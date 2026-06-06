# ADR-005: Browser Compatibility Strategy

## Status

Accepted

## Context

Fortify-TS needs to work in both Node.js and browser environments. Many resilience libraries are Node.js-only due to dependencies on:

- Node.js built-in modules (timers, events)
- Node.js-specific APIs (process, Buffer)
- npm packages without browser bundles

We needed to ensure Fortify-TS works seamlessly in browsers without requiring bundler configuration or polyfills.

## Decision

We adopted a **browser-first, standards-based approach** using only APIs available in both environments.

### Core Principles

1. **Use Web Standards**: Prefer standardized APIs (AbortController, Promise, Map) over Node.js-specific ones
2. **No Node.js Built-ins**: Avoid `events`, `timers/promises`, `process`, etc.
3. **No External Runtime Dependencies**: Core patterns have zero runtime dependencies
4. **Feature Detection**: Use `AbortSignal.any()` when available, polyfill when not

### APIs Used

| Need | Standard API | Availability |
|------|--------------|--------------|
| Cancellation | `AbortController`, `AbortSignal` | Node 15+, all modern browsers |
| Timing | `setTimeout`, `clearTimeout` | Universal |
| High-res time | `performance.now()` | Node 8+, all modern browsers |
| Data structures | `Map`, `Set`, `WeakMap` | ES6+, all modern browsers |
| Async | `Promise`, `async/await` | ES2017+, all modern browsers |

### Build Output

tsup builds output both ESM and CJS formats:
- `dist/index.js` - ESM for modern bundlers and Node.js with `"type": "module"`
- `dist/index.cjs` - CommonJS for older Node.js and legacy bundlers
- `dist/index.d.ts` - TypeScript declarations

## Consequences

### Positive

- **Universal compatibility**: Works in browsers, Node.js, Deno, Bun, and edge runtimes
- **Zero configuration**: No polyfills or bundler plugins required
- **Smaller bundles**: No Node.js polyfills bloating browser bundles
- **Future-proof**: Web standards have long-term support
- **Testing simplicity**: Same code runs in all test environments

### Negative

- **Limited APIs**: Cannot use convenient Node.js-only APIs like `timers/promises`
- **Polyfill overhead**: `AbortSignal.any()` fallback adds some code
- **Timing limitations**: `performance.now()` precision varies by environment

### Neutral

- Target is ES2022 + Node 20, requiring relatively modern environments
- Some optional integrations (Redis storage) may require Node.js

## Alternatives Considered

### Node.js-Only

**Rejected because:**
- Excludes browser usage entirely
- Many applications need resilience in both client and server

### Separate Browser Bundle

```
dist/
├── node/
│   └── index.js  (uses Node APIs)
└── browser/
    └── index.js  (uses web APIs)
```

**Rejected because:**
- Maintenance burden of two codebases
- Bundler configuration complexity for users
- Potential behavior differences between bundles

### Ponyfills/Polyfills

Import polyfills for missing browser APIs in Node.js:

```typescript
import { AbortController } from 'abort-controller';
```

**Rejected because:**
- Adds dependencies
- Modern Node.js (15+) has AbortController natively
- Polyfills may have subtle behavior differences

## Examples

### AbortSignal.any() Polyfill

```typescript
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const filtered = signals.filter((s): s is AbortSignal => s !== undefined);

  if (filtered.length === 0) {
    return new AbortController().signal;
  }
  if (filtered.length === 1) {
    return filtered[0];
  }

  // Use native AbortSignal.any() if available (Node 20+, modern browsers)
  if ('any' in AbortSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(filtered);
  }

  // Fallback implementation
  const controller = new AbortController();
  for (const signal of filtered) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => {
      controller.abort(signal.reason);
    });
  }
  return controller.signal;
}
```

### Browser Usage

```html
<script type="module">
  import { Retry } from 'https://esm.sh/@klarlabs-studio/fortify-retry';

  const retry = new Retry({ maxAttempts: 3 });
  const result = await retry.execute(async (signal) => {
    const response = await fetch('/api/data', { signal });
    return response.json();
  });
</script>
```

### Testing Browser Compatibility

The `@klarlabs-studio/fortify-testing` package includes browser compatibility tests:

```typescript
describe('browser compatibility', () => {
  it('should work with standard AbortController', () => {
    const controller = new AbortController();
    // Tests use only standard APIs
  });
});
```
