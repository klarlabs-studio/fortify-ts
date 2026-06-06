# ADR-003: Error Hierarchy Design

## Status

Accepted

## Context

Resilience patterns need to throw specific errors that applications can catch and handle appropriately. We needed to design an error system that:

1. Allows catching all Fortify errors or specific pattern errors
2. Preserves original error context when wrapping
3. Supports retry logic (some errors are retryable, others aren't)
4. Provides useful debugging information

## Decision

We implemented a **hierarchical error system** with a base `FortifyError` class and pattern-specific subclasses.

### Error Hierarchy

```
Error
└── FortifyError (base class)
    ├── CircuitOpenError
    ├── RateLimitExceededError
    ├── BulkheadFullError
    ├── BulkheadClosedError
    ├── TimeoutError
    └── MaxAttemptsReachedError
```

### Retryable Error Marking

Errors can be marked as retryable or non-retryable using utility functions:

```typescript
// Mark error as retryable
throw asRetryable(new Error('Temporary failure'));

// Mark error as non-retryable
throw asNonRetryable(new Error('Validation failed'));

// Check if error is retryable
if (isRetryableError(error)) {
  // Retry the operation
}
```

### Error Properties

All `FortifyError` instances include:
- `name`: Error class name (e.g., 'CircuitOpenError')
- `message`: Human-readable error message
- `cause`: Original error that caused this error (if applicable)
- Pattern-specific metadata (e.g., `duration` for TimeoutError)

## Consequences

### Positive

- **Granular handling**: Applications can catch specific error types
- **Instanceof checks**: `error instanceof CircuitOpenError` works correctly
- **Error chaining**: Original errors are preserved in `cause` property
- **Retry control**: Explicit retryable/non-retryable marking
- **Type safety**: TypeScript can narrow error types in catch blocks

### Negative

- **Class hierarchy**: Requires ES6+ environments for proper class inheritance
- **Instanceof fragility**: Won't work across different package versions (rare edge case)
- **Learning curve**: Users need to know which errors each pattern throws

### Neutral

- Error classes are exported from `@klarlabs-studio/fortify-core` for consistent access
- Symbol-based retryable marking doesn't affect error serialization

## Alternatives Considered

### Error Codes

```typescript
interface FortifyError extends Error {
  code: 'CIRCUIT_OPEN' | 'RATE_LIMITED' | 'TIMEOUT' | ...;
}
```

**Rejected because:**
- No TypeScript narrowing support
- Cannot use instanceof for type checking
- Less discoverable for IDE autocompletion

### Union Types

```typescript
type FortifyError = CircuitOpenError | TimeoutError | ...;
```

**Rejected because:**
- Cannot catch "all Fortify errors" with a single catch
- Harder to add new error types without breaking existing code
- No inheritance relationship

### Result Types

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: FortifyError };
```

**Rejected because:**
- Doesn't match JavaScript/TypeScript idioms for error handling
- More verbose than try/catch
- Doesn't compose well with async/await

## Examples

### Catching Specific Errors

```typescript
try {
  await circuitBreaker.execute(operation);
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // Circuit is open, use fallback
    return fallbackValue;
  }
  throw error;
}
```

### Catching All Fortify Errors

```typescript
try {
  await chain.execute(operation);
} catch (error) {
  if (error instanceof FortifyError) {
    logger.warn('Resilience pattern error', { error: error.message });
    return defaultValue;
  }
  throw error;
}
```

### Retryable Error Control

```typescript
const retry = new Retry({
  isRetryable: (error) => {
    // Check explicit marking first
    if (isRetryableError(error)) return true;
    if (isNonRetryableError(error)) return false;

    // Default: retry network errors, not validation errors
    return error instanceof NetworkError;
  }
});
```
