import {
  type Operation,
  type Pattern,
  MaxAttemptsReachedError,
  isRetryable,
  sleep,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import { type RetryConfig, type RetryConfigInputFull, parseRetryConfig } from './config.js';
import { getRetryDelay } from './backoff.js';

/**
 * Retry pattern implementation with configurable backoff strategies.
 *
 * Automatically retries failed operations with exponential, linear,
 * or constant backoff. Supports jitter to prevent thundering herd.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const retry = new Retry({
 *   maxAttempts: 3,
 *   initialDelay: 100,
 *   backoffPolicy: 'exponential',
 *   multiplier: 2,
 *   jitter: true,
 *   onRetry: (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`),
 * });
 *
 * const result = await retry.execute(async (signal) => {
 *   const response = await fetch('/api/data', { signal });
 *   if (!response.ok) throw new Error('Request failed');
 *   return response.json();
 * });
 * ```
 */
export class Retry<T> implements Pattern<T> {
  private readonly config: RetryConfig;
  private readonly logger: FortifyLogger;

  /**
   * Create a new Retry instance.
   *
   * @param config - Retry configuration
   */
  constructor(config?: RetryConfigInputFull) {
    this.config = parseRetryConfig(config);
    this.logger = this.config.logger ?? noopLogger;
  }

  /**
   * Execute an operation with retry logic.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {MaxAttemptsReachedError} When all retry attempts are exhausted
   * @throws {DOMException} When cancelled via signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      // Check if cancelled
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      try {
        this.logger.debug('Executing operation', {
          attempt,
          maxAttempts: this.config.maxAttempts,
        });

        const result = await operation(signal ?? NEVER_ABORTED_SIGNAL);

        this.logger.debug('Operation succeeded', { attempt });
        return result;
      } catch (error) {
        // Wrap non-Error throws to ensure consistent error handling
        // This allows retry logic to work even with throw "string" or throw 123
        const wrappedError =
          error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : JSON.stringify(error));

        lastError = wrappedError;

        // Check if cancelled during operation
        if (signal?.aborted) {
          throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        // Check if this is the last attempt
        if (attempt >= this.config.maxAttempts) {
          this.logger.warn('All retry attempts exhausted', {
            attempts: attempt,
            error: wrappedError.message,
          });
          break;
        }

        // Check if error is retryable
        if (!this.shouldRetry(wrappedError)) {
          this.logger.info('Error is not retryable, giving up', {
            attempt,
            error: wrappedError.message,
          });
          break;
        }

        // Calculate delay for next retry
        const delay = getRetryDelay(attempt, {
          initialDelay: this.config.initialDelay,
          policy: this.config.backoffPolicy,
          multiplier: this.config.multiplier,
          maxDelay: this.config.maxDelay,
          jitter: this.config.jitter,
        });

        this.logger.info('Retrying after delay', {
          attempt,
          nextAttempt: attempt + 1,
          delayMs: delay,
          error: wrappedError.message,
        });

        // Call onRetry callback
        this.safeCallOnRetry(attempt, wrappedError);

        // Wait before retrying
        try {
          await sleep(delay, signal);
        } catch (sleepError) {
          // Sleep was cancelled
          if (signal?.aborted) {
            throw signal.reason ?? new DOMException('Aborted', 'AbortError');
          }
          throw sleepError;
        }
      }
    }

    // All attempts exhausted or error not retryable
    throw new MaxAttemptsReachedError(
      `Operation failed after ${String(this.config.maxAttempts)} attempts`,
      this.config.maxAttempts,
      lastError
    );
  }

  /**
   * Determine if an error should be retried.
   *
   * Priority:
   * 1. Custom isRetryable function
   * 2. RetryableError interface (error.retryable)
   * 3. Default: retry all errors
   *
   * @param error - Error to check
   * @returns True if the error should be retried
   */
  private shouldRetry(error: Error): boolean {
    // 1. Check custom isRetryable function
    if (this.config.isRetryable) {
      return this.config.isRetryable(error);
    }

    // 2. Check RetryableError interface
    const retryableStatus = isRetryable(error);
    if (retryableStatus !== undefined) {
      return retryableStatus;
    }

    // 3. Default: retry all errors
    return true;
  }

  /**
   * Safely call the onRetry callback.
   */
  private safeCallOnRetry(attempt: number, error: Error): void {
    if (!this.config.onRetry) return;

    try {
      this.config.onRetry(attempt, error);
    } catch (callbackError) {
      this.logger.error('onRetry callback threw an error', {
        error: callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
    }
  }

  /**
   * Get the configuration.
   *
   * @returns Current retry configuration
   */
  getConfig(): Readonly<RetryConfig> {
    return this.config;
  }
}
