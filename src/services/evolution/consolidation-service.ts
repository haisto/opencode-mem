import { shardManager } from "../sqlite/shard-manager.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import { CONFIG } from "../../config.js";
import { log, logDebug } from "../logger.js";
import type {
  ConsolidationResult,
  MergePair,
  MergeResult,
  PruneResult,
  StrengthenResult,
} from "./types.js";

/**
 * Three-phase memory consolidation pipeline.
 *
 * Runs as a background job (fire-and-forget, typically triggered from the idle
 * handler) to automatically prune, merge, and strengthen memories.
 *
 *   Phase 1 – Prune:   delegates to {@link CleanupService} to remove stale
 *                       memories that exceed the retention window.
 *   Phase 2 – Merge:   scans all shards, performs O(n²) pairwise cosine
 *                       similarity per container-tag group, and supersedes
 *                       older near-duplicates with a similarity ≥ 0.92.
 *   Phase 3 – Strengthen: bumps `updated_at` on every survivor that absorbed
 *                          a merge, giving it a stronger recency signal.
 *
 * Singleton – import the module-level `consolidationService` instance.
 */
export class ConsolidationService {
  private isRunning = false;
  private lastRunTime = 0;

  /**
   * Cosine similarity threshold for near-duplicate detection.
   * Falls back to 0.92 when config is not set.
   */
  private get MERGE_THRESHOLD(): number {
    return CONFIG.consolidation?.mergeThreshold ?? 0.92;
  }

  /**
   * Minimum interval (ms) between two consolidation runs.
   * Falls back to 1 hour when config is not set.
   */
  private get MIN_INTERVAL_MS(): number {
    return CONFIG.consolidation?.minIntervalMs ?? 3_600_000;
  }

  // ------------------------------------------------------------------
  //  Public API
  // ------------------------------------------------------------------

  /**
   * Returns `true` when a consolidation run should be initiated:
   * the service is not already running, and the minimum interval
   * since the last run has elapsed.
   */
  async shouldRun(): Promise<boolean> {
    if (this.isRunning) {
      logDebug("Consolidation shouldRun: skipped — already running");
      return false;
    }
    if (!CONFIG.consolidation?.enabled) {
      logDebug("Consolidation shouldRun: skipped — consolidation disabled in config");
      return false;
    }
    const now = Date.now();
    if (now - this.lastRunTime < this.MIN_INTERVAL_MS) {
      const elapsed = Math.round((now - this.lastRunTime) / 1000);
      const minIntervalSec = Math.round(this.MIN_INTERVAL_MS / 1000);
      logDebug("Consolidation shouldRun: skipped — within min interval", { elapsed, minIntervalSec });
      return false;
    }
    logDebug("Consolidation shouldRun: proceeding");
    return true;
  }

