import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Backoff policy enum.
 */
export const backoffPolicySchema = z.enum(['exponential', 'linear', 'constant']);
export type BackoffPolicy = z.infer<typeof backoffPolicySchema>;

/** Maximum allowed retry attempts to prevent DoS/resource exhaustion */
const MAX_RETRY_ATTEMPTS = 100;

/** Maximum allowed delay in milliseconds (1 hour) */
const MAX_DELAY_MS = 3_600_000;

/**
 * Zod schema for Retry configuration.
 */
export const retryConfigSchema = z.object({
  /** Maximum number of attempts including the first (default: 3, max: 100) */
  maxAttempts: z.number().int().positive().max(MAX_RETRY_ATTEMPTS).default(3),
  /** Initial delay before first retry in milliseconds (default: 100, max: 1 hour) */
  initialDelay: z.number().int().positive().max(MAX_DELAY_MS).default(100),
  /** Maximum delay between retries in milliseconds (max: 1 hour) */
  maxDelay: z.number().int().positive().max(MAX_DELAY_MS).optional(),
  /** Backoff strategy (default: 'exponential') */
  backoffPolicy: backoffPolicySchema.default('exponential'),
  /** Multiplier for exponential backoff (default: 2.0, max: 10) */
  multiplier: z.number().positive().max(10).default(2.0),
  /** Add random jitter to delays to prevent thundering herd (default: true) */
  jitter: z.boolean().default(true),
});

/**
 * Raw config input type (before defaults are applied).
 */
export type RetryConfigInput = z.input<typeof retryConfigSchema>;

/**
 * Parsed config type (after defaults are applied).
 */
export type RetryConfigParsed = z.output<typeof retryConfigSchema>;

/**
 * Full configuration type including callbacks and logger.
 */
export interface RetryConfig extends RetryConfigParsed {
  /** Custom function to determine if error is retryable */
  isRetryable: ((error: Error) => boolean) | undefined;
  /** Callback on each retry attempt */
  onRetry: ((attempt: number, error: Error) => void) | undefined;
  /** Logger instance for structured logging */
  logger: FortifyLogger | undefined;
}

/**
 * Input config type for constructor.
 */
export interface RetryConfigInputFull extends RetryConfigInput {
  isRetryable?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
  logger?: FortifyLogger;
}

/**
 * Parse and validate retry configuration.
 *
 * @param config - Raw configuration input
 * @returns Validated configuration with defaults applied
 */
export function parseRetryConfig(config?: RetryConfigInputFull): RetryConfig {
  const parsed = retryConfigSchema.parse(config ?? {});
  return {
    ...parsed,
    isRetryable: config?.isRetryable,
    onRetry: config?.onRetry,
    logger: config?.logger,
  };
}
