import { describe, it, expect, vi } from 'vitest';
import { FortifyError, type Pattern } from '@klarlabs-studio/fortify-core';
import { CostBudget, BudgetExceededError } from '../src/index.js';

describe('CostBudget', () => {
  describe('Pattern<T> compliance', () => {
    it('implements Pattern<T>', async () => {
      const budget = new CostBudget<string>({
        maxCost: 10,
        costFunc: () => 1,
      });
      const pattern: Pattern<string> = budget;
      expect(pattern.execute).toBeDefined();

      const result = await pattern.execute(async () => 'ok');
      expect(result).toBe('ok');
    });
  });

  describe('config validation', () => {
    it('throws when maxCost is not positive', () => {
      expect(() => new CostBudget<string>({ maxCost: 0, costFunc: () => 1 })).toThrow();
      expect(() => new CostBudget<string>({ maxCost: -1, costFunc: () => 1 })).toThrow();
    });

    it('throws when maxCost is NaN or non-finite', () => {
      // Money-safety parity with Go: a non-finite ceiling cannot gate and is a
      // misconfiguration, so construction must fail loudly rather than silently
      // disabling the spend cap.
      expect(() => new CostBudget<string>({ maxCost: Number.NaN, costFunc: () => 1 })).toThrow();
      expect(
        () => new CostBudget<string>({ maxCost: Number.POSITIVE_INFINITY, costFunc: () => 1 })
      ).toThrow();
      expect(
        () => new CostBudget<string>({ maxCost: Number.NEGATIVE_INFINITY, costFunc: () => 1 })
      ).toThrow();
    });

    it('throws when maxCost overflows safe-integer money accounting', () => {
      // Mirrors Go's micro-USD overflow rejection: a ceiling beyond the range
      // where float accounting stays reliable is rejected rather than risking a
      // cap that arithmetic can saturate past.
      expect(
        () => new CostBudget<string>({ maxCost: Number.MAX_VALUE, costFunc: () => 1 })
      ).toThrow();
      expect(
        () =>
          new CostBudget<string>({
            maxCost: Number.MAX_SAFE_INTEGER + 1,
            costFunc: () => 1,
          })
      ).toThrow();
    });
  });

  describe('accumulation', () => {
    it('allows calls until the ceiling is reached', async () => {
      const budget = new CostBudget<string>({
        maxCost: 1.0, // $1.00
        costFunc: () => 0.3, // $0.30 per call
      });

      // 0.30 * 3 = 0.90 <= 1.00
      for (let i = 0; i < 3; i++) {
        await expect(budget.execute(async () => 'ok')).resolves.toBe('ok');
      }

      // 4th call pushes to 1.20 > 1.00 -> breach
      await expect(budget.execute(async () => 'ok')).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('reports consumed cost', async () => {
      const budget = new CostBudget<string>({
        maxCost: 100,
        costFunc: () => 2.5,
      });
      await budget.execute(async () => 'a');
      await budget.execute(async () => 'b');
      expect(budget.getConsumedCost()).toBeCloseTo(5.0);
    });
  });

  describe('breach behaviour', () => {
    it('throws BudgetExceededError that is a FortifyError', async () => {
      const budget = new CostBudget<number>({
        maxCost: 0.5,
        costFunc: () => 1.0,
      });
      let caught: unknown;
      try {
        await budget.execute(async () => 1);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BudgetExceededError);
      expect(caught).toBeInstanceOf(FortifyError);
      expect((caught as BudgetExceededError).maxCost).toBe(0.5);
      expect((caught as BudgetExceededError).consumedCost).toBeCloseTo(1.0);
    });

    it('refuses further work and does not run the operation after a breach', async () => {
      const budget = new CostBudget<number>({
        maxCost: 1.0,
        costFunc: () => 1.5,
      });
      await expect(budget.execute(async () => 1)).rejects.toBeInstanceOf(BudgetExceededError);

      const op = vi.fn(async () => 2);
      await expect(budget.execute(op)).rejects.toBeInstanceOf(BudgetExceededError);
      expect(op).not.toHaveBeenCalled();
    });

    it('fires onExceeded once', async () => {
      const onExceeded = vi.fn();
      const budget = new CostBudget<number>({
        maxCost: 1.0,
        costFunc: () => 0.6,
        onExceeded,
      });
      for (let i = 0; i < 5; i++) {
        await budget.execute(async () => 1).catch(() => undefined);
      }
      expect(onExceeded).toHaveBeenCalledTimes(1);
    });
  });

  describe('costFunc', () => {
    it('receives the result and error of the operation', async () => {
      let seenResult: unknown;
      let seenError: unknown;
      const sentinel = new Error('upstream failure');

      const budget = new CostBudget<string>({
        maxCost: 100,
        costFunc: (result, error) => {
          seenResult = result;
          seenError = error;
          return 1;
        },
      });

      await budget.execute(async () => 'payload').catch(() => undefined);
      expect(seenResult).toBe('payload');
      expect(seenError).toBeUndefined();

      await budget
        .execute(async () => {
          throw sentinel;
        })
        .catch(() => undefined);
      expect(seenError).toBe(sentinel);
    });

    it('ignores a non-finite or overflowing cost (charges nothing)', async () => {
      // Money-safety parity with Go: a bad costFunc return (NaN/Infinity or a
      // value beyond safe-integer money range) must not corrupt accounting or
      // instantly breach — it is treated as zero.
      for (const bad of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_VALUE,
        Number.MAX_SAFE_INTEGER + 1,
        -5,
      ]) {
        const budget = new CostBudget<string>({
          maxCost: 1.0,
          costFunc: () => bad,
        });
        for (let i = 0; i < 5; i++) {
          await expect(budget.execute(async () => 'ok')).resolves.toBe('ok');
        }
        expect(budget.getConsumedCost()).toBe(0);
      }
    });

    it('charges even when the operation throws (and re-throws the original error)', async () => {
      const sentinel = new Error('boom');
      const budget = new CostBudget<string>({
        maxCost: 100,
        costFunc: () => 3,
      });
      await expect(
        budget.execute(async () => {
          throw sentinel;
        })
      ).rejects.toBe(sentinel);
      expect(budget.getConsumedCost()).toBeCloseTo(3);
    });
  });

  describe('resetAfter', () => {
    it('auto-resets once the window elapses', async () => {
      let nowMs = 0;
      const budget = new CostBudget<string>({
        maxCost: 1.0,
        costFunc: () => 0.75,
        resetAfter: 60_000, // 1 minute
        clock: () => nowMs,
      });

      // First call: 0.75 <= 1.0
      await expect(budget.execute(async () => 'a')).resolves.toBe('a');
      // Second call within window: 1.5 > 1.0 -> breach
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);

      // Advance past the window
      nowMs += 60_001;
      await expect(budget.execute(async () => 'a')).resolves.toBe('a');
      expect(budget.getConsumedCost()).toBeCloseTo(0.75);
    });

    it('does not reset before the window elapses', async () => {
      let nowMs = 0;
      const budget = new CostBudget<string>({
        maxCost: 2.0,
        costFunc: () => 1.0,
        resetAfter: 60_000,
        clock: () => nowMs,
      });

      await budget.execute(async () => 'a');
      nowMs += 10_000;
      await budget.execute(async () => 'a');
      nowMs += 10_000; // total 20s < 60s
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('keeps the budget capped for its lifetime when resetAfter is unset', async () => {
      let nowMs = 0;
      const budget = new CostBudget<string>({
        maxCost: 1.0,
        costFunc: () => 1.5,
        clock: () => nowMs,
      });
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
      nowMs += 24 * 60 * 60 * 1000; // a day later
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
    });
  });

  describe('reset', () => {
    it('clears accumulated cost and re-arms the budget', async () => {
      const budget = new CostBudget<string>({
        maxCost: 1.0,
        costFunc: () => 1.5,
      });
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
      budget.reset();
      expect(budget.getConsumedCost()).toBe(0);
      await expect(budget.execute(async () => 'a')).rejects.toBeInstanceOf(BudgetExceededError);
    });
  });
});
