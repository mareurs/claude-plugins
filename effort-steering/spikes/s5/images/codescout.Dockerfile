# s5/codescout — the image every S5 run on a codescout task executes in.
#
# What is in it:   the official rust:1.97.1 image (Debian 13 trixie, the build tools and -dev
#                  libraries of buildpack-deps) + the rustfmt, clippy and rust-analyzer components,
#                  Node 26, Python 3, git, curl, ca-certificates, jq; user `agent` (uid 1000).
# What is NOT in it: a repo, a secret, the Claude Code binary. The binary is mounted read-only at
#                  /opt/claude/claude at run time, the task tree is mounted, and the cargo home
#                  (the fetched crates) is mounted read-only at /cargo from <workRoot>/cargo-home.
#
# Node 26 is copied from the official node:26-trixie-slim image rather than installed from
# NodeSource: the binary is pinned by that image's tag, the build needs no extra apt repository or
# signing key, and the same copy step builds s5/plugins, so both images carry the same node.
# trixie is the Debian release of rust:1.97.1, so the node binary links the same glibc it was
# built for.
FROM node:26-trixie-slim AS node

FROM rust:1.97.1

ENV DEBIAN_FRONTEND=noninteractive

# libatomic1 is a runtime dependency of the node binary. mold: codescout's .cargo/config.toml
# links with `-C link-arg=-fuse-ld=mold`, and without it every build and every test binary fails
# to link (found by the R19 check: `cargo test --no-run` on codescout HEAD).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq libatomic1 mold python3 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version

# The toolchain stays in RUSTUP_HOME (/usr/local/rustup, root-owned, world-readable). This runs
# BEFORE CARGO_HOME moves to /cargo below, while rustup still finds its own proxies.
RUN rustup component add rustfmt clippy rust-analyzer

# `agent`: uid/gid 1000, the same ids as the host user, so the mounted task tree is writable.
# The home directory is created empty (no skeleton files).
RUN useradd --uid 1000 --user-group --no-create-home --shell /bin/bash agent \
 && install -d -o agent -g agent -m 0755 /home/agent

# Two settings that keep a run from reaching for anything outside the image (both found by the
# R19 check on codescout HEAD):
#  * RUSTUP_TOOLCHAIN: codescout's rust-toolchain.toml names the channel 1.97.1 AND the target
#    x86_64-pc-windows-gnu. rustup, finding that target missing, downloads rust-std at the start of
#    every `cargo` call (the toolchain directory is world-writable in the official image, so it
#    even succeeds when there is a network and fails when there is not). Naming the toolchain in
#    the environment makes rustup ignore the file: the image's own 1.97.1 is the toolchain.
#  * RUSTC_WRAPPER (empty): the same config.toml says `rustc-wrapper = "sccache"`. An empty
#    variable overrides it (cargo: "does not use a wrapper"), so sccache is neither needed nor
#    installed, and no cache server is left running in a run's container.
ENV RUSTUP_TOOLCHAIN=1.97.1-x86_64-unknown-linux-gnu \
    RUSTC_WRAPPER=""

# At run time /cargo is a read-only mount of <workRoot>/cargo-home, filled once by a networked
# `cargo fetch` run in this image (checked: a clean `cargo test --no-run --no-default-features` then
# builds with --network none and /cargo mounted read-only). Agent containers have no route to a
# registry, so cargo is offline.
ENV CARGO_HOME=/cargo \
    CARGO_NET_OFFLINE=true
RUN install -d -o agent -g agent -m 0755 /cargo

USER agent
WORKDIR /home/agent
