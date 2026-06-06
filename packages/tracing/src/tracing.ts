import { type Operation } from '@klarlabs-studio/fortify-core';
import {
  type Tracer,
  type Span,
  type Attributes,
  SpanKind,
  SpanStatusCode,
  FORTIFY_ATTRIBUTES,
} from './types.js';

/**
 * Configuration for traced operations.
 */
export interface TracedOperationConfig {
  /** OpenTelemetry tracer */
  tracer: Tracer;
  /** Span name */
  spanName: string;
  /** Span kind (defaults to INTERNAL) */
  spanKind?: SpanKind;
  /** Initial span attributes */
  attributes?: Attributes;
  /** Callback to add attributes on success */
  onSuccess?: (span: Span, result: unknown) => void;
  /** Callback to add attributes on error */
  onError?: (span: Span, error: Error) => void;
}

/**
 * Wrap an operation with OpenTelemetry tracing.
 *
 * @param operation - Operation to wrap
 * @param config - Tracing configuration
 * @returns Traced operation
 */
export function traceOperation<T>(
  operation: Operation<T>,
  config: TracedOperationConfig
): Operation<T> {
  return async (signal: AbortSignal): Promise<T> => {
    const span = config.tracer.startSpan(config.spanName, {
      kind: config.spanKind ?? SpanKind.INTERNAL,
      // Use conditional spread to avoid exactOptionalPropertyTypes issues
      ...(config.attributes !== undefined ? { attributes: config.attributes } : {}),
    });

    try {
      const result = await operation(signal);

      if (config.onSuccess) {
        config.onSuccess(span, result);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (config.onError) {
        config.onError(span, err);
      }

      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });

      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Create a traced circuit breaker execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Circuit breaker name
 * @param prefix - Span name prefix
 * @returns Function to trace circuit breaker executions
 */
export function createCircuitBreakerTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceCircuitBreaker<T>(
    operation: Operation<T>,
    state: string,
    counts?: { failures: number; successes: number }
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.circuit_breaker.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'circuit-breaker',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.CB_STATE]: state,
        ...(counts
          ? {
              [FORTIFY_ATTRIBUTES.CB_FAILURE_COUNT]: counts.failures,
              [FORTIFY_ATTRIBUTES.CB_SUCCESS_COUNT]: counts.successes,
            }
          : {}),
      },
    });
  };
}

/**
 * Create a traced retry execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Retry name
 * @param prefix - Span name prefix
 * @returns Function to trace retry executions
 */
export function createRetryTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceRetry<T>(
    operation: Operation<T>,
    attempt: number,
    maxAttempts: number,
    delayMs?: number
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.retry.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'retry',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.RETRY_ATTEMPT]: attempt,
        [FORTIFY_ATTRIBUTES.RETRY_MAX_ATTEMPTS]: maxAttempts,
        ...(delayMs !== undefined
          ? { [FORTIFY_ATTRIBUTES.RETRY_DELAY_MS]: delayMs }
          : {}),
      },
    });
  };
}

/**
 * Create a traced rate limit execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Rate limiter name
 * @param prefix - Span name prefix
 * @returns Function to trace rate limit operations
 */
export function createRateLimitTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceRateLimit<T>(
    operation: Operation<T>,
    key: string,
    allowed: boolean,
    waitMs?: number
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.rate_limit.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'rate-limit',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.RATE_LIMIT_KEY]: key,
        [FORTIFY_ATTRIBUTES.RATE_LIMIT_ALLOWED]: allowed,
        ...(waitMs !== undefined
          ? { [FORTIFY_ATTRIBUTES.RATE_LIMIT_WAIT_MS]: waitMs }
          : {}),
      },
    });
  };
}

/**
 * Create a traced timeout execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Timeout name
 * @param prefix - Span name prefix
 * @returns Function to trace timeout operations
 */
export function createTimeoutTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceTimeout<T>(
    operation: Operation<T>,
    durationMs: number
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.timeout.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'timeout',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.TIMEOUT_DURATION_MS]: durationMs,
      },
      onError: (span, error) => {
        if (error.name === 'TimeoutError') {
          span.setAttribute(FORTIFY_ATTRIBUTES.TIMEOUT_EXCEEDED, true);
        }
      },
    });
  };
}

/**
 * Create a traced bulkhead execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Bulkhead name
 * @param prefix - Span name prefix
 * @returns Function to trace bulkhead operations
 */
export function createBulkheadTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceBulkhead<T>(
    operation: Operation<T>,
    activeCount: number,
    queuedCount: number,
    maxConcurrent: number
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.bulkhead.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'bulkhead',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.BULKHEAD_ACTIVE_COUNT]: activeCount,
        [FORTIFY_ATTRIBUTES.BULKHEAD_QUEUED_COUNT]: queuedCount,
        [FORTIFY_ATTRIBUTES.BULKHEAD_MAX_CONCURRENT]: maxConcurrent,
      },
    });
  };
}

/**
 * Create a traced fallback execution wrapper.
 *
 * @param tracer - OpenTelemetry tracer
 * @param name - Fallback name
 * @param prefix - Span name prefix
 * @returns Function to trace fallback operations
 */
export function createFallbackTracer(
  tracer: Tracer,
  name: string,
  prefix = 'fortify'
) {
  return function traceFallback<T>(
    operation: Operation<T>,
    activated: boolean,
    reason?: string
  ): Operation<T> {
    return traceOperation(operation, {
      tracer,
      spanName: `${prefix}.fallback.${name}`,
      attributes: {
        [FORTIFY_ATTRIBUTES.PATTERN]: 'fallback',
        [FORTIFY_ATTRIBUTES.NAME]: name,
        [FORTIFY_ATTRIBUTES.FALLBACK_ACTIVATED]: activated,
        ...(reason !== undefined
          ? { [FORTIFY_ATTRIBUTES.FALLBACK_REASON]: reason }
          : {}),
      },
    });
  };
}
