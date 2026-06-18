/**
 * A single database schema migration.
 *
 * Each migration represents a sequential, irreversible schema upgrade.
 * Version numbers must be monotonically increasing within each database type.
 * Migrations are applied in order and never rolled back.
 */
export interface Migration {
  /** Monotonically increasing version number (1, 2, 3, …) */
  readonly version: number;

  /** Human-readable summary of what this migration does */
  readonly description: string;

  /**
   * Apply the migration.
   * Receives a connected database instance and may execute DDL (ALTER TABLE, …)
   * or DML (UPDATE, …) to evolve the schema or fix data.
   * Supports both synchronous and async migrations.
   */
  up: (db: any) => void | Promise<void>;
}
