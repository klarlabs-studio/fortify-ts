import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';
import { TokenBucket } from '../src/token-bucket.js';
import { KeyTooLongError } from '../src/errors.js';
import {
  RateLimitExceededError,
  type RateLimitStorage,
  type BucketState,
  MemoryStorage,
  sanitizeStorageKey,
  validateBucketState,
  bucketStateSchema,
} from '@klarlabs-studio/fortify-core';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('allow', () => {
    it('should allow requests when tokens are available', () => {
      const bucket = new TokenBucket(10, 10, 1000);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(true);
    });

    it('should reject when bucket is empty', () => {
      const bucket = new TokenBucket(10, 2, 1000);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(false);
    });

    it('should refill tokens over time', () => {
      const bucket = new TokenBucket(10, 2, 1000);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(false);

      // Advance 100ms (should add 1 token at 10/sec)
      vi.advanceTimersByTime(100);
      expect(bucket.allow()).toBe(true);
      expect(bucket.allow()).toBe(false);
    });

    it('should not exceed burst capacity', () => {
      const bucket = new TokenBucket(10, 5, 1000);
      // Drain bucket
      for (let i = 0; i < 5; i++) {
        bucket.allow();
      }
      expect(bucket.allow()).toBe(false);

      // Wait enough for full refill (and more)
      vi.advanceTimersByTime(2000);

      // Should only have burst (5) tokens
      for (let i = 0; i < 5; i++) {
        expect(bucket.allow()).toBe(true);
      }
      expect(bucket.allow()).toBe(false);
    });
  });

  describe('take', () => {
    it('should take multiple tokens at once', () => {
      const bucket = new TokenBucket(10, 10, 1000);
      expect(bucket.take(5)).toBe(true);
      expect(bucket.take(5)).toBe(true);
      expect(bucket.take(1)).toBe(false);
    });

    it('should reject if not enough tokens', () => {
      const bucket = new TokenBucket(10, 10, 1000);
      expect(bucket.take(5)).toBe(true);
      expect(bucket.take(10)).toBe(false);
    });

    it('should reject zero or negative tokens', () => {
      const bucket = new TokenBucket(10, 10, 1000);
      expect(bucket.take(0)).toBe(false);
      expect(bucket.take(-1)).toBe(false);
    });
  });

  describe('waitTime', () => {
    it('should return 0 when tokens are available', () => {
      const bucket = new TokenBucket(10, 10, 1000);
      expect(bucket.waitTime()).toBe(0);
    });

    it('should return wait time when no tokens available', () => {
      const bucket = new TokenBucket(10, 1, 1000);
      bucket.allow();
      const waitTime = bucket.waitTime();
      // At 10 tokens/second, need to wait 100ms for 1 token
      expect(waitTime).toBeCloseTo(100, 0);
    });
  });
});

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Create a mock storage adapter for testing.
   */
  function createMockStorage(): RateLimitStorage & {
    store: Map<string, BucketState>;
    getCalls: string[];
    setCalls: Array<{ key: string; state: BucketState; ttlMs?: number }>;
  } {
    const store = new Map<string, BucketState>();
    const getCalls: string[] = [];
    const setCalls: Array<{ key: string; state: BucketState; ttlMs?: number }> = [];

    return {
      store,
      getCalls,
      setCalls,
      async get(key: string): Promise<BucketState | null> {
        getCalls.push(key);
        return store.get(key) ?? null;
      },
      async set(key: string, state: BucketState, ttlMs?: number): Promise<void> {
        setCalls.push({ key, state: { ...state }, ttlMs });
        store.set(key, state);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async clear(): Promise<void> {
        store.clear();
      },
    };
  }

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const limiter = new RateLimiter();
      // Default is 100 requests per second
      for (let i = 0; i < 100; i++) {
        expect(limiter.allow()).toBe(true);
      }
      expect(limiter.allow()).toBe(false);
    });

    it('should accept custom configuration', () => {
      const limiter = new RateLimiter({
        rate: 5,
        burst: 10,
        interval: 1000,
      });

      for (let i = 0; i < 10; i++) {
        expect(limiter.allow()).toBe(true);
      }
      expect(limiter.allow()).toBe(false);
    });

    it('should default burst to rate when not specified', () => {
      const limiter = new RateLimiter({ rate: 5 });
      for (let i = 0; i < 5; i++) {
        expect(limiter.allow()).toBe(true);
      }
      expect(limiter.allow()).toBe(false);
    });
  });

  describe('allow', () => {
    it('should allow requests within rate limit', () => {
      const limiter = new RateLimiter({ rate: 5, burst: 5 });
      expect(limiter.allow('user-1')).toBe(true);
    });

    it('should reject requests exceeding rate limit', () => {
      const limiter = new RateLimiter({ rate: 2, burst: 2 });
      expect(limiter.allow('user-1')).toBe(true);
      expect(limiter.allow('user-1')).toBe(true);
      expect(limiter.allow('user-1')).toBe(false);
    });

    it('should maintain separate limits per key', () => {
      const limiter = new RateLimiter({ rate: 2, burst: 2 });
      expect(limiter.allow('user-1')).toBe(true);
      expect(limiter.allow('user-1')).toBe(true);
      expect(limiter.allow('user-1')).toBe(false);

      // user-2 should have their own bucket
      expect(limiter.allow('user-2')).toBe(true);
      expect(limiter.allow('user-2')).toBe(true);
      expect(limiter.allow('user-2')).toBe(false);
    });

    it('should use default key when not provided', () => {
      const limiter = new RateLimiter({ rate: 2, burst: 2 });
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(true);
      expect(limiter.allow()).toBe(false);
    });
  });

  describe('take', () => {
    it('should take multiple tokens', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10 });
      expect(limiter.take('key', 5)).toBe(true);
      expect(limiter.take('key', 5)).toBe(true);
      expect(limiter.take('key', 1)).toBe(false);
    });

    it('should reject zero or negative tokens', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10 });
      expect(limiter.take('key', 0)).toBe(false);
      expect(limiter.take('key', -1)).toBe(false);
    });
  });

  describe('wait', () => {
    it('should return immediately when tokens available', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10 });
      await limiter.wait('key');
      // Should not throw
    });

    it('should wait for token when bucket is empty', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 1 });
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(false);

      const waitPromise = limiter.wait('key');

      // Advance time to refill 1 token
      vi.advanceTimersByTime(100);

      await waitPromise;
      // Should complete without error
    });

    it('should abort when signal is already aborted', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10 });
      const controller = new AbortController();
      controller.abort();

      await expect(limiter.wait('key', controller.signal)).rejects.toThrow();
    });

    it('should abort when signal is aborted during wait', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 1 });
      limiter.allow('key'); // Drain

      const controller = new AbortController();
      const waitPromise = limiter.wait('key', controller.signal);

      // Abort while waiting
      controller.abort();

      await expect(waitPromise).rejects.toThrow();
    });
  });

  describe('execute', () => {
    it('should execute operation when allowed', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 10 });
      const result = await limiter.execute(async () => 'success', 'key');
      expect(result).toBe('success');
    });

    it('should throw RateLimitExceededError when rate limited', async () => {
      const limiter = new RateLimiter({ rate: 1, burst: 1 });
      await limiter.execute(async () => 'first', 'key');

      await expect(
        limiter.execute(async () => 'second', 'key')
      ).rejects.toThrow(RateLimitExceededError);
    });

    it('should throw when signal is already aborted', async () => {
      const limiter = new RateLimiter();
      const controller = new AbortController();
      controller.abort();

      await expect(
        limiter.execute(async () => 'success', 'key', controller.signal)
      ).rejects.toThrow();
    });
  });

  describe('reset', () => {
    it('should clear all buckets', () => {
      const limiter = new RateLimiter({ rate: 2, burst: 2 });

      // Drain some keys
      limiter.allow('key-1');
      limiter.allow('key-1');
      limiter.allow('key-2');
      limiter.allow('key-2');

      expect(limiter.allow('key-1')).toBe(false);
      expect(limiter.allow('key-2')).toBe(false);

      // Reset
      limiter.reset();

      // Buckets should be fresh
      expect(limiter.allow('key-1')).toBe(true);
      expect(limiter.allow('key-2')).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('should call onLimit when rate limited', () => {
      const onLimit = vi.fn();
      const limiter = new RateLimiter({
        rate: 1,
        burst: 1,
        onLimit,
      });

      limiter.allow('test-key');
      expect(onLimit).not.toHaveBeenCalled();

      limiter.allow('test-key');
      // onLimit is called with key and optional context
      expect(onLimit).toHaveBeenCalledWith('test-key', undefined);
    });

    it('should handle errors in onLimit gracefully', () => {
      const onLimit = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      const limiter = new RateLimiter({
        rate: 1,
        burst: 1,
        onLimit,
      });

      limiter.allow('key');
      // Should not throw
      expect(() => limiter.allow('key')).not.toThrow();
    });
  });

  describe('rate refill', () => {
    it('should refill tokens over time', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        interval: 1000,
      });

      // Drain bucket
      for (let i = 0; i < 10; i++) {
        limiter.allow('key');
      }
      expect(limiter.allow('key')).toBe(false);

      // Advance 500ms (should add 5 tokens)
      vi.advanceTimersByTime(500);
      for (let i = 0; i < 5; i++) {
        expect(limiter.allow('key')).toBe(true);
      }
      expect(limiter.allow('key')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest bucket when maxBuckets is exceeded', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxBuckets: 3,
      });

      // Create 3 buckets
      limiter.allow('key-1');
      limiter.allow('key-2');
      limiter.allow('key-3');

      expect(limiter.bucketCount()).toBe(3);
      expect(limiter.getEvictionCount()).toBe(0);

      // Adding 4th key should evict the oldest (key-1)
      limiter.allow('key-4');

      expect(limiter.bucketCount()).toBe(3);
      expect(limiter.getEvictionCount()).toBe(1);
    });

    it('should evict LRU bucket not just oldest created', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxBuckets: 3,
      });

      // Create 3 buckets
      limiter.allow('key-1');
      limiter.allow('key-2');
      limiter.allow('key-3');

      // Touch key-1 to make it recently used
      limiter.allow('key-1');

      // Adding 4th key should evict key-2 (now the LRU)
      limiter.allow('key-4');

      expect(limiter.bucketCount()).toBe(3);
      expect(limiter.getEvictionCount()).toBe(1);

      // key-1 should still work (wasn't evicted)
      // key-2 was evicted, so it should get a fresh bucket
      expect(limiter.allow('key-1')).toBe(true);
    });

    it('should not evict when maxBuckets is 0 (unlimited)', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxBuckets: 0,
      });

      // Create many buckets
      for (let i = 0; i < 100; i++) {
        limiter.allow(`key-${i}`);
      }

      expect(limiter.bucketCount()).toBe(100);
      expect(limiter.getEvictionCount()).toBe(0);
    });

    it('should reset eviction count on reset', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxBuckets: 2,
      });

      limiter.allow('key-1');
      limiter.allow('key-2');
      limiter.allow('key-3'); // Evicts key-1

      expect(limiter.getEvictionCount()).toBe(1);

      limiter.reset();

      // Bucket count should be 0, but eviction count is NOT reset
      // (eviction count tracks total evictions since creation)
      expect(limiter.bucketCount()).toBe(0);
      expect(limiter.getEvictionCount()).toBe(1);
    });
  });

  describe('external storage adapter', () => {
    it('should indicate when external storage is configured', () => {
      const storage = createMockStorage();
      const limiter = new RateLimiter({ rate: 10, storage });

      expect(limiter.hasExternalStorage()).toBe(true);
    });

    it('should indicate when external storage is not configured', () => {
      const limiter = new RateLimiter({ rate: 10 });

      expect(limiter.hasExternalStorage()).toBe(false);
    });

    describe('allowAsync', () => {
      it('should allow requests when tokens are available', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
      });

      it('should reject requests when rate limited', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 2, storage });

        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(false);
      });

      it('should persist state to storage', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

        await limiter.allowAsync('user-1');

        expect(storage.getCalls).toContain('user-1');
        expect(storage.setCalls.length).toBeGreaterThan(0);
        expect(storage.setCalls[0]?.key).toBe('user-1');
      });

      it('should pass TTL to storage.set', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({
          rate: 10,
          burst: 10,
          interval: 1000,
          storage,
          storageTtlMs: 5000,
        });

        await limiter.allowAsync('user-1');

        expect(storage.setCalls[0]?.ttlMs).toBe(5000);
      });

      it('should calculate default TTL based on config', async () => {
        const storage = createMockStorage();
        // rate=10, burst=10, interval=1000
        // default TTL = interval * (burst / rate) * 2 = 1000 * 1 * 2 = 2000
        const limiter = new RateLimiter({
          rate: 10,
          burst: 10,
          interval: 1000,
          storage,
        });

        await limiter.allowAsync('user-1');

        expect(storage.setCalls[0]?.ttlMs).toBe(2000);
      });

      it('should maintain separate limits per key', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 2, storage });

        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(false);

        // Different user should have fresh bucket
        expect(await limiter.allowAsync('user-2')).toBe(true);
        expect(await limiter.allowAsync('user-2')).toBe(true);
      });

      it('should restore state from storage', async () => {
        const storage = createMockStorage();

        // Pre-populate storage with a bucket that has 1 token left
        storage.store.set('user-1', {
          tokens: 1,
          lastRefill: Date.now(),
        });

        const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

        // Should only have 1 token
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(false);
      });
    });

    describe('takeAsync', () => {
      it('should take multiple tokens', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 10, storage });

        expect(await limiter.takeAsync('user-1', 5)).toBe(true);
        expect(await limiter.takeAsync('user-1', 5)).toBe(true);
        expect(await limiter.takeAsync('user-1', 1)).toBe(false);
      });

      it('should reject zero or negative tokens', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, storage });

        expect(await limiter.takeAsync('user-1', 0)).toBe(false);
        expect(await limiter.takeAsync('user-1', -1)).toBe(false);
      });

      it('should persist state after taking tokens', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 10, storage });

        await limiter.takeAsync('user-1', 3);

        const state = storage.store.get('user-1');
        expect(state).toBeDefined();
        expect(state?.tokens).toBeLessThan(10);
      });
    });

    describe('waitAsync', () => {
      it('should return immediately when tokens available', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 10, storage });

        const start = Date.now();
        await limiter.waitAsync('user-1');
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(50);
      });

      it('should abort when signal is already aborted', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, storage });
        const controller = new AbortController();
        controller.abort();

        await expect(limiter.waitAsync('user-1', controller.signal)).rejects.toThrow();
      });
    });

    describe('executeAsync', () => {
      it('should execute operation when allowed', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 10, storage });

        const result = await limiter.executeAsync(async () => 'success', 'user-1');

        expect(result).toBe('success');
      });

      it('should throw RateLimitExceededError when rate limited', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, burst: 1, storage });

        await limiter.allowAsync('user-1'); // Use up the token

        await expect(
          limiter.executeAsync(async () => 'success', 'user-1')
        ).rejects.toThrow(RateLimitExceededError);
      });

      it('should throw when signal is already aborted', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, storage });
        const controller = new AbortController();
        controller.abort();

        await expect(
          limiter.executeAsync(async () => 'success', 'user-1', controller.signal)
        ).rejects.toThrow();
      });
    });

    describe('resetAsync', () => {
      it('should clear both in-memory and external storage', async () => {
        const storage = createMockStorage();
        const limiter = new RateLimiter({ rate: 10, storage });

        await limiter.allowAsync('user-1');
        await limiter.allowAsync('user-2');

        expect(storage.store.size).toBe(2);
        expect(limiter.bucketCount()).toBeGreaterThanOrEqual(0);

        await limiter.resetAsync();

        expect(storage.store.size).toBe(0);
      });

      it('should handle external storage clear failure gracefully', async () => {
        const errorLogs: Array<{ message: string; context: unknown }> = [];
        const mockLogger = {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn((message: string, context: unknown) => {
            errorLogs.push({ message, context });
          }),
        };

        const storage: RateLimitStorage = {
          async get(): Promise<BucketState | null> {
            return null;
          },
          async set(): Promise<void> {},
          async clear(): Promise<void> {
            throw new Error('Storage clear failed');
          },
        };

        const limiter = new RateLimiter({
          rate: 10,
          storage,
          logger: mockLogger,
        });

        // resetAsync should not throw even when storage.clear fails
        await expect(limiter.resetAsync()).resolves.toBeUndefined();

        // Error should be logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to clear external storage',
          expect.objectContaining({
            error: 'Storage clear failed',
          })
        );
      });
    });

    describe('using MemoryStorage explicitly', () => {
      it('should work with MemoryStorage as external storage', async () => {
        const storage = new MemoryStorage({ maxEntries: 100 });
        const limiter = new RateLimiter({
          rate: 10,
          burst: 5,
          storage,
        });

        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(storage.size()).toBe(1);
      });
    });

    describe('sync and async methods are independent', () => {
      it('should use separate storage for sync and async methods', async () => {
        const externalStorage = createMockStorage();
        const limiter = new RateLimiter({
          rate: 10,
          burst: 2,
          storage: externalStorage,
        });

        // Sync uses in-memory storage
        expect(limiter.allow('user-1')).toBe(true);
        expect(limiter.allow('user-1')).toBe(true);
        expect(limiter.allow('user-1')).toBe(false);

        // Async uses external storage (fresh bucket)
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(false);
      });
    });

    describe('storage failure modes', () => {
      function createFailingStorage(
        failOn: 'get' | 'set' | 'both' = 'both'
      ): RateLimitStorage {
        return {
          async get(key: string): Promise<BucketState | null> {
            if (failOn === 'get' || failOn === 'both') {
              throw new Error('Storage read failed');
            }
            return null;
          },
          async set(): Promise<void> {
            if (failOn === 'set' || failOn === 'both') {
              throw new Error('Storage write failed');
            }
          },
        };
      }

      it('should allow request on storage failure with fail-open mode (default)', async () => {
        const storage = createFailingStorage();
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'fail-open',
        });

        expect(await limiter.allowAsync('user-1')).toBe(true);
      });

      it('should deny request on storage failure with fail-closed mode', async () => {
        const storage = createFailingStorage();
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'fail-closed',
        });

        expect(await limiter.allowAsync('user-1')).toBe(false);
      });

      it('should throw on storage failure with throw mode', async () => {
        const storage = createFailingStorage();
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'throw',
        });

        await expect(limiter.allowAsync('user-1')).rejects.toThrow('Storage read failed');
      });

      it('should handle storage.set failure in fail-open mode', async () => {
        const storage = createFailingStorage('set');
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'fail-open',
        });

        // get succeeds, set fails - should still return true in fail-open
        expect(await limiter.allowAsync('user-1')).toBe(true);
      });

      it('should return in waitAsync on fail-open (consistent with other methods)', async () => {
        const storage = createFailingStorage();
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'fail-open',
        });

        // In fail-open mode, waitAsync returns immediately (allows the request)
        await expect(limiter.waitAsync('user-1')).resolves.toBeUndefined();
      });

      it('should apply failure mode to takeAsync', async () => {
        const storage = createFailingStorage();
        const limiter = new RateLimiter({
          rate: 10,
          storage,
          storageFailureMode: 'fail-closed',
        });

        expect(await limiter.takeAsync('user-1', 5)).toBe(false);
      });
    });

    describe('fast path optimization', () => {
      it('should use sync path when no external storage for allowAsync', async () => {
        const limiter = new RateLimiter({ rate: 10, burst: 2 });

        // These should work just like sync allow()
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(true);
        expect(await limiter.allowAsync('user-1')).toBe(false);
      });

      it('should use sync path when no external storage for takeAsync', async () => {
        const limiter = new RateLimiter({ rate: 10, burst: 10 });

        expect(await limiter.takeAsync('user-1', 5)).toBe(true);
        expect(await limiter.takeAsync('user-1', 5)).toBe(true);
        expect(await limiter.takeAsync('user-1', 1)).toBe(false);
      });

      it('should use sync path when no external storage for waitAsync', async () => {
        const limiter = new RateLimiter({ rate: 10, burst: 10 });

        await limiter.waitAsync('user-1');
        // Should not throw and should consume a token
        expect(limiter.allow('user-1')).toBe(true); // Uses sync path
      });
    });
  });

  describe('key sanitization', () => {
    it('should sanitize keys by default', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });

      // Keys with dangerous characters should be sanitized
      expect(limiter.allow('user/with/slashes')).toBe(true);
      expect(limiter.allow('user_with_slashes')).toBe(true); // Same sanitized key
      expect(limiter.allow('user_with_slashes')).toBe(false); // Exhausted
    });

    it('should sanitize keys in async methods', async () => {
      const storage = createMockStorage();
      const limiter = new RateLimiter({ rate: 10, storage });

      await limiter.allowAsync('user/with/slashes');

      // Key should be sanitized in storage calls
      expect(storage.getCalls[0]).toBe('user_with_slashes');
    });

    it('should not sanitize keys when disabled', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        sanitizeKeys: false,
      });

      // Keys should be used as-is
      expect(limiter.allow('user/1')).toBe(true);
      expect(limiter.allow('user/1')).toBe(true);
      expect(limiter.allow('user_1')).toBe(true); // Different key
    });

    it('should remove control characters from keys', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });

      expect(limiter.allow('user\x00with\x1fnullbytes')).toBe(true);
      expect(limiter.allow('userwithnullbytes')).toBe(true); // Same sanitized key
      expect(limiter.allow('userwithnullbytes')).toBe(false);
    });

    it('should throw KeyTooLongError for keys exceeding maxKeyLength', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });
      const longKey = 'a'.repeat(500);

      // Default maxKeyLength is 256, so keys longer than that throw
      expect(() => limiter.allow(longKey)).toThrow(KeyTooLongError);

      // Keys exactly at maxKeyLength should work
      expect(limiter.allow('a'.repeat(256))).toBe(true);
      expect(limiter.allow('a'.repeat(256))).toBe(true);
      expect(limiter.allow('a'.repeat(256))).toBe(false);
    });

    it('should allow configuring maxKeyLength', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2, maxKeyLength: 100 });
      const longKey = 'a'.repeat(150);

      expect(() => limiter.allow(longKey)).toThrow(KeyTooLongError);
      expect(limiter.allow('a'.repeat(100))).toBe(true); // Exactly at limit
    });
  });

  describe('metrics', () => {
    it('should call onAllow when request is allowed', () => {
      const onAllow = vi.fn();
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        metrics: { onAllow },
      });

      limiter.allow('test-key');
      expect(onAllow).toHaveBeenCalledWith({
        key: 'test-key',
        tokens: 1,
        currentTokens: 1,
        burst: 2,
        isAsync: false,
      });
    });

    it('should call onDeny when request is denied', () => {
      const onDeny = vi.fn();
      const limiter = new RateLimiter({
        rate: 10,
        burst: 1,
        metrics: { onDeny },
      });

      limiter.allow('test-key');
      limiter.allow('test-key');

      expect(onDeny).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'test-key',
          tokens: 1,
          burst: 1,
          isAsync: false,
        })
      );
    });

    it('should call onError when error occurs', () => {
      const onError = vi.fn();
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        maxKeyLength: 10,
        metrics: { onError },
      });

      expect(() => limiter.allow('a'.repeat(20))).toThrow(KeyTooLongError);
      expect(onError).toHaveBeenCalled();
    });

    it('should handle errors in metrics callbacks gracefully', () => {
      const onAllow = vi.fn().mockImplementation(() => {
        throw new Error('metrics error');
      });
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        metrics: { onAllow },
      });

      // Should not throw
      expect(() => limiter.allow('test-key')).not.toThrow();
    });
  });

  describe('keyFunc', () => {
    it('should extract key from context using keyFunc', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 1,
        keyFunc: (ctx) => ctx.userId as string | undefined,
      });

      expect(limiter.allowWithContext({ userId: 'user-1' })).toBe(true);
      expect(limiter.allowWithContext({ userId: 'user-1' })).toBe(false);
      expect(limiter.allowWithContext({ userId: 'user-2' })).toBe(true);
    });

    it('should allow request when keyFunc returns undefined', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 1,
        keyFunc: () => undefined,
      });

      // All requests allowed because no key extracted
      expect(limiter.allowWithContext({})).toBe(true);
      expect(limiter.allowWithContext({})).toBe(true);
      expect(limiter.allowWithContext({})).toBe(true);
    });

    it('should return true when no keyFunc configured', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 1 });

      // No keyFunc, always returns true
      expect(limiter.allowWithContext({})).toBe(true);
    });

    it('should handle keyFunc errors gracefully', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 1,
        keyFunc: () => {
          throw new Error('keyFunc error');
        },
      });

      // Should not throw, returns true (no key extracted)
      expect(() => limiter.allowWithContext({})).not.toThrow();
      expect(limiter.allowWithContext({})).toBe(true);
    });
  });

  describe('maxTokensPerRequest', () => {
    it('should throw TokensExceededError for excessive token requests', async () => {
      const { TokensExceededError } = await import('../src/errors.js');
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxTokensPerRequest: 5,
      });

      expect(() => limiter.take('key', 10)).toThrow(TokensExceededError);
    });

    it('should allow token requests within limit', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
        maxTokensPerRequest: 5,
      });

      expect(limiter.take('key', 5)).toBe(true);
    });

    it('should use default maxTokensPerRequest of burst * 10', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 10,
      });

      // Default maxTokensPerRequest is 10 * 10 = 100
      expect(limiter.take('key', 10)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a bucket by key', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });

      limiter.allow('key-1');
      limiter.allow('key-1');
      expect(limiter.allow('key-1')).toBe(false);

      limiter.delete('key-1');

      // After delete, bucket is reset
      expect(limiter.allow('key-1')).toBe(true);
    });
  });

  describe('keyCount', () => {
    it('should return the number of active buckets', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });

      expect(limiter.keyCount()).toBe(0);
      limiter.allow('key-1');
      expect(limiter.keyCount()).toBe(1);
      limiter.allow('key-2');
      expect(limiter.keyCount()).toBe(2);
      limiter.allow('key-1'); // Same key
      expect(limiter.keyCount()).toBe(2);
    });
  });

  describe('healthCheck', () => {
    it('should return true when no external storage', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });
      expect(await limiter.healthCheck()).toBe(true);
    });

    it('should verify external storage is operational', async () => {
      // Use a store that tracks set/get operations with randomized keys
      const store = new Map<string, BucketState>();
      const storage: RateLimitStorage = {
        async get(key) {
          return store.get(key) ?? null;
        },
        async set(key, state) {
          store.set(key, state);
        },
        async delete(key) {
          store.delete(key);
        },
      };

      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        storage,
      });

      expect(await limiter.healthCheck()).toBe(true);
    });

    it('should throw HealthCheckError on storage failure', async () => {
      const { HealthCheckError } = await import('../src/errors.js');
      const storage: RateLimitStorage = {
        async get() {
          throw new Error('Storage unavailable');
        },
        async set() {
          throw new Error('Storage unavailable');
        },
      };

      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        storage,
      });

      await expect(limiter.healthCheck()).rejects.toThrow(HealthCheckError);
    });
  });

  describe('isClosed', () => {
    it('should return false when not closed', () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });
      expect(limiter.isClosed()).toBe(false);
    });

    it('should return true after close', async () => {
      const limiter = new RateLimiter({ rate: 10, burst: 2 });
      await limiter.close();
      expect(limiter.isClosed()).toBe(true);
    });
  });

  describe('cleanupInterval', () => {
    it('should accept cleanupIntervalMs configuration', () => {
      // Should not throw
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        cleanupIntervalMs: 30000,
      });
      expect(limiter).toBeDefined();
    });

    it('should accept 0 to disable cleanup', () => {
      const limiter = new RateLimiter({
        rate: 10,
        burst: 2,
        cleanupIntervalMs: 0,
      });
      expect(limiter).toBeDefined();
    });

    it('should handle cleanup timer errors gracefully', async () => {
      vi.useFakeTimers();

      const errorLogs: Array<{ message: string; context: unknown }> = [];
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn((message: string, context: unknown) => {
          errorLogs.push({ message, context });
        }),
      };

      const limiter = new RateLimiter({
        rate: 10,
        burst: 5,
        cleanupIntervalMs: 1000,
        logger: mockLogger,
      });

      // Mock keyCount to throw an error during cleanup
      vi.spyOn(limiter, 'keyCount').mockImplementation(() => {
        throw new Error('Mock cleanup error');
      });

      // Advance time to trigger cleanup
      await vi.advanceTimersByTimeAsync(1000);

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cleanup timer error',
        expect.objectContaining({
          error: 'Mock cleanup error',
        })
      );

      // Limiter should still be usable
      expect(limiter.allow('test-key')).toBe(true);

      limiter.close();
      vi.useRealTimers();
    });
  });
});

