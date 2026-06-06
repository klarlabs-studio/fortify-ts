# @klarlabs-studio/fortify-timeout

Timeout pattern for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-timeout
# or
pnpm add @klarlabs-studio/fortify-timeout
```

## Features

- **Default and Per-Operation Timeouts**: Configure default with override capability
- **Abort Signal Integration**: Proper cancellation support
- **Timeout Notifications**: `onTimeout` callback

## Usage

### Basic Usage

```typescript
import { Timeout } from '@klarlabs-studio/fortify-timeout';

const timeout = new Timeout<Response>({
  defaultTimeout: 5000, // 5 seconds
});

try {
  const result = await timeout.execute(async (signal) => {
    return fetch('/api/data', { signal });
  });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Request timed out');
  }
}
```

### Per-Operation Timeout

```typescript
// Use default timeout
await timeout.execute(operation);

// Override with specific timeout
await timeout.executeWithTimeout(operation, 10000); // 10 seconds
```

### Configuration Options

```typescript
const timeout = new Timeout<Response>({
  // Default timeout in milliseconds
  defaultTimeout: 5000,

  // Timeout notification
  onTimeout: (duration) => {
    console.log(`Operation timed out after ${duration}ms`);
  },

  // Optional logger
  logger: myLogger,
});
```

### With External Signal

```typescript
const controller = new AbortController();

// Both timeout and external signal can cancel
const result = await timeout.execute(
  async (signal) => fetch('/api/data', { signal }),
  controller.signal
);

// Cancel from external code
controller.abort();
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultTimeout` | number | 30000 | Default timeout (ms) |
| `onTimeout` | function | - | Timeout callback |
| `logger` | FortifyLogger | - | Optional logger |

## License

MIT
