import type { ConfidenceStrategy, MergeParams, DecayParams } from "./confidence-strategy.js";
import { estimateMatchCountFromConfidence, DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA } from "./confidence-utils.js";

/**
 * Prior α for the Beta distribution.
 * α (hits) starts at 1, β (misses) starts at 1 → prior mean = 0.5.
 * Shared with confidence-utils defaults for consistency across all strategies.
 */
const PRIOR_ALPHA = DEFAULT_PRIOR_ALPHA;
const PRIOR_BETA = DEFAULT_PRIOR_BETA;

/**
 * Scaling factor for β increase during decay.
 * Higher = confidence drops faster once past the decay threshold.
 *
 * Formula: β_increase = (1 - decayFactor) * DECAY_BETA_SCALE
 * At decayFactor=0.5 (maximum decay), β increases by 5.
 */
const DECAY_BETA_SCALE = 10;

/**
 * Beta-Binomial Bayesian confidence strategy (default).
 *
 * Treats confidence as the mean of a Beta(α, β) distribution:
 *
 *   α = PRIOR_ALPHA + matchCount
 *   β  recovered from existing confidence (preserves decay history)
 *   confidence = α / (α + β)
 *
 * Key property: β is **recovered** from the existing confidence value on each
 * merge, so any prior decay effects are preserved. This means:
 *   - merge increments α (one more observation)
 *   - β carries forward the decay from previous cycles
 *   - decay increases β (time penalty)
 *
 * Legacy data compatibility:
 *   When `matchCount` is undefined (pre-existing preference written before this
 *   strategy existed), the strategy estimates matchCount from the current
 *   confidence value via the inverse Beta mean formula.
 */
export class BayesianStrategy implements ConfidenceStrategy {
  readonly name = "beta-binomial";
  readonly needsMatchCount = true;

  /**
   * Estimate matchCount from a confidence value (inverse Beta mean).
   * Delegates to shared utility for consistency across all strategies.
   */
  private estimateMatchCount(confidence: number): number {
    return estimateMatchCountFromConfidence(confidence, PRIOR_ALPHA, PRIOR_BETA);
  }

  merge(params: MergeParams): number {
    const matchCount =
      params.matchCount ?? this.estimateMatchCount(params.existingConfidence);
    const alpha = PRIOR_ALPHA + matchCount;

    /*
     * Recover β from existing confidence to preserve decay history.
     * β = α_old * (1 / confidence - 1)
     * where α_old = PRIOR_ALPHA + matchCount - 1 (before this merge)
     */
    const alphaOld = PRIOR_ALPHA + Math.max(0, matchCount - 1);
    const beta =
      params.existingConfidence > 0 && alphaOld > 0
        ? Math.max(PRIOR_BETA, alphaOld * (1 / params.existingConfidence - 1))
        : PRIOR_BETA;

    return alpha / (alpha + beta);
  }

  decay(params: DecayParams): number {
    const { confidence, age, decayThreshold } = params;
    if (age <= decayThreshold) return confidence;

    const matchCount =
      params.matchCount ?? this.estimateMatchCount(confidence);
    const alpha = PRIOR_ALPHA + matchCount;

    // Recover current β from confidence (already includes any prior decay)
    const currentBeta =
      confidence > 0
        ? Math.max(PRIOR_BETA, alpha * (1 / confidence - 1))
        : PRIOR_BETA;

    // Decay increases β — the longer past threshold, the more β grows
    const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
    const newBeta = currentBeta + (1 - decayFactor) * DECAY_BETA_SCALE;

    return alpha / (alpha + newBeta);
  }
}
