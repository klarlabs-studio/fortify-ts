import { FortifyError } from '@klarlabs-studio/fortify-core';

/**
 * Error thrown when a cost budget's ceiling is reached.
 *
 * This is the TypeScript parity of Go fortify's `ErrBudgetExceeded`
 * sentinel: match it with `instanceof BudgetExceededError`. It extends
 * {@link FortifyError} so it also matches `instanceof FortifyError`.
 */
export class BudgetExceededError extends FortifyError {
  /** Accumulated cost (in the configured currency unit) at the breach. */
  public readonly consumedCost: number;
  /** The configured ceiling that was exceeded. */
  public readonly maxCost: number;

  constructor(consumedCost: number, maxCost: number, message?: string) {
    super(
      message ??
        `Cost budget exceeded (consumed=${String(consumedCost)} max=${String(maxCost)})`
    );
    this.name = 'BudgetExceededError';
    this.consumedCost = consumedCost;
    this.maxCost = maxCost;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      consumedCost: this.consumedCost,
      maxCost: this.maxCost,
    };
  }
}