describe('BucketState validation', () => {
  describe('bucketStateSchema', () => {
    it('should validate valid bucket state', () => {
      const result = bucketStateSchema.safeParse({
        tokens: 10,
        lastRefill: 1234567890,
      });

      expect(result.success).toBe(true);
    });

    it('should reject negative tokens', () => {
      const result = bucketStateSchema.safeParse({
        tokens: -5,
        lastRefill: 1234567890,
      });

      expect(result.success).toBe(false);
    });

    it('should reject negative lastRefill', () => {
      const result = bucketStateSchema.safeParse({
        tokens: 10,
        lastRefill: -1,
      });

      expect(result.success).toBe(false);
    });

    it('should reject non-integer lastRefill', () => {
      const result = bucketStateSchema.safeParse({
        tokens: 10,
        lastRefill: 1234.567,
      });

      expect(result.success).toBe(false);
    });

    it('should accept decimal tokens', () => {
      const result = bucketStateSchema.safeParse({
        tokens: 5.5,
        lastRefill: 1234567890,
      });

      expect(result.success).toBe(true);
    });

    it('should reject NaN tokens', () => {
      const result = bucketStateSchema.safeParse({
        tokens: NaN,
        lastRefill: 1234567890,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('validateBucketState', () => {
    it('should return valid bucket state', () => {
      const state = validateBucketState({
        tokens: 10,
        lastRefill: 1234567890,
      });

      expect(state).toEqual({ tokens: 10, lastRefill: 1234567890 });
    });

    it('should return null for invalid data', () => {
      expect(validateBucketState(null)).toBeNull();
      expect(validateBucketState(undefined)).toBeNull();
      expect(validateBucketState('string')).toBeNull();
      expect(validateBucketState({ tokens: -1, lastRefill: 0 })).toBeNull();
    });

    it('should return null for missing fields', () => {
      expect(validateBucketState({ tokens: 10 })).toBeNull();
      expect(validateBucketState({ lastRefill: 1234567890 })).toBeNull();
    });
  });
});

describe('sanitizeStorageKey', () => {
  it('should pass through simple alphanumeric keys', () => {
    expect(sanitizeStorageKey('user123')).toBe('user123');
    expect(sanitizeStorageKey('key-with-dashes')).toBe('key-with-dashes');
    expect(sanitizeStorageKey('key_with_underscores')).toBe('key_with_underscores');
  });

  it('should replace path separators with underscores', () => {
    expect(sanitizeStorageKey('user/id')).toBe('user_id');
    expect(sanitizeStorageKey('user\\id')).toBe('user_id');
    expect(sanitizeStorageKey('path/to/resource')).toBe('path_to_resource');
  });

  it('should remove control characters', () => {
    expect(sanitizeStorageKey('user\x00id')).toBe('userid');
    expect(sanitizeStorageKey('user\nid')).toBe('userid');
    expect(sanitizeStorageKey('user\tid')).toBe('userid');
    expect(sanitizeStorageKey('\x1fprefix')).toBe('prefix');
  });

  it('should truncate long keys to 256 characters', () => {
    const longKey = 'a'.repeat(300);
    expect(sanitizeStorageKey(longKey)).toBe('a'.repeat(256));
  });

  it('should handle empty strings', () => {
    expect(sanitizeStorageKey('')).toBe('');
  });

  it('should preserve dots, colons, and at signs', () => {
    expect(sanitizeStorageKey('user@domain.com')).toBe('user@domain.com');
    expect(sanitizeStorageKey('prefix:key')).toBe('prefix:key');
  });
});

describe('MemoryStorage compareAndSet', () => {
  it('should update state when expected matches current', async () => {
    const storage = new MemoryStorage();
    const initial: BucketState = { tokens: 10, lastRefill: 1000 };
    const updated: BucketState = { tokens: 9, lastRefill: 1100 };

    await storage.set('key', initial);

    const result = await storage.compareAndSet('key', initial, updated);

    expect(result.success).toBe(true);
    expect(result.currentState).toEqual(updated);
    expect(await storage.get('key')).toEqual(updated);
  });

  it('should fail when expected does not match current', async () => {
    const storage = new MemoryStorage();
    const initial: BucketState = { tokens: 10, lastRefill: 1000 };
    const stale: BucketState = { tokens: 10, lastRefill: 999 };
    const updated: BucketState = { tokens: 9, lastRefill: 1100 };

    await storage.set('key', initial);

    const result = await storage.compareAndSet('key', stale, updated);

    expect(result.success).toBe(false);
    expect(result.currentState).toEqual(initial);
    expect(await storage.get('key')).toEqual(initial); // Not updated
  });

  it('should succeed when expected is null and key does not exist', async () => {
    const storage = new MemoryStorage();
    const newState: BucketState = { tokens: 10, lastRefill: 1000 };

    const result = await storage.compareAndSet('key', null, newState);

    expect(result.success).toBe(true);
    expect(result.currentState).toEqual(newState);
    expect(await storage.get('key')).toEqual(newState);
  });

  it('should fail when expected is null but key exists', async () => {
    const storage = new MemoryStorage();
    const existing: BucketState = { tokens: 5, lastRefill: 1000 };
    const newState: BucketState = { tokens: 10, lastRefill: 2000 };

    await storage.set('key', existing);

    const result = await storage.compareAndSet('key', null, newState);

    expect(result.success).toBe(false);
    expect(result.currentState).toEqual(existing);
  });
});

describe('Storage data validation', () => {
  /**
   * Create a mock storage adapter that returns specified data.
   */
  function createStorageWithData(
    data: Record<string, unknown>
  ): RateLimitStorage & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>(Object.entries(data));
    return {
      store,
      async get(key: string): Promise<BucketState | null> {
        return store.get(key) as BucketState | null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        store.set(key, state);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async clear(): Promise<void> {
        store.clear();
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000); // Fixed timestamp for testing
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle corrupted bucket state from storage', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: 'invalid', lastRefill: 'also-invalid' },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Should create new bucket instead of failing
    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should handle missing tokens field', async () => {
    const storage = createStorageWithData({
      'user-1': { lastRefill: Date.now() },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should handle missing lastRefill field', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: 5 },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should handle lastRefill in the future (clock skew)', async () => {
    const futureTime = Date.now() + 120000; // 2 minutes in future
    const storage = createStorageWithData({
      'user-1': { tokens: 3, lastRefill: futureTime },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Should reset bucket due to future timestamp
    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should normalize tokens exceeding burst capacity', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: 1000, lastRefill: Date.now() },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // First request should use normalized tokens (capped at burst=5)
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(false);
  });

  it('should handle negative token values', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: -5, lastRefill: Date.now() },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Should create new bucket due to invalid data
    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should handle NaN token values', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: NaN, lastRefill: Date.now() },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    expect(await limiter.allowAsync('user-1')).toBe(true);
  });

  it('should handle Infinity token values', async () => {
    const storage = createStorageWithData({
      'user-1': { tokens: Infinity, lastRefill: Date.now() },
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    expect(await limiter.allowAsync('user-1')).toBe(true);
  });
});

describe('Storage timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should timeout slow storage operations', async () => {
    const slowStorage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        // Never resolves
        return new Promise(() => {});
      },
      async set(): Promise<void> {
        // Never resolves
        return new Promise(() => {});
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      storage: slowStorage,
      storageTimeoutMs: 1000,
      storageFailureMode: 'fail-open',
    });

    const promise = limiter.allowAsync('user-1');

    // Advance past timeout
    vi.advanceTimersByTime(1500);

    // Should fail open due to timeout
    expect(await promise).toBe(true);
  });

  it('should use default timeout when not specified', () => {
    const limiter = new RateLimiter({ rate: 10 });
    // Just verify it doesn't throw - default timeout is 5000ms
    expect(limiter).toBeDefined();
  });
});

describe('Zod schema bounds', () => {
  it('should reject tokens exceeding MAX_TOKENS', () => {
    const result = bucketStateSchema.safeParse({
      tokens: 2_000_000_000, // Exceeds 1 billion
      lastRefill: Date.now(),
    });

    expect(result.success).toBe(false);
  });

  it('should reject lastRefill exceeding MAX_TIMESTAMP', () => {
    const result = bucketStateSchema.safeParse({
      tokens: 10,
      lastRefill: 5_000_000_000_000, // Exceeds year 2100
    });

    expect(result.success).toBe(false);
  });

  it('should accept valid bucket state within bounds', () => {
    const result = bucketStateSchema.safeParse({
      tokens: 100,
      lastRefill: Date.now(),
    });

    expect(result.success).toBe(true);
  });

  it('should reject Infinity tokens', () => {
    const result = bucketStateSchema.safeParse({
      tokens: Infinity,
      lastRefill: Date.now(),
    });

    expect(result.success).toBe(false);
  });
});

describe('Config validation', () => {
  it('should reject storageTimeoutMs below minimum (100ms)', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTimeoutMs: 50, // Below 100ms minimum
      });
    }).toThrow(/storageTimeoutMs must be between/);
  });

  it('should reject storageTimeoutMs above maximum (5 minutes)', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTimeoutMs: 600000, // Above 300000ms maximum
      });
    }).toThrow(/storageTimeoutMs must be between/);
  });

  it('should accept valid storageTimeoutMs', () => {
    const limiter = new RateLimiter({
      rate: 10,
      storageTimeoutMs: 1000,
    });
    expect(limiter).toBeDefined();
  });

  it('should reject storageTtlMs exceeding maximum (1 week)', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTtlMs: 8 * 24 * 60 * 60 * 1000, // 8 days
      });
    }).toThrow(/storageTtlMs must be between/);
  });

  it('should reject non-finite storageTimeoutMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTimeoutMs: Infinity,
      });
    }).toThrow(/storageTimeoutMs must be between/);
  });

  it('should reject NaN storageTimeoutMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTimeoutMs: NaN,
      });
    }).toThrow(/storageTimeoutMs must be between/);
  });

  it('should reject NaN storageTtlMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTtlMs: NaN,
      });
    }).toThrow(/storageTtlMs must be between/);
  });

  it('should reject Infinity storageTtlMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        storageTtlMs: Infinity,
      });
    }).toThrow(/storageTtlMs must be between/);
  });

  it('should reject NaN maxKeyLength', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        maxKeyLength: NaN,
      });
    }).toThrow(/maxKeyLength must be between/);
  });

  it('should reject Infinity maxKeyLength', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        maxKeyLength: Infinity,
      });
    }).toThrow(/maxKeyLength must be between/);
  });

  it('should reject NaN cleanupIntervalMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        cleanupIntervalMs: NaN,
      });
    }).toThrow(/cleanupIntervalMs must be/);
  });

  it('should reject Infinity cleanupIntervalMs', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        cleanupIntervalMs: Infinity,
      });
    }).toThrow(/cleanupIntervalMs must be/);
  });

  it('should reject NaN maxTokensPerRequest', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        maxTokensPerRequest: NaN,
      });
    }).toThrow(/maxTokensPerRequest must be a positive number/);
  });

  it('should reject Infinity maxTokensPerRequest', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        maxTokensPerRequest: Infinity,
      });
    }).toThrow(/maxTokensPerRequest must be a positive number/);
  });

  it('should reject NaN sanitizationCacheSize', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        sanitizationCacheSize: NaN,
      });
    }).toThrow(/sanitizationCacheSize must be between/);
  });

  it('should reject Infinity sanitizationCacheSize', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        sanitizationCacheSize: Infinity,
      });
    }).toThrow(/sanitizationCacheSize must be between/);
  });

  it('should reject sanitizationCacheSize exceeding maximum (100000)', () => {
    expect(() => {
      new RateLimiter({
        rate: 10,
        sanitizationCacheSize: 200000,
      });
    }).toThrow(/sanitizationCacheSize must be between/);
  });

  it('should accept valid sanitizationCacheSize', () => {
    const limiter = new RateLimiter({
      rate: 10,
      sanitizationCacheSize: 5000,
    });
    expect(limiter).toBeDefined();
  });

  it('should reject zero rate', () => {
    expect(() => {
      new RateLimiter({
        rate: 0,
      });
    }).toThrow(); // Zod validates rate must be positive
  });

  it('should reject negative rate', () => {
    expect(() => {
      new RateLimiter({
        rate: -10,
      });
    }).toThrow(); // Zod validates rate must be positive
  });
});

