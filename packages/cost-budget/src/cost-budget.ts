import {
  type Operation,
  type Pattern,
  type Resettable,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
  now as monotonicNow,
} from '@klarlabs-studio/fortify-core';
import { type CostBudgetConfig, validateCostBudgetConfig } from './config.js';
import { BudgetExceededError } from './error.js';

/**
 * Cost budget pattern: caps the cumulative monetary cost of operations.
 *
 * Tracks accumulated cost across `execute` calls and refuses further work
 * once the configured `maxCost` ceiling is reached. The caller supplies a
 * `costFunc` that converts each operation's result and error into a cost.
 *
 * This is the TypeScript parity of Go fortify's `WithCostBudget`
 * convenience API: a single-dimension monetary ceiling with optional
 * time-based auto-reset via `resetAfter`.
 *
 * @template T - The operation result type
 *
 * @example
 * ```typescript
 * const budget = new CostBudget<Response>({
 *   maxCost: 5.0, // $5 ceiling
 *   resetAfter: 60 * 60 * 1000, // rolling hour
 *   costFunc: (result) => result?.usdCost ?? 0,
 * });
 *
 * const out = await budget.execute(async (signal) => callProvider(signal));
 * ```
 */
export class CostBudget<T> implements Pattern<T>, Resettable {
  private readonly config: CostBudgetConfig<T>;
  private readonly logger: FortifyLogger;
  private readonly clock: () => number;

  private consumed = 0;
  private breached = false;
  private windowStart: number | undefined;

  /**
   * Create a new CostBudget instance.
   *
   * @param config - Cost budget configuration
   * @throws {Error} When the configuration is invalid
   */
  constructor(config: CostBudgetConfig<T>) {
    this.config = validateCostBudgetConfig(config);
    this.logger = this.config.logger ?? noopLogger;
    this.clock = this.config.clock ?? monotonicNow;
  }

  /**
   * Execute an operation, charging its cost against the budget.
   *
   * If the budget is already breached, the operation is not run and a
   * {@link BudgetExceededError} is thrown. Otherwise the operation runs,
   * its cost is charged (even when it throws), and a
   * {@link BudgetExceededError} is thrown if the ceiling is now exceeded.
   * The operation's own error and result are otherwise preserved.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {BudgetExceededError} When the budget ceiling is reached
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    this.maybeAutoReset();

    if (this.breached) {
      throw this.exceededError();
    }

    const operationSignal = signal ?? NEVER_ABORTED_SIGNAL;

    let result: T | undefined;
    let opError: Error | undefined;
    let threw: unknown;
    let didThrow = false;

    try {
      result = await operation(operationSignal);
    } catch (error) {
      didThrow = true;
      threw = error;
      opError = error instanceof Error ? error : new Error(String(error));
    }

    // Charge the cost regardless of success or failure.
    const cost = this.safeCost(result, opError);
    if (cost > 0) {
      this.consumed += cost;
    }

    if (this.consumed > this.config.maxCost) {
      this.markBreach();
      throw this.exceededError();
    }

    if (didThrow) {
      throw threw;
    }
    return result as T;
  }

  /**
   * Get the accumulated cost in the configured currency unit.
   */
  getConsumedCost(): number {
    return this.consumed;
  }

  /**
   * Clear the accumulated cost and re-arm the budget (and `onExceeded`).
   * Also closes any open rolling window; the next `execute` reopens it.
   */
  reset(): void {
    this.consumed = 0;
    this.breached = false;
    this.windowStart = undefined;
  }

  private maybeAutoReset(): void {
    const resetAfter = this.config.resetAfter;
    if (resetAfter === undefined) {
      return;
    }
    const current = this.clock();
    if (this.windowStart === undefined) {
      this.windowStart = current;
      return;
    }
    if (current - this.windowStart < resetAfter) {
      return;
    }
    // Window elapsed: open a fresh one and clear accumulated cost.
    this.windowStart = current;
    this.consumed = 0;
    this.breached = false;
  }

  private markBreach(): void {
    if (this.breached) {
      return;
    }
    this.breached = true;
    if (this.config.onExceeded) {
      this.safeCallback(() => {
        // Non-null asserted: guarded by the if above.
        this.config.onExceeded?.(this.consumed);
      });
    }
  }

  private exceededError(): BudgetExceededError {
    return new BudgetExceededError(this.consumed, this.config.maxCost);
  }

  private safeCost(result: T | undefined, error: Error | undefined): number {
    try {
      const cost = this.config.costFunc(result, error);
      return Number.isFinite(cost) && cost > 0 ? cost : 0;
    } catch (callbackError) {
      this.logger.error('costFunc threw an error', {
        error: callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
      return 0;
    }
  }

  private safeCallback(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.error('onExceeded callback threw an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
