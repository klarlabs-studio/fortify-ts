import { describe, it, expect } from 'vitest';
import {
  AdaptiveLimiter,
  AdaptiveLimitExceededError,
  parseAdaptiveConfig,
} from '../src/index.js';

const ok = async (): Promise<string> => 'ok';
const boom = async (): Promise<string> => {
  throw new Error('boom');
};

describe('parseAdaptiveConfig', () => {
  it('applies defaults', () => {
    const cfg = parseAdaptiveConfig();
    expect(cfg.algorithm).toBe('aimd');
    expect(cfg.initialLimit).toBe(10);
    expect(cfg.minLimit).toBe(1);
    expect(cfg.maxLimit).toBe(200);
    expect(cfg.successThreshold).toBe(10);
  });

  it('clamps initialLimit into [minLimit, maxLimit]', () => {
    expect(parseAdaptiveConfig({ initialLimit: 100, maxLimit: 50 }).initialLimit).toBe(50);
    expect(parseAdaptiveConfig({ initialLimit: 1, minLimit: 5 }).initialLimit).toBe(5);
  });

  it('forces maxLimit >= minLimit', () => {
    expect(parseAdaptiveConfig({ minLimit: 10, maxLimit: 5 }).maxLimit).toBe(10);
  });

  it('forces vegasBeta > vegasAlpha', () => {
    expect(parseAdaptiveConfig({ vegasAlpha: 5, vegasBeta: 3 }).vegasBeta).toBe(10);
  });
});

describe('AdaptiveLimiter (AIMD)', () => {
  it('starts at initialLimit and reports inFlight', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 5 });
    expect(limiter.limit()).toBe(5);
    expect(limiter.inFlight()).toBe(0);
    await limiter.execute(ok);
    expect(limiter.inFlight()).toBe(0);
  });

  it('throws AdaptiveLimitExceededError when at capacity', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 1, minLimit: 1 });
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });

    const inflight = limiter.execute(async () => {
      await gate;
      return 'held';
    });

    expect(limiter.inFlight()).toBe(1);
    await expect(limiter.execute(ok)).rejects.toBeInstanceOf(AdaptiveLimitExceededError);

    release();
    await inflight;
  });

  it('increases the limit by one after successThreshold successes', async () => {
    const limiter = new AdaptiveLimiter<string>({
      initialLimit: 5,
      maxLimit: 10,
      successThreshold: 3,
    });
    expect(limiter.limit()).toBe(5);
    await limiter.execute(ok);
    await limiter.execute(ok);
    expect(limiter.limit()).toBe(5); // not yet
    await limiter.execute(ok); // 3rd consecutive -> +1
    expect(limiter.limit()).toBe(6);
  });

  it('does not exceed maxLimit', async () => {
    const limiter = new AdaptiveLimiter<string>({
      initialLimit: 2,
      maxLimit: 2,
      successThreshold: 1,
    });
    await limiter.execute(ok);
    await limiter.execute(ok);
    expect(limiter.limit()).toBe(2);
  });

  it('halves the limit on failure, bounded by minLimit', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 8, minLimit: 2 });
    await expect(limiter.execute(boom)).rejects.toThrow('boom');
    expect(limiter.limit()).toBe(4);
    await expect(limiter.execute(boom)).rejects.toThrow('boom');
    expect(limiter.limit()).toBe(2);
    await expect(limiter.execute(boom)).rejects.toThrow('boom');
    expect(limiter.limit()).toBe(2); // floor
  });

  it('resets the success streak on failure', async () => {
    const limiter = new AdaptiveLimiter<string>({
      initialLimit: 5,
      maxLimit: 10,
      minLimit: 1,
      successThreshold: 3,
    });
    await limiter.execute(ok);
    await limiter.execute(ok);
    await expect(limiter.execute(boom)).rejects.toThrow(); // resets streak, halves
    const afterFailure = limiter.limit();
    await limiter.execute(ok);
    await limiter.execute(ok);
    expect(limiter.limit()).toBe(afterFailure); // streak restarted, not yet at threshold
  });

  it('fires onLimitChange with old and new values', async () => {
    const changes: Array<[number, number]> = [];
    const limiter = new AdaptiveLimiter<string>({
      initialLimit: 4,
      minLimit: 1,
      onLimitChange: (oldLimit, newLimit) => changes.push([oldLimit, newLimit]),
    });
    await expect(limiter.execute(boom)).rejects.toThrow();
    expect(changes).toEqual([[4, 2]]);
  });

  it('rejects when the signal is already aborted', async () => {
    const limiter = new AdaptiveLimiter<string>();
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    await expect(limiter.execute(ok, controller.signal)).rejects.toThrow('gone');
  });
});

describe('AdaptiveLimiter (Vegas)', () => {
  it('raises the limit when the queue estimate is shallow (low latency)', async () => {
    let t = 0;
    const limiter = new AdaptiveLimiter<string>({
      algorithm: 'vegas',
      initialLimit: 10,
      maxLimit: 50,
      vegasMinSamples: 1,
      clock: () => t,
    });
    // Constant low RTT => emaRtt ~ minRtt => queue ~ 0 < alpha => limit grows.
    for (let i = 0; i < 5; i++) {
      const before = t;
      await limiter.execute(async () => {
        t = before + 1; // 1ms RTT
        return 'ok';
      });
    }
    expect(limiter.limit()).toBeGreaterThan(10);
  });

  it('lowers the limit when latency inflates (deep queue)', async () => {
    let t = 0;
    const limiter = new AdaptiveLimiter<string>({
      algorithm: 'vegas',
      initialLimit: 20,
      minLimit: 1,
      vegasMinSamples: 1,
      vegasAlpha: 3,
      vegasBeta: 6,
      clock: () => t,
    });
    // One fast sample establishes a low baseline.
    let before = t;
    await limiter.execute(async () => {
      t = before + 1;
      return 'ok';
    });
    // Then sustained high latency stretches the EMA above the baseline,
    // pushing the estimated queue past beta so the limit shrinks.
    const start = limiter.limit();
    for (let i = 0; i < 10; i++) {
      before = t;
      await limiter.execute(async () => {
        t = before + 100; // 100ms RTT, 100x baseline
        return 'ok';
      });
    }
    expect(limiter.limit()).toBeLessThan(start);
  });
});

describe('AdaptiveLimiter (Gradient2)', () => {
  it('grows the limit under steady low latency', async () => {
    let t = 0;
    const limiter = new AdaptiveLimiter<string>({
      algorithm: 'gradient2',
      initialLimit: 10,
      maxLimit: 100,
      gradientMinSamples: 1,
      clock: () => t,
    });
    for (let i = 0; i < 5; i++) {
      const before = t;
      await limiter.execute(async () => {
        t = before + 1;
        return 'ok';
      });
    }
    // gradient ~ 1, queue = sqrt(limit) => target = limit + sqrt(limit) > limit.
    expect(limiter.limit()).toBeGreaterThan(10);
  });
});
