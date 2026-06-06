# ADR-006: Configuration Validation with Zod

## Status

Accepted

## Context

Each resilience pattern accepts a configuration object with various options. We needed a validation strategy that:

1. Validates configuration at runtime to catch errors early
2. Provides helpful error messages for invalid configurations
3. Generates TypeScript types from validation schemas
4. Supports default values and optional properties
5. Works in both Node.js and browser environments

## Decision

We chose **Zod** for runtime configuration validation with schemas defined in `@klarlabs-studio/fortify-core`.

### Schema Structure

Each pattern has a corresponding Zod schema:

```typescript
export const retryConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).default(3),
  initialDelay: z.number().min(0).default(100),
  maxDelay: z.number().min(0).optional(),
  backoffPolicy: z.enum(['exponential', 'linear', 'constant']).default('exponential'),
  multiplier: z.number().min(1).default(2),
  jitter: z.boolean().default(false),
  isRetryable: z.function().optional(),
  onRetry: z.function().optional(),
  logger: loggerSchema.optional(),
});

export type RetryConfig = z.infer<typeof retryConfigSchema>;
```

### Validation in Patterns

Patterns validate configuration in their constructor:

```typescript
class Retry<T> {
  private config: RetryConfig;

  constructor(input: RetryConfigInput) {
    this.config = retryConfigSchema.parse(input);
  }
}
```

### Type Generation

Types are inferred from schemas, ensuring runtime validation matches TypeScript types:

```typescript
// Input type (partial, for constructor)
export type RetryConfigInput = z.input<typeof retryConfigSchema>;

// Output type (complete, after defaults applied)
export type RetryConfig = z.output<typeof retryConfigSchema>;
```

## Consequences

### Positive

- **Runtime safety**: Invalid configurations fail fast with clear error messages
- **Type inference**: TypeScript types automatically match validation rules
- **Default values**: Schemas define sensible defaults, reducing boilerplate
- **Consistent validation**: All patterns use the same validation approach
- **Self-documenting**: Schemas serve as documentation for valid configurations
- **Composable**: Schemas can be extended or combined for custom patterns

### Negative

- **Bundle size**: Zod adds ~12KB (minified) to the bundle
- **Runtime overhead**: Validation runs on every instantiation (negligible in practice)
- **Learning curve**: Contributors need to understand Zod schema syntax
- **Version coupling**: Zod updates may require schema updates

### Neutral

- Zod is a peer dependency, allowing version flexibility
- Schemas are centralized in `@klarlabs-studio/fortify-core` for consistency

## Alternatives Considered

### Manual Validation

```typescript
function validateRetryConfig(config: unknown): RetryConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Config must be an object');
  }
  if ('maxAttempts' in config && typeof config.maxAttempts !== 'number') {
    throw new Error('maxAttempts must be a number');
  }
  // ... more manual checks
}
```

**Rejected because:**
- Verbose and error-prone
- Types must be maintained separately from validation
- Inconsistent error messages
- No default value support built-in

### io-ts

```typescript
const RetryConfig = t.type({
  maxAttempts: t.number,
  initialDelay: t.number,
});
```

**Rejected because:**
- More complex API with codec concept
- Requires fp-ts for some features
- Less intuitive error messages
- Smaller ecosystem and community

### Joi

```typescript
const schema = Joi.object({
  maxAttempts: Joi.number().integer().min(1).default(3),
});
```

**Rejected because:**
- Originally designed for Node.js, larger bundle
- TypeScript type inference is less ergonomic
- Requires additional package for TypeScript types

### TypeScript-only (No Runtime Validation)

Rely solely on TypeScript for type checking:

```typescript
interface RetryConfig {
  maxAttempts?: number;
  initialDelay?: number;
}
```

**Rejected because:**
- No runtime protection against invalid input
- Cannot validate configuration from JSON/environment
- No default values enforcement

## Examples

### Basic Validation

```typescript
import { retryConfigSchema } from '@klarlabs-studio/fortify-core';

// Valid configuration
const config = retryConfigSchema.parse({
  maxAttempts: 5,
  initialDelay: 200,
});

// Invalid configuration throws ZodError
retryConfigSchema.parse({
  maxAttempts: -1,  // Error: Number must be >= 1
});
```

### Safe Parsing

```typescript
const result = retryConfigSchema.safeParse(userInput);

if (result.success) {
  const config = result.data;
} else {
  console.error('Invalid config:', result.error.format());
}
```

### Extending Schemas

```typescript
const customRetrySchema = retryConfigSchema.extend({
  customOption: z.string().optional(),
});
```

### Configuration from Environment

```typescript
const config = retryConfigSchema.parse({
  maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS ?? '3'),
  initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY ?? '100'),
});
```
