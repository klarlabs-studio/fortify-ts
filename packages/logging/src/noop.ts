import { type FortifyLogger, type LogContext } from './logger.js';

/**
 * No-operation logger that discards all log messages.
 *
 * Useful for testing or when logging should be disabled.
 *
 * @example
 * ```typescript
 * import { noopLogger } from '@klarlabs-studio/fortify-logging';
 *
 * // In tests or when logging is disabled
 * const circuitBreaker = new CircuitBreaker({
 *   logger: noopLogger,
 * });
 * ```
 */
export const noopLogger: FortifyLogger = {
  debug(_msg: string, _context?: LogContext): void {
    // No-op
  },

  info(_msg: string, _context?: LogContext): void {
    // No-op
  },

  warn(_msg: string, _context?: LogContext): void {
    // No-op
  },

  error(_msg: string, _context?: LogContext): void {
    // No-op
  },

  child(_bindings: LogContext): FortifyLogger {
    return noopLogger;
  },
};

/**
 * Create a no-operation logger.
 *
 * Returns a singleton noop logger instance.
 *
 * @returns Noop logger instance
 */
export function createNoopLogger(): FortifyLogger {
  return noopLogger;
}
