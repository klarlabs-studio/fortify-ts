import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { Timeout } from '@klarlabs-studio/fortify-timeout';
import { Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { Fallback } from '@klarlabs-studio/fortify-fallback';
import { Chain } from '@klarlabs-studio/fortify-middleware';
import {
  type HttpRequest,
  type HttpResponse,
  type HttpHandler,
  keyFromIp,
  keyFromHeader,
  combineKeys,
  createErrorResponse,
  HttpErrors,
  createCircuitBreakerMiddleware,
  createRetryMiddleware,
  createRateLimitMiddleware,
  createRateLimitGuard,
  createTimeoutMiddleware,
  createBulkheadMiddleware,
  createFallbackMiddleware,
  createChainMiddleware,
  composeMiddleware,
} from '../src/index.js';

const createRequest = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET',
  url: '/api/test',
  headers: {},
  ...overrides,
});

const createSuccessResponse = (): HttpResponse => ({
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: { success: true },
});

describe('Key Extractors', () => {
  describe('keyFromIp', () => {
    it('should extract IP from request', () => {
      const request = createRequest({ ip: '192.168.1.1' });
      expect(keyFromIp(request)).toBe('192.168.1.1');
    });

    it('should return unknown when IP is missing', () => {
      const request = createRequest();
      expect(keyFromIp(request)).toBe('unknown');
    });
  });

  describe('keyFromHeader', () => {
    it('should extract value from header', () => {
      const extractor = keyFromHeader('x-api-key');
      const request = createRequest({
        headers: { 'x-api-key': 'my-key-123' },
      });
      expect(extractor(request)).toBe('my-key-123');
    });

    it('should handle array headers', () => {
      const extractor = keyFromHeader('x-forwarded-for');
      const request = createRequest({
        headers: { 'x-forwarded-for': ['10.0.0.1', '192.168.1.1'] },
      });
      expect(extractor(request)).toBe('10.0.0.1');
    });

    it('should return default when header is missing', () => {
      const extractor = keyFromHeader('x-api-key', 'default-key');
      const request = createRequest();
      expect(extractor(request)).toBe('default-key');
    });
  });

  describe('combineKeys', () => {
    it('should combine multiple extractors', () => {
      const extractor = combineKeys([
        keyFromIp,
        keyFromHeader('x-user-id'),
      ]);
      const request = createRequest({
        ip: '192.168.1.1',
        headers: { 'x-user-id': 'user-123' },
      });
      expect(extractor(request)).toBe('192.168.1.1:user-123');
    });

    it('should use custom separator', () => {
      const extractor = combineKeys([keyFromIp, keyFromHeader('x-user-id')], '-');
      const request = createRequest({
        ip: '10.0.0.1',
        headers: { 'x-user-id': 'user-456' },
      });
      expect(extractor(request)).toBe('10.0.0.1-user-456');
    });
  });
});

describe('Error Responses', () => {
  describe('createErrorResponse', () => {
    it('should create error response with default headers', () => {
      const response = createErrorResponse(400, 'Bad Request');
      expect(response.status).toBe(400);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.body).toEqual({ error: 'Bad Request' });
    });

    it('should merge custom headers', () => {
      const response = createErrorResponse(400, 'Bad Request', {
        'X-Custom': 'value',
      });
      expect(response.headers['X-Custom']).toBe('value');
    });
  });

  describe('HttpErrors', () => {
    it('should create 429 response', () => {
      const response = HttpErrors.tooManyRequests();
      expect(response.status).toBe(429);
    });

    it('should create 429 response with Retry-After', () => {
      const response = HttpErrors.tooManyRequests(60);
      expect(response.status).toBe(429);
      expect(response.headers['Retry-After']).toBe('60');
    });

    it('should create 503 service unavailable response', () => {
      const response = HttpErrors.serviceUnavailable();
      expect(response.status).toBe(503);
    });

    it('should create 504 gateway timeout response', () => {
      const response = HttpErrors.gatewayTimeout();
      expect(response.status).toBe(504);
    });

    it('should create capacity exceeded response', () => {
      const response = HttpErrors.capacityExceeded();
      expect(response.status).toBe(503);
    });
  });
});

