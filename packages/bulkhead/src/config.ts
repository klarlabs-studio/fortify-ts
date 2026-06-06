import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/** Maximum concurrent operations to prevent resource exhaustion */
const MAX_CONCURRENT = 10_000;

/** Maximum queue size to prevent memory exhaustion */
const MAX_QUEUE_SIZE = 100_000;

/** Maximum queue timeout in milliseconds (1 hour) */
const MAX_QUEUE_TIMEOUT_MS = 3_600_000;

/**
 * Zod schema for Bulkhead configuration.
 */
export const bulkheadConfigSchema = z.object({
  /** Maximum number of concurrent executions allowed (default: 10, max: 10000) */
  maxConcurrent: z.number().int().positive().max(MAX_CONCURRENT).default(10),
  /** Maximum size of overflow queue, 0 means no queue (default: 0, max: 100000) */
  maxQueue: z.number().int().nonnegative().max(MAX_QUEUE_SIZE).default(0),
  /** Maximum time a request can wait in queue in milliseconds, 0 means no timeout (default: 0, max: 1 hour) */
  queueTimeout: z.number().int().nonnegative().max(MAX_QUEUE_TIMEOUT_MS).default(0),
});

/**
 * Raw config input type (before defaults are applied).
 */
export type BulkheadConfigInput = z.input<typeof bulkheadConfigSchema>;

/**
 * Parsed config type (after defaults are applied).
 */
export type BulkheadConfigParsed = z.output<typeof bulkheadConfigSchema>;

/**
 * Full configuration type including callbacks and logger.
 */
export interface BulkheadConfig extends BulkheadConfigParsed {
  /** Callback when a request is rejected */
  onRejected: (() => void) | undefined;
  /** Logger instance for structured logging */
  logger: FortifyLogger | undefined;
}

/**
 * Input config type for constructor.
 */
export interface BulkheadConfigInputFull extends BulkheadConfigInput {
  onRejected?: () => void;
  logger?: FortifyLogger;
}

/**
 * Parse and validate bulkhead configuration.
 *
 * @param config - Raw configuration input
 * @returns Validated configuration with defaults applied
 */
export function parseBulkheadConfig(config?: BulkheadConfigInputFull): BulkheadConfig {
  const parsed = bulkheadConfigSchema.parse(config ?? {});
  return {
    ...parsed,
    onRejected: config?.onRejected,
    logger: config?.logger,
  };
}