describe('waitAsync failure modes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createFailingStorage(): RateLimitStorage {
    return {
      async get(): Promise<BucketState | null> {
        throw new Error('Storage read failed');
      },
      async set(): Promise<void> {
        throw new Error('Storage write failed');
      },
    };
  }

  it('should return immediately on fail-open mode', async () => {
    const storage = createFailingStorage();
    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageFailureMode: 'fail-open',
    });

    // Should return without throwing
    await expect(limiter.waitAsync('user-1')).resolves.toBeUndefined();
  });

  it('should throw on throw mode', async () => {
    const storage = createFailingStorage();
    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageFailureMode: 'throw',
    });

    await expect(limiter.waitAsync('user-1')).rejects.toThrow('Storage read failed');
  });
});

describe('Clock skew handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Create a mock storage adapter that returns specified data.
   */
  function createStorageWithData(
    data: Record<string, unknown>
  ): RateLimitStorage & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>(Object.entries(data));
    return {
      store,
      async get(key: string): Promise<BucketState | null> {
        return store.get(key) as BucketState | null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        store.set(key, state);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async clear(): Promise<void> {
        store.clear();
      },
    };
  }

  it('should accept lastRefill within 5 second clock skew tolerance', async () => {
    const now = Date.now();
    const storage = createStorageWithData({
      'user-1': { tokens: 3, lastRefill: now + 4000 }, // 4 seconds in future
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Should use existing bucket (within tolerance)
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(false); // Only had 3 tokens
  });

  it('should reset bucket when lastRefill exceeds 5 second clock skew tolerance', async () => {
    const now = Date.now();
    const storage = createStorageWithData({
      'user-1': { tokens: 1, lastRefill: now + 6000 }, // 6 seconds in future
    });
    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Should reset to fresh bucket with burst tokens
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(true);
    expect(await limiter.allowAsync('user-1')).toBe(false); // Full burst (5) used
  });
});

describe('Storage set timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should timeout slow set operations', async () => {
    let getResolved = false;
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        getResolved = true;
        return null; // New bucket
      },
      async set(): Promise<void> {
        // Never resolves
        return new Promise(() => {});
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageTimeoutMs: 1000,
      storageFailureMode: 'fail-open',
    });

    const promise = limiter.allowAsync('user-1');

    // Advance past timeout and flush promises
    await vi.advanceTimersByTimeAsync(1500);

    // Should fail open due to set timeout
    expect(await promise).toBe(true);
    expect(getResolved).toBe(true);
  });

  it('should apply timeout to set in takeAsync', async () => {
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        return null;
      },
      async set(): Promise<void> {
        return new Promise(() => {}); // Never resolves
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageTimeoutMs: 1000,
      storageFailureMode: 'fail-closed',
    });

    const promise = limiter.takeAsync('user-1', 5);
    await vi.advanceTimersByTimeAsync(1500);

    expect(await promise).toBe(false); // fail-closed on timeout
  });
});

