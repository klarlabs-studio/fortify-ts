import {
  type Operation,
  type Pattern,
  type Resettable,
  type Closeable,
  CircuitOpenError,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import {
  type CircuitBreakerConfig,
  type CircuitBreakerConfigInputFull,
  parseCircuitBreakerConfig,
} from './config.js';
import { type State, States } from './state.js';
import { type Counts, createCounts, recordSuccess, recordFailure } from './counts.js';

/**
 * Circuit Breaker pattern implementation.
 *
 * Prevents cascading failures by "opening" the circuit when failures exceed
 * a threshold, and "closing" it again when the service recovers.
 *
 * States:
 * - **Closed**: Normal operation, requests pass through
 * - **Open**: Circuit is tripped, requests are rejected immediately
 * - **Half-Open**: Testing if service recovered, limited requests allowed
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   maxFailures: 5,
 *   timeout: 60000,
 *   onStateChange: (from, to) => console.log(`State: ${from} -> ${to}`),
 * });
 *
 * const result = await breaker.execute(async (signal) => {
 *   const response = await fetch('/api/data', { signal });
 *   if (!response.ok) throw new Error('Request failed');
 *   return response.json();
 * });
 * ```
 */
export class CircuitBreaker<T> implements Pattern<T>, Resettable, Closeable {
  private readonly config: CircuitBreakerConfig;
  private readonly logger: FortifyLogger;

  private currentState: State = States.CLOSED;
  private counts: Counts = createCounts();
  private lastStateChange: number = Date.now();
  private halfOpenRequests = 0;

  // Timestamp when OPEN state should transition to HALF_OPEN (includes jitter)
  private openUntil = 0;

  // Interval timer for clearing counts
  private intervalId: ReturnType<typeof setInterval> | undefined;

  /**
   * Create a new CircuitBreaker instance.
   *
   * @param config - Circuit breaker configuration
   */
  constructor(config?: CircuitBreakerConfigInputFull) {
    this.config = parseCircuitBreakerConfig(config);
    this.logger = this.config.logger ?? noopLogger;

    // Set up interval for clearing counts if configured
    if (this.config.interval > 0) {
      this.intervalId = setInterval(() => {
        if (this.currentState === States.CLOSED) {
          this.counts = createCounts();
          this.logger.debug('Counts cleared by interval');
        }
      }, this.config.interval);
    }
  }

  /**
   * Execute an operation through the circuit breaker.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {CircuitOpenError} When circuit is open
   * @throws {DOMException} When cancelled via signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    // Check if cancelled
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // Check if we can execute based on current state
    const canExecute = this.beforeExecution();
    if (!canExecute) {
      this.logger.warn('Circuit breaker is open, rejecting request');
      throw new CircuitOpenError();
    }

    this.logger.debug('Executing operation', {
      state: this.currentState,
      counts: this.counts,
    });

    try {
      const result = await operation(signal ?? NEVER_ABORTED_SIGNAL);
      this.onSuccess();
      return result;
    } catch (error) {
      // Wrap non-Error throws to ensure consistent error handling
      const wrappedError =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : JSON.stringify(error));

      // Check if cancelled
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      this.onFailure(wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get the current state of the circuit breaker.
   */
  state(): State {
    return this.currentState;
  }

  /**
   * Get the current counts/metrics.
   */
  getCounts(): Readonly<Counts> {
    return { ...this.counts };
  }

  /**
   * Reset the circuit breaker to closed state with cleared counts.
   */
  reset(): void {
    this.logger.info('Circuit breaker reset');
    const oldState = this.currentState;
    this.currentState = States.CLOSED;
    this.counts = createCounts();
    this.halfOpenRequests = 0;
    this.lastStateChange = Date.now();

    if (oldState !== States.CLOSED) {
      this.safeCallOnStateChange(oldState, States.CLOSED);
    }
  }

  /**
   * Close the circuit breaker and release resources.
   * Clears the interval timer used for count clearing.
   *
   * @returns Promise that resolves immediately (sync cleanup)
   */
  close(): Promise<void> {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.logger.info('Circuit breaker closed');
    return Promise.resolve();
  }

  /**
   * Clean up resources (interval timer).
   * @deprecated Use close() instead for consistent lifecycle API
   */
  destroy(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Check if execution is allowed and update state if needed.
   * @returns true if execution should proceed
   */
  private beforeExecution(): boolean {
    switch (this.currentState) {
      case States.CLOSED:
        return true;

      case States.OPEN:
        // Check if timeout (with jitter) has elapsed
        if (Date.now() >= this.openUntil) {
          this.setState(States.HALF_OPEN);
          this.halfOpenRequests = 1;
          return true;
        }
        return false;

      case States.HALF_OPEN:
        // Check if we can accept more requests
        if (this.halfOpenRequests < this.config.halfOpenMaxRequests) {
          this.halfOpenRequests++;
          return true;
        }
        return false;

      default: {
        const _exhaustive: never = this.currentState;
        return _exhaustive;
      }
    }
  }

  /**
   * Handle successful execution.
   */
  private onSuccess(): void {
    const isSuccess = this.config.isSuccessful
      ? this.config.isSuccessful(null)
      : true;

    if (!isSuccess) {
      this.onFailure(null);
      return;
    }

    this.counts = recordSuccess(this.counts);

    this.logger.debug('Operation succeeded', {
      state: this.currentState,
      consecutiveSuccesses: this.counts.consecutiveSuccesses,
    });

    if (this.currentState === States.HALF_OPEN) {
      // In half-open, a success means we can close the circuit
      this.setState(States.CLOSED);
      this.counts = createCounts();
      this.halfOpenRequests = 0;
    }
  }

  /**
   * Handle failed execution.
   */
  private onFailure(error: Error | null): void {
    const isSuccess = this.config.isSuccessful
      ? this.config.isSuccessful(error)
      : false;

    if (isSuccess) {
      this.onSuccess();
      return;
    }

    this.counts = recordFailure(this.counts);

    this.logger.debug('Operation failed', {
      state: this.currentState,
      consecutiveFailures: this.counts.consecutiveFailures,
      error: error?.message,
    });

    switch (this.currentState) {
      case States.CLOSED:
        // Check if we should trip the circuit
        if (this.shouldTrip()) {
          this.setState(States.OPEN);
        }
        break;

      case States.HALF_OPEN:
        // In half-open, a failure means we need to open again
        this.setState(States.OPEN);
        break;

      case States.OPEN:
        // Already open, nothing to do
        break;
    }
  }

  /**
   * Check if the circuit should trip open.
   */
  private shouldTrip(): boolean {
    if (this.config.readyToTrip) {
      return this.config.readyToTrip(this.counts);
    }

    // Default: trip after maxFailures consecutive failures
    return this.counts.consecutiveFailures >= this.config.maxFailures;
  }

  /**
   * Transition to a new state.
   */
  private setState(newState: State): void {
    const oldState = this.currentState;
    if (oldState === newState) return;

    this.currentState = newState;
    this.lastStateChange = Date.now();

    // Calculate jittered timeout end for OPEN state
    if (newState === States.OPEN) {
      const jitter = this.config.timeoutJitter > 0
        ? Math.random() * this.config.timeout * this.config.timeoutJitter
        : 0;
      this.openUntil = this.lastStateChange + this.config.timeout + jitter;
    }

    this.logger.info('Circuit breaker state changed', {
      from: oldState,
      to: newState,
    });

    // Call onStateChange callback asynchronously to prevent blocking
    // and potential deadlocks
    queueMicrotask(() => {
      this.safeCallOnStateChange(oldState, newState);
    });
  }

  /**
   * Safely call the onStateChange callback.
   */
  private safeCallOnStateChange(from: State, to: State): void {
    if (!this.config.onStateChange) return;

    try {
      this.config.onStateChange(from, to);
    } catch (error) {
      this.logger.error('onStateChange callback threw an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
