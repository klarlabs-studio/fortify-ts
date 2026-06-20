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
 * Zod schema for the validatable (non-function) parts of the config.
 * Function and generic fields are validated separately.
 */
export const costBudgetConfigSchema = z.object({
  /** Spending ceiling; must be positive. */
  maxCost: z.number().positive(),
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