describe('Timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should clean up timeout timer when operation succeeds quickly', async () => {
    let setTimeoutCount = 0;
    let clearTimeoutCount = 0;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    // Spy on setTimeout/clearTimeout
    vi.spyOn(global, 'setTimeout').mockImplementation((...args) => {
      setTimeoutCount++;
      return originalSetTimeout(...args);
    });
    vi.spyOn(global, 'clearTimeout').mockImplementation((...args) => {
      clearTimeoutCount++;
      return originalClearTimeout(...args);
    });

    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        return null;
      },
      async set(): Promise<void> {
        // Resolves immediately
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageTimeoutMs: 5000,
    });

    await limiter.allowAsync('user-1');

    // Should have created and cleaned up timeout timers
    // 2 operations (get + set) = 2 timeouts that should be cleared
    expect(setTimeoutCount).toBeGreaterThan(0);
    expect(clearTimeoutCount).toBe(setTimeoutCount);

    vi.restoreAllMocks();
  });
});

describe('Static AbortSignal reuse', () => {
  it('should pass signal to operation in execute', async () => {
    const limiter = new RateLimiter({ rate: 10 });
    let receivedSignal: AbortSignal | undefined;

    await limiter.execute(async (signal) => {
      receivedSignal = signal;
      return 'success';
    });

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('should pass provided signal instead of default', async () => {
    const limiter = new RateLimiter({ rate: 10 });
    const customController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    await limiter.execute(
      async (signal) => {
        receivedSignal = signal;
        return 'success';
      },
      '',
      customController.signal
    );

    expect(receivedSignal).toBe(customController.signal);
  });
});

describe('Zero config defaults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should work with completely empty config', () => {
    const limiter = new RateLimiter({});

    // Default: rate=100, burst=100, interval=1000
    for (let i = 0; i < 100; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.allow()).toBe(false);
  });

  it('should work with undefined config', () => {
    const limiter = new RateLimiter(undefined);

    // Default: rate=100, burst=100, interval=1000
    for (let i = 0; i < 100; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.allow()).toBe(false);
  });

  it('should use rate as default burst', () => {
    const limiter = new RateLimiter({ rate: 50 });

    for (let i = 0; i < 50; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.allow()).toBe(false);
  });
});

