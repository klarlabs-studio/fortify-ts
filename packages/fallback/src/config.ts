import { z } from 'zod';
import { type FortifyLogger } from '@klarlabs-studio/fortify-core';

/**
 * Zod schema for Fallback configuration.
 * Note: The fallback function itself is validated separately since
 * Zod can't express the generic type constraint.
 */
export const fallbackConfigSchema = z.object({
  /** Determines whether to execute the fallback function for a given error */
  shouldFallback: z.function().optional(),
  /** Called when the fallback function is triggered */
  onFallback: z.function().optional(),
  /** Called when the primary operation succeeds */
  onSuccess: z.function().optional(),
});

/**
 * Configuration for the Fallback pattern.
 *
 * @template T - The return type of operations
 */
export interface FallbackConfig<T> {
  /**
   * The fallback function to execute when the primary operation fails.
   * Receives the AbortSignal and the error from the primary operation.
   * Required.
   */
  fallback: (signal: AbortSignal, error: Error) => Promise<T> | T;

  /**
   * Determines whether to execute the fallback function for a given error.
   * If not provided or returns true, fallback is always executed on primary failure.
   * Optional.
   */
  shouldFallback?: (error: Error) => boolean;

  /**
   * Called when the fallback function is triggered.
   * Receives the error from the primary operation.
   * Optional.
   */
  onFallback?: (error: Error) => void;

  /**
   * Called when the primary operation succeeds.
   * Optional.
   */
  onSuccess?: () => void;

  /**
   * Logger instance for structured logging.
   * Optional.
   */
  logger?: FortifyLogger;
}

/**
 * Validate and return the fallback configuration.
 * Runtime validation for JavaScript users or those bypassing TypeScript.
 *
 * @param config - Fallback configuration
 * @returns Validated configuration
 * @throws {Error} When fallback function is not provided or is not a function
 */
export function validateFallbackConfig<T>(config: FallbackConfig<T>): FallbackConfig<T> {
  // Runtime check for JS users or those using `as any`
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!config.fallback) {
    throw new Error('Fallback function is required');
  }

  if (typeof config.fallback !== 'function') {
    throw new Error('Fallback must be a function');
  }

  // Validate optional callbacks via schema
  fallbackConfigSchema.parse({
    shouldFallback: config.shouldFallback,
    onFallback: config.onFallback,
    onSuccess: config.onSuccess,
  });

  return config;
}