describe('Circuit Breaker Middleware', () => {
  it('should pass requests through when circuit is closed', async () => {
    const cb = new CircuitBreaker<HttpResponse>();
    const middleware = createCircuitBreakerMiddleware(cb);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();

    await cb.close();
  });

  it('should return 503 when circuit is open', async () => {
    const cb = new CircuitBreaker<HttpResponse>({ maxFailures: 1 });
    const middleware = createCircuitBreakerMiddleware(cb);

    const handler: HttpHandler = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = middleware(handler);

    // Trip the circuit
    await expect(wrapped(createRequest())).rejects.toThrow();

    // Now it should be open
    const response = await wrapped(createRequest());
    expect(response.status).toBe(503);

    await cb.close();
  });

  it('should use custom onOpen response', async () => {
    const cb = new CircuitBreaker<HttpResponse>({ maxFailures: 1 });
    const middleware = createCircuitBreakerMiddleware(cb, {
      onOpen: () => createErrorResponse(503, 'Custom message'),
    });

    const handler: HttpHandler = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = middleware(handler);

    await expect(wrapped(createRequest())).rejects.toThrow();
    const response = await wrapped(createRequest());
    expect(response.body).toEqual({ error: 'Custom message' });

    await cb.close();
  });
});

describe('Retry Middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass successful requests through', async () => {
    vi.useRealTimers();

    const retry = new Retry<HttpResponse>({ maxAttempts: 3, initialDelay: 1 });
    const middleware = createRetryMiddleware(retry);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should retry on 5xx responses', async () => {
    vi.useRealTimers();

    const retry = new Retry<HttpResponse>({ maxAttempts: 3, initialDelay: 1 });
    const middleware = createRetryMiddleware(retry);

    const handler: HttpHandler = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, headers: {}, body: null })
      .mockResolvedValueOnce(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should use custom shouldRetry predicate', async () => {
    vi.useRealTimers();

    const retry = new Retry<HttpResponse>({ maxAttempts: 3, initialDelay: 1 });
    const middleware = createRetryMiddleware(retry, {
      shouldRetry: (r) => r.status === 429,
    });

    const handler: HttpHandler = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, headers: {}, body: null })
      .mockResolvedValueOnce(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('Rate Limit Middleware', () => {
  it('should allow requests within rate limit', async () => {
    const rl = new RateLimiter({ rate: 10, burst: 10 });
    const middleware = createRateLimitMiddleware(rl);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest({ ip: '192.168.1.1' }));
    expect(response.status).toBe(200);
  });

  it('should throw when rate limit exceeded', async () => {
    const rl = new RateLimiter({ rate: 1, burst: 1 });
    const middleware = createRateLimitMiddleware(rl);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    await wrapped(createRequest({ ip: '192.168.1.1' }));
    await expect(wrapped(createRequest({ ip: '192.168.1.1' }))).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  it('should use custom key extractor', async () => {
    const rl = new RateLimiter({ rate: 1, burst: 1 });
    const middleware = createRateLimitMiddleware(rl, {
      keyExtractor: keyFromHeader('x-api-key'),
    });

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    // Different keys should have separate limits
    await wrapped(createRequest({ headers: { 'x-api-key': 'key-1' } }));
    await wrapped(createRequest({ headers: { 'x-api-key': 'key-2' } }));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should use custom onLimit response', async () => {
    const rl = new RateLimiter({ rate: 1, burst: 1 });
    const middleware = createRateLimitMiddleware(rl, {
      onLimit: () => createErrorResponse(429, 'Custom rate limit message'),
    });

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    await wrapped(createRequest({ ip: '192.168.1.1' }));
    const response = await wrapped(createRequest({ ip: '192.168.1.1' }));
    expect(response.body).toEqual({ error: 'Custom rate limit message' });
  });
});

describe('Rate Limit Guard', () => {
  it('should return 429 when rate limited', async () => {
    const rl = new RateLimiter({ rate: 1, burst: 1 });
    const middleware = createRateLimitGuard(rl);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    await wrapped(createRequest({ ip: '192.168.1.1' }));
    const response = await wrapped(createRequest({ ip: '192.168.1.1' }));
    expect(response.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('Timeout Middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass fast requests through', async () => {
    const timeout = new Timeout<HttpResponse>();
    const middleware = createTimeoutMiddleware(timeout, { duration: 5000 });

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
  });

  it('should return 504 on timeout', async () => {
    const timeout = new Timeout<HttpResponse>();
    const middleware = createTimeoutMiddleware(timeout, { duration: 100 });

    const handler: HttpHandler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return createSuccessResponse();
    });
    const wrapped = middleware(handler);

    const responsePromise = wrapped(createRequest());
    await vi.advanceTimersByTimeAsync(150);
    const response = await responsePromise;
    expect(response.status).toBe(504);
  });

  it('should use custom onTimeout response', async () => {
    const timeout = new Timeout<HttpResponse>();
    const middleware = createTimeoutMiddleware(timeout, {
      duration: 100,
      onTimeout: () => createErrorResponse(504, 'Custom timeout'),
    });

    const handler: HttpHandler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return createSuccessResponse();
    });
    const wrapped = middleware(handler);

    const responsePromise = wrapped(createRequest());
    await vi.advanceTimersByTimeAsync(150);
    const response = await responsePromise;
    expect(response.body).toEqual({ error: 'Custom timeout' });
  });
});

describe('Bulkhead Middleware', () => {
  it('should pass requests through when capacity available', async () => {
    const bh = new Bulkhead<HttpResponse>({ maxConcurrent: 5 });
    const middleware = createBulkheadMiddleware(bh);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
  });

  it('should return 503 when bulkhead is full', async () => {
    vi.useRealTimers();

    const bh = new Bulkhead<HttpResponse>({ maxConcurrent: 1, maxQueue: 0 });
    const middleware = createBulkheadMiddleware(bh);

    let resolveFirst: () => void;
    const firstComplete = new Promise<void>((r) => { resolveFirst = r; });

    const handler: HttpHandler = vi.fn().mockImplementation(async () => {
      await firstComplete;
      return createSuccessResponse();
    });
    const wrapped = middleware(handler);

    // Start first request (holds the slot)
    const first = wrapped(createRequest());

    // Second request should fail immediately
    const response = await wrapped(createRequest());
    expect(response.status).toBe(503);

    resolveFirst!();
    await first;
  });

  it('should use custom onFull response', async () => {
    vi.useRealTimers();

    const bh = new Bulkhead<HttpResponse>({ maxConcurrent: 1, maxQueue: 0 });
    const middleware = createBulkheadMiddleware(bh, {
      onFull: () => createErrorResponse(503, 'Server busy'),
    });

    let resolveFirst: () => void;
    const firstComplete = new Promise<void>((r) => { resolveFirst = r; });

    const handler: HttpHandler = vi.fn().mockImplementation(async () => {
      await firstComplete;
      return createSuccessResponse();
    });
    const wrapped = middleware(handler);

    const first = wrapped(createRequest());
    const response = await wrapped(createRequest());
    expect(response.body).toEqual({ error: 'Server busy' });

    resolveFirst!();
    await first;
  });
});

describe('Fallback Middleware', () => {
  it('should pass successful requests through', async () => {
    const fb = new Fallback<HttpResponse>({
      fallback: async () => createErrorResponse(500, 'Fallback'),
    });
    const middleware = createFallbackMiddleware(fb);

    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
  });

  it('should return fallback on error', async () => {
    const fb = new Fallback<HttpResponse>({
      fallback: async () => createErrorResponse(500, 'Fallback response'),
    });
    const middleware = createFallbackMiddleware(fb);

    const handler: HttpHandler = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Fallback response' });
  });
});

describe('Chain Middleware', () => {
  it('should execute handler through chain', async () => {
    vi.useRealTimers();

    const rl = new RateLimiter({ rate: 100, burst: 100 });
    const timeout = new Timeout<HttpResponse>();

    const chain = new Chain<HttpResponse>()
      .withRateLimit(rl, 'test')
      .withTimeout(timeout, 5000);

    const middleware = createChainMiddleware(chain);
    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = middleware(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
  });
});

describe('composeMiddleware', () => {
  it('should compose middlewares in order', async () => {
    const log: string[] = [];

    const middleware1: (h: HttpHandler) => HttpHandler = (handler) => async (req) => {
      log.push('m1-before');
      const res = await handler(req);
      log.push('m1-after');
      return res;
    };

    const middleware2: (h: HttpHandler) => HttpHandler = (handler) => async (req) => {
      log.push('m2-before');
      const res = await handler(req);
      log.push('m2-after');
      return res;
    };

    const composed = composeMiddleware(middleware1, middleware2);
    const handler: HttpHandler = vi.fn().mockImplementation(async () => {
      log.push('handler');
      return createSuccessResponse();
    });
    const wrapped = composed(handler);

    await wrapped(createRequest());

    expect(log).toEqual(['m1-before', 'm2-before', 'handler', 'm2-after', 'm1-after']);
  });

  it('should work with empty middleware array', async () => {
    const composed = composeMiddleware();
    const handler: HttpHandler = vi.fn().mockResolvedValue(createSuccessResponse());
    const wrapped = composed(handler);

    const response = await wrapped(createRequest());
    expect(response.status).toBe(200);
  });
});
