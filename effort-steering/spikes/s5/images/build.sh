#!/usr/bin/env bash
# build.sh — build the three S5 images and record their IDs.
#
#   s5/codescout   the image for runs on a codescout task
#   s5/plugins     the image for runs on a claude-plugins task
#   s5/proxy       the allowlisting CONNECT proxy
#
# Writes images/digests.json: { "s5/codescout": "sha256:<64 hex>", "s5/plugins": ..., "s5/proxy": ... },
# each value being `docker image inspect --format '{{.Id}}'`. The file is generated and ignored by
# git (images/.gitignore); the prereg copies the IDs. --provenance=false: BuildKit would otherwise
# wrap each image in an index with an attestation manifest that records the build time, which is
# no use here and makes the ID depend on more than the image.
#
# This host runs other people's containers and images: the script only builds and tags the three
# images above. It never prunes, removes or stops anything.
#
# The base images (rust:1.97.1, node:26-trixie-slim, debian:trixie-slim) are pulled when they are
# not present locally, and `rustup component add` and apt need the network. Nothing else here does.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
images=(codescout plugins proxy)

docker version --format '{{.Server.Version}}' >/dev/null

declare -A ids
for name in "${images[@]}"; do
  echo "== build s5/${name}" >&2
  docker build --provenance=false --file "${here}/${name}.Dockerfile" --tag "s5/${name}" "${here}" >&2
  id="$(docker image inspect --format '{{.Id}}' "s5/${name}")"
  if [[ ! "${id}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "build.sh: s5/${name} has an unexpected image ID: '${id}'" >&2
    exit 1
  fi
  ids["${name}"]="${id}"
done

tmp="$(mktemp "${here}/.digests.json.XXXXXX")"
trap 'rm -f "${tmp}"' EXIT
{
  echo '{'
  for i in "${!images[@]}"; do
    name="${images[$i]}"
    sep=','
    [[ "${i}" -eq $((${#images[@]} - 1)) ]] && sep=''
    printf '  "s5/%s": "%s"%s\n' "${name}" "${ids[${name}]}" "${sep}"
  done
  echo '}'
} >"${tmp}"
mv "${tmp}" "${here}/digests.json"
trap - EXIT
echo "== wrote ${here}/digests.json" >&2
cat "${here}/digests.json"
