import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Reports the cost an operation consumed.
 *
 * Invoked once per execution regardless of success or failure, so a failed
 * attempt that still cost money (e.g. a partial LLM completion) can be
 * charged. Return a non-negative number in the same unit as `maxCost`
 * (typically US dollars).
 *
 * @template T - The operation result type
 */
export type CostFunc<T> = (result: T | undefined, error: Error | undefined) => number;

/**
 * Upper bound for any monetary amount (the `maxCost` ceiling and each
 * `costFunc` return). Mirrors Go fortify's micro-USD overflow rejection:
 * beyond `Number.MAX_SAFE_INTEGER` float arithmetic loses integer precision and
 * cost accounting becomes unreliable (and can saturate to `Infinity`), so such
 * values are rejected rather than silently disabling or corrupting the cap.
 */
export const MAX_SAFE_COST = Number.MAX_SAFE_INTEGER;

/**
 * Whether a number is a safe, finite, positive monetary amount. Shared by the
 * `maxCost` validation and the per-call `costFunc` guard so the money-safety
 * checks cannot drift between the two. Rejects NaN, ±Infinity, non-positive
 * values, and magnitudes beyond {@link MAX_SAFE_COST}.
 */
export function isSafePositiveCost(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_SAFE_COST;
}

/**
 * Zod schema for the validatable (non-function) parts of the config.
 * Function and generic fields are validated separately.
 */
export const costBudgetConfigSchema = z.object({
  /**
   * Spending ceiling; must be a positive, finite amount within
   * {@link MAX_SAFE_COST}. `z.number()` already rejects NaN/±Infinity; the
   * refinement adds the safe-integer overflow guard.
   */
  maxCost: z
    .number()
    .positive()
    .refine((v) => v <= MAX_SAFE_COST, {
      message: `maxCost must not exceed ${String(MAX_SAFE_COST)} (safe-integer money range)`,
    }),
  /** Rolling-window duration in milliseconds; must be positive when set. */
  resetAfter: z.number().positive().optional(),
});

/**
 * Configuration for the {@link CostBudget} pattern.
 *
 * Mirrors the Go fortify `CostBudgetConfig` convenience surface:
 * a single-dimension monetary ceiling with an optional time-based
 * auto-reset window.
 *
 * @template T - The operation result type
 */
export interface CostBudgetConfig<T> {
  /**
   * The spending ceiling, in your chosen currency unit (e.g. US dollars).
   * Must be positive. Once the accumulated cost exceeds this value, further
   * executions are refused with a {@link BudgetExceededError}.
   */
  maxCost: number;

  /**
   * Reports the cost an operation consumed. Invoked once per execution
   * regardless of err. Required.
   */
  costFunc: CostFunc<T>;

  /**
   * When set (in milliseconds), turns the budget into a rolling window:
   * the accumulated spend is automatically cleared once this much time has
   * elapsed since the window opened. Omit to cap for the lifetime of the
   * instance.
   */
  resetAfter?: number;

  /**
   * Fires once when the ceiling is first breached. Receives the accumulated
   * cost after the breaching call. Synchronous; keep it short.
   */
  onExceeded?: (consumedCost: number) => void;

  /**
   * Time source for the `resetAfter` window, in milliseconds. Defaults to
   * a monotonic clock. Override to drive the window deterministically in
   * tests or simulations.
   */
  clock?: () => number;

  /** Logger instance for structured logging. */
  logger?: FortifyLogger;
}

/**
 * Validate a cost-budget configuration.
 *
 * @throws {Error} When `maxCost` is non-positive, `costFunc` is missing,
 *   or `resetAfter` is non-positive.
 */
export function validateCostBudgetConfig<T>(config: CostBudgetConfig<T>): CostBudgetConfig<T> {
  // Runtime check for JS users or those using `as any`.
  if (typeof config.costFunc !== 'function') {
    throw new Error('costFunc is required and must be a function');
  }
  costBudgetConfigSchema.parse({
    maxCost: config.maxCost,
    resetAfter: config.resetAfter,
  });
  return config;
}