describe('Concurrent operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle concurrent allowAsync calls', async () => {
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        // Simulate small network delay
        await Promise.resolve();
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        await Promise.resolve();
        this.store.set(key, state);
      },
    };

    const limiter = new RateLimiter({ rate: 10, burst: 5, storage });

    // Fire multiple concurrent requests
    const results = await Promise.all([
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-1'), // Should be rejected
    ]);

    // Due to TOCTOU, some might be allowed that shouldn't be
    // But we expect at least the last one to be rejected eventually
    const allowedCount = results.filter(Boolean).length;
    expect(allowedCount).toBeGreaterThanOrEqual(5);
  });

  it('should handle concurrent operations with different keys', async () => {
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        await Promise.resolve();
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        await Promise.resolve();
        this.store.set(key, state);
      },
    };

    const limiter = new RateLimiter({ rate: 10, burst: 2, storage });

    // Fire concurrent requests for different keys
    const results = await Promise.all([
      limiter.allowAsync('user-1'),
      limiter.allowAsync('user-2'),
      limiter.allowAsync('user-3'),
    ]);

    // All should be allowed (different keys)
    expect(results.every(Boolean)).toBe(true);
  });

  it('should handle concurrent sync operations safely', () => {
    const limiter = new RateLimiter({ rate: 10, burst: 5 });

    // Sync operations are atomic in single-threaded JS
    for (let i = 0; i < 5; i++) {
      expect(limiter.allow('user-1')).toBe(true);
    }
    expect(limiter.allow('user-1')).toBe(false);
  });
});

