import {
  CircuitOpenError,
  RateLimitExceededError,
  BulkheadFullError,
  TimeoutError,
} from '@klarlabs-studio/fortify-core';
import { type CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { type Retry } from '@klarlabs-studio/fortify-retry';
import { type RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { type Timeout } from '@klarlabs-studio/fortify-timeout';
import { type Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { type Fallback } from '@klarlabs-studio/fortify-fallback';
import { type Chain } from '@klarlabs-studio/fortify-middleware';
import {
  type HttpHandler,
  type HttpMiddleware,
  type HttpResponse,
  type KeyExtractor,
  HttpErrors,
  keyFromIp,
} from './types.js';

/**
 * Configuration for circuit breaker HTTP middleware.
 */
export interface CircuitBreakerMiddlewareConfig {
  /** Custom error response when circuit is open */
  onOpen?: () => HttpResponse;
}

/**
 * Create HTTP middleware that wraps handlers with a circuit breaker.
 *
 * @param circuitBreaker - Circuit breaker instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createCircuitBreakerMiddleware(
  circuitBreaker: CircuitBreaker<HttpResponse>,
  config?: CircuitBreakerMiddlewareConfig
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      try {
        return await circuitBreaker.execute(async (signal) => {
          return handler({ ...request, context: { ...request.context, signal } });
        });
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          return config?.onOpen?.() ?? HttpErrors.serviceUnavailable();
        }
        throw error;
      }
    };
  };
}

/**
 * Configuration for retry HTTP middleware.
 */
export interface RetryMiddlewareConfig {
  /** Determine if a response should trigger a retry */
  shouldRetry?: (response: HttpResponse) => boolean;
}

/**
 * Create HTTP middleware that wraps handlers with retry logic.
 *
 * @param retry - Retry instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createRetryMiddleware(
  retry: Retry<HttpResponse>,
  config?: RetryMiddlewareConfig
): HttpMiddleware {
  const shouldRetry = config?.shouldRetry ?? ((r) => r.status >= 500);

  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      return retry.execute(async (signal) => {
        const response = await handler({
          ...request,
          context: { ...request.context, signal },
        });
        if (shouldRetry(response)) {
          throw new Error(`Server error: ${String(response.status)}`);
        }
        return response;
      });
    };
  };
}

/**
 * Configuration for rate limit HTTP middleware.
 */
export interface RateLimitMiddlewareConfig {
  /** Key extractor for rate limiting (defaults to IP) */
  keyExtractor?: KeyExtractor;
  /** Whether to wait for token or reject immediately */
  wait?: boolean;
  /** Custom error response when rate limited */
  onLimit?: (key: string) => HttpResponse;
}

/**
 * Create HTTP middleware that enforces rate limiting.
 *
 * @param rateLimiter - Rate limiter instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  config?: RateLimitMiddlewareConfig
): HttpMiddleware {
  const keyExtractor = config?.keyExtractor ?? keyFromIp;
  const wait = config?.wait ?? false;

  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      const key = keyExtractor(request);

      if (wait) {
        await rateLimiter.wait(key);
      } else if (!rateLimiter.allow(key)) {
        if (config?.onLimit) {
          return config.onLimit(key);
        }
        throw new RateLimitExceededError(`Rate limit exceeded for key: ${key}`);
      }

      return handler(request);
    };
  };
}

/**
 * Create HTTP middleware that wraps handlers with rate limiting,
 * returning a 429 response when rate limited.
 *
 * @param rateLimiter - Rate limiter instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createRateLimitGuard(
  rateLimiter: RateLimiter,
  config?: Omit<RateLimitMiddlewareConfig, 'wait'>
): HttpMiddleware {
  const keyExtractor = config?.keyExtractor ?? keyFromIp;

  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      const key = keyExtractor(request);

      if (!rateLimiter.allow(key)) {
        return config?.onLimit?.(key) ?? HttpErrors.tooManyRequests();
      }

      return handler(request);
    };
  };
}

/**
 * Configuration for timeout HTTP middleware.
 */
export interface TimeoutMiddlewareConfig {
  /** Timeout duration in milliseconds */
  duration?: number;
  /** Custom error response on timeout */
  onTimeout?: () => HttpResponse;
}

/**
 * Create HTTP middleware that enforces request timeouts.
 *
 * @param timeout - Timeout instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createTimeoutMiddleware(
  timeout: Timeout<HttpResponse>,
  config?: TimeoutMiddlewareConfig
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      const operation = async (signal: AbortSignal) => {
        return handler({ ...request, context: { ...request.context, signal } });
      };

      try {
        // Use executeWithTimeout if custom duration is specified, otherwise use default
        return config?.duration !== undefined
          ? await timeout.executeWithTimeout(operation, config.duration)
          : await timeout.execute(operation);
      } catch (error) {
        if (error instanceof TimeoutError) {
          return config?.onTimeout?.() ?? HttpErrors.gatewayTimeout();
        }
        throw error;
      }
    };
  };
}

/**
 * Configuration for bulkhead HTTP middleware.
 */
export interface BulkheadMiddlewareConfig {
  /** Custom error response when bulkhead is full */
  onFull?: () => HttpResponse;
}

/**
 * Create HTTP middleware that limits concurrent requests.
 *
 * @param bulkhead - Bulkhead instance
 * @param config - Optional middleware configuration
 * @returns HTTP middleware function
 */
export function createBulkheadMiddleware(
  bulkhead: Bulkhead<HttpResponse>,
  config?: BulkheadMiddlewareConfig
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      try {
        return await bulkhead.execute(async (signal) => {
          return handler({ ...request, context: { ...request.context, signal } });
        });
      } catch (error) {
        if (error instanceof BulkheadFullError) {
          return config?.onFull?.() ?? HttpErrors.capacityExceeded();
        }
        throw error;
      }
    };
  };
}

/**
 * Create HTTP middleware that provides fallback responses.
 *
 * @param fallback - Fallback instance (configure shouldFallback on the Fallback instance)
 * @returns HTTP middleware function
 */
export function createFallbackMiddleware(
  fallback: Fallback<HttpResponse>
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      return fallback.execute(async (signal) => {
        return handler({ ...request, context: { ...request.context, signal } });
      });
    };
  };
}

/**
 * Create HTTP middleware from a pre-configured middleware chain.
 *
 * @param chain - Middleware chain instance
 * @returns HTTP middleware function
 */
export function createChainMiddleware(
  chain: Chain<HttpResponse>
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return async (request) => {
      return chain.execute(async (signal) => {
        return handler({ ...request, context: { ...request.context, signal } });
      });
    };
  };
}

/**
 * Compose multiple HTTP middlewares into a single middleware.
 * Middlewares are applied in order (first = outermost).
 *
 * @param middlewares - Array of HTTP middlewares
 * @returns Composed HTTP middleware
 */
export function composeMiddleware(
  ...middlewares: HttpMiddleware[]
): HttpMiddleware {
  return (handler: HttpHandler): HttpHandler => {
    return middlewares.reduceRight(
      (next, middleware) => middleware(next),
      handler
    );
  };
}
