import {
  type Operation,
  type Pattern,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import { type HedgeConfig, type HedgeConfigInputFull, parseHedgeConfig } from './config.js';

/**
 * Hedge pattern implementation for tail-latency reduction.
 *
 * A hedged request fires the primary attempt immediately. If it has not
 * returned within `hedgeDelay`, a second attempt is fired in parallel (and
 * optionally a third, fourth, ...) up to `maxAttempts`. The first successful
 * result wins; remaining in-flight attempts are cancelled via their
 * AbortSignal. If all attempts fail, the first error is returned.
 *
 * Hedging trades extra work for lower tail latency. Use only on idempotent
 * operations: under hedging, multiple attempts may run to completion before
 * the cancellation propagates, so each attempt's side effects must be safe to
 * repeat.
 *
 * This mirrors the Go `hedge` package semantics.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const hedge = new Hedge<Response>({ maxAttempts: 3, hedgeDelay: 50 });
 *
 * const result = await hedge.execute(async (signal) => {
 *   return fetch('/api/data', { signal });
 * });
 * ```
 */
export class Hedge<T> implements Pattern<T> {
  private readonly config: HedgeConfig;
  private readonly logger: FortifyLogger;

  /**
   * Create a new Hedge instance.
   *
   * @param config - Hedge configuration
   */
  constructor(config?: HedgeConfigInputFull) {
    this.config = parseHedgeConfig(config);
    this.logger = this.config.logger ?? noopLogger;
  }

  /**
   * Execute an operation with hedged attempts.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the first successful result
   * @throws The first error if every attempt fails
   * @throws {DOMException} When cancelled via the parent signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    const parent = signal ?? NEVER_ABORTED_SIGNAL;

    // Check the parent signal up front.
    if (parent.aborted) {
      throw parent.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // All attempts share a controller derived from the parent so a winner can
    // cancel the losers, and a parent abort cancels every attempt.
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort(parent.reason);
    parent.addEventListener('abort', onParentAbort, { once: true });

    const { maxAttempts, hedgeDelay } = this.config;

    return new Promise<T>((resolve, reject) => {
      let fired = 0;
      let collected = 0;
      let settled = false;
      let firstError: unknown;
      let hasFirstError = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        parent.removeEventListener('abort', onParentAbort);
      };

      const win = (value: T): void => {
        if (settled) return;
        settled = true;
        cleanup();
        controller.abort();
        resolve(value);
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        controller.abort();
        // Re-throw the original rejection reason untouched (mirrors the Go
        // hedge returning the first error as-is); it is a caught rejection,
        // not a freshly minted non-Error value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      };

      const onAttemptError = (error: unknown): void => {
        if (settled) return;
        collected++;
        if (!hasFirstError) {
          hasFirstError = true;
          firstError = error;
        }
        // All fired attempts have now reported, and no more will be fired.
        if (collected === fired && fired === maxAttempts) {
          fail(firstError);
        }
      };

      const fire = (): void => {
        fired++;
        void Promise.resolve(operation(controller.signal)).then(
          (value) => {
            win(value);
          },
          (error: unknown) => {
            onAttemptError(error);
          }
        );
      };

      const scheduleNext = (): void => {
        if (settled) return;
        if (fired >= maxAttempts) return;
        timer = setTimeout(() => {
          if (settled) return;
          if (fired < maxAttempts) {
            fire();
            const attempt = fired;
            this.logHedge(attempt);
            this.safeCallOnHedge(attempt);
            scheduleNext();
          }
        }, hedgeDelay);
      };

      // Honour a parent abort that arrives while attempts are in flight.
      controller.signal.addEventListener('abort', () => {
        if (parent.aborted) {
          fail(parent.reason ?? new DOMException('Aborted', 'AbortError'));
        }
      });

      // Fire the primary immediately, then schedule hedges.
      fire();
      scheduleNext();
    });
  }

  /** Get the configuration. */
  getConfig(): Readonly<HedgeConfig> {
    return this.config;
  }

  /** Log a hedge attempt firing. */
  private logHedge(attempt: number): void {
    this.logger.debug('hedge attempt fired', {
      pattern: 'hedge',
      attempt,
      maxAttempts: this.config.maxAttempts,
      hedgeDelay: this.config.hedgeDelay,
    });
  }

  /** Safely invoke the onHedge callback. */
  private safeCallOnHedge(attempt: number): void {
    if (!this.config.onHedge) return;
    try {
      this.config.onHedge(attempt);
    } catch (callbackError) {
      this.logger.error('onHedge callback threw an error', {
        pattern: 'hedge',
        error: callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
    }
  }
}