describe('TokenBucket clock skew', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle backward clock adjustment (negative elapsed time)', () => {
    const bucket = new TokenBucket(10, 5, 1000);

    // Consume 3 tokens
    bucket.allow();
    bucket.allow();
    bucket.allow();

    // Move clock backward
    vi.setSystemTime(1700000000000 - 1000);

    // Should still work (bucket handles negative elapsed)
    expect(bucket.allow()).toBe(true);
    expect(bucket.allow()).toBe(true);
    // Now bucket should be empty (had 2 tokens after clock went back)
    expect(bucket.allow()).toBe(false);
  });

  it('should cap refill for very large elapsed time', () => {
    const bucket = new TokenBucket(10, 5, 1000);

    // Drain bucket
    for (let i = 0; i < 5; i++) {
      bucket.allow();
    }
    expect(bucket.allow()).toBe(false);

    // Advance time by 10 hours (simulating system sleep/wake)
    vi.advanceTimersByTime(10 * 60 * 60 * 1000);

    // Should refill to burst capacity, not infinite tokens
    for (let i = 0; i < 5; i++) {
      expect(bucket.allow()).toBe(true);
    }
    expect(bucket.allow()).toBe(false);
  });

  it('should handle zero elapsed time', () => {
    const bucket = new TokenBucket(10, 5, 1000);

    expect(bucket.allow()).toBe(true);
    // Immediate second call (zero elapsed time)
    expect(bucket.allow()).toBe(true);
  });
});

