import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bulkhead } from '../src/bulkhead.js';
import { Semaphore } from '../src/semaphore.js';
import { BulkheadFullError, BulkheadClosedError } from '@klarlabs-studio/fortify-core';

describe('Semaphore', () => {
  describe('tryAcquire', () => {
    it('should acquire permits up to max', () => {
      const sem = new Semaphore(3);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.tryAcquire()).toBe(false);
    });

    it('should allow reacquire after release', () => {
      const sem = new Semaphore(1);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.tryAcquire()).toBe(false);
      sem.release();
      expect(sem.tryAcquire()).toBe(true);
    });
  });

  describe('acquire', () => {
    it('should acquire immediately when permits available', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      expect(sem.availablePermits()).toBe(0);
    });

    it('should wait when no permits available', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      let acquired = false;
      const acquirePromise = sem.acquire().then(() => {
        acquired = true;
      });

      // Should not be acquired yet
      await Promise.resolve();
      expect(acquired).toBe(false);

      // Release and wait
      sem.release();
      await acquirePromise;
      expect(acquired).toBe(true);
    });

    it('should reject when signal is already aborted', async () => {
      const sem = new Semaphore(0);
      const controller = new AbortController();
      controller.abort();

      await expect(sem.acquire(controller.signal)).rejects.toThrow();
    });

    it('should reject when signal is aborted while waiting', async () => {
      const sem = new Semaphore(0);
      const controller = new AbortController();

      const acquirePromise = sem.acquire(controller.signal);
      controller.abort();

      await expect(acquirePromise).rejects.toThrow();
    });
  });

  describe('release', () => {
    it('should not exceed max permits', () => {
      const sem = new Semaphore(2);
      sem.release();
      sem.release();
      sem.release();
      expect(sem.availablePermits()).toBe(2);
    });
  });

  describe('queueLength', () => {
    it('should track waiters', async () => {
      const sem = new Semaphore(0);
      expect(sem.queueLength()).toBe(0);

      const p1 = sem.acquire();
      expect(sem.queueLength()).toBe(1);

      const p2 = sem.acquire();
      expect(sem.queueLength()).toBe(2);

      sem.release();
      await p1;
      expect(sem.queueLength()).toBe(1);

      sem.release();
      await p2;
      expect(sem.queueLength()).toBe(0);
    });
  });

  describe('rejectAll', () => {
    it('should reject all waiters', async () => {
      const sem = new Semaphore(0);
      const error = new Error('test error');

      const p1 = sem.acquire();
      const p2 = sem.acquire();

      sem.rejectAll(error);

      await expect(p1).rejects.toThrow('test error');
      await expect(p2).rejects.toThrow('test error');
      expect(sem.queueLength()).toBe(0);
    });

    it('should reject waiters with abort signals and clean up listeners', async () => {
      const sem = new Semaphore(0);
      const controller = new AbortController();
      const error = new Error('closed');

      // Acquire with a signal - tests the abort listener cleanup path in rejectAll
      const p1 = sem.acquire(controller.signal);

      sem.rejectAll(error);

      await expect(p1).rejects.toThrow('closed');
      expect(sem.queueLength()).toBe(0);
    });
  });

  describe('release with signal cleanup', () => {
    it('should clean up abort listener when releasing to waiter with signal', async () => {
      const sem = new Semaphore(1);
      const controller = new AbortController();

      // Acquire first permit
      await sem.acquire();
      expect(sem.availablePermits()).toBe(0);

      // Queue a second acquire with a signal
      const acquirePromise = sem.acquire(controller.signal);

      // Release should give permit to queued waiter and clean up its abort listener
      sem.release();
      await acquirePromise;

      // The waiter got the permit, abort listener should be cleaned up
      // Aborting now should have no effect (listener was removed)
      controller.abort();
      expect(sem.availablePermits()).toBe(0);
    });

    it('should handle release when queue is empty and permits at max', () => {
      const sem = new Semaphore(2);
      // Already at max permits, release should be no-op
      sem.release();
      sem.release();
      expect(sem.availablePermits()).toBe(2);
    });
  });

  describe('acquire with non-Error abort reason', () => {
    it('should handle string abort reason in already-aborted signal', async () => {
      const sem = new Semaphore(0);
      const controller = new AbortController();
      controller.abort('string reason');

      await expect(sem.acquire(controller.signal)).rejects.toThrow();
    });

    it('should handle string abort reason while waiting', async () => {
      const sem = new Semaphore(0);
      const controller = new AbortController();

      const acquirePromise = sem.acquire(controller.signal);
      controller.abort('string reason');

      await expect(acquirePromise).rejects.toThrow();
    });
  });
});

