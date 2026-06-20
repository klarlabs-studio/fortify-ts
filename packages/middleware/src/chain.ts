import { type Operation, type Pattern, NEVER_ABORTED_SIGNAL } from '@klarlabs-studio/fortify-core';
import { type Timeout } from '@klarlabs-studio/fortify-timeout';
import { type Retry } from '@klarlabs-studio/fortify-retry';
import { type CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { type RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { type Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { type Fallback } from '@klarlabs-studio/fortify-fallback';
import { type CostBudget } from '@klarlabs-studio/fortify-cost-budget';

/**
 * Middleware function type that wraps an operation with resilience behavior.
 *
 * @template T - The return type of operations
 */
export type Middleware<T> = (
  next: Operation<T>
) => Operation<T>;

/**
 * Composable middleware chain for combining resilience patterns.
 *
 * The chain allows stacking multiple patterns in any order, creating
 * flexible and powerful resilience strategies.
 *
 * Execution order is from first added to last added (outer to inner):
 * - First middleware added is the outermost wrapper
 * - Last middleware added is closest to the actual operation
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const chain = new Chain<Response>()
 *   .withBulkhead(bulkhead)
 *   .withRateLimit(rateLimiter, 'user-123')
 *   .withTimeout(timeout, 5000)
 *   .withCircuitBreaker(circuitBreaker)
 *   .withRetry(retry)
 *   .withFallback(fallback);
 *
 * const result = await chain.execute(async (signal) => {
 *   return fetch('/api/data', { signal });
 * });
 * ```
 */
export class Chain<T> implements Pattern<T> {
  private readonly middlewares: Middleware<T>[] = [];

  /**
   * Add a circuit breaker to the middleware chain.
   *
   * @param cb - Circuit breaker instance
   * @returns this chain for method chaining
   */
  withCircuitBreaker(cb: CircuitBreaker<T>): this {
    const middleware: Middleware<T> = (next) => (signal) => cb.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add retry logic to the middleware chain.
   *
   * @param retry - Retry instance
   * @returns this chain for method chaining
   */
  withRetry(retry: Retry<T>): this {
    const middleware: Middleware<T> = (next) => (signal) => retry.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add rate limiting to the middleware chain.
   *
   * The rate limiter will wait for a token to be available before proceeding.
   *
   * @param rl - Rate limiter instance
   * @param key - Rate limiting key (e.g., user ID, IP address)
   * @returns this chain for method chaining
   */
  withRateLimit(rl: RateLimiter, key = ''): this {
    const middleware: Middleware<T> = (next) => async (signal) => {
      await rl.wait(key, signal);
      return next(signal);
    };
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add timeout enforcement to the middleware chain.
   *
   * @param tm - Timeout instance
   * @param duration - Timeout duration in milliseconds (optional, uses default if not specified)
   * @returns this chain for method chaining
   */
  withTimeout(tm: Timeout<T>, duration?: number): this {
    const middleware: Middleware<T> = (next) => (signal) =>
      duration !== undefined
        ? tm.executeWithTimeout(next, duration, signal)
        : tm.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add concurrency limiting to the middleware chain.
   *
   * @param bh - Bulkhead instance
   * @returns this chain for method chaining
   */
  withBulkhead(bh: Bulkhead<T>): this {
    const middleware: Middleware<T> = (next) => (signal) => bh.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add fallback to the middleware chain.
   *
   * @param fb - Fallback instance
   * @returns this chain for method chaining
   */
  withFallback(fb: Fallback<T>): this {
    const middleware: Middleware<T> = (next) => (signal) => fb.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add a cost budget to the middleware chain.
   *
   * Place the budget inside retry (i.e. add it after withRetry) so each
   * attempt is charged, capping the total cost of a retry storm. Once the
   * budget's ceiling is reached, execute rejects with a
   * BudgetExceededError and the operation is refused.
   *
   * @param cb - Cost budget instance
   * @returns this chain for method chaining
   */
  withCostBudget(cb: CostBudget<T>): this {
    const middleware: Middleware<T> = (next) => (signal) => cb.execute(next, signal);
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add a custom middleware to the chain.
   *
   * @param middleware - Custom middleware function
   * @returns this chain for method chaining
   */
  use(middleware: Middleware<T>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Get the number of middlewares in the chain.
   */
  get length(): number {
    return this.middlewares.length;
  }

  /**
   * Check if the chain has any middlewares.
   */
  isEmpty(): boolean {
    return this.middlewares.length === 0;
  }

  /**
   * Execute an operation through all middlewares in the chain.
   *
   * Middlewares are applied in the order they were added to the chain.
   * If no middlewares are configured, the operation is executed directly.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   */
  execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    // Build the chain from right to left (last added = innermost)
    // Note: middlewares array is private and never contains null values,
    // so no null check is needed in this hot path
    let next = operation;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      next = this.middlewares[i]!(next);
    }
    return next(signal ?? NEVER_ABORTED_SIGNAL);
  }
}