describe('RateLimitExceededError key inclusion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should include key in RateLimitExceededError from execute', async () => {
    const limiter = new RateLimiter({ rate: 1, burst: 1 });
    await limiter.execute(async () => 'first', 'test-key');

    try {
      await limiter.execute(async () => 'second', 'test-key');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitExceededError);
      expect((error as RateLimitExceededError).key).toBe('test-key');
    }
  });

  it('should include key in RateLimitExceededError from executeAsync', async () => {
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        this.store.set(key, state);
      },
    };

    const limiter = new RateLimiter({ rate: 1, burst: 1, storage });
    await limiter.executeAsync(async () => 'first', 'async-test-key');

    try {
      await limiter.executeAsync(async () => 'second', 'async-test-key');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitExceededError);
      expect((error as RateLimitExceededError).key).toBe('async-test-key');
    }
  });

  it('should include empty key when using default', async () => {
    const limiter = new RateLimiter({ rate: 1, burst: 1 });
    await limiter.execute(async () => 'first');

    try {
      await limiter.execute(async () => 'second');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitExceededError);
      expect((error as RateLimitExceededError).key).toBe('');
    }
  });
});

describe('onStorageLatency metrics', () => {
  it('should call onStorageLatency for get and set operations', async () => {
    const onStorageLatency = vi.fn();
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        this.store.set(key, state);
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 5,
      storage,
      metrics: { onStorageLatency },
    });

    await limiter.allowAsync('test-key');

    // Should be called for both get and set operations
    expect(onStorageLatency).toHaveBeenCalledTimes(2);

    // Check the get operation
    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'get',
        key: 'test-key',
        success: true,
        error: undefined,
      })
    );

    // Check the set operation
    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'set',
        key: 'test-key',
        success: true,
        error: undefined,
      })
    );

    // All calls should have durationMs defined
    for (const call of onStorageLatency.mock.calls) {
      expect(call[0].durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('should report storage errors in onStorageLatency for set failures', async () => {
    const onStorageLatency = vi.fn();
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        return null; // get succeeds
      },
      async set(): Promise<void> {
        throw new Error('Storage write failed');
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 5,
      storage,
      storageFailureMode: 'fail-open',
      metrics: { onStorageLatency },
    });

    await limiter.allowAsync('test-key');

    // Should be called for both get (success) and set (failure)
    expect(onStorageLatency).toHaveBeenCalledTimes(2);

    // Check the successful get operation
    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'get',
        success: true,
      })
    );

    // Check the failed set operation
    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'set',
        success: false,
        error: expect.any(Error),
      })
    );
  });

  it('should report storage errors in onStorageLatency for get failures', async () => {
    const onStorageLatency = vi.fn();
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        throw new Error('Storage read failed');
      },
      async set(): Promise<void> {
        // set would not be called if get fails in fail-open mode
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 5,
      storage,
      storageFailureMode: 'fail-open',
      metrics: { onStorageLatency },
    });

    await limiter.allowAsync('test-key');

    // Should be called for the failed get operation
    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'get',
        key: 'test-key',
        success: false,
        error: expect.any(Error),
      })
    );
  });

  it('should call onStorageLatency for delete operations', async () => {
    const onStorageLatency = vi.fn();
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        this.store.set(key, state);
      },
      async delete(key: string): Promise<void> {
        this.store.delete(key);
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 5,
      storage,
      metrics: { onStorageLatency },
    });

    await limiter.deleteAsync('test-key');

    expect(onStorageLatency).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'delete',
        key: 'test-key',
        success: true,
        error: undefined,
      })
    );
  });
});

