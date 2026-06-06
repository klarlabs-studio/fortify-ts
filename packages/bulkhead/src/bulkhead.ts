import {
  type Operation,
  type Pattern,
  type Resettable,
  type Closeable,
  BulkheadFullError,
  BulkheadClosedError,
  type FortifyLogger,
  noopLogger,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';
import {
  type BulkheadConfig,
  type BulkheadConfigInputFull,
  parseBulkheadConfig,
} from './config.js';
import { Semaphore } from './semaphore.js';

/**
 * Bulkhead pattern implementation for limiting concurrent operations.
 *
 * Prevents resource exhaustion by limiting the number of concurrent executions,
 * with optional queueing for overflow requests.
 *
 * @template T - The return type of operations
 *
 * @example
 * ```typescript
 * const bulkhead = new Bulkhead<Response>({
 *   maxConcurrent: 5,
 *   maxQueue: 10,
 *   queueTimeout: 5000,
 *   onRejected: () => console.log('Request rejected'),
 * });
 *
 * const result = await bulkhead.execute(async (signal) => {
 *   return fetch('/api/data', { signal });
 * });
 * ```
 */
export class Bulkhead<T> implements Pattern<T>, Resettable, Closeable {
  private readonly config: BulkheadConfig;
  private readonly logger: FortifyLogger;
  private readonly semaphore: Semaphore;
  private readonly queueSemaphore: Semaphore | undefined;
  private closed = false;

  /**
   * Create a new Bulkhead instance.
   *
   * @param config - Bulkhead configuration
   */
  constructor(config?: BulkheadConfigInputFull) {
    this.config = parseBulkheadConfig(config);
    this.logger = this.config.logger ?? noopLogger;
    // Execution semaphore: queue capacity = maxQueue (bounded by queue semaphore)
    this.semaphore = new Semaphore(
      this.config.maxConcurrent,
      Math.max(this.config.maxQueue, 1) // At least 1 for edge cases
    );

    // Only create queue semaphore if maxQueue > 0
    if (this.config.maxQueue > 0) {
      // Queue semaphore: only used for tryAcquire, queue never used
      this.queueSemaphore = new Semaphore(this.config.maxQueue, 1);
    }
  }

  /**
   * Execute an operation within the bulkhead's concurrency limits.
   *
   * @param operation - The async operation to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise resolving to the operation result
   * @throws {BulkheadFullError} When bulkhead is at capacity and queue is full
   * @throws {DOMException} When cancelled via signal (AbortError)
   */
  async execute(operation: Operation<T>, signal?: AbortSignal): Promise<T> {
    // Check if closed - use specific closed error, not full error
    if (this.closed) {
      throw new BulkheadClosedError('Bulkhead is closed');
    }

    // Check if cancelled
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // Try to acquire semaphore immediately
    if (this.semaphore.tryAcquire()) {
      return this.executeWithPermit(operation, signal);
    }

    // Bulkhead full, try to queue
    return this.enqueue(operation, signal);
  }

  /**
   * Get the number of currently active executions.
   */
  activeCount(): number {
    return this.config.maxConcurrent - this.semaphore.availablePermits();
  }

  /**
   * Get the number of requests currently waiting in the queue.
   */
  queuedCount(): number {
    return this.semaphore.queueLength();
  }

  /**
   * Close the bulkhead, rejecting all pending requests.
   *
   * @returns Promise that resolves immediately (sync cleanup)
   */
  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }

    this.closed = true;
    const closeError = new BulkheadClosedError('Bulkhead closed');
    this.semaphore.rejectAll(closeError);
    this.queueSemaphore?.rejectAll(closeError);
    this.logger.info('Bulkhead closed');
    return Promise.resolve();
  }

  /**
   * Reset the bulkhead to accept new requests.
   */
  reset(): void {
    this.closed = false;
    this.logger.info('Bulkhead reset');
  }

  /**
   * Execute operation with semaphore permit held.
   */
  private async executeWithPermit(
    operation: Operation<T>,
    signal?: AbortSignal
  ): Promise<T> {
    try {
      return await operation(signal ?? NEVER_ABORTED_SIGNAL);
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Attempt to queue the request when bulkhead is full.
   */
  private async enqueue(
    operation: Operation<T>,
    signal?: AbortSignal
  ): Promise<T> {
    // If no queue configured, reject immediately
    if (this.config.maxQueue === 0) {
      this.onRejected();
      throw this.createFullError('Bulkhead is full - no queue configured');
    }

    // Try to acquire queue slot
    if (!this.queueSemaphore?.tryAcquire()) {
      // Queue is full, reject
      this.onRejected();
      throw this.createFullError('Bulkhead queue is full');
    }

    // Track timeout for cleanup in finally block
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Create combined signal for queue timeout
      let timeoutController: AbortController | undefined;
      let combinedSignal = signal;

      if (this.config.queueTimeout > 0) {
        timeoutController = new AbortController();

        // Create combined signal
        if (signal) {
          combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
        } else {
          combinedSignal = timeoutController.signal;
        }

        // Start timeout with proper cleanup
        timeoutId = setTimeout(() => {
          timeoutController?.abort(new DOMException('Queue timeout', 'TimeoutError'));
        }, this.config.queueTimeout);
      }

      // Wait for execution semaphore
      try {
        await this.semaphore.acquire(combinedSignal);
      } catch (error) {
        // If aborted due to queue timeout, call onRejected
        if (
          error instanceof DOMException &&
          error.name === 'TimeoutError'
        ) {
          this.onRejected();
        }
        throw error;
      }

      // Got permit, execute
      return await this.executeWithPermit(operation, signal);
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      this.queueSemaphore.release();
    }
  }

  /**
   * Handle rejection event.
   */
  private onRejected(): void {
    this.logger.warn('Bulkhead rejection', {
      maxConcurrent: this.config.maxConcurrent,
      maxQueue: this.config.maxQueue,
    });

    if (this.config.onRejected) {
      try {
        this.config.onRejected();
      } catch (error) {
        this.logger.error('onRejected callback threw an error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Create a BulkheadFullError with current state context.
   */
  private createFullError(message?: string): BulkheadFullError {
    return new BulkheadFullError(
      message ?? 'Bulkhead is full',
      this.activeCount(),
      this.queuedCount()
    );
  }
}
