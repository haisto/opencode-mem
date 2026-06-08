import type { ConfidenceStrategy, MergeParams, DecayParams } from "./confidence-strategy.js";

/**
 * Exponential Moving Average confidence strategy.
 *
 *   newConfidence = old * (1 - learningRate) + incoming * learningRate
 *
 * A simple damped-update that prevents single high-confidence observations
 * from instantly maxing out the score. Does NOT require matchCount.
 */
export class EWMAStrategy implements ConfidenceStrategy {
  readonly name = "ewma";
  readonly needsMatchCount = false;

  private readonly learningRate: number;

  constructor(learningRate = 0.3) {
    this.learningRate = learningRate;
  }

  merge(params: MergeParams): number {
    const old = params.existingConfidence;
    const incoming = params.incomingConfidence;
    const lr = this.learningRate;
    return Math.min(1, old * (1 - lr) + incoming * lr);
  }

  decay(params: DecayParams): number {
    const { confidence, age, decayThreshold } = params;
    if (age <= decayThreshold) return confidence;

    const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
    return Math.max(0, confidence * decayFactor);
  }
}
