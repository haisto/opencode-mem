import type { Migration } from "./types.js";

/**
 * Apply pending schema migrations to a database connection.
 *
 * Reads `PRAGMA user_version` to determine the current schema version,
 * then applies all migrations with `version > currentVersion` in order.
 * After each successful migration, `PRAGMA user_version` is updated so
 * partially-applied sequences resume from the failure point on restart.
 *
 * @param db          - Connected SQLite database instance.
 * @param migrations  - Ordered list of migrations for this database type.
 * @returns           - Number of migrations applied (0 if already current).
 */
export async function runMigrations(
  db: any,
  migrations: readonly Migration[],
): Promise<number> {
  const row = db.prepare("PRAGMA user_version").get() as any;
  const currentVersion: number = row?.user_version ?? 0;

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const pending = sorted.filter((m) => m.version > currentVersion);

  if (pending.length === 0) return 0;

  let applied = 0;
  for (const migration of pending) {
    await migration.up(db);
    // PRAGMA doesn't support parameterised queries in bun:sqlite / node:sqlite / better-sqlite3.
    // migration.version is always a controlled number — interpolation is safe.
    db.run(`PRAGMA user_version = ${migration.version}`);
    applied++;
  }

  return applied;
}
