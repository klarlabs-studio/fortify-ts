# @klarlabs-studio/fortify-fallback

Fallback pattern for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-fallback
# or
pnpm add @klarlabs-studio/fortify-fallback
```

## Features

- **Default Values**: Return fallback on failure
- **Alternative Operations**: Execute backup operation on failure
- **Custom Predicates**: `shouldFallback` callback
- **Notifications**: `onFallback` and `onSuccess` callbacks

## Usage

### Basic Usage

```typescript
import { Fallback } from '@klarlabs-studio/fortify-fallback';

const fallback = new Fallback<User>({
  fallback: () => ({ id: 0, name: 'Guest' }),
});

// Returns Guest user if operation fails
const user = await fallback.execute(async (signal) => {
  return fetchUser(userId, { signal });
});
```

### With Error Context

```typescript
const fallback = new Fallback<Response>({
  fallback: (error) => {
    console.log(`Falling back due to: ${error.message}`);
    return cachedResponse;
  },
});
```

### Custom Fallback Condition

```typescript
const fallback = new Fallback<Response>({
  fallback: () => defaultResponse,

  // Only fallback on network errors
  shouldFallback: (error) => {
    return error instanceof NetworkError;
  },
});
```

### Configuration Options

```typescript
const fallback = new Fallback<Data>({
  // Fallback function (required)
  fallback: (error) => defaultData,

  // Custom fallback condition
  shouldFallback: (error) => error instanceof NetworkError,

  // Notification on fallback
  onFallback: (error) => {
    metrics.increment('fallback.activated');
  },

  // Notification on success
  onSuccess: (result) => {
    metrics.increment('primary.success');
  },

  // Optional logger
  logger: myLogger,
});
```

### Async Fallback

```typescript
const fallback = new Fallback<Data>({
  fallback: async (error) => {
    // Fallback to cache
    return await cache.get('backup-data');
  },
});
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fallback` | function | required | Fallback function |
| `shouldFallback` | function | - | Custom condition |
| `onFallback` | function | - | Fallback callback |
| `onSuccess` | function | - | Success callback |
| `logger` | FortifyLogger | - | Optional logger |

## License

MIT
