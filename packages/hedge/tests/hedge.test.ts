import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hedge, parseHedgeConfig } from '../src/index.js';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('parseHedgeConfig', () => {
  it('applies defaults', () => {
    const cfg = parseHedgeConfig();
    expect(cfg.maxAttempts).toBe(2);
    expect(cfg.hedgeDelay).toBe(100);
  });

  it('caps maxAttempts at 16', () => {
    expect(() => parseHedgeConfig({ maxAttempts: 17 })).toThrow();
  });

  it('clamps zero hedgeDelay to the default', () => {
    const cfg = parseHedgeConfig({ hedgeDelay: 0 });
    expect(cfg.hedgeDelay).toBe(100);
  });
});

describe('Hedge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the primary result when it completes before the hedge delay', async () => {
    const hedge = new Hedge<string>({ maxAttempts: 3, hedgeDelay: 50 });
    let calls = 0;
    const result = await hedge.execute(async () => {
      calls++;
      return 'primary';
    });
    expect(result).toBe('primary');
    expect(calls).toBe(1);
  });

  it('fires a hedge attempt after the delay and takes the first success', async () => {
    vi.useFakeTimers();
    const primary = deferred<string>();
    let calls = 0;

    const hedge = new Hedge<string>({ maxAttempts: 2, hedgeDelay: 100 });
    const promise = hedge.execute(async () => {
      calls++;
      if (calls === 1) {
        // Primary never resolves until after the hedge wins.
        return primary.promise;
      }
      return 'hedge';
    });

    // Advance past the hedge delay so the second attempt fires.
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe('hedge');
    expect(calls).toBe(2);
  });

  it('invokes onHedge with the 1-based attempt index for each fired hedge', async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const blocker = deferred<string>();

    const hedge = new Hedge<string>({
      maxAttempts: 3,
      hedgeDelay: 100,
      onHedge: (attempt) => seen.push(attempt),
    });

    let calls = 0;
    const promise = hedge.execute(async () => {
      calls++;
      if (calls < 3) {
        return blocker.promise; // first two attempts hang
      }
      return 'third';
    });

    await vi.advanceTimersByTimeAsync(100); // fires attempt 2
    await vi.advanceTimersByTimeAsync(100); // fires attempt 3 -> wins

    await expect(promise).resolves.toBe('third');
    expect(seen).toEqual([2, 3]);
  });

  it('returns the first error when all attempts fail', async () => {
    vi.useFakeTimers();
    const hedge = new Hedge<string>({ maxAttempts: 2, hedgeDelay: 10 });

    let calls = 0;
    const promise = hedge.execute(async () => {
      calls++;
      throw new Error(`fail-${String(calls)}`);
    });
    // Attach a catch synchronously so the rejection is never unhandled while
    // the fake-timer clock advances.
    const settled = promise.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, e })
    );

    await vi.advanceTimersByTimeAsync(10);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect((outcome.e as Error).message).toBe('fail-1');
    }
  });

  it('does not hedge when maxAttempts is 1', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const blocker = deferred<string>();
    const hedge = new Hedge<string>({ maxAttempts: 1, hedgeDelay: 10 });

    const promise = hedge.execute(async () => {
      calls++;
      return calls === 1 ? blocker.promise : 'should-not-happen';
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);

    blocker.resolve('only');
    await expect(promise).resolves.toBe('only');
    expect(calls).toBe(1);
  });

  it('rejects immediately when the parent signal is already aborted', async () => {
    const hedge = new Hedge<string>();
    const controller = new AbortController();
    controller.abort(new Error('already gone'));

    await expect(
      hedge.execute(async () => 'never', controller.signal)
    ).rejects.toThrow('already gone');
  });

  it('aborts in-flight attempts when a winner returns', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const primary = deferred<string>();

    const hedge = new Hedge<string>({ maxAttempts: 2, hedgeDelay: 100 });
    const promise = hedge.execute(async (signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        return primary.promise; // primary hangs
      }
      return 'hedge-wins';
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe('hedge-wins');

    // The primary's signal should now be aborted so the loser can stop work.
    expect(signals[0]?.aborted).toBe(true);
  });
});
