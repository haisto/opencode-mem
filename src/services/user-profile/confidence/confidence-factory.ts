import type { ConfidenceStrategy } from "./confidence-strategy.js";
import { BayesianStrategy } from "./bayesian-strategy.js";
import { EWMAStrategy } from "./ewma-strategy.js";
import { FrequencyWeightedStrategy } from "./frequency-weighted-strategy.js";
import { CONFIDENCE_ALGORITHMS } from "./types.js";
import type { ConfidenceAlgorithm } from "./types.js";

export { CONFIDENCE_ALGORITHMS };
export type { ConfidenceAlgorithm };

/**
 * Create a confidence strategy by algorithm name.
 *
 * @param algorithm
 *   One of the CONFIDENCE_ALGORITHMS values.
 *   Defaults to "beta-binomial".
 * @param learningRate
 *   Learning rate for EWMA / FrequencyWeighted (default 0.3).
 *   Ignored by beta-binomial.
 * @throws
 *   If algorithm name is not recognised.
 */
export function createConfidenceStrategy(
  algorithm: string = CONFIDENCE_ALGORITHMS.BETA_BINOMIAL,
  learningRate?: number
): ConfidenceStrategy {
  switch (algorithm as ConfidenceAlgorithm) {
    case CONFIDENCE_ALGORITHMS.EWMA:
      return new EWMAStrategy(learningRate ?? 0.3);
    case CONFIDENCE_ALGORITHMS.FREQUENCY_WEIGHTED:
      return new FrequencyWeightedStrategy(learningRate ?? 0.3);
    case CONFIDENCE_ALGORITHMS.BETA_BINOMIAL:
      return new BayesianStrategy();
    default: {
      const available = Object.values(CONFIDENCE_ALGORITHMS).join(", ");
      throw new Error(
        `Unknown confidence algorithm: "${algorithm}". Available: ${available}`
      );
    }
  }
}
