/**
 * Default Beta prior α for matchCount estimation.
 */
export const DEFAULT_PRIOR_ALPHA = 1;

/**
 * Default Beta prior β for matchCount estimation.
 */
export const DEFAULT_PRIOR_BETA = 1;

/**
 * Cap for estimated matchCount, prevents runaway on near-1.0 confidence.
 */
export const DEFAULT_MAX_ESTIMATE = 50;

/**
 * Estimate matchCount from a confidence value using the inverse Beta-Binomial mean formula.
 *
 * This is primarily used for legacy data that predates the `matchCount` field.
 * The formula assumes a Beta(priorAlpha, priorBeta) prior:
 *
 *   confidence = (priorAlpha + matchCount) / (priorAlpha + priorBeta + matchCount)
 *   → matchCount = (confidence * (priorAlpha + priorBeta) - priorAlpha) / (1 - confidence)
 *
 * @param confidence  Current confidence value (0-1).
 * @param priorAlpha  Beta prior α (default DEFAULT_PRIOR_ALPHA — uniform prior).
 * @param priorBeta   Beta prior β (default DEFAULT_PRIOR_BETA — uniform prior).
 * @param maxEstimate  Cap for the returned value.
 * @returns Estimated match count, capped at maxEstimate. Returns 0 for confidence <= 0.
 */
export function estimateMatchCountFromConfidence(
  confidence: number,
  priorAlpha = DEFAULT_PRIOR_ALPHA,
  priorBeta = DEFAULT_PRIOR_BETA,
  maxEstimate = DEFAULT_MAX_ESTIMATE
): number {
  if (!Number.isFinite(confidence) || confidence >= 1) return maxEstimate;
  if (confidence <= 0) return 0;

  /*
   * For confidence >= 0.99 the formula produces numbers >> maxEstimate,
   * which would unreasonably lock confidence near its current value.
   * Treat anything above 0.99 the same as 1.0.
   */
  if (confidence >= 0.99) return maxEstimate;

  return Math.max(
    0,
    Math.round(
      (confidence * (priorAlpha + priorBeta) - priorAlpha) / (1 - confidence)
    )
  );
}
