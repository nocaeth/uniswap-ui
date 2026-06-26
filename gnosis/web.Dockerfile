# Build the Gnosis-only interface and serve the static bundle with nginx.
# Build context must be the repo root: `docker build -f gnosis/web.Dockerfile .`
FROM oven/bun:1.3.11 AS build
WORKDIR /app
COPY . .
# Install with the committed patches (incl. the @uniswap/sdk-core Gnosis patch).
RUN bun install --frozen-lockfile
# Production build (Vite). DEPLOY_TARGET unset -> plain static output in apps/web/build.
RUN bunx nx run @universe/web:build:production || bunx nx build web
# Build output location can vary by target; normalize to /app/web-build.
RUN sh -c 'cp -r apps/web/build /app/web-build 2>/dev/null || cp -r apps/web/.vercel/output/static /app/web-build'

FROM nginx:alpine
COPY --from=build /app/web-build /usr/share/nginx/html
# SPA fallback so client-side routes (e.g. /explore, /positions) resolve.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
