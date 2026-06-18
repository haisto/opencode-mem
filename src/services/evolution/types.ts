/**
 * Result of a full consolidation run.
 */
export interface ConsolidationResult {
  /**
   * Number of memories pruned in phase 1.
   */
  readonly phase1Pruned: number;
  /**
   * Number of merge operations performed in phase 2.
   */
  readonly phase2Merged: number;
  /**
   * Number of memories marked as superseded in phase 2.
   */
  readonly phase2Superseded: number;
  /**
   * Number of survivor memories strengthened in phase 3.
   */
  readonly phase3Survivors: number;
  /**
   * Total duration of the consolidation run in milliseconds.
   */
  readonly duration: number;
  /**
   * Unix timestamp (ms) when the consolidation completed.
   */
  readonly timestamp: number;
}

/**
 * A pair of memories being merged — one survives, the other is superseded.
 */
export interface MergePair {
  /**
   * ID of the memory that will be kept (the survivor).
   */
  readonly survivorId: string;
  /**
   * ID of the memory that will be marked as superseded.
   */
  readonly supersededId: string;
  /**
   * Cosine similarity score between the two memories.
   */
  readonly similarity: number;
  /**
   * Container tag shared by both memories.
   */
  readonly containerTag: string;
}

/**
 * Audit trail entry for a memory that has been superseded.
 */
export interface SupersededRecord {
  /**
   * Original memory ID that was superseded.
   */
  readonly originalId: string;
  /**
   * Memory ID of the surviving entry that replaced it.
   */
  readonly supersededById: string;
  /**
   * Reason for superseding this memory.
   */
  readonly reason: "near-duplicate" | "contradiction";
  /**
   * Unix timestamp (ms) when the supersede action occurred.
   */
  readonly mergedAt: number;
  /**
   * Tags from the superseded memory, merged into the survivor (optional).
   */
  readonly mergedTags?: string;
  /**
   * Content from the superseded memory, merged into the survivor (optional).
   */
  readonly mergedContent?: string;
}

/**
 * Result of the phase 1 pruning step.
 */
export interface PruneResult {
  /**
   * Number of memories deleted during pruning.
   */
  readonly deletedCount: number;
}

/**
 * Result of the phase 2 merge step.
 */
export interface MergeResult {
  /**
   * Number of merge operations performed.
   */
  readonly mergedCount: number;
  /**
   * Number of memories marked as superseded.
   */
  readonly supersededCount: number;
  /**
   * List of merge pairs that were processed.
   */
  readonly pairs: MergePair[];
}

/**
 * Result of the phase 3 strengthening step.
 */
export interface StrengthenResult {
  /**
   * Number of survivor memories that were strengthened.
   */
  readonly survivorsCount: number;
}
