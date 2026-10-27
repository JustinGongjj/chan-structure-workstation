# Contributing to Chan Structure Workstation

Thanks for helping! This project is intentionally small and dependency-free, so contributions are easy to review.

## Good first issues

- **Data adapters** — add a provider for a market we do not cover well (e.g. a free HK intraday source), or harden an existing fallback chain. Everything lives in `server/lib/sources.js`; a new adapter only needs to return `{ bars, source }`.
- **Translations** — `README`, `docs/`, and (soon) the UI strings.
- **Test cases** — edge cases for the engine: gap-only data, limit-up sequences, 0-volume bars, tick-level crypto.
- **Chart polish** — annotation styling, accessibility (keyboard navigation), reduced-motion.
- **Theory content** — new concepts with operational definitions and "where to look on this chart" hints (`web/js/theory-content.js`).

## Development

```bash
git clone <fork>
cd chan-structure-workstation
npm start            # http://localhost:8931
npm test             # node:test, no network required
```

No `npm install` is needed: the runtime and the tests use only the Node standard library.

## Code conventions

- **Zero runtime dependencies.** Do not add packages to `dependencies`. Dev-time tooling may be discussed in an issue first.
- Node ≥ 18, CommonJS in `server/`, plain ES2020 in `web/` (no bundler).
- Every engine change must keep `npm test` green and add a test that fails before the change.
- Keep the documented simplifications documented: if you change a rule (e.g. segment division), update `docs/ARCHITECTURE.md` and the UI hints in the same PR.
- Chinese and English comments are both welcome; keep user-facing strings consistent in tone.

## Pull requests

1. Open an issue first for anything larger than a bug fix.
2. One logical change per PR; include a test for engine logic.
3. Describe **what you observed on a real chart** if the change affects structures (symbol + timeframe + date range).

## Data and licensing

- Do not commit proprietary data or vendor credentials.
- Adapters must use public, no-key endpoints and must not bypass rate limits. Add caching/backoff rather than retry storms.
- Respect each provider's terms of service; a provider being technically reachable is not permission to hammer it.

## Reporting bugs

Use the issue templates. For engine bugs, the most useful report includes:

```jsonc
{
  "market": "A", "code": "600519", "period": "day",
  "asOf": "2026-10-26",
  "expected": "one pivot of 3 strokes around 1270–1339",
  "actual": "no pivot detected"
}
```

and, if possible, the output of `GET /api/chan?...` for that symbol.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
