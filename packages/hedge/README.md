# @klarlabs-studio/fortify-hedge

Hedged-request (tail-latency reduction) pattern for the Fortify-TS resilience library.

Mirrors the Go `fortify/hedge` package.

## Installation

```bash
npm install @klarlabs-studio/fortify-hedge
# or
pnpm add @klarlabs-studio/fortify-hedge
```

## How it works

The primary attempt fires immediately. If it has not returned within
`hedgeDelay`, a second attempt is fired in parallel — and optionally a third,
fourth, ... — up to `maxAttempts`. The first successful result wins and the
remaining in-flight attempts are cancelled via their `AbortSignal`. If every
attempt fails, the first error is returned.

> **Idempotency required.** Multiple attempts may run to completion before
> cancellation propagates, so each attempt's side effects must be safe to
> repeat. Use hedging only on idempotent operations.

## Usage

```typescript
import { Hedge } from '@klarlabs-studio/fortify-hedge';

const hedge = new Hedge<Response>({
  maxAttempts: 3, // total parallel attempts including the primary (1 disables hedging, max 16)
  hedgeDelay: 50, // ms to wait before firing each subsequent attempt
  onHedge: (attempt) => console.log(`hedge attempt ${attempt} fired`),
});

const result = await hedge.execute(async (signal) => {
  return fetch('/api/data', { signal });
});
```

## Configuration

| Option        | Type                          | Default | Description                                                        |
| ------------- | ----------------------------- | ------- | ------------------------------------------------------------------ |
| `maxAttempts` | `number`                      | `2`     | Total parallel attempts including the primary. `1` disables. Max 16. |
| `hedgeDelay`  | `number`                      | `100`   | Milliseconds to wait before firing the next hedge attempt.         |
| `onHedge`     | `(attempt: number) => void`   | —       | Called when a hedge attempt fires, with its 1-based index.         |
| `logger`      | `FortifyLogger`               | —       | Structured logger for hedge events.                                |

## Composition

Use with the middleware chain via `chain.withHedge(hedge)`. Place hedge
innermost (closest to the operation) so it multiplies only the operation
itself, not the surrounding patterns.

## License

MIT
