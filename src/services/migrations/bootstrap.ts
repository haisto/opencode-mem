import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { CONFIG } from "../../config.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { shardManager } from "../sqlite/shard-manager.js";
import { log } from "../logger.js";
import { runMigrations } from "./runner.js";
import {
  METADATA_MIGRATIONS,
  SHARD_MIGRATIONS,
  AI_SESSION_MIGRATIONS,
  USER_PROMPT_MIGRATIONS,
  USER_PROFILE_MIGRATIONS,
} from "./registry.js";
import type { Migration } from "./types.js";

/** Format an error for logging — prefers stack trace over message. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

/* ── Known system database filenames ──────────────────────────────────── */

const SYSTEM_DBS: Array<{ filename: string; label: string; migrations: readonly Migration[] }> = [
  { filename: "metadata.db",      label: "metadata",      migrations: METADATA_MIGRATIONS },
  { filename: "ai-sessions.db",   label: "ai-sessions",   migrations: AI_SESSION_MIGRATIONS },
  { filename: "user-prompts.db",  label: "user-prompts",  migrations: USER_PROMPT_MIGRATIONS },
  { filename: "user-profiles.db", label: "user-profiles", migrations: USER_PROFILE_MIGRATIONS },
];

/**
 * Run pending schema migrations on all managed databases.
 *
 * Scans:
 *   1. System databases in `CONFIG.storagePath`.
 *   2. Shard databases registered in `metadata.db`.
 *
 * Idempotent — databases already at the latest version are skipped.
 * Errors for individual databases are logged and isolated; other DBs
 * still receive their migrations.
 */
export async function runAllMigrations(): Promise<void> {
  const { storagePath } = CONFIG;

  /* ── 1. System databases ───────────────────────────────────────────── */

  for (const { filename, label, migrations } of SYSTEM_DBS) {
    const dbPath = join(storagePath, filename);
    if (!existsSync(dbPath)) continue;

    try {
      const db = connectionManager.getConnection(dbPath);
      const count = await runMigrations(db, migrations);
      if (count > 0) {
        log(`Schema migration: ${label} — ${count} migration(s) applied`);
      }
    } catch (error) {
      log(`Schema migration failed for ${label}`, { error: formatError(error) });
    }
  }

  /* ── 2. Shard databases (discovered via metadata.db) ───────────────── */

  try {
    const allShards = [
      ...shardManager.getAllShards("user", ""),
      ...shardManager.getAllShards("project", ""),
    ];

    const seen = new Set<string>();
    for (const shard of allShards) {
      if (seen.has(shard.dbPath)) continue;
      seen.add(shard.dbPath);

      if (!existsSync(shard.dbPath)) continue;

      try {
        const db = connectionManager.getConnection(shard.dbPath);
        const count = await runMigrations(db, SHARD_MIGRATIONS);
        if (count > 0) {
          log(`Schema migration: shard ${basename(shard.dbPath)} — ${count} migration(s) applied`);
        }
      } catch (error) {
        log(`Schema migration failed for shard ${basename(shard.dbPath)}`, {
          error: formatError(error),
        });
      }
    }
  } catch (error) {
    log("Schema migration: failed to discover shard databases", { error: formatError(error) });
  }
}
