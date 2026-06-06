import { type Operation, sleep } from '@klarlabs-studio/fortify-core';

/**
 * Configuration for a mock operation.
 */
export interface MockOperationConfig<T> {
  /** Results to return in sequence */
  results?: (T | Error)[];
  /** Default result after sequence is exhausted */
  defaultResult?: T | Error;
  /** Delay before each call in milliseconds */
  delayMs?: number;
  /** Callback on each invocation */
  onCall?: (callIndex: number, signal?: AbortSignal) => void;
}

/**
 * Create a mock operation for testing.
 *
 * @param config - Mock operation configuration
 * @returns Mock operation and stats
 *
 * @example
 * ```typescript
 * const { operation, stats } = createMockOperation({
 *   results: ['first', new Error('fail'), 'third'],
 *   defaultResult: 'default',
 * });
 *
 * await operation(); // 'first'
 * await operation(); // throws Error('fail')
 * await operation(); // 'third'
 * await operation(); // 'default'
 *
 * console.log(stats.callCount); // 4
 * ```
 */
export function createMockOperation<T>(
  config: MockOperationConfig<T> = {}
): {
  operation: Operation<T>;
  stats: {
    callCount: number;
    calls: { timestamp: number; signal?: AbortSignal }[];
    reset: () => void;
  };
} {
  const { results = [], defaultResult, delayMs, onCall } = config;

  let callCount = 0;
  const calls: { timestamp: number; signal?: AbortSignal }[] = [];

  const operation: Operation<T> = async (signal: AbortSignal): Promise<T> => {
    const currentCall = callCount;
    callCount++;
    // Use conditional spread to avoid exactOptionalPropertyTypes issues
    calls.push({ timestamp: Date.now(), signal });

    if (onCall) {
      onCall(currentCall, signal);
    }

    if (delayMs !== undefined && delayMs > 0) {
      await sleep(delayMs, signal);
    }

    const result = currentCall < results.length
      ? results[currentCall]
      : defaultResult;

    if (result instanceof Error) {
      throw result;
    }

    if (result === undefined) {
      throw new Error('No result configured for mock operation');
    }

    return result;
  };

  return {
    operation,
    stats: {
      get callCount() {
        return callCount;
      },
      get calls() {
        return calls;
      },
      reset() {
        callCount = 0;
        calls.length = 0;
      },
    },
  };
}

/**
 * Create a counting operation that tracks invocations.
 *
 * @param operation - Operation to wrap
 * @returns Wrapped operation with call counter
 */
export function createCountingOperation<T>(
  operation: Operation<T>
): {
  operation: Operation<T>;
  getCallCount: () => number;
  reset: () => void;
} {
  let callCount = 0;

  const countingOperation: Operation<T> = async (signal: AbortSignal): Promise<T> => {
    callCount++;
    return operation(signal);
  };

  return {
    operation: countingOperation,
    getCallCount: () => callCount,
    reset: () => {
      callCount = 0;
    },
  };
}

/**
 * Create an operation that fails a specific number of times before succeeding.
 *
 * @param failCount - Number of times to fail
 * @param error - Error to throw on failure
 * @param successResult - Result to return on success
 * @returns Operation that fails then succeeds
 */
export function createFailThenSucceed<T>(
  failCount: number,
  error: Error,
  successResult: T
): {
  operation: Operation<T>;
  getAttempts: () => number;
} {
  let attempts = 0;

  const operation: Operation<T> = (): Promise<T> => {
    attempts++;
    if (attempts <= failCount) {
      return Promise.reject(error);
    }
    return Promise.resolve(successResult);
  };

  return {
    operation,
    getAttempts: () => attempts,
  };
}

/**
 * Create an operation that always fails.
 *
 * @param error - Error to throw
 * @returns Operation that always throws
 */
export function createFailingOperation<T>(error: Error): Operation<T> {
  return (): Promise<T> => {
    return Promise.reject(error);
  };
}

/**
 * Create an operation that always succeeds.
 *
 * @param result - Result to return
 * @returns Operation that always succeeds
 */
export function createSuccessfulOperation<T>(result: T): Operation<T> {
  return (): Promise<T> => {
    return Promise.resolve(result);
  };
}

/**
 * Create an operation with configurable behavior.
 *
 * @param behavior - Function that determines success/failure
 * @returns Configurable operation
 */
export function createConfigurableOperation<T>(
  behavior: () => T | Error
): Operation<T> {
  return (): Promise<T> => {
    const result = behavior();
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return Promise.resolve(result);
  };
}

/**
 * Create a slow operation that takes a specified time.
 *
 * @param durationMs - Duration in milliseconds
 * @param result - Result to return
 * @returns Slow operation
 */
export function createSlowOperation<T>(
  durationMs: number,
  result: T
): Operation<T> {
  return async (signal: AbortSignal): Promise<T> => {
    await sleep(durationMs, signal);
    return result;
  };
}

/**
 * Create an operation that respects abort signal.
 *
 * @param result - Result to return if not aborted
 * @param delayMs - Delay before checking signal
 * @returns Abortable operation
 */
export function createAbortableOperation<T>(
  result: T,
  delayMs = 100
): Operation<T> {
  return async (signal: AbortSignal): Promise<T> => {
    await sleep(delayMs, signal);
    signal.throwIfAborted();
    return result;
  };
}
