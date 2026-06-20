import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Chain } from '../src/chain.js';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { Timeout } from '@klarlabs-studio/fortify-timeout';
import { Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { Fallback } from '@klarlabs-studio/fortify-fallback';
import { CostBudget, BudgetExceededError } from '@klarlabs-studio/fortify-cost-budget';

describe('Chain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execute without middleware', () => {
    it('should execute operation directly', async () => {
      const chain = new Chain<string>();
      const result = await chain.execute(async () => 'result');
      expect(result).toBe('result');
    });

    it('should pass signal to operation', async () => {
      const chain = new Chain<string>();
      const controller = new AbortController();

      let receivedSignal: AbortSignal | undefined;
      await chain.execute(async (signal) => {
        receivedSignal = signal;
        return 'result';
      }, controller.signal);

      expect(receivedSignal).toBe(controller.signal);
    });
  });

  describe('withCircuitBreaker', () => {
    it('should wrap operation with circuit breaker', async () => {
      const cb = new CircuitBreaker<string>();
      const chain = new Chain<string>().withCircuitBreaker(cb);

      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
      expect(cb.getCounts().totalSuccesses).toBe(1);

      cb.destroy();
    });
  });

  describe('withRetry', () => {
    it('should wrap operation with retry', async () => {
      vi.useRealTimers(); // Use real timers for retry

      const retry = new Retry<string>({ maxAttempts: 3, initialDelay: 1 });
      const chain = new Chain<string>().withRetry(retry);

      let attempts = 0;
      const result = await chain.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('fail');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('withRateLimit', () => {
    it('should wrap operation with rate limiter', async () => {
      const rl = new RateLimiter({ rate: 10, burst: 10 });
      const chain = new Chain<string>().withRateLimit(rl, 'key');

      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('withTimeout', () => {
    it('should wrap operation with timeout', async () => {
      const timeout = new Timeout<string>();
      const chain = new Chain<string>().withTimeout(timeout, 5000);

      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('withBulkhead', () => {
    it('should wrap operation with bulkhead', async () => {
      const bh = new Bulkhead<string>({ maxConcurrent: 5 });
      const chain = new Chain<string>().withBulkhead(bh);

      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('withFallback', () => {
    it('should wrap operation with fallback', async () => {
      const fb = new Fallback<string>({
        fallback: async () => 'fallback',
      });
      const chain = new Chain<string>().withFallback(fb);

      const result = await chain.execute(async () => {
        throw new Error('primary failed');
      });

      expect(result).toBe('fallback');
    });
  });

  describe('withCostBudget', () => {
    it('should wrap operation with a cost budget', async () => {
      const cb = new CostBudget<string>({ maxCost: 10, costFunc: () => 1 });
      const chain = new Chain<string>().withCostBudget(cb);

      const result = await chain.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should refuse work once the budget is exceeded', async () => {
      const cb = new CostBudget<string>({ maxCost: 1, costFunc: () => 0.6 });
      const chain = new Chain<string>().withCostBudget(cb);

      await chain.execute(async () => 'a');
      await expect(chain.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('should return this for chaining', () => {
      const cb = new CostBudget<string>({ maxCost: 10, costFunc: () => 1 });
      const chain = new Chain<string>();
      expect(chain.withCostBudget(cb)).toBe(chain);
    });
  });

  describe('use custom middleware', () => {
    it('should add custom middleware', async () => {
      const log: string[] = [];

      const chain = new Chain<string>()
        .use((next) => async (signal) => {
          log.push('before');
          const result = await next(signal);
          log.push('after');
          return result;
        });

      await chain.execute(async () => {
        log.push('operation');
        return 'result';
      });

      expect(log).toEqual(['before', 'operation', 'after']);
    });
  });

  describe('middleware ordering', () => {
    it('should apply middlewares in correct order (first added = outermost)', async () => {
      const log: string[] = [];

      const chain = new Chain<string>()
        .use((next) => async (signal) => {
          log.push('A-before');
          const result = await next(signal);
          log.push('A-after');
          return result;
        })
        .use((next) => async (signal) => {
          log.push('B-before');
          const result = await next(signal);
          log.push('B-after');
          return result;
        })
        .use((next) => async (signal) => {
          log.push('C-before');
          const result = await next(signal);
          log.push('C-after');
          return result;
        });

      await chain.execute(async () => {
        log.push('operation');
        return 'result';
      });

      expect(log).toEqual([
        'A-before',
        'B-before',
        'C-before',
        'operation',
        'C-after',
        'B-after',
        'A-after',
      ]);
    });
  });

  describe('full chain integration', () => {
    it('should compose multiple patterns', async () => {
      vi.useRealTimers();

      const cb = new CircuitBreaker<string>({ maxFailures: 3 });
      const retry = new Retry<string>({ maxAttempts: 2, initialDelay: 1 });
      const rl = new RateLimiter({ rate: 100, burst: 100 });
      const timeout = new Timeout<string>({ defaultTimeout: 5000 });
      const bh = new Bulkhead<string>({ maxConcurrent: 10 });
      const fb = new Fallback<string>({
        fallback: async () => 'fallback',
      });

      const chain = new Chain<string>()
        .withBulkhead(bh)
        .withRateLimit(rl, 'user-1')
        .withTimeout(timeout, 5000)
        .withCircuitBreaker(cb)
        .withRetry(retry)
        .withFallback(fb);

      // Successful operation
      const result1 = await chain.execute(async () => 'success');
      expect(result1).toBe('success');

      // Failed operation with fallback
      const result2 = await chain.execute(async () => {
        throw new Error('failed');
      });
      expect(result2).toBe('fallback');

      cb.destroy();
    });

    it('should handle errors correctly through chain', async () => {
      vi.useRealTimers();

      const retry = new Retry<string>({ maxAttempts: 2, initialDelay: 1 });
      const fb = new Fallback<string>({
        fallback: async () => 'fallback',
      });

      // Fallback is added first (outermost), retry is added second (inner)
      // So retry exhausts attempts, then fallback catches the final error
      const chain = new Chain<string>()
        .withFallback(fb)
        .withRetry(retry);

      let attempts = 0;
      const result = await chain.execute(async () => {
        attempts++;
        throw new Error('always fails');
      });

      // Should have retried and then used fallback
      expect(attempts).toBe(2);
      expect(result).toBe('fallback');
    });
  });

  describe('method chaining', () => {
    it('should return this for fluent API', () => {
      const cb = new CircuitBreaker<string>();
      const retry = new Retry<string>();
      const rl = new RateLimiter();
      const timeout = new Timeout<string>();
      const bh = new Bulkhead<string>();
      const fb = new Fallback<string>({ fallback: async () => '' });

      const chain = new Chain<string>();

      expect(chain.withCircuitBreaker(cb)).toBe(chain);
      expect(chain.withRetry(retry)).toBe(chain);
      expect(chain.withRateLimit(rl)).toBe(chain);
      expect(chain.withTimeout(timeout)).toBe(chain);
      expect(chain.withBulkhead(bh)).toBe(chain);
      expect(chain.withFallback(fb)).toBe(chain);
      expect(chain.use((next) => next)).toBe(chain);

      cb.destroy();
    });
  });

  describe('length and isEmpty', () => {
    it('should return 0 for empty chain', () => {
      const chain = new Chain<string>();
      expect(chain.length).toBe(0);
    });

    it('should return true for isEmpty on empty chain', () => {
      const chain = new Chain<string>();
      expect(chain.isEmpty()).toBe(true);
    });

    it('should return false for isEmpty after adding middleware', () => {
      const chain = new Chain<string>().use((next) => next);
      expect(chain.isEmpty()).toBe(false);
    });

    it('should return correct length after adding middlewares', () => {
      const cb = new CircuitBreaker<string>();
      const retry = new Retry<string>();

      const chain = new Chain<string>()
        .withCircuitBreaker(cb)
        .withRetry(retry)
        .use((next) => next);

      expect(chain.length).toBe(3);
      expect(chain.isEmpty()).toBe(false);

      cb.destroy();
    });

    it('should count each pattern addition separately', () => {
      const rl = new RateLimiter();
      const timeout = new Timeout<string>();
      const bh = new Bulkhead<string>();
      const fb = new Fallback<string>({ fallback: async () => '' });

      const chain = new Chain<string>()
        .withRateLimit(rl, 'key1')
        .withTimeout(timeout, 1000)
        .withBulkhead(bh)
        .withFallback(fb);

      expect(chain.length).toBe(4);
    });
  });
});
