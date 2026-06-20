# @klarlabs-studio/fortify-cost-budget

Cost budget pattern for the Fortify-TS resilience library.

Caps the cumulative monetary cost of operations whose cost cannot be bounded
by attempt count alone (LLM calls, paid APIs). This is the TypeScript parity
of Go fortify's `WithCostBudget` convenience API.

## Installation

```bash
npm install @klarlabs-studio/fortify-cost-budget
# or
pnpm add @klarlabs-studio/fortify-cost-budget
```

## Features

- **Spend ceiling**: refuse work once accumulated cost exceeds `maxCost`
- **Per-call cost**: a `costFunc(result, error)` you supply reports each call's cost
- **Rolling window**: optional `resetAfter` auto-clears spend after a duration
- **Charged on failure**: cost is charged even when the operation throws
- **Typed error**: throws `BudgetExceededError` (a `FortifyError`)

## Usage

### Basic Usage

```typescript
import { CostBudget, BudgetExceededError } from '@klarlabs-studio/fortify-cost-budget';

const budget = new CostBudget<Response>({
  maxCost: 5.0, // $5 ceiling
  costFunc: (result) => result?.usdCost ?? 0,
});

try {
  const out = await budget.execute(async (signal) => callProvider(signal));
} catch (err) {
  if (err instanceof BudgetExceededError) {
    // ceiling reached; operation refused
  }
}
```

### Rolling Window

```typescript
const budget = new CostBudget<Response>({
  maxCost: 10.0,
  resetAfter: 60 * 60 * 1000, // auto-reset every hour
  costFunc: (result) => result?.usdCost ?? 0,
});
```

### Within a Middleware Chain

Place the budget inside retry so every attempt is charged:

```typescript
import { Chain } from '@klarlabs-studio/fortify-middleware';

const chain = new Chain<Response>()
  .withRetry(retry)
  .withCostBudget(budget);
```

## Configuration Reference

| Option       | Type                                          | Default  | Description                                            |
| ------------ | --------------------------------------------- | -------- | ------------------------------------------------------ |
| `maxCost`    | number                                        | required | Spending ceiling (must be positive)                    |
| `costFunc`   | `(result, error) => number`                   | required | Cost a call consumed; charged on success and failure   |
| `resetAfter` | number (ms)                                   | -        | Rolling-window duration; auto-clears spend when elapsed |
| `onExceeded` | `(consumedCost: number) => void`              | -        | Fires once on first breach                             |
| `clock`      | `() => number`                                | monotonic | Time source for `resetAfter` (override in tests)       |
| `logger`     | FortifyLogger                                 | -        | Optional logger                                        |

## License

MIT
