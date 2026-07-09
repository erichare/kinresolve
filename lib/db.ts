import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export type DatabaseOptions = {
  databaseUrl?: string;
};

const pools = new Map<string, Pool>();
const schemaPromises = new Map<string, Promise<void>>();

export function getDatabaseUrl(options: DatabaseOptions = {}): string {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Start Postgres or set DATABASE_URL before running KinSleuth.");
  }

  return databaseUrl;
}

export function getPool(options: DatabaseOptions = {}): Pool {
  const databaseUrl = getDatabaseUrl(options);
  const existing = pools.get(databaseUrl);
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: process.env.NODE_ENV === "test" ? 2 : 10
  });
  pools.set(databaseUrl, pool);
  return pool;
}

export async function ensureDatabaseSchema(options: DatabaseOptions = {}): Promise<void> {
  const databaseUrl = getDatabaseUrl(options);
  const existing = schemaPromises.get(databaseUrl);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const migrationPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "migrations", "001_initial.sql");
    const sql = await readFile(migrationPath, "utf8");
    await getPool(options).query(sql);
  })();

  schemaPromises.set(databaseUrl, promise);
  return promise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  options: DatabaseOptions = {}
): Promise<QueryResult<T>> {
  await ensureDatabaseSchema(options);
  return getPool(options).query<T>(text, values);
}

export async function withClient<T>(options: DatabaseOptions, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabaseSchema(options);
  const client = await getPool(options).connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(options: DatabaseOptions, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(options, async (client) => {
    await client.query("BEGIN");
    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function closeDatabasePools(): Promise<void> {
  const openPools = [...pools.values()];
  pools.clear();
  schemaPromises.clear();
  await Promise.all(openPools.map((pool) => pool.end()));
}
