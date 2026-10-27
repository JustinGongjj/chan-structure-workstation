# Architecture

```
                    ┌──────────────────────────────────────────────┐
   free endpoints   │  server/lib/sources.js                       │
  ┌───────────────► │  adapter matrix + fallback + TTL cache       │
  │                 └───────────────┬──────────────────────────────┘
  │                                 │ bars[] {t,o,h,l,c,v}
  │                 ┌───────────────▼──────────────────────────────┐
  │                 │  server/lib/chan.js  (pure functions)        │
  │                 │  merge → fractal → stroke → segment → pivot  │
  │                 │  → trend → divergence → signals → summary    │
  │                 └───────┬──────────────────────┬───────────────┘
  │                         │                      │
  │        ┌────────────────▼─────┐   ┌────────────▼──────────────┐
  │        │ server/index.js      │   │ web/js/highlight.js       │
  │        │ REST + static + SPA  │   │ concept → chart annotation │
  │        └───────┬──────────────┘   └────────────┬──────────────┘
  │                │                               │
  │     web/ (desktop)                        web/m/ (mobile PWA)
  │     web/js/chart.js  canvas renderer used by both
  └────────────────  web/js/api.js
```

## Why zero dependencies

The runtime is a single Node process plus static files. That means: no `npm audit`
surface, no lockfile churn, trivially auditable by a reviewer, and a Docker image
built in seconds. Everything needed (HTTP client with retry/timeout, GBK decoding,
TTL cache, concurrency pool) is ~200 lines in `server/lib/http.js`.

## The engine, step by step

### 1. Inclusion merging (包含处理)

Walk the bars once. Two adjacent bars are *included* when one's range contains the
other. On inclusion, merge according to the prevailing direction:

- up trend → `high = max(h)`, `low = max(l)`
- down trend → `high = min(h)`, `low = min(l)`

The direction is inferred from the last two merged bars (`h` and `l` both rising or
both falling). Each merged bar keeps the original index span `[i0, i1]` so that
fractals can be mapped back to real bars.

> Invariant tested in `test/chan.test.js`: after merging, no two adjacent merged
> bars are in an inclusion relation.

### 2. Fractals (分型)

On merged bars, a top fractal is `b.h > a.h && b.h > c.h && b.l > a.l && b.l > c.l`;
a bottom fractal is the mirror. The extreme bar inside `[i0, i1]` is recorded so the
chart can place the marker on the actual candle.

### 3. Strokes (笔)

Alternating fractal endpoints with `mergedIndex(f2) - mergedIndex(f1) >= 4`
(⟺ at least 5 merged bars, i.e. one independent bar between the two fractals).
When a more extreme same-type fractal appears, the **last stroke is extended**
instead of opening a new one, so strokes always connect end-to-end.

### 4. Segments (线段) — documented approximation

Strict feature-sequence division needs gap (缺口) second-case handling and a
confirmation step. This project uses the widely used 3-stroke approximation:
a segment ends when the third stroke in the same direction fails to make a new
extreme; the endpoint is the extreme of the same-direction strokes inside the
candidate range. Segments therefore stay contiguous (`startBi = endBi + 1`).

This is called out in `docs/`, in the UI chart note, and in the theory card for
`线段`. A strict implementation is on the roadmap behind a flag.

### 5. Pivots (中枢)

Three consecutive strokes define a zone: `ZG = min(highs)`, `ZD = max(lows)`;
valid when `ZG > ZD`. Extension continues while each following stroke *ends*
inside `[ZD, ZG]` (the zone itself never changes). The first stroke whose endpoint
leaves the zone becomes the **exit leg** (`leaveBi`), and the stroke before the
zone is the **entry leg** (`enterBi`). Nine or more strokes mark the pivot as
upgradeable (九笔升级).

### 6. Trend classification (走势类型)

From pivot succession: two consecutive non-overlapping pivots that ascend ⇒ uptrend,
descend ⇒ downtrend, overlap ⇒ consolidation. The count of consecutive same-direction
relations is reported in the summary.

### 7. Divergence (背驰)

For same-direction moves, compare MACD (12, 26, 9) histogram **area** and DIF
extreme:

- segment level: `area_ratio < 0.92`
- stroke level across a pivot: `area_ratio < 0.85`

plus "price must make a new extreme". The result carries `kind` (`段背驰` / `笔背驰`),
`areaRatio`, `peakRatio`, and the reference move, so the UI can draw both legs.

### 8. Signals (三类买卖点)

| Signal | Rule implemented |
| --- | --- |
| 1B / 1S | endpoint of a down/up leg that satisfies divergence |
| 2B / 2S | first counter-move after a 1B/1S whose low/high does not break it |
| 3B / 3S | pivot exit followed by a pullback that stays above `ZG` (below `ZD`) |

All signals are deduplicated by `(type, barIdx)` and sorted by bar index.

### 9. Multi-level suite (区间套)

`/api/suite` runs the same engine on up to six periods (1m → 1d) and reports per
level: trend, price position vs pivot, most recent signal/divergence, plus a
resonance verdict (≥2 levels agreeing).

## Teaching annotations (`web/js/highlight.js`)

`buildHighlight(conceptKey, analysis)` returns a declarative spec:

```js
{
  title, range: [barStart, barEnd],
  bands: [{ from, to, color, label }],
  hlines: [{ y, text, color }],
  marks: [{ bar, price, text, color, pos }],
  steps: ['…5 lines of explanation with real numbers…']
}
```

The canvas renderer (`web/js/chart.js::drawHighlight`) dims everything outside
`range`, paints the bands/lines/marks, and the page renders the steps. Because the
spec is pure data, the desktop page and the mobile page share the same builder.

## I Ching module

`ganzhi.js` computes the calendar astronomically: Meeus low-precision apparent solar
longitude → bisection for the 24 solar terms → year pillar at 立春, month pillar at
each 节, day pillar from the Julian day (anchors verified by tests), hour pillar by
五鼠遁. `divination.js` derives the hexagram from an FNV-1a seed over
`market:code | price bucket | pct | four-pillar sum | draw index`, then builds
the Plum Blossom (体用/互卦/变卦) and the six-line Na Jia board from `gua-data.js`.

Every input to the seed is returned in `seed.parts`, so any reading is reproducible.

## Data flow / caching

| Layer | TTL | Notes |
| --- | --- | --- |
| quotes | 4s | single batched request per market group |
| daily/weekly/monthly klines | 60s | per symbol+period |
| intraday klines | 20s | |
| radar scan | 30s | `?nocache=1` bypasses for manual/live refresh |
| source probe | 60s | |

In-flight requests are deduplicated, and failures fall back to the last cached
value (`stale: true`) instead of erroring out.
