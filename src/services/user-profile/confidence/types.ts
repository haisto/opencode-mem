/**
 * Confidence algorithm identifiers.
 * Defined as const + type instead of enum to keep the JSON config surface simple.
 */
export const CONFIDENCE_ALGORITHMS = {
  /**
   * Beta-Binomial (default).
   * Tracks match count for gradual Bayesian updates. Needs `matchCount` field.
   */
  BETA_BINOMIAL: "beta-binomial",
  /**
   * Exponential Moving Average.
   * Simple damped update, no extra fields needed.
   */
  EWMA: "ewma",
  /**
   * Frequency-weighted.
   * Diminishing returns per match, needs `matchCount` field.
   */
  FREQUENCY_WEIGHTED: "frequency-weighted",
} as const;

export type ConfidenceAlgorithm = (typeof CONFIDENCE_ALGORITHMS)[keyof typeof CONFIDENCE_ALGORITHMS];

export interface MergeParams {
  /**
   * Existing confidence value (0-1).
   */
  existingConfidence: number;
  /**
   * Incoming confidence value (0-1) from the new observation.
   */
  incomingConfidence: number;
  /**
   * Evidence strings from the existing item.
   */
  existingEvidence: string[];
  /**
   * Evidence strings from the incoming item.
   */
  incomingEvidence: string[];
  /**
   * Number of times this preference has been observed/matched AFTER this merge.
   * i.e., existing matchCount + 1 (for the current incoming observation).
   * May be undefined for legacy data — strategies that require it should
   * estimate from the existing confidence value.
   */
  matchCount?: number;
}

export interface DecayParams {
  /**
   * Current confidence value (0-1).
   */
  confidence: number;
  /**
   * Milliseconds since last update.
   */
  age: number;
  /**
   * Threshold in milliseconds.
   * Decay only applies when age > this value.
   */
  decayThreshold: number;
  /**
   * Number of times this preference has been observed/matched.
   * Optional — strategies that need it should estimate from confidence
   * when not provided (legacy data).
   */
  matchCount?: number;
}