describe('Bulkhead', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const bh = new Bulkhead();
      expect(bh.activeCount()).toBe(0);
      expect(bh.queuedCount()).toBe(0);
    });

    it('should accept custom configuration', () => {
      const bh = new Bulkhead({
        maxConcurrent: 5,
        maxQueue: 10,
        queueTimeout: 5000,
      });
      expect(bh.activeCount()).toBe(0);
    });
  });

  describe('execute', () => {
    it('should execute operations within concurrency limit', async () => {
      const bh = new Bulkhead<string>({ maxConcurrent: 2 });

      const results = await Promise.all([
        bh.execute(async () => 'result1'),
        bh.execute(async () => 'result2'),
      ]);

      expect(results).toEqual(['result1', 'result2']);
    });

    it('should limit concurrent executions', async () => {
      vi.useRealTimers(); // Use real timers for concurrency test

      const bh = new Bulkhead<number>({ maxConcurrent: 2, maxQueue: 10 });
      let concurrentCount = 0;
      let maxConcurrentSeen = 0;

      const operation = async (): Promise<number> => {
        concurrentCount++;
        maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
        return maxConcurrentSeen;
      };

      // Start 5 operations
      await Promise.all([
        bh.execute(operation),
        bh.execute(operation),
        bh.execute(operation),
        bh.execute(operation),
        bh.execute(operation),
      ]);

      expect(maxConcurrentSeen).toBe(2);
    });

    it('should reject when bulkhead is full and no queue', async () => {
      const bh = new Bulkhead<void>({ maxConcurrent: 1, maxQueue: 0 });

      // Fill the bulkhead
      const longOperation = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      // This should reject immediately
      await expect(bh.execute(async () => {})).rejects.toThrow(BulkheadFullError);

      // Clean up
      vi.advanceTimersByTime(1000);
      await longOperation;
    });

    it('should queue requests when bulkhead is full', async () => {
      const bh = new Bulkhead<string>({ maxConcurrent: 1, maxQueue: 5 });

      // Start long operation
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'first';
      });

      // Queue second operation
      const second = bh.execute(async () => 'second');

      expect(bh.queuedCount()).toBe(1);

      // Complete first operation
      vi.advanceTimersByTime(100);
      await first;
      await second;

      expect(bh.queuedCount()).toBe(0);
    });

    it('should reject when queue is full', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const bh = new Bulkhead<void>({ maxConcurrent: 1, maxQueue: 1 });

      // Fill bulkhead
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Give time for first to start
      await new Promise(resolve => setTimeout(resolve, 5));

      // Fill queue
      const queued = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Should reject
      await expect(bh.execute(async () => {})).rejects.toThrow(BulkheadFullError);

      // Clean up
      await first;
      await queued;
    });

    it('should throw when signal is already aborted', async () => {
      const bh = new Bulkhead<string>();
      const controller = new AbortController();
      controller.abort();

      await expect(
        bh.execute(async () => 'success', controller.signal)
      ).rejects.toThrow();
    });
  });

  describe('close', () => {
    it('should reject new requests after close', async () => {
      const bh = new Bulkhead<string>();
      bh.close();

      await expect(bh.execute(async () => 'result')).rejects.toThrow(BulkheadClosedError);
    });

    it('should reject pending queue requests on close', async () => {
      const bh = new Bulkhead<void>({ maxConcurrent: 1, maxQueue: 5 });

      // Fill bulkhead
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      // Queue some requests
      const queued = bh.execute(async () => {});

      // Close bulkhead
      bh.close();

      // Queued request should be rejected
      await expect(queued).rejects.toThrow();

      // Complete first operation
      vi.advanceTimersByTime(1000);
      await first.catch(() => {}); // May or may not complete
    });

    it('should be safe to call multiple times', () => {
      const bh = new Bulkhead<string>();
      bh.close();
      bh.close();
      // Should not throw
    });
  });

  describe('reset', () => {
    it('should accept new requests after reset', async () => {
      const bh = new Bulkhead<string>();
      bh.close();

      await expect(bh.execute(async () => 'result')).rejects.toThrow(BulkheadClosedError);

      bh.reset();

      const result = await bh.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('callbacks', () => {
    it('should call onRejected when request is rejected', async () => {
      const onRejected = vi.fn();
      const bh = new Bulkhead<void>({
        maxConcurrent: 1,
        maxQueue: 0,
        onRejected,
      });

      // Fill bulkhead
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      // Try to execute another (should reject)
      await expect(bh.execute(async () => {})).rejects.toThrow(BulkheadFullError);

      expect(onRejected).toHaveBeenCalledTimes(1);

      // Clean up
      vi.advanceTimersByTime(1000);
      await first;
    });

    it('should handle errors in onRejected gracefully', async () => {
      const onRejected = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      const bh = new Bulkhead<void>({
        maxConcurrent: 1,
        maxQueue: 0,
        onRejected,
      });

      // Fill bulkhead
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      // Should not throw even though callback throws
      await expect(bh.execute(async () => {})).rejects.toThrow(BulkheadFullError);

      // Clean up
      vi.advanceTimersByTime(1000);
      await first;
    });
  });

  describe('metrics', () => {
    it('should track active count', async () => {
      const bh = new Bulkhead<void>({ maxConcurrent: 3 });

      expect(bh.activeCount()).toBe(0);

      const p1 = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      const p2 = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Give promises time to start
      await Promise.resolve();
      expect(bh.activeCount()).toBe(2);

      vi.advanceTimersByTime(100);
      await Promise.all([p1, p2]);

      expect(bh.activeCount()).toBe(0);
    });

    it('should track queued count', async () => {
      const bh = new Bulkhead<void>({ maxConcurrent: 1, maxQueue: 5 });

      expect(bh.queuedCount()).toBe(0);

      // Fill bulkhead
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Queue some requests
      const q1 = bh.execute(async () => {});
      const q2 = bh.execute(async () => {});

      expect(bh.queuedCount()).toBe(2);

      // Complete all
      vi.advanceTimersByTime(100);
      await Promise.all([first, q1, q2]);

      expect(bh.queuedCount()).toBe(0);
    });
  });

  describe('queue timeout', () => {
    it('should reject queued request after timeout', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const bh = new Bulkhead<void>({
        maxConcurrent: 1,
        maxQueue: 5,
        queueTimeout: 50, // 50ms timeout
      });

      // Fill bulkhead with long operation
      const first = bh.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Queue request that should timeout
      const queued = bh.execute(async () => {});

      await expect(queued).rejects.toThrow();

      // Clean up - abort the first operation
      await first.catch(() => {});
    });
  });
});
