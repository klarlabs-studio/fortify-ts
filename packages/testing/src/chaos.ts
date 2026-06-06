import { type Operation, sleep } from '@klarlabs-studio/fortify-core';

/**
 * Configuration for error injection.
 */
export interface ErrorInjectorConfig {
  /** Probability of injecting an error (0-1) */
  probability: number;
  /** Error to inject */
  error: Error;
}

/**
 * Create an error injector that randomly fails operations.
 *
 * @param config - Error injector configuration
 * @returns Operation wrapper that may inject errors
 *
 * @example
 * ```typescript
 * const inject = createErrorInjector({
 *   probability: 0.3,
 *   error: new Error('Random failure'),
 * });
 *
 * const unreliable = inject(myOperation);
 * ```
 */
export function createErrorInjector(
  config: ErrorInjectorConfig
): <T>(operation: Operation<T>) => Operation<T> {
  const { probability, error } = config;

  return <T>(operation: Operation<T>): Operation<T> => {
    return async (signal: AbortSignal): Promise<T> => {
      if (Math.random() < probability) {
        throw error;
      }
      return operation(signal);
    };
  };
}

/**
 * Configuration for latency injection.
 */
export interface LatencyInjectorConfig {
  /** Minimum latency in milliseconds */
  minMs: number;
  /** Maximum latency in milliseconds */
  maxMs: number;
  /** Probability of injecting latency (0-1, defaults to 1) */
  probability?: number;
}

/**
 * Create a latency injector that adds random delays.
 *
 * @param config - Latency injector configuration
 * @returns Operation wrapper that adds latency
 *
 * @example
 * ```typescript
 * const inject = createLatencyInjector({
 *   minMs: 100,
 *   maxMs: 500,
 * });
 *
 * const slow = inject(myOperation);
 * ```
 */
export function createLatencyInjector(
  config: LatencyInjectorConfig
): <T>(operation: Operation<T>) => Operation<T> {
  const { minMs, maxMs, probability = 1 } = config;

  return <T>(operation: Operation<T>): Operation<T> => {
    return async (signal: AbortSignal): Promise<T> => {
      if (Math.random() < probability) {
        const delay = minMs + Math.random() * (maxMs - minMs);
        await sleep(delay, signal);
      }
      return operation(signal);
    };
  };
}

/**
 * Configuration for timeout simulation.
 */
export interface TimeoutSimulatorConfig {
  /** Timeout duration in milliseconds */
  timeoutMs: number;
  /** Probability of simulating timeout (0-1) */
  probability: number;
}

/**
 * Create a timeout simulator that randomly causes operations to hang.
 *
 * @param config - Timeout simulator configuration
 * @returns Operation wrapper that may simulate timeouts
 *
 * @example
 * ```typescript
 * const simulate = createTimeoutSimulator({
 *   timeoutMs: 10000,
 *   probability: 0.1,
 * });
 *
 * const mayTimeout = simulate(myOperation);
 * ```
 */
export function createTimeoutSimulator(
  config: TimeoutSimulatorConfig
): <T>(operation: Operation<T>) => Operation<T> {
  const { timeoutMs, probability } = config;

  return <T>(operation: Operation<T>): Operation<T> => {
    return async (signal: AbortSignal): Promise<T> => {
      if (Math.random() < probability) {
        // Simulate timeout by waiting longer than typical timeout
        await sleep(timeoutMs, signal);
      }
      return operation(signal);
    };
  };
}

/**
 * Configuration for flakey service simulation.
 */
export interface FlakeyServiceConfig {
  /** Error rate (0-1) */
  errorRate: number;
  /** Minimum latency in milliseconds */
  minLatencyMs: number;
  /** Maximum latency in milliseconds */
  maxLatencyMs: number;
  /** Errors to randomly choose from */
  errors?: Error[];
}

/**
 * Create a flakey service simulator combining errors and latency.
 *
 * @param config - Flakey service configuration
 * @returns Operation wrapper that simulates unreliable service
 *
 * @example
 * ```typescript
 * const flakey = createFlakeyService({
 *   errorRate: 0.2,
 *   minLatencyMs: 50,
 *   maxLatencyMs: 200,
 *   errors: [
 *     new Error('Connection refused'),
 *     new Error('Internal server error'),
 *   ],
 * });
 *
 * const unreliable = flakey(myOperation);
 * ```
 */
export function createFlakeyService(
  config: FlakeyServiceConfig
): <T>(operation: Operation<T>) => Operation<T> {
  const {
    errorRate,
    minLatencyMs,
    maxLatencyMs,
    errors = [new Error('Service unavailable')],
  } = config;

  return <T>(operation: Operation<T>): Operation<T> => {
    return async (signal: AbortSignal): Promise<T> => {
      // Add random latency
      const delay = minLatencyMs + Math.random() * (maxLatencyMs - minLatencyMs);
      await sleep(delay, signal);

      // Randomly fail
      if (Math.random() < errorRate) {
        const error = errors[Math.floor(Math.random() * errors.length)];
        throw error ?? new Error('Service unavailable');
      }

      return operation(signal);
    };
  };
}

/**
 * Configuration for response degradation.
 */
export interface DegradedResponseConfig {
  /** Probability of degradation (0-1) */
  probability: number;
  /** Transform function to degrade the response */
  transform: <T>(result: T) => T;
}

/**
 * Create a response degrader that randomly modifies responses.
 *
 * @param config - Response degrader configuration
 * @returns Operation wrapper that may degrade responses
 *
 * @example
 * ```typescript
 * const degrade = createDegradedResponse({
 *   probability: 0.1,
 *   transform: (data) => ({ ...data, partial: true }),
 * });
 *
 * const degraded = degrade(myOperation);
 * ```
 */
export function createDegradedResponse(
  config: DegradedResponseConfig
): <T>(operation: Operation<T>) => Operation<T> {
  const { probability, transform } = config;

  return <T>(operation: Operation<T>): Operation<T> => {
    return async (signal: AbortSignal): Promise<T> => {
      const result = await operation(signal);

      if (Math.random() < probability) {
        return transform(result);
      }

      return result;
    };
  };
}

/**
 * Compose multiple chaos injectors.
 *
 * @param injectors - Array of injector functions
 * @returns Combined injector
 *
 * @example
 * ```typescript
 * const chaos = composeChaos(
 *   createErrorInjector({ probability: 0.1, error: new Error('fail') }),
 *   createLatencyInjector({ minMs: 50, maxMs: 200 }),
 * );
 *
 * const chaotic = chaos(myOperation);
 * ```
 */
export function composeChaos(
  ...injectors: (<T>(op: Operation<T>) => Operation<T>)[]
): <T>(operation: Operation<T>) => Operation<T> {
  return <T>(operation: Operation<T>): Operation<T> => {
    return injectors.reduce(
      (op, injector) => injector(op),
      operation
    );
  };
}
