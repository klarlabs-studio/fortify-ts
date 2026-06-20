# @klarlabs-studio/fortify-adaptive

Adaptive concurrency limiter (AIMD, Vegas, Gradient2) for the Fortify-TS resilience library.

Mirrors the Go `fortify/adaptive` package.

## Installation

```bash
npm install @klarlabs-studio/fortify-adaptive
# or
pnpm add @klarlabs-studio/fortify-adaptive
```

## How it works

Unlike a static bulkhead (fixed concurrency cap), the adaptive limiter starts
at `initialLimit` and tunes its in-flight cap at runtime:

- **aimd** (default): additive increase — `+1` to the limit on every
  `successThreshold` consecutive successes (up to `maxLimit`); multiplicative
  decrease — halve on any failure (down to `minLimit`).
- **vegas**: RTT-aware. Tracks the minimum observed latency (no-load baseline)
  and an EMA of recent latencies, estimates the induced queue depth, and grows
  the limit when the queue is shallow (`< vegasAlpha`) / shrinks it when deep
  (`> vegasBeta`). Reacts to rising latency before failures appear.
- **gradient2**: smoothed gradient-of-RTT controller. Reacts more aggressively
  than Vegas under variable load.

## Usage

```typescript
import { AdaptiveLimiter, AdaptiveLimitExceededError } from '@klarlabs-studio/fortify-adaptive';

const limiter = new AdaptiveLimiter<Response>({
  algorithm: 'aimd',
  initialLimit: 10,
  minLimit: 2,
  maxLimit: 100,
  successThreshold: 20,
  onLimitChange: (oldLimit, newLimit) => console.log(`limit ${oldLimit} -> ${newLimit}`),
});

try {
  const result = await limiter.execute(async (signal) => downstream(signal));
} catch (error) {
  if (error instanceof AdaptiveLimitExceededError) {
    // shed load
  }
}
```

## Configuration

| Option               | Type                                  | Default  | Description                                              |
| -------------------- | ------------------------------------- | -------- | ------------------------------------------------------- |
| `algorithm`          | `'aimd' \| 'vegas' \| 'gradient2'`    | `'aimd'` | Tuning strategy.                                        |
| `initialLimit`       | `number`                              | `10`     | Starting cap, clamped into `[minLimit, maxLimit]`.      |
| `minLimit`           | `number`                              | `1`      | Floor for multiplicative decrease.                      |
| `maxLimit`           | `number`                              | `200`    | Ceiling for additive increase.                          |
| `successThreshold`   | `number`                              | `10`     | AIMD: consecutive successes before `+1`.                |
| `vegasAlpha`         | `number`                              | `3`      | Vegas: low-water queue mark (grow below).               |
| `vegasBeta`          | `number`                              | `6`      | Vegas: high-water queue mark (shrink above).            |
| `vegasMinSamples`    | `number`                              | `10`     | Vegas: min RTT samples before adjusting.                |
| `gradientMinSamples` | `number`                              | `10`     | Gradient2: min RTT samples before adjusting.            |
| `gradientSmoothing`  | `number`                              | `0.2`    | Gradient2: EMA smoothing in `(0, 1]`.                   |
| `onLimitChange`      | `(old: number, new: number) => void` | —        | Limit-change callback (metrics).                        |
| `clock`              | `() => number`                        | —        | Monotonic ms clock; defaults to `performance.now()`.    |
| `logger`             | `FortifyLogger`                       | —        | Structured logger.                                      |

## Composition

Use with the middleware chain via `chain.withAdaptive(limiter)`. Place it
outermost (before bulkhead) to shed load before any pattern-specific work
occurs.

## License

MIT