  /**
   * Execute the full 3-phase consolidation pipeline.
   *
   * @param projectTag - Current project's container tag (e.g. "opencode_project_abc123").
   *                     When provided, only memories matching this tag are scanned.
   *                     When omitted, all project shards are scanned (legacy behavior).
   * @throws {Error} if a run is already in progress.
   */
  async run(projectTag?: string): Promise<ConsolidationResult> {
    if (this.isRunning) {
      throw new Error("Consolidation already running");
    }

    this.isRunning = true;
    const startTime = Date.now();
    this.lastRunTime = startTime;

    log("Consolidation run started", {
      mergeThreshold: this.MERGE_THRESHOLD,
    });

    try {
      const phase1 = await this.phase1Prune();
      const phase2 = await this.phase2Merge(projectTag);
      const phase3 = await this.phase3Strengthen(phase2.pairs);

      const duration = Date.now() - startTime;

      log("Consolidation complete", {
        phase1Pruned: phase1.deletedCount,
        phase2Merged: phase2.mergedCount,
        phase2Superseded: phase2.supersededCount,
        phase3Survivors: phase3.survivorsCount,
        duration,
      });

      return {
        phase1Pruned: phase1.deletedCount,
        phase2Merged: phase2.mergedCount,
        phase2Superseded: phase2.supersededCount,
        phase3Survivors: phase3.survivorsCount,
        duration,
        timestamp: Date.now(),
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Return current service status (useful for debugging / health checks).
   */
  getStatus(): {
    enabled: boolean;
    mergeThreshold: number;
    minIntervalMs: number;
    lastRunTime: number;
    isRunning: boolean;
  } {
    return {
      enabled: CONFIG.consolidation?.enabled ?? true,
      mergeThreshold: this.MERGE_THRESHOLD,
      minIntervalMs: this.MIN_INTERVAL_MS,
      lastRunTime: this.lastRunTime,
      isRunning: this.isRunning,
    };
  }

  // ------------------------------------------------------------------
  //  Phase 1 — Prune stale memories
  // ------------------------------------------------------------------

  /**
   * Delegate to {@link CleanupService} to delete memories that exceed
   * the configured retention window.
   *
   * Imported dynamically so that the consolidation pipeline does not
   * force an eager load of the cleanup service and all of its deps.
   */
  private async phase1Prune(): Promise<PruneResult> {
    try {
      const { cleanupService } = await import("../cleanup-service.js");
      if (await cleanupService.shouldRunCleanup()) {
        const result = await cleanupService.runCleanup();
        log("Phase 1 (Prune) complete", { deletedCount: result.deletedCount });
        return { deletedCount: result.deletedCount };
      }
    } catch (error) {
      log("Phase 1 (Prune) skipped", { error: String(error) });
    }
    return { deletedCount: 0 };
  }

  // ------------------------------------------------------------------
  //  Phase 2 — Merge near-duplicates
  // ------------------------------------------------------------------

  /**
   * Scan every user & project shard, group non-deleted memories by
   * `container_tag`, then compute O(n²) pairwise cosine similarity
   * within each group.
   *
   * When two memories exceed the threshold:
   *  - The **newer** (higher `created_at`) becomes the **survivor**.
   *  - The **older** is marked as **superseded**:
   *      `superseded_by ← survivor.id`
   *  - The survivor records the merge:
   *      `merged_from` (JSON array of absorbed IDs) is appended
   *      `merge_count` is incremented
   */
  private async phase2Merge(projectTag?: string): Promise<MergeResult> {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    // When projectTag targets a project scope, skip user shards entirely
    // because they can never match the project's container_tag.
    const shardsToScan =
      projectTag?.includes("_project_") ? projectShards : allShards;
    if (projectTag?.includes("_project_")) {
      logDebug("Phase 2: project tag detected, skipping user shards", { projectTag });
    }

    const pairs: MergePair[] = [];
    let supersededCount = 0;

    logDebug("Phase 2: scanning shards", {
      total: shardsToScan.length,
      userShards: userShards.length,
      projectShards: projectShards.length,
    });

    for (const shard of shardsToScan) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memories = vectorSearch.getAllMemories(db) as any[];

      logDebug("Phase 2: processing shard", {
        id: shard.id,
        totalMemories: memories.length,
        dbPath: shard.dbPath,
      });

      // Filter to current project only when projectTag is provided
      let scopedMemories = memories;
      if (projectTag) {
        scopedMemories = memories.filter((m: any) => m.container_tag === projectTag);
        if (scopedMemories.length !== memories.length) {
          logDebug("Phase 2: filtered to current project", {
            before: memories.length,
            after: scopedMemories.length,
            tag: projectTag,
          });
        }
      }

      // Group by container_tag and type together to prevent cross-type merging
      const groups = new Map<string, any[]>();
      for (const mem of scopedMemories) {
        // Skip pinned memories so they are never superseded
        if (mem.is_pinned === 1) continue;
        if (!mem.vector) continue;
        const tag = `${mem.container_tag}::${mem.type || ""}`;
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(mem);
      }

      logDebug("Phase 2: shard grouped by container_tag", {
        groupsWithContent: groups.size,
        totalMemoriesInGroups: Array.from(groups.values()).reduce((s, g) => s + g.length, 0),
      });

      for (const [tag, group] of groups) {
        if (group.length < 2) {
          logDebug("Phase 2: tag skipped — too few memories", { tag, count: group.length });
          continue;
        }

        const processedIds = new Set<string>();

        for (let i = 0; i < group.length; i++) {
          const mem1 = group[i];
          if (processedIds.has(mem1.id)) continue;

          const vector1 = new Float32Array(new Uint8Array(mem1.vector).buffer);

          for (let j = i + 1; j < group.length; j++) {
            const mem2 = group[j];
            if (processedIds.has(mem2.id)) continue;
            if (!mem2.vector) continue;

            const vector2 = new Float32Array(new Uint8Array(mem2.vector).buffer);
            const similarity = this.cosineSimilarity(vector1, vector2);

            if (similarity >= this.MERGE_THRESHOLD && similarity < 1.0) {
              // Survivor = the memory with the newer created_at timestamp
              const [survivor, superseded] =
                Number(mem1.created_at) >= Number(mem2.created_at)
                  ? [mem1, mem2]
                  : [mem2, mem1];

              pairs.push({
                survivorId: survivor.id,
                supersededId: superseded.id,
                similarity,
                containerTag: survivor.container_tag,
              });

              // Phase 2 merge in a transaction for atomicity, with optimistic locking
              // for cross-process concurrent merges on the same survivor.
              let mergedContent = "";
              let existingMerged: string[] = [];
              let currentMergeCount = 0;

              const mergeTransaction = db.transaction(() => {
                // Mark superseded memory
                db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`)
                  .run(survivor.id, superseded.id);

                // Null vectors in SQLite (keep row for audit trail)
                db.prepare(`UPDATE memories SET vector = NULL, tags_vector = NULL WHERE id = ?`)
                  .run(superseded.id);

                // Read current survivor state inside transaction = serialized
                const currentRow = db
                  .prepare(`SELECT merged_from, merge_count, content FROM memories WHERE id = ?`)
                  .get(survivor.id) as any;

                existingMerged = currentRow?.merged_from
                  ? JSON.parse(currentRow.merged_from)
                  : [];
                if (!existingMerged.includes(superseded.id)) {
                  existingMerged.push(superseded.id);
                }
                const oldMergeCount = currentRow?.merge_count ?? 0;
                currentMergeCount = oldMergeCount + 1;

                // Merge content from current DB content, not stale in-memory
                mergedContent = [
                  currentRow?.content ?? survivor.content,
                  superseded.content,
                ].filter(Boolean).join("\n---\n");

                // Optimistic lock: only succeed if merge_count hasn't changed
                const result = db.prepare(
                  `UPDATE memories SET merged_from = ?, merge_count = ?, content = ? ` +
                  `WHERE id = ? AND merge_count = ?`,
                ).run(
                  JSON.stringify(existingMerged), currentMergeCount,
                  mergedContent, survivor.id, oldMergeCount,
                );

                if (result.changes === 0) {
                  throw new Error("merge_count modified by concurrent process");
                }
              });

              // Retry loop: 3 attempts on optimistic lock failure
              let mergeRetries = 3;
              let mergeSuccess = false;
              while (mergeRetries > 0 && !mergeSuccess) {
                try {
                  mergeTransaction();
                  mergeSuccess = true;

                  // Sync in-memory survivor state after successful merge
                  survivor.content = mergedContent;
                  survivor.merged_from = JSON.stringify(existingMerged);
                  survivor.merge_count = currentMergeCount;

                  // Remove vector index entries (outside transaction — async, non-critical)
                  try {
                    await vectorSearch.removeVectorIndex(db, superseded.id, shard);
                    shardManager.decrementVectorCount(shard.id);
                  } catch (vecError) {
                    log("Phase 2: failed to remove vector index", {
                      supersededId: superseded.id,
                      error: String(vecError),
                    });
                  }
                } catch (txError) {
                  mergeRetries--;
                  if (mergeRetries === 0) {
                    log("Phase 2: merge failed after max retries", {
                      survivorId: survivor.id,
                      supersededId: superseded.id,
                      error: String(txError),
                    });
                    continue;
                  }
                  logDebug("Phase 2: merge conflict, retrying", {
                    survivorId: survivor.id,
                    supersededId: superseded.id,
                  });
                }
              }

              if (mergeSuccess) {
                logDebug("Phase 2: merged pair", {
                  survivorId: survivor.id, supersededId: superseded.id, similarity,
                });
                processedIds.add(superseded.id);
                supersededCount++;
              }
            }
          }
        }
      }
    }

    log("Phase 2 (Merge) complete", {
      mergedCount: pairs.length,
      supersededCount,
    });

    return {
      mergedCount: pairs.length,
      supersededCount,
      pairs,
    };
  }

  // ------------------------------------------------------------------
  //  Phase 3 — Strengthen survivors
  // ------------------------------------------------------------------

  /**
   * Touch the `updated_at` timestamp of every survivor that absorbed one
   * or more merges, giving it a stronger recency signal for future
   * search ranking and confidence decay.
   */
  private async phase3Strengthen(pairs: MergePair[]): Promise<StrengthenResult> {
    if (pairs.length === 0) return { survivorsCount: 0 };

    const survivorIds = [...new Set(pairs.map((p) => p.survivorId))];
    let strengthened = 0;

    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const now = Date.now();

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);

      for (const sid of survivorIds) {
        try {
          const result = db
            .prepare(`UPDATE memories SET updated_at = ? WHERE id = ? AND merge_count > 0`)
            .run(now, sid);

          if (result.changes > 0) strengthened++;
        } catch (error) {
          log("Phase 3: failed to strengthen survivor", {
            survivorId: sid,
            error: String(error),
          });
        }
      }
    }

    log("Phase 3 (Strengthen) complete", { survivorsCount: strengthened });
    return { survivorsCount: strengthened };
  }

  // ------------------------------------------------------------------
  //  Cosine Similarity
  // ------------------------------------------------------------------

  /**
   * Compute cosine similarity between two equal-length vectors.
   *
   * Returns a value in [0, 1] where 1.0 means identical direction.
   * Returns 0 if either vector is zero-length.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Pre-instantiated singleton — import this rather than constructing manually.
export const consolidationService = new ConsolidationService();
