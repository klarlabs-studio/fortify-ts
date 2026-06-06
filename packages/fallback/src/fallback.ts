import {
  type Operation,
  type Pattern,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import { type FallbackConfig, validateFallbackConfig } from './config.js';

/**
 * Fallback pattern implementation for graceful degradation.
 *
 * Executes a primary operation and, if it fails, executes a fallback
 * operation to provide a default value or alternative behavior.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const fallback = new Fallback<UserData>({
 *   fallback: async (signal, error) => {
 *     // Return cached data when primary fails
 *     return getCachedUserData();
 *   },
 *   onFallback: (error) => console.log(`Primary failed: ${error.message}`),
 * });
 *
 * const result = await fallback.execute(async (signal) => {
 *   return fetchUserDataFromAPI(signal);
 * });
 * ```
 */
export class Fallback<T> implements Pattern<T> {
  private readonly config: FallbackConfig<T>;
  private readonly logger: FortifyLogger;

  /**
   * Create a new Fallback instance.
   *
   * @param config - Fallback configuration (fallback function is required)
   * @throws {Error} When fallback function is not provided
   */
  constructor(config: FallbackConfig<T>) {
    this.config = validateFallbackConfig(config);
    this.logger = this.config.logger ?? noopLogger;
  }

  /**
   * Execute an operation with fallback on failure.
   *
   * @param operation - The primary async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result or fallback result
   * @throws {Error} When both primary and fallback fail
   * @throws {DOMException} When cancelled via signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    // Check if cancelled
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const operationSignal = signal ?? NEVER_ABORTED_SIGNAL;

    try {
      // Execute primary operation
      const result = await operation(operationSignal);

      // Success callback
      if (this.config.onSuccess) {
        this.safeCallback(this.config.onSuccess);
      }

      this.logger.debug('Primary operation succeeded');
      return result;
    } catch (error) {
      // Check if cancelled
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      // Non-Error throws are re-thrown as-is
      if (!(error instanceof Error)) {
        throw error;
      }

      // Check if we should use fallback
      if (this.config.shouldFallback && !this.config.shouldFallback(error)) {
        this.logger.debug('Fallback skipped by shouldFallback', {
          error: error.message,
        });
        throw error;
      }

      // Callback before fallback
      const onFallback = this.config.onFallback;
      if (onFallback) {
        this.safeCallback(() => onFallback(error));
      }

      this.logger.info('Fallback triggered', {
        primaryError: error.message,
      });

      try {
        // Execute fallback
        const fallbackResult = await this.config.fallback(operationSignal, error);
        this.logger.debug('Fallback succeeded');
        return fallbackResult;
      } catch (fallbackError) {
        this.logger.warn('Fallback failed', {
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        // Return original error, not fallback error
        throw error;
      }
    }
  }

  /**
   * Safely execute a callback with error handling.
   */
  private safeCallback(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.error('Callback threw an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
