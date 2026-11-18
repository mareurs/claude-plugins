# s5/plugins — the image every S5 run on a claude-plugins task executes in.
#
# What is in it:   Debian 13 trixie (slim), Node 26, bash, jq, Python 3, git, curl,
#                  ca-certificates; user `agent` (uid 1000).
# What is NOT in it: a repo, a secret, the Claude Code binary (mounted read-only at
#                  /opt/claude/claude at run time).
#
# Node 26 comes from the official node:26-trixie-slim image, the same copy step as s5/codescout
# (see the note there). debian:trixie-slim and that node image are the same Debian release.
FROM node:26-trixie-slim AS node

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# libatomic1 is a runtime dependency of the node binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git jq libatomic1 python3 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version

# `agent`: uid/gid 1000, the same ids as the host user, so the mounted task tree is writable.
# The home directory is created empty (no skeleton files).
RUN useradd --uid 1000 --user-group --no-create-home --shell /bin/bash agent \
 && install -d -o agent -g agent -m 0755 /home/agent

USER agent
WORKDIR /home/agent
