# Build the Gnosis-only interface and serve the static bundle with nginx.
# Build context is the repo root: `docker build -f gnosis/web.Dockerfile .`
# (gnosis/web.Dockerfile.dockerignore overrides the repo-root .dockerignore, which
#  is scoped to other images and excludes apps/web.)
# Build under Node — the Vite/Rollup build does not run cleanly under Bun's runtime
# (it fails in the generate phase) — but use Bun for the dependency install.
FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app

# Bun (single static binary) for a lockfile-faithful, fast install.
COPY --from=oven/bun:1.3.11 /usr/local/bin/bun /usr/local/bin/bun

# git is needed at build time: the postinstall configures the hooks path and
# vite.config.mts runs `git rev-parse HEAD` for the build commit hash.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Deployment-specific values. Vite bakes env at build time, so these MUST be build
# args — passing them as container env at runtime has no effect on a static bundle.
ARG API_BASE_URL_V2_OVERRIDE=""
ARG GRAPHQL_URL_OVERRIDE=""
ARG REACT_APP_WALLET_CONNECT_PROJECT_ID=""
ARG REACT_APP_GNOSIS_RPC_URL=""
ARG REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS=""

# The CSP meta-tag plugin reads these from process.env to allow the adapter origin
# in connect-src (see apps/web/vite/vite.plugins.ts).
ENV API_BASE_URL_V2_OVERRIDE=$API_BASE_URL_V2_OVERRIDE \
    GRAPHQL_URL_OVERRIDE=$GRAPHQL_URL_OVERRIDE

COPY . .
# Skip the runtime-version gate — the toolchain is pinned by the base image + copied
# bun, so the build shouldn't hinge on exact version-string matching. All other
# install scripts still run.
RUN SKIP_RUNTIME_VERSION_CHECK=1 bun install --frozen-lockfile

# Bake the non-empty overrides into .env.production (mode=production loads it with
# highest precedence, covering keys outside Vite's process.env allowlist such as
# GRAPHQL_URL_OVERRIDE). Empty args are skipped so committed defaults aren't clobbered.
RUN f=apps/web/.env.production; \
    for kv in \
      "API_BASE_URL_V2_OVERRIDE=$API_BASE_URL_V2_OVERRIDE" \
      "GRAPHQL_URL_OVERRIDE=$GRAPHQL_URL_OVERRIDE" \
      "REACT_APP_WALLET_CONNECT_PROJECT_ID=$REACT_APP_WALLET_CONNECT_PROJECT_ID" \
      "REACT_APP_GNOSIS_RPC_URL=$REACT_APP_GNOSIS_RPC_URL" \
      "REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS=$REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS" \
    ; do case "$kv" in *=) ;; *) printf '%s\n' "$kv" >> "$f";; esac; done

# Plain static build: with DEPLOY_TARGET unset the Cloudflare plugin is skipped and
# Vite emits a static SPA to apps/web/build. (The nx build targets force
# DEPLOY_TARGET=cloudflare, so invoke Vite directly.)
RUN cd apps/web && NODE_OPTIONS="--max-old-space-size=8192" node ../../node_modules/.bin/vite build --mode production

FROM nginx:alpine
COPY --from=build /app/apps/web/build /usr/share/nginx/html
# Serve the SPA (with client-side-route fallback) AND reverse-proxy the analytics
# adapter at /api on the same origin (so no second domain / CORS / CSP host needed).
COPY gnosis/web.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
