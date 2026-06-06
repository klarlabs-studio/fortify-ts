import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/** Maximum allowed timeout in milliseconds (1 hour) */
const MAX_TIMEOUT_MS = 3_600_000;

/**
 * Zod schema for Timeout configuration.
 */
export const timeoutConfigSchema = z.object({
  /** Default timeout in milliseconds (default: 30000, max: 1 hour) */
  defaultTimeout: z.number().int().positive().max(MAX_TIMEOUT_MS).default(30000),
  /** Callback when timeout occurs */
  onTimeout: z.function().optional(),
});

/**
 * Raw config input type (before defaults are applied).
 */
export type TimeoutConfigInput = z.input<typeof timeoutConfigSchema>;

/**
 * Parsed config type (after defaults are applied).
 */
export type TimeoutConfigParsed = z.output<typeof timeoutConfigSchema>;

/**
 * Full configuration type including logger.
 */
export interface TimeoutConfig extends TimeoutConfigParsed {
  /** Logger instance for structured logging */
  logger: FortifyLogger | undefined;
}

/**
 * Parse and validate timeout configuration.
 *
 * @param config - Raw configuration input
 * @returns Validated configuration with defaults applied
 */
export function parseTimeoutConfig(config?: TimeoutConfigInput & { logger?: FortifyLogger }): TimeoutConfig {
  const parsed = timeoutConfigSchema.parse(config ?? {});
  return {
    ...parsed,
    logger: config?.logger,
  };
}
