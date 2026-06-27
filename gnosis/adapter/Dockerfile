# Gnosis analytics adapter — serves ExploreStats + positions (ConnectRPC) and the
# token/pool GraphQL on top of a SQLite store. Runs on Bun (the adapter uses
# bun:sqlite, so it cannot run on Node). Build context is this directory.
#
#   docker build -t gnosis-adapter gnosis/adapter
#
# The same image runs each role (compose overrides the command):
#   - server : `bun src/server.ts`   (default CMD)
#   - indexer: `bun src/backfill.ts` (bootstrap/repair writes)
#   - syncer : `bun src/sync.ts`     (incremental tail)
FROM oven/bun:1.3.11
WORKDIR /app

# Install deps against the committed lockfile (no build/transpile step — Bun runs TS).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
# The GraphQL endpoint loads the upstream schema SDL. Vendored here so the build
# context stays self-contained; refresh with `bun run sync-schema`.
COPY schema.graphql ./schema.graphql

# Schema is vendored next to the app; DB lives on a mounted volume (see compose).
ENV GRAPHQL_SCHEMA_PATH=/app/schema.graphql
ENV ANALYTICS_DB_PATH=/data/analytics.db
ENV PORT=8081
EXPOSE 8081
CMD ["bun", "src/server.ts"]
