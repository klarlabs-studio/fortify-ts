import {
  type Operation,
  type Pattern,
  type FortifyLogger,
  FortifyError,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import {
  type AdaptiveConfig,
  type AdaptiveConfigInputFull,
  parseAdaptiveConfig,
} from './config.js';

/**
 * Error thrown when the current adaptive concurrency limit is reached. The
 * limit may auto-recover over time as in-flight operations drain and successes
 * accumulate. Mirrors the Go adaptive.ErrLimitExceeded sentinel.
 */
export class AdaptiveLimitExceededError extends FortifyError {
  constructor(message = 'Adaptive concurrency limit exceeded') {
    super(message);
    this.name = 'AdaptiveLimitExceededError';
  }
}

/**
 * Adaptive concurrency limiter that auto-tunes its in-flight cap in response
 * to observed success and failure outcomes.
 *
 * Unlike a static bulkhead (fixed cap), the limiter starts at `initialLimit`
 * and adjusts via the configured {@link Algorithm}:
 *
 * - **aimd** (default): +1 to the limit on every `successThreshold`
 *   consecutive successes (up to `maxLimit`); halve on any failure (down to
 *   `minLimit`).
 * - **vegas** / **gradient2**: RTT-aware controllers that react to rising
 *   latency before failures appear.
 *
 * Mirrors the Go `adaptive` package semantics. JavaScript runs the limiter on
 * a single thread, so the Go atomics become plain counters here while the
 * tuning math is identical.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const limiter = new AdaptiveLimiter<Response>({
 *   initialLimit: 10,
 *   minLimit: 2,
 *   maxLimit: 100,
 *   successThreshold: 20,
 * });
 *
 * const result = await limiter.execute(async (signal) => downstream(signal));
 * ```
 */
export class AdaptiveLimiter<T> implements Pattern<T> {
  private readonly config: AdaptiveConfig;
  private readonly logger: FortifyLogger;
  private readonly clock: () => number;

  private currentLimit: number;
  private inFlightCount = 0;
  private successes = 0;

  // RTT tracking (Vegas / Gradient2), in milliseconds. 0 = not yet observed.
  private minRtt = 0;
  private emaRtt = 0;
  private rttSamples = 0;

  /**
   * Create a new adaptive limiter.
   *
   * @param config - Adaptive configuration
   */
  constructor(config?: AdaptiveConfigInputFull) {
    this.config = parseAdaptiveConfig(config);
    this.logger = this.config.logger ?? noopLogger;
    this.clock =
      this.config.clock ??
      (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.currentLimit = this.config.initialLimit;
  }

  /** Current concurrency cap. */
  limit(): number {
    return this.currentLimit;
  }

  /** Number of operations currently in flight. */
  inFlight(): number {
    return this.inFlightCount;
  }

  /**
   * Execute an operation if the current concurrency limit allows.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {AdaptiveLimitExceededError} When the limit is currently reached
   * @throws {DOMException} When cancelled via signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    const sig = signal ?? NEVER_ABORTED_SIGNAL;

    if (sig.aborted) {
      throw sig.reason ?? new DOMException('Aborted', 'AbortError');
    }

    if (this.inFlightCount >= this.currentLimit) {
      throw new AdaptiveLimitExceededError();
    }
    this.inFlightCount++;

    const rttAware =
      this.config.algorithm === 'vegas' || this.config.algorithm === 'gradient2';
    const start = rttAware ? this.clock() : 0;

    try {
      const result = await operation(sig);
      switch (this.config.algorithm) {
        case 'vegas':
          this.vegasOnSuccess(this.clock() - start);
          break;
        case 'gradient2':
          this.gradient2OnSuccess(this.clock() - start);
          break;
        default:
          this.aimdOnSuccess();
      }
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      this.inFlightCount--;
    }
  }

  /**
   * AIMD: advance the success counter; on reaching successThreshold, increase
   * the limit by one (up to maxLimit).
   */
  private aimdOnSuccess(): void {
    this.successes++;
    if (this.successes < this.config.successThreshold) {
      return;
    }
    this.successes = 0;
    if (this.currentLimit < this.config.maxLimit) {
      this.setLimit(this.currentLimit + 1);
    }
  }

  /**
   * Vegas: record a latency sample, update baseline + EMA, and apply a
   * queue-depth-based adjustment.
   *
   * expected = limit * minRtt / emaRtt; queue = limit - expected.
   * queue < alpha -> limit++; queue > beta -> limit--.
   */
  private vegasOnSuccess(rtt: number): void {
    if (rtt <= 0) return;

    this.updateRttBaseline(rtt);
    this.updateEma(rtt, 1 / 8); // halflife ~= 8 samples

    this.rttSamples++;
    if (this.rttSamples < this.config.vegasMinSamples) return;
    if (this.minRtt === 0 || this.emaRtt === 0) return;

    const cur = this.currentLimit;
    // queue = cur * (emaRtt - minRtt) / emaRtt
    const queue = Math.trunc((cur * (this.emaRtt - this.minRtt)) / this.emaRtt);

    if (queue < this.config.vegasAlpha) {
      if (cur < this.config.maxLimit) {
        this.setLimit(cur + 1);
      }
    } else if (queue > this.config.vegasBeta) {
      if (cur > this.config.minLimit) {
        this.setLimit(cur - 1);
      }
    }
  }

  /**
   * Gradient2: record a sample, update the long EMA, and adjust the limit by
   * the smoothed RTT gradient.
   *
   * gradient = clamp(minRtt / longEMA, 0.5, 1.0)
   * newLimit = floor(limit * gradient + sqrt(limit))
   */
  private gradient2OnSuccess(rtt: number): void {
    if (rtt <= 0) return;

    this.updateRttBaseline(rtt);
    this.updateEma(rtt, this.config.gradientSmoothing);

    this.rttSamples++;
    if (this.rttSamples < this.config.gradientMinSamples) return;
    if (this.minRtt === 0 || this.emaRtt === 0) return;

    let gradient = this.minRtt / this.emaRtt;
    if (gradient < 0.5) gradient = 0.5;
    if (gradient > 1.0) gradient = 1.0;

    const cur = this.currentLimit;
    const queueSize = Math.sqrt(cur);
    let target = Math.floor(cur * gradient + queueSize);

    if (target < this.config.minLimit) target = this.config.minLimit;
    if (target > this.config.maxLimit) target = this.config.maxLimit;
    if (target !== cur) {
      this.setLimit(target);
    }
  }

  /** Multiplicative decrease (halving) of the limit, bounded by minLimit. */
  private onFailure(): void {
    this.successes = 0;
    const next = Math.max(this.config.minLimit, Math.floor(this.currentLimit / 2));
    if (next !== this.currentLimit) {
      this.setLimit(next);
    }
  }

  /** Update the no-load minimum RTT baseline. */
  private updateRttBaseline(rtt: number): void {
    if (this.minRtt === 0 || rtt < this.minRtt) {
      this.minRtt = rtt;
    }
  }

  /** Update the EMA RTT with the given smoothing coefficient. */
  private updateEma(rtt: number, alpha: number): void {
    if (this.emaRtt === 0) {
      this.emaRtt = rtt;
    } else {
      this.emaRtt = this.emaRtt * (1 - alpha) + rtt * alpha;
    }
  }

  /** Commit a new limit value and fire logging / onLimitChange. */
  private setLimit(newLimit: number): void {
    const oldLimit = this.currentLimit;
    this.currentLimit = newLimit;
    this.logger.info('adaptive limit changed', {
      pattern: 'adaptive',
      old: oldLimit,
      new: newLimit,
    });
    if (this.config.onLimitChange) {
      try {
        this.config.onLimitChange(oldLimit, newLimit);
      } catch (callbackError) {
        this.logger.error('onLimitChange callback threw an error', {
          pattern: 'adaptive',
          error:
            callbackError instanceof Error ? callbackError.message : String(callbackError),
        });
      }
    }
  }

  /** Get the configuration. */
  getConfig(): Readonly<AdaptiveConfig> {
    return this.config;
  }
}
