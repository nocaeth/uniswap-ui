/**
 * SQLite store for the Gnosis analytics adapter.
 *
 * `backfill.ts` (the historical indexer) writes this DB; `envio.ts` reads it for
 * the ExploreStats ConnectRPC service and the GraphQL detail/transactions schema.
 * Uses bun's built-in `bun:sqlite` (zero external deps, fast). The DB lives at
 * `data/analytics.db` and is opened in WAL mode so the server can read while a
 * fresh backfill writes.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DB_PATH =
  process.env.ANALYTICS_DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'analytics.db')

/** DDL for the analytics store. Idempotent. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Current per-token snapshot (used by the Explore tokens table + token rankings).
CREATE TABLE IF NOT EXISTS tokens (
  id            TEXT PRIMARY KEY,   -- lowercased address
  symbol        TEXT,
  name          TEXT,
  decimals      INTEGER,
  totalSupply   TEXT,               -- raw uint256 as decimal string
  logo          TEXT,
  priceUSD      REAL,
  tvlUSD        REAL,
  fdv           REAL,
  volume1h      REAL,
  volume1d      REAL,
  volume7d      REAL,
  volume30d     REAL,
  volume1y      REAL,
  priceChange1h REAL,
  priceChange1d REAL,
  priceChange1w REAL,
  priceChange1m REAL,
  priceChange1y REAL
);

-- Current per-pool snapshot (used by the Explore pools table + pool detail).
CREATE TABLE IF NOT EXISTS pools (
  id               TEXT PRIMARY KEY,  -- lowercased pool address
  token0           TEXT,
  token1           TEXT,
  feeTier          INTEGER,
  createdBlock     INTEGER,
  createdTimestamp INTEGER,
  tvlUSD           REAL,
  tvlChange1d      REAL,
  volume1d         REAL,
  volume7d         REAL,
  volume30d        REAL,
  feesUSD          REAL,
  txCount          INTEGER,
  token0Price      REAL,             -- token1 per token0 (spot)
  token1Price      REAL,             -- token0 per token1 (spot)
  token0Supply     REAL,             -- current reserve token0 (human)
  token1Supply     REAL              -- current reserve token1 (human)
);

-- Daily/hourly rollups for charts + percent-change.
CREATE TABLE IF NOT EXISTS token_day_data (
  tokenId   TEXT,
  day       INTEGER,                 -- unix seconds, start of day (UTC)
  priceUSD  REAL,
  volumeUSD REAL,
  tvlUSD    REAL,
  PRIMARY KEY (tokenId, day)
);
CREATE TABLE IF NOT EXISTS token_hour_data (
  tokenId   TEXT,
  hour      INTEGER,                 -- unix seconds, start of hour (UTC)
  priceUSD  REAL,
  volumeUSD REAL,
  PRIMARY KEY (tokenId, hour)
);
CREATE TABLE IF NOT EXISTS pool_day_data (
  poolId      TEXT,
  day         INTEGER,
  volumeUSD   REAL,
  tvlUSD      REAL,
  feesUSD     REAL,
  token0Price REAL,
  token1Price REAL,
  txCount     INTEGER,
  PRIMARY KEY (poolId, day)
);
CREATE TABLE IF NOT EXISTS protocol_day_data (
  day       INTEGER PRIMARY KEY,
  tvlUSD    REAL,
  volumeUSD REAL
);

-- Recent transactions feed (swap/add/remove) for the GraphQL transactions tables.
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,      -- hash + log index
  hash        TEXT,
  logIndex    INTEGER,
  type        TEXT,                  -- SWAP | ADD | REMOVE
  poolId      TEXT,
  token0      TEXT,
  token1      TEXT,
  amount0     REAL,                  -- signed, human (pool-perspective delta)
  amount1     REAL,
  amountUSD   REAL,
  account     TEXT,
  timestamp   INTEGER,
  blockNumber INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_pool_ts ON transactions(poolId, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_ts      ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_t0_ts   ON transactions(token0, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_t1_ts   ON transactions(token1, timestamp DESC);
`

let cached: Database | undefined

/** Opens (and caches) the analytics DB. `write` enables creation + RW for the indexer. */
export function getDb(write = false): Database {
  if (cached) {
    return cached
  }
  if (write) {
    mkdirSync(dirname(DB_PATH), { recursive: true })
  }
  const db = new Database(DB_PATH, write ? { create: true, readwrite: true } : { readonly: true })
  db.exec('PRAGMA journal_mode = WAL;')
  if (write) {
    db.exec('PRAGMA synchronous = NORMAL;')
  }
  cached = db
  return db
}

export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL)
}
