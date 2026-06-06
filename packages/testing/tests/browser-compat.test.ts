/**
 * Browser Compatibility Tests
 *
 * These tests verify that all patterns work correctly in a browser-like environment
 * by testing the core APIs that should be available in modern browsers.
 */

import { describe, it, expect } from 'vitest';

// Import all browser-compatible packages
import {
  FortifyError,
  CircuitOpenError,
  RateLimitExceededError,
  BulkheadFullError,
  TimeoutError,
  sleep,
  withTimeout,
  combineSignals,
  isAbortError,
  throwIfAborted,
} from '@klarlabs-studio/fortify-core';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { Timeout } from '@klarlabs-studio/fortify-timeout';
import { Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { Fallback } from '@klarlabs-studio/fortify-fallback';
import { Chain } from '@klarlabs-studio/fortify-middleware';

describe('Browser Compatibility', () => {
  describe('Web APIs used', () => {
    it('should use standard AbortController', () => {
      const controller = new AbortController();
      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal).toHaveProperty('aborted');
      expect(controller.signal).toHaveProperty('reason');
      expect(typeof controller.abort).toBe('function');
    });

    it('should use standard AbortSignal.any()', () => {
      // AbortSignal.any is available in modern browsers and Node 20+
      if ('any' in AbortSignal) {
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        const combined = AbortSignal.any([controller1.signal, controller2.signal]);

        expect(combined).toHaveProperty('aborted');
        expect(combined.aborted).toBe(false);

        controller1.abort();
        expect(combined.aborted).toBe(true);
      } else {
        // Fallback should work
        const combined = combineSignals(
          new AbortController().signal,
          new AbortController().signal
        );
        expect(combined).toHaveProperty('aborted');
      }
    });

    it('should use standard Promise APIs', async () => {
      // Promise.race
      const result = await Promise.race([
        Promise.resolve('first'),
        new Promise((resolve) => setTimeout(resolve, 100, 'second')),
      ]);
      expect(result).toBe('first');

      // Promise.all
      const results = await Promise.all([
        Promise.resolve(1),
        Promise.resolve(2),
      ]);
      expect(results).toEqual([1, 2]);
    });

    it('should use standard DOMException for AbortError', () => {
      const error = new DOMException('Aborted', 'AbortError');
      expect(error.name).toBe('AbortError');
      expect(error.message).toBe('Aborted');
      expect(isAbortError(error)).toBe(true);
    });

    it('should use standard setTimeout/clearTimeout', async () => {
      let called = false;
      const id = setTimeout(() => {
        called = true;
      }, 10);

      clearTimeout(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(called).toBe(false);
    });

    it('should use standard Map', () => {
      const map = new Map<string, number>();
      map.set('a', 1);
      map.set('b', 2);

      expect(map.get('a')).toBe(1);
      expect(map.has('b')).toBe(true);
      expect(map.size).toBe(2);
    });

    it('should use Date.now() for timing', () => {
      const now = Date.now();
      expect(typeof now).toBe('number');
      expect(now).toBeGreaterThan(0);
    });

    it('should use performance.now() when available', () => {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        const now = performance.now();
        expect(typeof now).toBe('number');
        expect(now).toBeGreaterThanOrEqual(0);
      }
    });

    it('should use queueMicrotask for async callbacks', async () => {
      let called = false;
      queueMicrotask(() => {
        called = true;
      });

      // Should be called before the next tick
      await Promise.resolve();
      expect(called).toBe(true);
    });
  });

  describe('Core patterns work without Node.js APIs', () => {
    it('CircuitBreaker works', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 2, timeout: 100 });
      const result = await cb.execute(async () => 'success');
      expect(result).toBe('success');
      await cb.close();
    });

    it('Retry works', async () => {
      let attempts = 0;
      const retry = new Retry<string>({ maxAttempts: 3, initialDelay: 10 });
      const result = await retry.execute(async () => {
        attempts++;
        if (attempts < 2) throw new Error('fail');
        return 'success';
      });
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('RateLimiter works', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10, interval: 1000 });
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
    });

    it('Timeout works', async () => {
      const timeout = new Timeout<string>({ defaultTimeout: 1000 });
      const result = await timeout.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('Bulkhead works', async () => {
      const bulkhead = new Bulkhead<string>({ maxConcurrent: 2, maxQueue: 1 });
      const result = await bulkhead.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('Fallback works', async () => {
      const fallback = new Fallback<string>({
        fallback: () => 'fallback',
        shouldFallback: () => true,
      });
      const result = await fallback.execute(async () => {
        throw new Error('primary fails');
      });
      expect(result).toBe('fallback');
    });

    it('Chain works', async () => {
      const chain = new Chain<string>();
      chain.withTimeout(new Timeout({ defaultTimeout: 1000 }));
      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('Error types are standard', () => {
    it('FortifyError extends Error', () => {
      expect(new FortifyError('test')).toBeInstanceOf(Error);
    });

    it('CircuitOpenError extends FortifyError', () => {
      expect(new CircuitOpenError()).toBeInstanceOf(FortifyError);
      expect(new CircuitOpenError()).toBeInstanceOf(Error);
    });

    it('RateLimitExceededError extends FortifyError', () => {
      expect(new RateLimitExceededError()).toBeInstanceOf(FortifyError);
    });

    it('BulkheadFullError extends FortifyError', () => {
      expect(new BulkheadFullError()).toBeInstanceOf(FortifyError);
    });

    it('TimeoutError extends FortifyError', () => {
      expect(new TimeoutError('test', 1000)).toBeInstanceOf(FortifyError);
    });
  });

  describe('Utility functions work', () => {
    it('sleep works with cancellation', async () => {
      const controller = new AbortController();

      // Cancel immediately
      controller.abort();

      await expect(sleep(1000, controller.signal)).rejects.toThrow();
    });

    it('withTimeout works', async () => {
      const result = await withTimeout(Promise.resolve('done'), 1000);
      expect(result).toBe('done');
    });

    it('combineSignals works', () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const combined = combineSignals(controller1.signal, controller2.signal);
      expect(combined.aborted).toBe(false);

      controller1.abort();
      expect(combined.aborted).toBe(true);
    });

    it('throwIfAborted works', () => {
      const controller = new AbortController();

      expect(() => throwIfAborted(controller.signal)).not.toThrow();

      controller.abort();
      expect(() => throwIfAborted(controller.signal)).toThrow();
    });
  });
});
