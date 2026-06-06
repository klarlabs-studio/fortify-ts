import { addJitter } from '@klarlabs-studio/fortify-core';
import { type BackoffPolicy } from './config.js';

// Re-export addJitter from core for backwards compatibility
export { addJitter } from '@klarlabs-studio/fortify-core';

/**
 * Absolute maximum delay to prevent integer overflow.
 * Set to 1 hour (3,600,000 ms) as a reasonable upper bound.
 * This prevents exponential backoff from overflowing JavaScript's safe integer range.
 */
export const ABSOLUTE_MAX_DELAY_MS = 3_600_000; // 1 hour

/**
 * Calculate delay for a given attempt using the specified backoff policy.
 *
 * Includes an absolute cap of 1 hour to prevent integer overflow with
 * exponential backoff at high attempt counts.
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param initialDelay - Initial delay in milliseconds
 * @param policy - Backoff policy to use
 * @param multiplier - Multiplier for exponential backoff
 * @returns Delay in milliseconds (capped at ABSOLUTE_MAX_DELAY_MS)
 */
export function calculateDelay(
  attempt: number,
  initialDelay: number,
  policy: BackoffPolicy,
  multiplier: number
): number {
  // Attempt 1 = first retry, so we start from 0 for calculation
  const retryNumber = attempt - 1;

  let delay: number;

  switch (policy) {
    case 'exponential':
      // delay = initialDelay * multiplier^(attempt-1)
      // Use Math.min to prevent overflow before multiplication becomes too large
      delay = initialDelay * Math.pow(multiplier, retryNumber);
      break;

    case 'linear':
      // delay = initialDelay * attempt
      delay = initialDelay * attempt;
      break;

    case 'constant':
      // delay = initialDelay (always the same)
      delay = initialDelay;
      break;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }

  // Apply absolute cap to prevent overflow and unreasonably long delays
  return Math.min(delay, ABSOLUTE_MAX_DELAY_MS);
}

/**
 * Clamp a delay to a maximum value.
 *
 * @param delay - Delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @returns Clamped delay
 */
export function clampDelay(delay: number, maxDelay?: number): number {
  if (maxDelay === undefined) {
    return delay;
  }
  return Math.min(delay, maxDelay);
}

/**
 * Calculate the final delay for a retry attempt.
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param options - Backoff calculation options
 * @returns Final delay in milliseconds
 */
export function getRetryDelay(
  attempt: number,
  options: {
    initialDelay: number;
    policy: BackoffPolicy;
    multiplier: number;
    maxDelay: number | undefined;
    jitter: boolean;
  }
): number {
  let delay = calculateDelay(
    attempt,
    options.initialDelay,
    options.policy,
    options.multiplier
  );

  delay = clampDelay(delay, options.maxDelay);

  if (options.jitter) {
    delay = addJitter(delay);
  }

  return delay;
}
