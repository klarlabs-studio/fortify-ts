import { type FortifyLogger, type LogContext } from './logger.js';

/**
 * Pino logger instance type.
 * We use a minimal interface to avoid requiring pino as a direct dependency.
 */
export interface PinoLike {
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  child(bindings: object): PinoLike;
}

/**
 * Create a logger adapter for pino.
 *
 * @param pinoInstance - Pino logger instance
 * @returns Fortify logger that delegates to pino
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createPinoLogger } from '@klarlabs-studio/fortify-logging';
 *
 * const logger = createPinoLogger(pino());
 * logger.info('Hello', { key: 'value' });
 * ```
 */
export function createPinoLogger(pinoInstance: PinoLike): FortifyLogger {
  return {
    debug(msg: string, context?: LogContext): void {
      if (context && Object.keys(context).length > 0) {
        pinoInstance.debug(context, msg);
      } else {
        pinoInstance.debug(msg);
      }
    },

    info(msg: string, context?: LogContext): void {
      if (context && Object.keys(context).length > 0) {
        pinoInstance.info(context, msg);
      } else {
        pinoInstance.info(msg);
      }
    },

    warn(msg: string, context?: LogContext): void {
      if (context && Object.keys(context).length > 0) {
        pinoInstance.warn(context, msg);
      } else {
        pinoInstance.warn(msg);
      }
    },

    error(msg: string, context?: LogContext): void {
      if (context && Object.keys(context).length > 0) {
        pinoInstance.error(context, msg);
      } else {
        pinoInstance.error(msg);
      }
    },

    child(bindings: LogContext): FortifyLogger {
      return createPinoLogger(pinoInstance.child(bindings));
    },
  };
}
