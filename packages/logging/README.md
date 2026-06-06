# @klarlabs-studio/fortify-logging

Structured logging utilities for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-logging
# or
pnpm add @klarlabs-studio/fortify-logging
```

## Features

- **Console Logger**: Browser-friendly logger with timestamps and JSON output
- **Pino Adapter**: Integrate with pino for production logging
- **Resilience Logger**: Pre-built methods for resilience pattern events
- **Log Redaction**: Automatic redaction of sensitive data
- **Child Loggers**: Create contextual loggers with bound metadata

## Usage

### Console Logger

```typescript
import { createConsoleLogger } from '@klarlabs-studio/fortify-logging';

const logger = createConsoleLogger({
  level: 'info',      // Minimum log level
  timestamps: true,   // Include ISO timestamps
  json: false,        // Output as JSON
  prefix: 'myapp',    // Custom prefix
});

logger.info('User logged in', { userId: '123' });
// [2024-01-15T10:30:00.000Z] [myapp] [INFO] User logged in {"userId":"123"}
```

### Pino Integration

```typescript
import pino from 'pino';
import { createPinoLogger } from '@klarlabs-studio/fortify-logging';

const logger = createPinoLogger(pino());

logger.info('Hello', { key: 'value' });
```

### Resilience Logger

```typescript
import { createConsoleLogger, createResilienceLogger } from '@klarlabs-studio/fortify-logging';

const baseLogger = createConsoleLogger({ level: 'info' });
const logger = createResilienceLogger(baseLogger);

// Pre-built methods for resilience events
logger.circuitBreakerStateChange('api-breaker', 'closed', 'open');
logger.retryAttempt('fetch-data', 2, 5, new Error('Connection failed'));
logger.rateLimitExceeded('api-limiter', 'user-123');
logger.timeoutExceeded('fetch-data', 5000);
logger.bulkheadRejection('api-bulkhead', 10, 50);
logger.fallbackActivated('get-user', new Error('Primary failed'));
```

### Log Redaction

Automatically redact sensitive data from logs:

```typescript
import { createConsoleLogger, withDefaultRedaction } from '@klarlabs-studio/fortify-logging';

const baseLogger = createConsoleLogger({ level: 'info' });
const logger = withDefaultRedaction(baseLogger);

// Sensitive keys are automatically redacted
logger.info('User authenticated', {
  username: 'john',
  password: 'secret123',    // Will be '[REDACTED]'
  token: 'jwt-token',       // Will be '[REDACTED]'
  apiKey: 'key-123',        // Will be '[REDACTED]'
});
```

#### Custom Redaction

```typescript
import {
  createConsoleLogger,
  withRedaction,
  createRedactor,
} from '@klarlabs-studio/fortify-logging';

// Create custom redactor
const redactor = createRedactor({
  keys: ['customSecret', 'internalId'],
  patterns: [/^x-internal-/i],
  replacement: '****',
  deep: true,  // Redact nested objects
});

const baseLogger = createConsoleLogger({ level: 'info' });
const logger = withRedaction(baseLogger, redactor);

logger.info('Request', {
  customSecret: 'hidden',      // '****'
  'x-internal-token': 'xyz',   // '****'
  publicData: 'visible',       // Unchanged
});
```

#### Extending Default Redaction

```typescript
import { createConsoleLogger, withDefaultRedaction } from '@klarlabs-studio/fortify-logging';

const baseLogger = createConsoleLogger({ level: 'info' });

// Add custom keys/patterns to default redaction
const logger = withDefaultRedaction(
  baseLogger,
  ['myCustomSecret'],           // Additional keys
  [/^x-my-app-/i]              // Additional patterns
);
```

#### Manual Context Redaction

```typescript
import { redactContext, createDefaultRedactor } from '@klarlabs-studio/fortify-logging';

// One-time redaction
const sanitized = redactContext(
  { password: 'secret', name: 'john' },
  { keys: ['password'] }
);

// Reusable redactor
const redact = createDefaultRedactor();
const safe = redact({ apiKey: 'key123', data: 'public' });
```

### Child Loggers

```typescript
const logger = createConsoleLogger({ level: 'info' });

// Create child with bound context
const requestLogger = logger.child({ requestId: 'abc-123' });

requestLogger.info('Processing request');
// All logs include requestId automatically
```

### Noop Logger

```typescript
import { noopLogger } from '@klarlabs-studio/fortify-logging';

// Disable logging (useful for tests)
const circuitBreaker = new CircuitBreaker({
  logger: noopLogger,
});
```

## Configuration Reference

### Console Logger

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | 'info' | Minimum log level |
| `timestamps` | boolean | true | Include timestamps |
| `json` | boolean | false | Output as JSON |
| `prefix` | string | '' | Log message prefix |

### Redaction Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | string[] | required | Keys to redact |
| `patterns` | RegExp[] | [] | Patterns to match |
| `replacement` | string | '[REDACTED]' | Replacement value |
| `deep` | boolean | true | Redact nested objects |

### Default Sensitive Keys

The following keys are redacted by default:
- `password`, `secret`, `token`
- `apiKey`, `api_key`, `apikey`
- `authorization`, `auth`
- `credential`, `credentials`
- `privateKey`, `private_key`
- `accessToken`, `access_token`
- `refreshToken`, `refresh_token`
- `sessionId`, `session_id`
- `cookie`, `ssn`, `cvv`, `pin`
- Credit card related fields

## API Reference

### Logger Factories

| Function | Description |
|----------|-------------|
| `createConsoleLogger(config?)` | Create console logger |
| `createPinoLogger(pino)` | Wrap pino instance |
| `createResilienceLogger(logger)` | Add resilience methods |
| `createNoopLogger()` | Create silent logger |

### Redaction Functions

| Function | Description |
|----------|-------------|
| `withRedaction(logger, redactor)` | Wrap logger with redaction |
| `withDefaultRedaction(logger, keys?, patterns?)` | Wrap with default redaction |
| `redactContext(context, config)` | Redact a single context object |
| `createRedactor(config)` | Create reusable redactor |
| `createDefaultRedactor(keys?, patterns?)` | Create default redactor |

## License

MIT
