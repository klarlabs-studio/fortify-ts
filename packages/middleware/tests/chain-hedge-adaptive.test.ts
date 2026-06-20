import { describe, it, expect } from 'vitest';
import { Chain } from '../src/chain.js';
import { Hedge } from '@klarlabs-studio/fortify-hedge';
import { AdaptiveLimiter, AdaptiveLimitExceededError } from '@klarlabs-studio/fortify-adaptive';

describe('Chain.withHedge', () => {
  it('executes the operation through the hedge and returns its result', async () => {
    const hedge = new Hedge<string>({ maxAttempts: 2, hedgeDelay: 50 });
    const chain = new Chain<string>().withHedge(hedge);

    const result = await chain.execute(async () => 'hedged-ok');
    expect(result).toBe('hedged-ok');
    expect(chain.length).toBe(1);
  });
});

describe('Chain.withAdaptive', () => {
  it('executes the operation through the adaptive limiter', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 5 });
    const chain = new Chain<string>().withAdaptive(limiter);

    const result = await chain.execute(async () => 'adaptive-ok');
    expect(result).toBe('adaptive-ok');
    expect(chain.length).toBe(1);
  });

  it('propagates AdaptiveLimitExceededError when at capacity', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 1, minLimit: 1 });
    const chain = new Chain<string>().withAdaptive(limiter);

    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const inflight = chain.execute(async () => {
      await gate;
      return 'held';
    });

    await expect(chain.execute(async () => 'second')).rejects.toBeInstanceOf(
      AdaptiveLimitExceededError
    );

    release();
    await inflight;
  });

  it('composes adaptive (outer) with hedge (inner)', async () => {
    const limiter = new AdaptiveLimiter<string>({ initialLimit: 5 });
    const hedge = new Hedge<string>({ maxAttempts: 2, hedgeDelay: 50 });
    const chain = new Chain<string>().withAdaptive(limiter).withHedge(hedge);

    const result = await chain.execute(async () => 'composed');
    expect(result).toBe('composed');
    expect(chain.length).toBe(2);
  });
});
