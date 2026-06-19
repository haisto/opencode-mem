import type { Migration } from "./types.js";

/**
 * === Migration Registry ===
 *
 * Each database type has its own ordered migration list.
 *
 * Guidelines for adding migrations:
 * - Append to the array — never insert, delete, or reorder entries.
 * - Every new migration must have version = lastVersion + 1.
 * - Wrap ALTER TABLE / UPDATE in existence guards (PRAGMA table_info) so
 *   that the migration is idempotent across restarts.
 * - DDL statements (ALTER TABLE) implicitly commit in WAL mode; keep each
 *   migration as a single atomic change.
 *
 * ---
 *
 * v1 (Baseline, no-op):
 *   Acknowledges the current schema as version 1.  The actual tables are
 *   bootstrapped by each manager's CREATE TABLE IF NOT EXISTS, so v1 has
 *   no work to do — it solely establishes the version baseline so future
 *   migrations (v2, v3, …) can run on existing databases.
 */

// ── metadata.db (shard registry) ──────────────────────────────────────────

export const METADATA_MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Baseline schema", up: () => {} },
];

// ── *_shard_*.db (vector shards) ───────────────────────────────────────────

export const SHARD_MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Baseline schema", up: () => {} },

  /**
   * v2 — Add consolidation columns to `memories` table.
   *
   * Introduces three columns supporting the self-evolution consolidation
   * pipeline: superseded_by (ID of the survivor that replaced this record),
   * merged_from (JSON array of source IDs that were merged into this one),
   * and merge_count (how many times this record has been a merge target).
   *
   * Each ALTER TABLE is guarded by PRAGMA table_info so the migration is
   * idempotent across restarts (already-applied columns are skipped).
   */
  {
    version: 2,
    description: "Add superseded_by, merged_from, merge_count to memories",
    up: (db: any) => {
      const tableInfo = db
        .prepare("PRAGMA table_info('memories')")
        .all() as any[];
      const hasColumn = (name: string) =>
        tableInfo.some((col: any) => col.name === name);

      if (!hasColumn("superseded_by")) {
        db.run("ALTER TABLE memories ADD COLUMN superseded_by TEXT");
      }
      if (!hasColumn("merged_from")) {
        db.run("ALTER TABLE memories ADD COLUMN merged_from TEXT");
      }
      if (!hasColumn("merge_count")) {
        db.run(
          "ALTER TABLE memories ADD COLUMN merge_count INTEGER DEFAULT 0",
        );
      }
    },
  },
];

// ── ai-sessions.db ─────────────────────────────────────────────────────────

export const AI_SESSION_MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Baseline schema", up: () => {} },
];

// ── user-prompts.db ────────────────────────────────────────────────────────

export const USER_PROMPT_MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Baseline schema", up: () => {} },
];

// ── user-profiles.db ───────────────────────────────────────────────────────

export const USER_PROFILE_MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Baseline schema", up: () => {} },

  /**
   * v2 — Add profile_embeddings table for vector-based preference matching.
   *
   * Stores description embeddings in a separate table referenced by
   * `embeddingId` on each preference/pattern, avoiding JSON blob bloat
   * and enabling efficient BLOB storage for float32 vectors.
   */
  {
    version: 2,
    description: "Create profile_embeddings table",
    up: (db: any) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS profile_embeddings (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
    },
  },
];
