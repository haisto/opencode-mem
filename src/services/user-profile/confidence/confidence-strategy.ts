import type { MergeParams, DecayParams } from "./types.js";

export interface ConfidenceStrategy {
  /**
   * Human-readable algorithm name.
   * Matches one of CONFIDENCE_ALGORITHMS values.
   */
  readonly name: string;
  /**
   * Whether this strategy requires the `matchCount` field
   * on preference items for accurate computation.
   */
  readonly needsMatchCount: boolean;
  /**
   * Compute merged confidence from existing item and incoming observation.
   */
  merge(params: MergeParams): number;
  /**
   * Compute decayed confidence based on how long ago the item was last updated.
   */
  decay(params: DecayParams): number;
}

export type { MergeParams, DecayParams };
export { CONFIDENCE_ALGORITHMS } from "./types.js";
export type { ConfidenceAlgorithm } from "./types.js";
