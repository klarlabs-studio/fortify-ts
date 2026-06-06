# @klarlabs-studio/fortify-circuit-breaker

Circuit breaker pattern implementation for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-circuit-breaker
# or
pnpm add @klarlabs-studio/fortify-circuit-breaker
```

## Features

- **State Machine**: CLOSED, OPEN, and HALF-OPEN states
- **Configurable Thresholds**: Max failures, timeout, half-open requests
- **Custom Predicates**: `readyToTrip` and `isSuccessful` callbacks
- **State Change Notifications**: `onStateChange` callback
- **Automatic Recovery**: Transitions from OPEN to HALF-OPEN after timeout

## Usage

### Basic Usage

```typescript
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';

const breaker = new CircuitBreaker<Response>({
  maxFailures: 5,
  timeout: 60000, // 60 seconds
});

try {
  const result = await breaker.execute(async (signal) => {
    return fetch('/api/data', { signal });
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log('Circuit is open, try again later');
  }
}
```

### Configuration Options

```typescript
const breaker = new CircuitBreaker<Response>({
  // Maximum failures before opening circuit
  maxFailures: 5,

  // Time in ms before attempting recovery
  timeout: 60000,

  // Requests allowed in half-open state
  halfOpenMaxRequests: 1,

  // Reset counts interval (0 = disabled)
  interval: 0,

  // Custom trip condition
  readyToTrip: (counts) => counts.consecutiveFailures >= 3,

  // Custom success condition
  isSuccessful: (result) => result.ok,

  // State change notification
  onStateChange: (from, to) => {
    console.log(`Circuit state: ${from} -> ${to}`);
  },

  // Optional logger
  logger: myLogger,
});
```

### State Machine

```
     ┌─────────────────────────────────────────────────┐
     │                                                 │
     ▼                                                 │
  CLOSED ──── failures >= maxFailures ────► OPEN ────►│
     ▲                                        │        │
     │                                        │ timeout
     │                                        ▼        │
     └────── success ◄──────────────────── HALF-OPEN ─┘
                                               │
                                               │ failure
                                               ▼
                                             OPEN
```

### Checking State

```typescript
// Get current state
const state = breaker.getState(); // 'closed' | 'open' | 'half-open'

// Get request counts
const counts = breaker.getCounts();
console.log(counts.requests, counts.totalSuccesses, counts.totalFailures);

// Reset circuit breaker
breaker.reset();

// Clean up resources
await breaker.close();
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxFailures` | number | 5 | Failures before opening |
| `timeout` | number | 60000 | Recovery timeout (ms) |
| `halfOpenMaxRequests` | number | 1 | Requests in half-open |
| `interval` | number | 0 | Count reset interval |
| `readyToTrip` | function | - | Custom trip condition |
| `isSuccessful` | function | - | Custom success check |
| `onStateChange` | function | - | State change callback |
| `logger` | FortifyLogger | - | Optional logger |

## License

MIT
