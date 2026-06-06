import { type FortifyLogger as CoreFortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Log level enumeration.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Context data to include in log messages.
 */
export type LogContext = Record<string, unknown>;

/**
 * Re-export the base FortifyLogger from core for convenience.
 */
export type { FortifyLogger as BaseFortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Extended Fortify logger interface with child logger support.
 *
 * Extends the base FortifyLogger from @klarlabs-studio/fortify-core with
 * additional capabilities for creating child loggers with bound context.
 *
 * This is compatible with pino, winston, and other logging libraries
 * that support child loggers.
 */
export interface FortifyLogger extends CoreFortifyLogger {
  /**
   * Create a child logger with additional context.
   *
   * @param bindings - Context to bind to all log messages
   * @returns Child logger with bound context
   */
  child(bindings: LogContext): FortifyLogger;
}

/**
 * Extended logger with additional resilience-specific methods.
 */
export interface ResilienceLogger extends FortifyLogger {
  /**
   * Log a circuit breaker state change.
   */
  circuitBreakerStateChange(
    name: string,
    from: string,
    to: string,
    context?: LogContext
  ): void;

  /**
   * Log a retry attempt.
   */
  retryAttempt(
    name: string,
    attempt: number,
    maxAttempts: number,
    error: Error,
    context?: LogContext
  ): void;

  /**
   * Log a rate limit event.
   */
  rateLimitExceeded(
    name: string,
    key: string,
    context?: LogContext
  ): void;

  /**
   * Log a timeout event.
   */
  timeoutExceeded(
    name: string,
    duration: number,
    context?: LogContext
  ): void;

  /**
   * Log a bulkhead rejection.
   */
  bulkheadRejection(
    name: string,
    active: number,
    queued: number,
    context?: LogContext
  ): void;

  /**
   * Log a fallback activation.
   */
  fallbackActivated(
    name: string,
    error: Error,
    context?: LogContext
  ): void;
}

/**
 * Create a resilience-aware logger from a base logger.
 *
 * @param logger - Base logger
 * @returns Resilience logger with additional methods
 */
export function createResilienceLogger(logger: FortifyLogger): ResilienceLogger {
  return {
    ...logger,

    child(bindings: LogContext): ResilienceLogger {
      return createResilienceLogger(logger.child(bindings));
    },

    circuitBreakerStateChange(
      name: string,
      from: string,
      to: string,
      context?: LogContext
    ): void {
      logger.info(`Circuit breaker ${name} state changed: ${from} -> ${to}`, {
        pattern: 'circuit-breaker',
        name,
        from,
        to,
        ...context,
      });
    },

    retryAttempt(
      name: string,
      attempt: number,
      maxAttempts: number,
      error: Error,
      context?: LogContext
    ): void {
      logger.warn(`Retry ${name} attempt ${String(attempt)}/${String(maxAttempts)}`, {
        pattern: 'retry',
        name,
        attempt,
        maxAttempts,
        error: error.message,
        ...context,
      });
    },

    rateLimitExceeded(
      name: string,
      key: string,
      context?: LogContext
    ): void {
      logger.warn(`Rate limit ${name} exceeded for key: ${key}`, {
        pattern: 'rate-limit',
        name,
        key,
        ...context,
      });
    },

    timeoutExceeded(
      name: string,
      duration: number,
      context?: LogContext
    ): void {
      logger.warn(`Timeout ${name} exceeded after ${String(duration)}ms`, {
        pattern: 'timeout',
        name,
        duration,
        ...context,
      });
    },

    bulkheadRejection(
      name: string,
      active: number,
      queued: number,
      context?: LogContext
    ): void {
      logger.warn(`Bulkhead ${name} rejected request`, {
        pattern: 'bulkhead',
        name,
        active,
        queued,
        ...context,
      });
    },

    fallbackActivated(
      name: string,
      error: Error,
      context?: LogContext
    ): void {
      logger.info(`Fallback ${name} activated due to: ${error.message}`, {
        pattern: 'fallback',
        name,
        error: error.message,
        ...context,
      });
    },
  };
}
