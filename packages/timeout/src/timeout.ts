import {
  type Operation,
  type Pattern,
  TimeoutError,
  combineSignals,
  type FortifyLogger,
  noopLogger,
} from '@klarlabs-studio/fortify-core';
import { type TimeoutConfig, type TimeoutConfigInput, parseTimeoutConfig } from './config.js';

/**
 * Timeout pattern implementation.
 *
 * Wraps operations with a configurable timeout, ensuring they complete
 * within a specified duration or are cancelled.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const timeout = new Timeout({ defaultTimeout: 5000 });
 *
 * const result = await timeout.execute(async (signal) => {
 *   const response = await fetch('/api/data', { signal });
 *   return response.json();
 * });
 * ```
 */
export class Timeout<T> implements Pattern<T> {
  private readonly config: TimeoutConfig;
  private readonly logger: FortifyLogger;

  /**
   * Create a new Timeout instance.
   *
   * @param config - Timeout configuration
   */
  constructor(config?: TimeoutConfigInput & { logger?: FortifyLogger }) {
    this.config = parseTimeoutConfig(config);
    this.logger = this.config.logger ?? noopLogger;
  }

  /**
   * Execute an operation with the default timeout.
   *
   * The operation receives an AbortSignal that will be aborted when:
   * - The timeout duration is exceeded
   * - The external signal (if provided) is aborted
   *
   * Operations MUST respect the AbortSignal for proper cancellation.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional external AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {TimeoutError} When the operation exceeds the timeout
   * @throws {DOMException} When cancelled via external signal (AbortError)
   */
  async execute(
    operation: Operation<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.executeWithTimeout(operation, this.config.defaultTimeout, signal);
  }

  /**
   * Execute an operation with a custom timeout duration.
   *
   * Use this method when you need to override the default timeout for a specific call.
   *
   * @param operation - The async operation to execute
   * @param timeout - Timeout duration in milliseconds
   * @param signal - Optional external AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {TimeoutError} When the operation exceeds the timeout
   * @throws {DOMException} When cancelled via external signal (AbortError)
   */
  async executeWithTimeout(
    operation: Operation<T>,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    const timeoutMs = timeout;

    // Check if already aborted
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const combinedSignal = combineSignals(signal, controller.signal);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new TimeoutError(
          `Operation timed out after ${String(timeoutMs)}ms`,
          timeoutMs
        );
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    this.logger.debug('Executing operation with timeout', { timeoutMs });

    try {
      const result = await Promise.race([
        operation(combinedSignal),
        timeoutPromise,
      ]);

      this.logger.debug('Operation completed successfully', { timeoutMs });
      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.warn('Operation timed out', { timeoutMs });
        this.safeCallOnTimeout();
      } else {
        this.logger.error('Operation failed', {
          timeoutMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Get the default timeout duration.
   *
   * @returns Default timeout in milliseconds
   */
  getDefaultTimeout(): number {
    return this.config.defaultTimeout;
  }

  /**
   * Safely call the onTimeout callback.
   */
  private safeCallOnTimeout(): void {
    if (!this.config.onTimeout) return;

    try {
      this.config.onTimeout();
    } catch (error) {
      this.logger.error('onTimeout callback threw an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
