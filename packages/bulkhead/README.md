# @klarlabs-studio/fortify-bulkhead

Bulkhead (concurrency limiter) pattern for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-bulkhead
# or
pnpm add @klarlabs-studio/fortify-bulkhead
```

## Features

- **Concurrency Limiting**: Control maximum parallel executions
- **Request Queueing**: Queue excess requests with optional timeout
- **Rejection Handling**: Reject when at capacity
- **Metrics**: Track active and queued requests

## Usage

### Basic Usage

```typescript
import { Bulkhead } from '@klarlabs-studio/fortify-bulkhead';

const bulkhead = new Bulkhead<Response>({
  maxConcurrent: 10,
});

try {
  const result = await bulkhead.execute(async (signal) => {
    return fetch('/api/data', { signal });
  });
} catch (error) {
  if (error instanceof BulkheadFullError) {
    console.log('Too many concurrent requests');
  }
}
```

### With Queueing

```typescript
const bulkhead = new Bulkhead<Response>({
  maxConcurrent: 10,
  maxQueue: 100,        // Queue up to 100 requests
  queueTimeout: 5000,   // 5 second queue timeout
});
```

### Configuration Options

```typescript
const bulkhead = new Bulkhead<Response>({
  // Maximum concurrent executions
  maxConcurrent: 10,

  // Maximum queued requests (0 = no queue)
  maxQueue: 100,

  // Queue timeout in milliseconds
  queueTimeout: 5000,

  // Rejection callback
  onRejected: (activeCount, queuedCount) => {
    console.log(`Rejected: ${activeCount} active, ${queuedCount} queued`);
  },

  // Optional logger
  logger: myLogger,
});
```

### Checking Status

```typescript
// Get current counts
const activeCount = bulkhead.getActiveCount();
const queuedCount = bulkhead.getQueuedCount();

// Check if at capacity
const isFull = activeCount >= config.maxConcurrent;
```

### Resource Cleanup

```typescript
// Close bulkhead (rejects queued requests)
await bulkhead.close();
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrent` | number | 10 | Max parallel executions |
| `maxQueue` | number | 0 | Max queued requests |
| `queueTimeout` | number | - | Queue timeout (ms) |
| `onRejected` | function | - | Rejection callback |
| `logger` | FortifyLogger | - | Optional logger |

## Error Types

| Error | Description |
|-------|-------------|
| `BulkheadFullError` | Bulkhead and queue at capacity |
| `BulkheadClosedError` | Bulkhead has been closed |

## License

MIT
