# Match this exact Node version on production hosts; rebuild deliberately when upgrading.
FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/local/bin/node /usr/bin/node
RUN mkdir -p /cache/npm /cache/next && chown -R node:node /cache
USER node
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /tmp
