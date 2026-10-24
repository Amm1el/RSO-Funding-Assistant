import pg from "pg";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

/** The slice of a Postgres client this app uses. Satisfied by node-postgres and by PGlite below. */
export interface Queryable {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
export interface DbPool extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * postgres://...         → a real Postgres server (Docker locally, Neon/RDS in production)
 * pglite://data/pglite   → embedded Postgres (WebAssembly) stored in that folder: no server,
 *                          no Docker, just Node. Relative paths are from the repo root.
 * pglite://memory        → embedded, in memory (tests)
 */
export function createDbPool(connectionString: string): DbPool {
  if (connectionString.startsWith("pglite:")) return createPglitePool(connectionString.replace(/^pglite:(\/\/)?/, ""));
  const pool = new pg.Pool({ connectionString });
  // HNSW returns this many candidates before WHERE filters apply; a section filter needs
  // more than the default 40 so filtered searches still fill their top-k.
  pool.on("connect", (client) => void client.query("SET hnsw.ef_search = 400").catch(() => {}));
  return pool as unknown as DbPool;
}

function createPglitePool(location: string): DbPool {
  const dataDir = location === "memory" || location === "" ? undefined : isAbsolute(location) ? location : resolve(REPO_ROOT, location);
  // Loaded lazily so the regular Postgres path never pays for the WebAssembly bundle.
  const ready = (async () => {
    const [{ PGlite }, { vector }] = await Promise.all([import("@electric-sql/pglite"), import("@electric-sql/pglite-pgvector")]);
    const db = await PGlite.create({ dataDir, extensions: { vector } });
    await db.exec("SET hnsw.ef_search = 400").catch(() => {});
    return db;
  })();

  // PGlite is a single connection. Statements are serialized by PGlite itself; transactions take
  // a lock so another caller's statements can't land inside BEGIN ... COMMIT.
  let lock: Promise<void> = Promise.resolve();
  const query = async <R>(text: string, params?: unknown[]) => {
    const db = await ready;
    // Multi-statement SQL (the schema file) has to go through exec(); it takes no parameters.
    if (!params?.length && text.includes(";")) {
      await db.exec(text);
      return { rows: [] as R[] };
    }
    const res = await db.query<R>(text, params as any[]);
    return { rows: res.rows };
  };

  return {
    async query<R>(text: string, params?: unknown[]) {
      await lock;
      return query<R>(text, params);
    },
    async connect() {
      const previous = lock;
      let unlock!: () => void;
      lock = new Promise<void>((r) => (unlock = r));
      await previous;
      return { query, release: unlock };
    },
    async end() {
      await (await ready).close();
    },
  };
}