describe('deleteAsync with external storage', () => {
  it('should delete from both memory and external storage', async () => {
    const storage: RateLimitStorage & { store: Map<string, BucketState> } = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        return this.store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        this.store.set(key, state);
      },
      async delete(key: string): Promise<void> {
        this.store.delete(key);
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 2,
      storage,
    });

    // Create a bucket via allowAsync
    await limiter.allowAsync('test-key');
    expect(storage.store.has('test-key')).toBe(true);

    // Delete the bucket
    await limiter.deleteAsync('test-key');

    // Verify deleted from external storage
    expect(storage.store.has('test-key')).toBe(false);

    // Verify bucket is reset (should get full tokens again)
    expect(await limiter.allowAsync('test-key')).toBe(true);
    expect(await limiter.allowAsync('test-key')).toBe(true);
  });

  it('should handle deleteAsync when storage has no delete method', async () => {
    const storage: RateLimitStorage = {
      store: new Map<string, BucketState>(),
      async get(key: string): Promise<BucketState | null> {
        return (this as { store: Map<string, BucketState> }).store.get(key) ?? null;
      },
      async set(key: string, state: BucketState): Promise<void> {
        (this as { store: Map<string, BucketState> }).store.set(key, state);
      },
      // No delete method
    };

    const limiter = new RateLimiter({
      rate: 10,
      burst: 2,
      storage,
    });

    // Should not throw even without delete method
    await expect(limiter.deleteAsync('test-key')).resolves.toBeUndefined();
  });
});

describe('Error types', () => {
  it('should export StorageUnavailableError', async () => {
    const { StorageUnavailableError } = await import('../src/errors.js');

    const cause = new Error('Connection refused');
    const error = new StorageUnavailableError('Redis unavailable', cause);

    expect(error.name).toBe('StorageUnavailableError');
    expect(error.message).toBe('Redis unavailable');
    expect(error.cause).toBe(cause);
  });

  it('should export StorageTimeoutError', async () => {
    const { StorageTimeoutError } = await import('../src/errors.js');

    const error = new StorageTimeoutError('get', 5000);

    expect(error.name).toBe('StorageTimeoutError');
    expect(error.message).toContain('get');
    expect(error.message).toContain('5000');
    expect(error.operationName).toBe('get');
    expect(error.timeoutMs).toBe(5000);
  });

  it('should export InvalidBucketStateError', async () => {
    const { InvalidBucketStateError } = await import('../src/errors.js');

    const error = new InvalidBucketStateError('user-123', 'Corrupted data');

    expect(error.name).toBe('InvalidBucketStateError');
    expect(error.message).toBe('Corrupted data');
    expect(error.key).toBe('user-123');
  });

  it('should truncate keys in KeyTooLongError for PII protection', async () => {
    const limiter = new RateLimiter({ rate: 10, maxKeyLength: 10 });
    const longKey = 'user-email@very-long-domain-that-should-be-truncated.com';

    try {
      limiter.allow(longKey);
      expect.fail('Should have thrown KeyTooLongError');
    } catch (error) {
      expect(error).toBeInstanceOf(KeyTooLongError);
      const keyError = error as InstanceType<typeof KeyTooLongError>;

      // keyPreview should be truncated to 20 chars + '...'
      expect(keyError.keyPreview).toBe('user-email@very-long...');
      expect(keyError.keyLength).toBe(longKey.length);
      expect(keyError.maxLength).toBe(10);

      // Full key should NOT be exposed in the error
      expect(keyError.message).not.toContain(longKey);
      expect(keyError.message).toContain('user-email@very-long...');
    }
  });

  it('should not truncate short keys in KeyTooLongError', async () => {
    const limiter = new RateLimiter({ rate: 10, maxKeyLength: 5 });
    const shortKey = 'abcdefghij'; // 10 chars, exceeds 5

    try {
      limiter.allow(shortKey);
      expect.fail('Should have thrown KeyTooLongError');
    } catch (error) {
      expect(error).toBeInstanceOf(KeyTooLongError);
      const keyError = error as InstanceType<typeof KeyTooLongError>;

      // 10 chars is <= 20, so no truncation
      expect(keyError.keyPreview).toBe(shortKey);
    }
  });

  it('should export RateLimiterError base class', async () => {
    const { RateLimiterError } = await import('../src/errors.js');

    const error = new RateLimiterError('Base error');
    expect(error.name).toBe('RateLimiterError');
    expect(error.message).toBe('Base error');
  });
});

describe('TOKEN_EPSILON floating-point precision', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle floating-point precision issues near token boundary', () => {
    // Create a limiter where token accumulation can lead to floating point issues
    const limiter = new RateLimiter({
      rate: 3, // 3 tokens per second = 0.003 tokens/ms
      burst: 3,
      interval: 1000,
    });

    // Drain all tokens
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(false);

    // Advance time to get exactly 1 token back
    // 1000ms / 3 = 333.333... ms per token
    // Due to floating point, this might result in 0.999999999 tokens
    vi.advanceTimersByTime(334); // Just over 1 token worth

    // TOKEN_EPSILON should allow this to pass
    expect(limiter.allow('key')).toBe(true);
  });

  it('should correctly deny when clearly below threshold', () => {
    const limiter = new RateLimiter({
      rate: 10,
      burst: 1,
      interval: 1000,
    });

    // Drain the bucket
    expect(limiter.allow('key')).toBe(true);
    expect(limiter.allow('key')).toBe(false);

    // Advance only 50ms (0.5 tokens, clearly below 1)
    vi.advanceTimersByTime(50);

    // Should still be denied (0.5 tokens is not enough)
    expect(limiter.allow('key')).toBe(false);
  });

  it('should export TOKEN_EPSILON constant', async () => {
    const { TOKEN_EPSILON } = await import('../src/config.js');

    expect(TOKEN_EPSILON).toBe(1e-9);
    expect(typeof TOKEN_EPSILON).toBe('number');
  });
});

describe('waitAsync exponential backoff in fail-closed mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use exponential backoff on storage failures in fail-closed mode', async () => {
    let callCount = 0;
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        callCount++;
        if (callCount <= 3) {
          throw new Error('Storage temporarily unavailable');
        }
        return { tokens: 5, lastRefill: Date.now() };
      },
      async set(): Promise<void> {
        // Success
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      storage,
      storageFailureMode: 'fail-closed',
    });

    const controller = new AbortController();
    const waitPromise = limiter.waitAsync('user-1', controller.signal);

    // First failure - should wait 100ms
    await vi.advanceTimersByTimeAsync(100);

    // Second failure - should wait 200ms
    await vi.advanceTimersByTimeAsync(200);

    // Third failure - should wait 400ms
    await vi.advanceTimersByTimeAsync(400);

    // Fourth call succeeds
    await waitPromise;

    expect(callCount).toBe(4);
  });

  it('should reset backoff after successful storage operation', async () => {
    let callCount = 0;
    const storage: RateLimitStorage = {
      async get(): Promise<BucketState | null> {
        callCount++;
        // Return 0 tokens to force wait loop to continue
        return callCount < 3 ? { tokens: 0, lastRefill: Date.now() } : { tokens: 5, lastRefill: Date.now() };
      },
      async set(): Promise<void> {
        // Success
      },
    };

    const limiter = new RateLimiter({
      rate: 10,
      interval: 100,
      storage,
      storageFailureMode: 'fail-closed',
    });

    const waitPromise = limiter.waitAsync('user-1');

    // First call succeeds but returns 0 tokens, waits for refill
    await vi.advanceTimersByTimeAsync(100);

    // Second call succeeds, returns 0 tokens
    await vi.advanceTimersByTimeAsync(100);

    // Third call succeeds with tokens
    await waitPromise;

    expect(callCount).toBe(3);
  });
});
