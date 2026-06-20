import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/** Default total attempts (including the primary) when unset. */
const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * Upper bound on parallel attempts to prevent fan-out storms from a
 * pathologically slow primary. Mirrors the Go hedge maxAttemptsCap.
 */
const MAX_ATTEMPTS_CAP = 16;

/** Default wait (ms) before firing the next hedge attempt. */
const DEFAULT_HEDGE_DELAY_MS = 100;

/** Maximum hedge delay (ms): 1 hour, a generous guard against typos. */
const MAX_HEDGE_DELAY_MS = 3_600_000;

/**
 * Zod schema for Hedge configuration.
 *
 * Mirrors the Go hedge.Config semantics: maxAttempts is the TOTAL number of
 * parallel attempts including the primary (1 disables hedging), capped at 16;
 * hedgeDelay is the wait before firing each subsequent attempt.
 */
export const hedgeConfigSchema = z.object({
  /**
   * Total number of parallel attempts INCLUDING the primary. 1 disables
   * hedging. Defaults to 2. Capped at 16.
   */
  maxAttempts: z.number().int().positive().max(MAX_ATTEMPTS_CAP).default(DEFAULT_MAX_ATTEMPTS),
  /**
   * Time in milliseconds to wait before firing the next hedge attempt after
   * the previous one. A short delay reduces tail latency at the cost of extra
   * work; a long delay approaches the no-hedge case. Defaults to 100.
   */
  hedgeDelay: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_HEDGE_DELAY_MS)
    .default(DEFAULT_HEDGE_DELAY_MS),
});

/** Raw config input type (before defaults are applied). */
export type HedgeConfigInput = z.input<typeof hedgeConfigSchema>;

/** Parsed config type (after defaults are applied). */
export type HedgeConfigParsed = z.output<typeof hedgeConfigSchema>;

/** Full configuration including callbacks and logger. */
export interface HedgeConfig extends HedgeConfigParsed {
  /**
   * Called each time a hedge attempt is fired (i.e., not the initial primary).
   * Receives the 1-based attempt index of the just-fired hedge (so the second
   * attempt overall is onHedge(2)).
   */
  onHedge: ((attempt: number) => void) | undefined;
  /** Logger for structured logging of hedge events. */
  logger: FortifyLogger | undefined;
}

/** Input config type for the constructor. */
export interface HedgeConfigInputFull extends HedgeConfigInput {
  onHedge?: (attempt: number) => void;
  logger?: FortifyLogger;
}

/**
 * Parse and validate hedge configuration, applying defaults.
 *
 * @param config - Raw configuration input
 * @returns Validated configuration with defaults applied
 */
export function parseHedgeConfig(config?: HedgeConfigInputFull): HedgeConfig {
  const parsed = hedgeConfigSchema.parse(config ?? {});
  // A zero hedgeDelay would fire every attempt immediately, defeating the
  // tail-latency purpose; clamp it to the default like the Go implementation.
  const hedgeDelay = parsed.hedgeDelay <= 0 ? DEFAULT_HEDGE_DELAY_MS : parsed.hedgeDelay;
  return {
    ...parsed,
    hedgeDelay,
    onHedge: config?.onHedge,
    logger: config?.logger,
  };
}
