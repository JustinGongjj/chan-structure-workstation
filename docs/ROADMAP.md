# Roadmap

## v1.0 — current

- [x] Deterministic Chan engine: merge → fractal → stroke → segment → pivot → trend → divergence → 1B/2B/3B
- [x] Multi-market adapters with fallback chains (A/HK/US/CR)
- [x] Teaching annotations (concept → chart, with real numbers)
- [x] Desktop workstation (6 pages, dark/light, deep links)
- [x] Mobile PWA (iOS + Android skins, touch chart, installable)
- [x] I Ching timing module with reproducible seeds
- [x] Unit tests (node:test) + CI (27 tests)
- [x] Theory corpus quantified (40 concepts / ≈4.56万字 / bibliography)
- [x] Timing-method lab with historical validation (5 methods + composite)
- [x] Signal backtest with hit rate, profit factor and edge vs baseline

## v1.1 — "international"

- [ ] **English UI** (i18n layer, `en` / `zh-CN`), language switch persisted
- [ ] English theory content (`theory-content.en.js`) — 20 concepts + 14 Q&A
- [ ] `docs/` screenshots with English captions
- [ ] OpenAPI spec + `/api/docs` playground
- [ ] `GET /api/chan?format=csv|ndjson` for research pipelines

## v1.2 — "measurable" (in progress)

- [x] 农历排盘（天文算法：Meeus 朔 + 节气 + 无中气置闰，2023–2027 春节/闰月锚点校验）
- [x] 紫微斗数 流日盘（十二宫、十四主星、四化；起紫微星诀与 iztro 公开公式交叉核对）
- [x] 奇门遁甲 时家盘（阴阳遁、三元局数、三奇六仪、九星、八门、八神；中宫寄坤）
- [x] 两者接入统一 0-100 评分与 `/api/timing/validate` 逐日回测
- [ ] 择时权重自动校准（按标的滚动优化，避免过拟合的 walk-forward 版本）
- [ ] 信号统计样本外滚动（train/test split）与置信区间

## v1.3 — "embeddable"

- [ ] Python package `chanx` (pure Python port or a thin client) with parity tests against the JS fixtures
- [ ] Adapters for **vectorbt**, **backtrader**, **qlib** (`ChanFeature` transformer)
- [ ] `pip install chanx-indicator` style indicator for **pandas-ta** ecosystem
- [ ] Publish fixtures: `chan-structures` dataset on Hugging Face (OHLC + computed structures + signals, CC-BY-4.0)

## v1.3 — "strict"

- [ ] Strict feature-sequence segment division (gap second-case) behind `?segments=strict`
- [ ] Pivot levels beyond stroke level (segment-level pivots, recursive levels)
- [ ] Divergence calibration report (area ratio thresholds per market/timeframe)
- [ ] Signal backtest harness (entry/stop/target from structure, walk-forward)

## v2.0 — "platform"

- [ ] WebSocket streaming for intraday updates
- [ ] Multi-instrument overlay & relative strength views
- [ ] Plugin API for data adapters (drop a file into `adapters/`)
- [ ] Mobile offline mode (cache last analyses, PWA background sync)

## How to pick something up

Everything marked `good first issue` is scoped to < 200 lines. The fastest way to
contribute meaningfully is a **data adapter** or a **test case** for a market/timeframe
you trade yourself.
