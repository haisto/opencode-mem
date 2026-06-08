import type { ConfidenceStrategy, MergeParams, DecayParams } from "./confidence-strategy.js";
import { estimateMatchCountFromConfidence, DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA } from "./confidence-utils.js";

/**
 * Frequency-weighted confidence strategy.
 *
 *   boost = incoming * learningRate / (1 + matchCount)
 *   newConfidence = min(1, old + boost)
 *
 * Each successive match contributes less boost, so confidence grows
 * quickly at first and then saturates. Requires matchCount.
 *
 * Legacy data: when matchCount is undefined, it is estimated from the
 * existing confidence using the inverse Beta mean formula.
 */
export class FrequencyWeightedStrategy implements ConfidenceStrategy {
  readonly name = "frequency-weighted";
  readonly needsMatchCount = true;

  private readonly learningRate: number;

  constructor(learningRate = 0.3) {
    this.learningRate = learningRate;
  }

  private estimateMatchCount(confidence: number): number {
    return estimateMatchCountFromConfidence(confidence, DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA);
  }

  merge(params: MergeParams): number {
    const matchCount =
      params.matchCount ?? this.estimateMatchCount(params.existingConfidence);
    const old = params.existingConfidence;
    const incoming = params.incomingConfidence;
    const lr = this.learningRate;

    const boost = incoming * lr / (1 + matchCount);
    return Math.min(1, old + boost);
  }

  decay(params: DecayParams): number {
    const { confidence, age, decayThreshold } = params;
    if (age <= decayThreshold) return confidence;

    const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
    return Math.max(0, confidence * decayFactor);
  }
}
