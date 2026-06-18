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
];
