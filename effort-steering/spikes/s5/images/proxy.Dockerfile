# s5/proxy — the allowlisting CONNECT proxy (tinyproxy) agent containers reach the API through.
#
# The image holds the binary only. The configuration (and, in allowlist mode, the filter file) is
# written by proxy.mjs from tinyproxy.conf.tmpl into a host directory and mounted read-only at
# /etc/s5-proxy, so one image serves both modes and a change of allowlist needs no rebuild.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# tinyproxy-bin: the daemon without the init script and the service user the `tinyproxy` package
# adds. bash is here for the readiness probe proxy.mjs runs with `docker exec`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash tinyproxy-bin \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --shell /usr/sbin/nologin tinyproxy

USER tinyproxy
EXPOSE 8888
# -d: stay in the foreground and log to stderr, where `docker logs` finds it.
ENTRYPOINT ["tinyproxy", "-d", "-c", "/etc/s5-proxy/tinyproxy.conf"]
