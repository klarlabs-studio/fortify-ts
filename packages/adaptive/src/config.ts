import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Limit-tuning strategy. Mirrors the Go adaptive.Algorithm enum.
 *
 * - `aimd`: additive increase on success, multiplicative decrease on failure.
 *   Predictable; ignores latency. The default.
 * - `vegas`: RTT-aware. Tracks the min observed latency (no-load baseline) and
 *   an EMA of recent latencies, estimates the induced queue depth, and raises
 *   the limit when the queue is shallow (< vegasAlpha) / lowers when deep
 *   (> vegasBeta). Reacts to rising latency before failures appear.
 * - `gradient2`: smoothed gradient-of-RTT controller. gradient = min/longEMA
 *   clamped to [0.5, 1.0]; newLimit = floor(cur * gradient + sqrt(cur)).
 *   Reacts more aggressively than Vegas under variable load.
 */
export type Algorithm = 'aimd' | 'vegas' | 'gradient2';

const DEFAULT_INITIAL_LIMIT = 10;
const DEFAULT_MIN_LIMIT = 1;
const DEFAULT_MAX_LIMIT = 200;
const DEFAULT_SUCCESS_THRESHOLD = 10;
const DEFAULT_VEGAS_ALPHA = 3;
const DEFAULT_VEGAS_BETA = 6;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_GRADIENT_SMOOTHING = 0.2;

/**
 * Zod schema for adaptive limiter configuration. Validates the raw shape;
 * cross-field clamping (initial within [min, max], beta > alpha, ...) is
 * applied in {@link parseAdaptiveConfig} to mirror the Go setDefaults logic.
 */
export const adaptiveConfigSchema = z.object({
  algorithm: z.enum(['aimd', 'vegas', 'gradient2']).default('aimd'),
  /** Starting concurrency cap. Clamped into [minLimit, maxLimit]. */
  initialLimit: z.number().int().positive().default(DEFAULT_INITIAL_LIMIT),
  /** Floor that multiplicative decrease will not go below. */
  minLimit: z.number().int().positive().default(DEFAULT_MIN_LIMIT),
  /** Ceiling that additive increase will not exceed. */
  maxLimit: z.number().int().positive().default(DEFAULT_MAX_LIMIT),
  /** AIMD only: consecutive successes required before the limit is raised. */
  successThreshold: z.number().int().positive().default(DEFAULT_SUCCESS_THRESHOLD),
  /** Vegas only: low-water mark for the queue-depth estimate. */
  vegasAlpha: z.number().int().positive().default(DEFAULT_VEGAS_ALPHA),
  /** Vegas only: high-water mark for the queue-depth estimate. Must be > alpha. */
  vegasBeta: z.number().int().positive().default(DEFAULT_VEGAS_BETA),
  /** Vegas only: min RTT samples before adjustments fire. */
  vegasMinSamples: z.number().int().positive().default(DEFAULT_MIN_SAMPLES),
  /** Gradient2 only: min RTT samples before adjustments fire. */
  gradientMinSamples: z.number().int().positive().default(DEFAULT_MIN_SAMPLES),
  /** Gradient2 only: EMA smoothing coefficient in (0, 1]; smaller = smoother. */
  gradientSmoothing: z.number().positive().max(1).default(DEFAULT_GRADIENT_SMOOTHING),
});

/** Raw config input (before defaults/clamping). */
export type AdaptiveConfigInput = z.input<typeof adaptiveConfigSchema>;

/** Parsed config (after defaults). */
export type AdaptiveConfigParsed = z.output<typeof adaptiveConfigSchema>;

/** Full configuration including callbacks and logger. */
export interface AdaptiveConfig extends AdaptiveConfigParsed {
  /** Called when the limit changes, with the old and new values. */
  onLimitChange: ((oldLimit: number, newLimit: number) => void) | undefined;
  /** Logger for structured logging of limit changes. */
  logger: FortifyLogger | undefined;
  /**
   * Monotonic clock in milliseconds, used to time RTT-aware algorithms.
   * Defaults to performance.now(). Override for deterministic tests.
   */
  clock: (() => number) | undefined;
}

/** Input config type for the constructor. */
export interface AdaptiveConfigInputFull extends AdaptiveConfigInput {
  onLimitChange?: (oldLimit: number, newLimit: number) => void;
  logger?: FortifyLogger;
  clock?: () => number;
}

/**
 * Parse, validate, and clamp adaptive configuration, applying the same
 * cross-field defaults as the Go adaptive.Config.setDefaults.
 */
export function parseAdaptiveConfig(config?: AdaptiveConfigInputFull): AdaptiveConfig {
  const parsed = adaptiveConfigSchema.parse(config ?? {});

  const { minLimit, vegasAlpha } = parsed;
  let { maxLimit, initialLimit, vegasBeta } = parsed;

  if (maxLimit < minLimit) {
    maxLimit = minLimit;
  }
  if (initialLimit < minLimit) {
    initialLimit = minLimit;
  }
  if (initialLimit > maxLimit) {
    initialLimit = maxLimit;
  }
  if (vegasBeta <= vegasAlpha) {
    vegasBeta = vegasAlpha * 2;
  }

  return {
    ...parsed,
    minLimit,
    maxLimit,
    initialLimit,
    vegasAlpha,
    vegasBeta,
    onLimitChange: config?.onLimitChange,
    logger: config?.logger,
    clock: config?.clock,
  };
}
