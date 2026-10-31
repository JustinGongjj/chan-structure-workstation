# Chan Structure Workstation · 缠论工作站

**English** · [简体中文](README.zh-CN.md)

<p align="center">
  <img src="docs/assets/banner.png" alt="Chan Structure Workstation" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-e0b15a"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A518-3c873a"></a>
  <img alt="dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen">
  <a href="#testing"><img alt="tests" src="https://img.shields.io/badge/tests-35%20passing-22b884"></a>
  <a href="https://huggingface.co/spaces"><img alt="HF Space" src="https://img.shields.io/badge/%F0%9F%A4%97-Hugging%20Face%20Space-ffd21e"></a>
</p>

> **A deterministic, dependency-free Chan-theory (缠论) structure engine + multi-market trading workstation.**
> Parse any OHLC series into fractals → strokes → segments → pivots → divergence → 1st/2nd/3rd class buy-sell points, see exactly where each concept lives on the chart, and run the same engine over A-shares, HK, US stocks and crypto.

<p align="center">
  <img src="docs/assets/desktop-structure.png" alt="Structure analysis with teaching annotations" width="88%">
</p>

---

## Why this exists

Chan theory (缠中说禅 / "Chan Zhong Shuo Chan") is one of the most influential price-structure methodologies in the Chinese-speaking trading world — and one of the worst served by open-source tooling. Existing projects are either black-box screen-recorders, closed indicator packs, or one-off notebooks that break on the next data feed.

This project is the opposite: **a small, readable, deterministic engine** (≈900 lines, zero runtime dependencies) plus a full workstation around it.

| | Typical Chan tools | This project |
| --- | --- | --- |
| Engine | embedded in a closed app / not reproducible | pure JS, deterministic, unit-tested, MIT |
| Dependencies | pandas / TA-Lib / dozens of npm packages | **0** (Node ≥18 standard library only) |
| Markets | one market, one data vendor | A-shares · HK · US · Crypto, multi-source with automatic fallback |
| Explainability | "the algorithm says so" | every band / pivot / signal can be **highlighted and explained on the chart** with real dates, prices and MACD areas |
| Mobile | none | installable PWA with **two native-feeling skins** (iOS / Android) |
| Learning | none | 20 concepts + 14 "where is it on the chart?" Q&A + 108-lesson guide + guided chart annotation |

---

## Features

### 1. Structure engine (`server/lib/chan.js`)

- **Inclusion handling** (K-line merging) → **fractals** → **strokes (笔)** with the strict ≥5-merged-bar rule → **segments (线段)** → **pivots (中枢, ZG/ZD, 9-stroke upgrade flag)**
- **Trend classification** (trend / consolidation from pivot succession)
- **Divergence (背驰)** by comparing MACD histogram area + DIF extremes of same-direction moves (segment-level and stroke-level)
- **Signals**: 1B/2B/3B and 1S/2S/3S with the exact geometric conditions (new extreme + weaker momentum; pullback that does not break the prior low; pullback that does not re-enter the pivot)
- **Multi-level suite** (区间套): run every level from 1m to 1d and detect cross-level resonance
- **Signal backtest**: every buy/sell point type gets a hit rate, average forward return, profit factor and **excess over a random-hold baseline** — with an explicit small-sample warning
- Deterministic: same bars in → same structures out (covered by tests)

```js
const { analyze } = require('./server/lib/chan');

const res = analyze(bars, { period: 'day' });
res.trend;      // { type: '上涨趋势', sub: '两个中枢不重叠且依次抬高' }
res.pivots;     // [{ zg, zd, i0, i1, count, upgraded, … }]
res.beichi;     // [{ kind: '段背驰', dir: -1, areaRatio: 0.55, … }]
res.signals;    // [{ type: '1B', price, barIdx, note, … }]
res.summary;    // human-readable narrative built from the actual numbers
```

> **Honest simplifications** (documented in code and in the UI): segments use the 3-stroke fractal approximation rather than the full feature-sequence gap handling; pivots are stroke-level; divergence is numeric (area-ratio thresholds 0.92 / 0.85). See [docs/MOBILE.md · docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### 2. Four markets, free data, graceful degradation

| Market | Daily / weekly / monthly | Intraday | Realtime quote |
| --- | --- | --- | --- |
| A-shares | Tencent `ifzq.gtimg.cn` (qfq) → Eastmoney → Sina | Sina `CN_MarketDataService` → Tencent mkline | Tencent `qt.gtimg.cn` |
| Hong Kong | Tencent fqkline → Eastmoney | — (UI hides unavailable levels) | Tencent |
| US | Nasdaq official API → Sina US → Eastmoney; week/month aggregated locally | — | Tencent |
| Crypto | Binance `data-api.binance.vision` klines | 1m/5m/15m/30m/1h/4h | Binance ticker/24hr |

No API keys, no paid vendors; per-request timeout + retry + dedup + TTL cache. Details and ToS notes: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

### 3. Teaching annotations — theory → chart, one click

Every concept in the theory library has an **"annotate it on the chart →"** action. The chart dims everything else and draws exactly the structure the concept describes — with real dates, prices and MACD areas from the current chart.

<p align="center">
  <img src="docs/assets/annotate-aab.png" alt="a+A+b annotation" width="88%">
</p>

| Concept | What gets highlighted |
| --- | --- |
| Fractal / stroke | last 3–4 strokes as bands + top/bottom fractal bubbles |
| Segment | last 3 segments, direction and completion state |
| Pivot | the pivot box + ZG/ZD dashed lines + stroke count / 9-stroke upgrade |
| **a+A+b** | entry leg **a**, pivot **A**, exit leg **b**, plus the a-vs-b MACD area ratio verdict |
| Divergence | previous leg vs diverging leg, extreme bubbles, area ratio, 1B/1S meaning |
| 1B / 2B / 3B | divergence leg or pivot + pullback leg + signal bubble + stop reference line |

### 3.5 Timing lab (算卦页新增)

Seven independent timing methods run side by side — **四柱·节气五行 / 梅花易数 / 六爻纳甲 / 建除十二神 / 日历周期因子 / 紫微斗数·流日 / 奇门遁甲·时家** — each returning a 0–100 "顺逆分" with readable reasons, plus a weighted composite, an agreement/spread read-out, and a **per-method historical validation**: for the selected symbol we recompute the score for the last N sessions and correlate it with next-session returns.

The verdict is deliberately blunt: on the shipped sample it usually says *"no significant edge — use it as a discipline tool, not a signal source."* 紫微斗数流日盘（十二宫＋十四主星＋四化）与奇门遁甲时家盘（阴阳遁·局数·三奇六仪·九星·八门·八神）都按同一标准接入：先排盘、再打分、最后必须过 `/api/timing/validate` 的逐日回测。方法卡（理论页 → 择时方法）对每一法都写明局限。

### 4. Trading radar, live refresh, editable watchlist

- Cross-market scan sorted by "signal freshness × type weight"
- Global live mode: quotes every 10s, structure every 20s, radar every 30s
- Add/remove symbols per market (search autocomplete); persisted to `data/watchlist.json`

### 4.4 108-lesson index + lore collection（108课全表 · 言论集）

- **108 课全表**: all 108 lessons with number, theme (14 study-route groups), title **only where verifiable from public indexes** (50), and a one-line gist (24); unverified titles are left blank on purpose — no invented titles. Served by `/api/chan-lessons`.
- **言论集**: 22 curated entries from 天涯论坛 / 新浪博客, each with source, era, kind, takeaway and the concept it maps to (e.g. "同一级别买点买入就在同一级别卖点卖出" → 级别). Clearly labelled as **community paraphrase, not verbatim quotes**: `/api/chan-lore`.

### 4.5 Metaphysics knowledge base (命理知识库)

A first-class module (not a footnote): **天干地支/四柱 · 紫微斗数 · 奇门遁甲 · 梅花易数 · 六爻纳甲**, each with principle, the exact rules this codebase implements, where to look in the UI, the module/API/test file, and its documented pitfalls — plus a 14-book bibliography (缠论 / 干支 / 紫微 / 奇门 / 卦象 / 六爻) used purely as an index.

### 4.6 1-on-1 guided walkthrough

Every teaching annotation is now a **stepper**: step 1 lights up `a`, step 2 adds the pivot, step 3 adds `b`, then reference lines, then key points — with the matching sentence highlighted below the chart. This is the "teach me how to read *my* chart" mode rather than a wall of text.

### 5. Reading room (theory library) — quantified

**40 concepts** (operational definition, original meaning, recognition steps, common mistakes, where to look on this chart) · **14 "where is it?" Q&A** · 108-lesson guide grouped into **14 themes** · **5 practical workflows** · **≈45,600 characters of original digest** in this repo, plus a bibliography (the 780-page annotated edition, the 6-volume collection, the complete-works edition) and honest provenance notes. The theory page shows these counts as a live stats strip.

See [docs/COMPETITIVE.md](docs/COMPETITIVE.md) for the GitHub landscape (czsc 6.5k★, chan.py 2.3k★, chanlun-pro 1.1k★, and the 8k★ Zi Wei Dou Shu engine we benchmarked against) and exactly which gaps this project fills.

### 6. I Ching timing module (算卦择时)

Ganzhi (干支) calendar computed astronomically (24 solar terms from apparent solar longitude), Plum Blossom (梅花易数) casting seeded by **symbol hash + live price bucket + time bucket + draw index**, six-line Na Jia board (六亲/世应/六神/旬空), twelve-hour body-use analysis. Deterministic and reproducible; **entertainment only, explicitly not investment advice**.

<p align="center">
  <img src="docs/assets/divination.png" alt="I Ching timing module" width="70%">
</p>

### 7. Desktop + mobile

- Desktop: 6 pages, dark/light themes, canvas chart with wheel zoom / drag pan, deep-linkable (`?m=A&c=600519&p=day&hl=a_A_b#structure`)
- Mobile: `/m/` with **iOS and Android skins** (`?skin=ios` / `?skin=android`), touch chart (drag / pinch), bottom tab bar, safe-area handling, installable as a PWA

<p align="center">
  <img src="docs/assets/mobile-ios.png" alt="iOS skin" width="25%"> &nbsp;&nbsp;
  <img src="docs/assets/mobile-android.png" alt="Android skin" width="27%">
</p>

---

## Quickstart

```bash
git clone https://github.com/<you>/chan-structure-workstation.git
cd chan-structure-workstation
npm start                 # → http://localhost:8931（桌面版）/ http://localhost:8931/m/（手机版）
# or: PORT=8931 node server/index.js
# or: ./start.sh
```

Requirements: **Node.js ≥ 18**. No `npm install` needed — the runtime has zero dependencies.

### Docker

```bash
docker build -t chan-station .
docker run -p 8931:8931 -v "$PWD/data:/app/data" chan-station
# open http://localhost:8931  (mobile UI at /m/)

# 在线版：
#   电脑版  https://dsh-qzmkvbrntwlsdhfa.apps.gai.cn/
#   手机版  https://dsh-qzmkvbrntwlsdhfa.apps.gai.cn/m/   （iOS / Android 双皮肤，可"添加到主屏幕"）
#   下载    https://dsh-qzmkvbrntwlsdhfa.apps.gai.cn/downloads/
```

### One-click deploy

- **Hugging Face Space** (Docker SDK): see [`space/`](space/) — duplicate it, port `8931`
- Any VPS / Fly.io / Railway: `docker run` or `node server/index.js` behind HTTPS (required for PWA install)

---

### 缠关 · 108（独立闯关小游戏）

`/game/` 是一个可以单独玩、单独测的小游戏：**把 108 课变成 108 关**，每关用**实时行情**生成一道题。

| 题型 | 玩法 | 判分 |
| --- | --- | --- |
| 看走势 | 图截断在某个位置，判断接下来 12–20 根涨/跌/震荡 | 方向 + 幅度，和缠论信号同向额外加分 |
| 找买卖点 | 在图上点出买卖点所在 K 线 | 与标准答案的 K 线距离 |
| 框中枢 | 拖一个框框住中枢 | 与真实中枢区间的 IoU |
| 判背驰 | 判断最后一段有没有背驰 | 二选一 + 力度对比数字 |

- 108 关 → 14 章（沿用 108 课的主题分组），难度四档：青铜 / 白银 / 黄金 / 王者。
- **答案不下发**：出题只给截断前的 K 线 + 一张 HMAC token，判分在服务端重算。
- 进度存本地：星级、平均分、连击；关卡按顺序解锁。
- 设计细节见 [`docs/GAME.md`](docs/GAME.md)。

### 手绘线 + AI 复核

在结构图上自己画线，然后让规则引擎把它和缠论结构对齐检查：

| 能画什么 | 怎么交互 | 检查什么 |
| --- | --- | --- |
| 趋势线 | 点两下（**自动吸附到笔的端点**，±14px） | 端点是否落在笔端点上、方向与当前趋势是否一致、是否横穿中枢 |
| 水平线 | 点一下 | 是否就是中枢的 ZG/ZD 或前高前低（否则判"无结构意义"） |
| 矩形 | 拖一下 | 是否正好框住某个中枢（缠论的核心对象） |

- 线按 `市场:代码:周期` 存在服务端（`data/drawings.json`，原子写），换设备/换浏览器都在。
- 点线可选中，`Delete` 删除；「清空」整表清掉；画完自动退出画线模式（手机上不会"停不下来"）。
- **AI 复核**（`POST /api/drawings/verify`）点一下直接**弹窗**（电脑端居中弹窗，手机端底部弹层），
  给出 0–100 一致度 + 逐条结论 + 改进步骤，可「重新复核」或 Esc/✕ 关闭。
  引擎是**确定性的规则层**（`server/lib/drawing.js`，10 个单测），不是大模型猜。
  每条结论都带可核对数值，例如"起点离最近的笔端点有 8 根、5.47% 的价格差"。
  要接 LLM 做自然语言点评，只需把 findings 转成 prompt（当前不联网，保持可复现）。

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/chan?market=A&code=600519&period=day` | full Chan analysis (bars, macd, bis, segments, pivots, beichi, signals, trend, summary) |
| `GET /api/suite?market=CR&code=BTCUSDT` | multi-level summary + resonance verdict |
| `GET /api/radar?scope=all` | watchlist scan |
| `GET /api/kline?market=US&code=NVDA&period=week` | raw OHLC |
| `GET /api/quote?list=US:NVDA,A:600519` | batch quotes |
| `GET/POST/DELETE /api/watchlist` | manage the watchlist |
| `GET /api/divination?market=A&code=600519&mode=price&nonce=0` | hexagram + six-line board + seed basis |
| `GET /api/daily` | ganzhi calendar, solar terms, 建除, 旬空 |
| `GET /api/sources` | live probe of every free data provider |
| `GET/POST /api/drawings?market=A&code=600519&period=day` | load / save user-drawn lines (per symbol+period, atomic JSON store) |
| `POST /api/drawings/verify` | rule-engine review of drawings against 笔/中枢/买卖点 → score + per-line findings |
| `GET /api/game/map` | 108 关地图（章节 / 题型 / 难度） |
| `GET /api/game/level?no=7` | 出题：截断后的 K 线 + 题目 + HMAC token（**不含答案**） |
| `POST /api/game/answer` | 判分：服务端重算答案 → 0–100 分、星级、逐条讲解、揭示段 |

All responses are `{ ok: true, … }`; failures are `{ ok: false, error }` with a 4xx/5xx status.

---

## Testing

五层门禁，一条命令全跑：`npm run check:all`

| 命令 | 覆盖 | 现状 |
| --- | --- | --- |
| `npm test` | 缠论引擎不变量、**中枢几何（进/离段、区间固定、扩展合并）**、干支锚点、农历/紫微/奇门、择时、算卦、手绘线校验、闯关关卡引擎 | **61 项** |
| `npm run check:api` | 逐条打 56 个接口（含国内期货 / 美期货的报价·K线·缠论）：四市场报价/K线/缠论、多级别、雷达、择时七法、择时验证、回测、算卦可变性、自选池增删+去重+垃圾代码拒绝、静态资源 | **39/39** |
| `npm run check:ui` | 真实 Chromium(CDP)：桌面 1440/1024、iOS 390×844、Android 412×915 × 深浅色。查 JS 报错、横向溢出、**内容超出却滚不动**、轮询是否打回滚动位置、5 个 Tab 是否都有内容 | **6/6** |
| `npm run check:sheet` | 弹层矩阵：5 Tab × 3 弹层 × 2 皮肤 × 2 主题，断言弹层背景不透明、不被页面压住、无零宽标题、无超宽元素 | **48/48** |
| `npm run check:flow` | 交互链路：搜索→进结构、自选池增删、**算卦两次必换卦**、切市场自动退回兼容周期、教学标注齐全、理论弹层、深链、桌面 6 页与弹窗 | **25/25** |
| `npm run check:pivot` | 中枢几何 + ASCII 画图，六个市场逐个校验 | ✅ 全通过 |
| `npm run check:matrix` | **全链路矩阵**：13 个商品搜索词 + 6 市场 27 个品种 ×（K线/缠论/中枢字段）+ 报价 + 概览脉冲 | **108/108** |
| `npm run check:css` | 框架冲突审计：把 F7 的 5706 条规则里"会命中我们 DOM"的 111 个危险属性逐条比对，缺一条不是危险就是覆盖不足，直接失败 | **111/111 已抵消** |
| `npm run check:perf` | 首屏传输基线（真实浏览器 + CDP Network，gzip 后字节）：手机版 **200 KB / 13 请求 / FCP 0.8s**，桌面版 151 KB | 预算 420 KB 内 |

```bash
npm test              # 只需单元测试（无网络）
npm run check:all     # 全量：单测 + 接口 + UI + 弹层 + 交互（需本机 8931 已在跑）
```

UI 五条用 `chrome-headless-shell` + CDP over WebSocket（Node 22 内置 WebSocket），
加 `--shots /tmp/out` 可落截图。它们不是"跑通就行"，而是逐项断言可复现的症状——
手机滚不动、弹层透明、标题零宽、算卦不换卦、切市场白屏都是这样被抓出来的。

### 中枢（画对了才算缠论）

中枢是缠论的骨架，之前实现有两处**不符合定义**，已修：

| 问题 | 以前 | 现在 |
| --- | --- | --- |
| 进入段/离开段 | 中枢从第一笔开始，进出段被吞进中枢 → 图上一截一截**首尾相接** | 中枢从第 2 笔起，`enterBi`/`leaveBi` 明确，图上画**进入段箭头 + 离开段箭头** |
| 延伸判据 | 整段与区间"相交"就算中枢内 → 一笔从 1142 涨到 1806 也被吞进去，中枢被拉成长条 | 看**终点**是否落在 `[ZD, ZG]` 内；终点出界即离开段 |
| 区间固定 | 延伸时区间会跟着漂 | ZG/ZD 在**形成那一刻固定**，后续震荡只延伸、不改区间 |
| 中枢扩展 | 相邻中枢重叠也各算各的 | 重叠 ≥30% 且相隔 ≤3 段 → 按缠论**合并为一个中枢**（区间取重叠区，合并后重新筛选内段） |
| 9 段升级 | 判据错位 | 内段 ≥9 段标记 `upgraded` |

验证方式（不依赖浏览器）：

```bash
npm run check:pivot                    # ASCII 画图 + 6 项几何断言，六个市场逐个跑
node scripts/pivotviz.js USF ES day    # 指定市场/标的/周期
```

`pivotviz` 会打印一张文本 K 线图（`·` K 线、`/\` 笔、`=` 中枢上下沿、`░` 中枢内部），
并断言：区间有效 / 每笔与区间相交 / 延伸笔终点在内 / 离开笔终点出界 / 进入笔反向 / 相邻中枢已合并 / 段序不倒置。
六个市场（A股、美股、港股、加密、国内期货、美期货）当前全部通过。

### 商品板块页

`#sectors` 页把 **88 个期货品种按产业链分 8 组**，一屏看清某条链的全貌：

| 板块 | 品种数 | 代表 |
| --- | --- | --- |
| 有色金属 | 8 | 沪铜 / 沪铝 / 沪镍 / 国际铜 / COMEX 铜 |
| 贵金属 | 4 | 沪金 / 沪银 / 纽约金 / 纽约银 |
| 黑色系 | 10 | 螺纹 / 热卷 / 铁矿石 / 焦炭 / 焦煤 / 硅铁 / 锰硅 |
| 能源化工 | 25 | 原油 / 燃料油 / PTA / 甲醇 / 聚丙烯 / 纯碱 / 玻璃 |
| 农产品 | 25 | 豆粕 / 豆油 / 棕榈油 / 玉米 / 白糖 / 棉花 / 苹果 / 生猪 |
| 金融期货 | 8 | IF / IC / IH / IM + 2/5/10/30 年国债 |
| 外盘指数 | 5 | 标普500 / 纳指100 / 道指 / 罗素2000 / 日经225 |
| 林木轻工 | 3 | 纸浆 / 纤维板 / 胶合板 |

每个品种卡片显示**实时价与涨跌幅**，点卡片直接跳到结构分析（自动带标的），再在图上画线。
API：`GET /api/sectors`（目录）、`GET /api/sector?id=precious`（板块快照）。

### 市场覆盖（实测可用品种数）

| 市场 | 品种数 | 示例代码 | 数据源 | 周期 |
| --- | --- | --- | --- | --- |
| A股 | 全市场检索 | `600519` `300750` | 腾讯 / 东财 / 新浪 | 1m~月线 |
| 港股 | 全市场检索 | `00700` `09988` | 腾讯 / 东财 | 日/周/月 |
| 美股 | 全市场检索 | `NVDA` `AAPL` | 纳斯达克 / 新浪 / 东财 | 日/周/月 |
| 加密 | **519 个 USDT 交易对** | `BTCUSDT` `ETHUSDT` `SOLUSDT` `DOGEUSDT` … | Binance | 1m~周线 |
| **国内期货** | **68 个主力连续** | `RB0` `IF0` `AU0` `CU0` `M0` `I0` `T0` `AP0` `SC0` `JD0` … | 新浪期货 | **1m~月线** |
| **美期货** | **23 个** | `ES` `NQ` `YM` `GC` `SI` `HG` `CL` `NG` `KC` `CC` `SB` `CT` `OJ` `LE` `GF` | 新浪外盘期货 | **1m~月线**（分钟线仅当日） |

**商品搜索**：输入中文商品名直接命中多市场合约，例如

| 搜索词 | 命中 |
| --- | --- |
| 黄金 | `USF:GC`（纽约金）、`CNF:AU0`（沪金）、`USF:SI` |
| 铜 | `USF:HG`、`CNF:CU0`、`CNF:BC0`（国际铜） |
| 原油 | `USF:CL`、`CNF:SC0`、`USF:BZ`（布伦特）、`USF:QM`（迷你） |
| 国债 | `CNF:T0` `TF0` `TS0` `TL0` |
| 以太坊 / 狗狗币 | `CR:ETHUSDT` / `CR:DOGEUSDT` |

**数据可靠性措施**（都是实测踩出来的）：

1. **国内期货快照僵死**：新浪 `RB0` 实时快照返回的是 2024-07-17 的值，与 K 线（3030）差 400 点。
   现在国内期货报价统一用**日线最新收盘**重算，并在代码里注明原因。
2. **外盘残档**：`6A/6B/DX/PL/PA` 等在新浪只有 2019 年的 12–13 根残档。
   加了**新鲜度校验**（<60 根 或 最后一天 >90 天前 → 明确报错"该品种数据陈旧"），
   而不是给用户一张空图。
3. **贵金属交叉校验**：接入 [Gold-API](https://gold-api.com)（免费无 key）取 XAU/XAG 现货，
   与 `GC/SI` 期货价对比，偏离 >3% 标记 `stale`。

### 数据源可达性巡检

```bash
npm run check:sources        # 30 个渠道实测，按可用性分级
```

当前运行时（2026-10-31 实测）的结论：

**✅ 可直接用（免 key，17 个）**

| 源 | 用途 | 状态 |
| --- | --- | --- |
| 腾讯行情 / K线 | A股·港股·美股 | 已接入 |
| 新浪行情 / A股分钟 | A股·外盘期货报价 | 已接入 |
| 新浪期货日线 / **分钟线** | 国内期货 | 已接入（分钟线 v1.6 新增） |
| 外盘期货日线 / **分时** | 美期货 | 已接入（分时聚合成分钟线，**仅当日**） |
| 纳斯达克官方 | 美股日线 | 已接入 |
| Binance 行情 / K线 | 加密 | 已接入（519 交易对） |
| **Gold-API** | XAU/XAG 现货 | 已接入（期货交叉校验） |
| **Alpha Vantage** | 美股兜底 | 已接入（`ALPHAVANTAGE_KEY` 可选，无 key 用 demo） |
| 东财数据中心 | 期货持仓排名 | 备用 |
| 巨潮资讯 / 雪球 | A股公告·舆情 | 备用 |

**🔑 需 key / 账号（7 个）**：Yahoo Finance（403）、Stooq（403，且有 JS 反爬挑战，不绕过）、Finnhub、Polygon、Twelve Data、Marketstack、FMP（均 401 需 key）。

**⛔ 域名层不可达（6 个）**：

| 源 | 现象 | 说明 |
| --- | --- | --- |
| **TradingView 主站 / data / scanner** | `UND_ERR_CONNECT_TIMEOUT`，10s 超时 | **整域不可达**，无法接入 |
| 长桥 LongPort OpenAPI | `UND_ERR_CONNECT_TIMEOUT` | 需账户 + IP 白名单 |
| 东财 push2 / push2his | `UND_ERR_SOCKET` | 行情接口被reset（数据中心正常） |
| AKShare | — | Python 库而非 HTTP API，上游本就是东财/新浪 |
| IBKR API | 域名 200 但需 IB Gateway 常驻进程 + 盈透账户 | 不适合无头部署 |

> 关于 TradingView：即使域名可达，其 `scanner`/`data` 接口属于**非公开授权接口**，
> 公开接入违反其 ToS。若要图形与数据，正路是用 **TradingView Charting Library**（免费申请），
> 但这会替换掉本站自研的缠论绘图层（笔/中枢/买卖点都在 canvas 上自绘），得不偿失。

> 国内期货的快照接口常年返回几个月前的僵死数据，所以报价统一用**日线最新收盘**重算，
> 这一点在 `sources.js` 里显式注释，避免以后又被"看起来有数据"骗过去。

### 样式分层：设计 / 兼容 两份文件

```
framework7-bundle.min.css   ← 只当组件外观底座（无 F7 JS 运行时）
f7-compat.css               ← 唯一的"框架对抗层"，55 处 !important 全部集中在这里
mobile.css                  ← 本站设计，0 处 !important
```

`npm run check:css` 会解析 vendored 的 F7 CSS，找出所有**可能命中我们 DOM** 的规则，
按选择器特异性判断我们的声明是否真的能覆盖它。已确认为无害的冲突（例如 `.page-title{width:100%}`）
在脚本里带理由白名单，其余一律失败——所以"下次不小心又踩一条 F7 规则"不会再靠用户截图发现。

### 移动端体验细节

- **下拉刷新**：html 上关掉了原生下拉（防误触整页重载），改成只在顶部、单指、纵向 >12px 时才接管的自绘刷新；松手阈值 64px，带"下拉刷新 / 松手刷新 / 刷新中"三态。
- **触感反馈**：切 Tab、起卦、增删自选、toast 用 `navigator.vibrate` 轻震（不支持的设备静默跳过）。
- **无障碍**：toast 为 `role=status aria-live=polite`；`#view` 为 `role=main`；`prefers-reduced-motion` 下关闭动画。
- **返回键**：先关弹层，再回上一个 Tab，最后才是退出。

Covers inclusion-merge invariants, stroke/segment/pivot structural invariants, determinism of the full analysis, signal type validity, divergence sanity, graceful degradation on short data, ganzhi anchors (1949-10-01 甲子日, 2000-01-01 戊午日, 2024-02-10 甲辰日), solar-term counts and 立春 windows, six-line chart invariants, and casting determinism ("different symbol ⇒ different hexagram").

CI runs the same suite on Node 18/20/22: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Project layout

```
server/
  index.js            HTTP server, routes, watchlist persistence
  lib/chan.js         Chan engine (merge → fractal → stroke → segment → pivot → signal)
  lib/sources.js      market data adapters + fallback chain + cache
  lib/ganzhi.js       ganzhi calendar, solar terms (astronomical), 建除, 旬空
  lib/divination.js   Plum Blossom casting + six-line board + reading
  lib/gua-data.js     64 hexagrams, 8 palaces, Na Jia tables
web/                  desktop UI (no build step): index.html, css, js/chart.js …
web/m/                mobile UI (iOS / Android skins) + service worker
web/js/highlight.js   shared "concept → chart annotation" builder (desktop + mobile)
test/                 node:test suites
docs/                 architecture, data sources, deploy, roadmap, launch playbook
space/                Hugging Face Space (Docker SDK)
```

---

## 二次复审流程（长期规矩）

每一次功能落地都走同一条流水线，**不允许"自己测完就交付"**：

1. **作者自测**：实现 + 单测 + 把新断言写进 `scripts/check:*` 的某一层门禁（回归项必须固化成断言，不能只靠手点）。
2. **复核 agent 二次复审**：另起一个独立 agent，只读代码、只跑命令、不改仓库，按"正确性 / 边界 / 契约 / 诚实性"四类出报告，
   每条附带 `file:line`、影响、一行修法，并按 blocker / major / minor 分级。
3. **作者处置**：blocker 与 major 必须修完并补断言；有意不修的写进报告与 README 的"已知限制"。
4. **全量门禁**：`npm run check:all` 全绿才允许提交；提交信息里写清"本轮复核修了什么"。
5. **留痕**：复审报告归档在 `docs/reviews/`（本轮：`docs/reviews/drawing.md`），更新日志里记一行。

> 这条流程本身就是被前几轮"改完没验、用户截图才发现"逼出来的：
> 滚动锁死、弹层透明、算卦不换卦、切市场白屏，都是**二次复审/独立 QA** 抓到的，不是自测发现的。

## 更新日志 / History

按时间倒序。每条都标注了"怎么验证"，避免同一类问题重复踩。

| 日期 | 版本 | 内容 | 验证方式 |
| --- | --- | --- | --- |
| 2026-10-27 | v1.1 | **缓存链路重做**：服务端按 `web/` 内容算构建哈希，HTML 里的 `__ASSET_V__` 注入成 `?v=<sha10>`，CSS/JS 每次部署 URL 都变；静态资源加 ETag/304 + gzip（F7 CSS 526KB→77KB）；Service Worker 升到 v3（导航网络优先、带 `?v=` 资源不可变缓存、离线回退只对 HTML 生效、安装用 `allSettled` 不再被一次 404 卡死） | `curl -D- /m/ \| grep X-Asset-Version` 每次改样式都会变；`curl -H 'Accept-Encoding: gzip'` 看 Content-Encoding；断网刷新仍能打开外壳 |
| 2026-10-27 | v1.1 | **手机端三处"死机"根因修复**：F7 的 `html,body{height:100%}`+`overflow:hidden` 把视口锁成不可滚动；`html` 的 `overflow-y:visible` 让视口继承 body 的 overflow；`overscroll-behavior` 加在 body 上会吞掉用户滚动。另加图表手势仲裁（纵向放行页面滚动，横向才接管平移） | `npm run check:ui`（断言"内容超出屏幕却滚不动"）；滚动容器=document、手势位移 506px |
| 2026-10-27 | v1.1 | **弹层两层框架冲突**：`.view{z-index:5000}` 把页面压到弹层之上（文字叠在一起）；元素级 `button{width:100%}` 把弹层标题挤成 0 宽。同时修 toast 被 `.ios/.md .toast` 顶出屏幕、`.btn` 被 F7 的 `--f7-button-height` 裁字 | `npm run check:sheet`（48 组断言：背景/层级/零宽/超宽） |
| 2026-10-27 | v1.1 | **服务端加固**：自选池原子写（tmp+rename）、空表不再回退默认、垃圾代码被拒（先取行情校验）、60 个上限、并发重复二次校验、写接口去掉 `Access-Control-Allow-Origin:*` | `npm run check:api`（含"去重被正确拒绝"与"垃圾代码被拒"） |
| 2026-10-27 | v1.1 | **交互健壮性**：切 Tab 清掉算卦 12s 跟随定时器、异步渲染加防串页守卫、雷达轮询改原地更新（不再把手指下的行换掉）、返回键先关弹层再回上页、未捕获异常给可见提示、chart 支持 `destroy()` 修监听泄漏、滚轮默认交还页面滚动（Ctrl/⌘+滚轮才缩放） | `npm run check:flow`（17 步） |
| 2026-10-31 | v1.7 | **商品板块页**：88 个期货品种按产业链分 8 组浏览，实时价 + 涨跌幅，点卡片直达结构分析；新增 `/api/sectors`、`/api/sector`；修正路由错误码（参数类错误返回 400 而非 500） | `check:api` 新增 8 项板块断言、2 个目录单测 |
| 2026-10-31 | v1.6 | **期货分钟线**：国内（OHLCV，1/5/15/30/60分）+ 外盘（分时聚合，标注"仅当日"）；**Alpha Vantage** 接入为美股兜底源；新增 `check:sources` 数据源巡检（30 渠道分级：17 可用 / 7 需 key / 6 不可达）；确认 **TradingView 全域不可达**并留档 | `npm run check:sources`、`check:matrix` 113 项 |
| 2026-10-30 | v1.5 | **数据覆盖面大扩**：国内期货 68 个主力 + 外盘 23 个（实测筛选，剔除新浪残档品种）；加密搜索接 Binance 519 对 + 中文别名（以太坊/狗狗币…）；商品中文名（黄金/铜/原油/国债…）多市场命中；接入 Gold-API 做贵金属现货交叉校验；新增**新鲜度校验**拒绝 2019 残档；新增 `check:matrix` 108 项全链路矩阵 | `npm run check:matrix` |
| 2026-10-30 | v1.5 | **先选标的再看图**：结构分析页进入时先展示六市场热门标的 + 搜索，选定后才建图，避免"空白图无从下手"；手机端市场栏同步补期货 | Playwright 实测：选择器→图表互斥、选定后标题变 `CNF · RB0 · 日线`、画线落库 |
| 2026-10-30 | v1.4 | **中枢严格化**：补进入段/离开段、区间形成后固定、延伸按终点判定、相邻重叠中枢按缠论合并、9 段升级；绘图补进离段箭头与 GG/DD 虚线、标签避让；新增 `check:pivot` 几何校验器（六市场全绿） | `npm run check:pivot`、61 个单测 |
| 2026-10-30 | v1.4 | **接入国内期货（CNF）与美期货（USF）**：新浪期货主连日线 + 实时报价（国内用日线收盘兜底僵死快照），盘面脉冲、指数看板、搜索、自选池、结构分析、算卦、闯关题库全部接入 | `check:api` 新增 6 项（两市场×报价/K线/缠论） |
| 2026-10-28 | v1.3 | **闯关游戏二次复审闭环**：复审 agent 报 2 blocker / 10 major；已修——出题不再泄露标的代码/真实时间轴/截断点（改发匿名时间轴，否则可反查 /api/kline 抄答案）、判分改为**单次有效 attempt**（防三选一试三次、防 token 重放）、截断点在历史里随机化（108 关不再出现重复题）、评分 70 起且震荡带按历史中位振幅自适应、中枢框可重画/清空、平移不再改写选择、判分后点击不再报错、本地存档损坏自动恢复、揭示真实标的 + 笔/线段结构、结算不再留空 MACD 区 | `check:api` 新增「不可重放 / 判分有界 / 不泄身份」3 项，`check:flow` 断言揭示标的；报告归档 `docs/reviews/game.md` |
| 2026-10-28 | v1.3 | **新增「缠关 · 108」独立闯关小游戏**（`/game/`）：108 课变 108 关，题型 4 种（看走势/找买卖点/框中枢/判背驰），实时行情出题、答案不下发、服务端判分、讲解 + 星级 + 本地进度；品牌去掉"炒股"字样 | `check:flow` 6 步闯关链路、`check:api` 5 项（含不泄题/防伪造 token）、5 个引擎单测 |
| 2026-10-28 | v1.2 | **复审闭环**：独立复审 agent 报 4 blocker / 11 major / 12 minor；已修 4 个 blocker（半成品线残留、画布外松手幽灵框、图表重建导致线丢失、40 条上限丢最新的）+ 主要 major（线改按时间戳 `t` 锚定不再随 K 线漂移、请求令牌防串标的、画线时禁用平移、hline 重复加分、`extreme` 误判、文案不再夸大、NaN 净化、cap 保留最新），三项落成 flow 断言；报告归档 `docs/reviews/drawing.md` | `check:flow`（25 步，含两条 blocker 回归） |
| 2026-10-28 | v1.2 | **手绘线 + AI 复核**：趋势线（吸附笔端点）/水平线/矩形，按标的+周期存服务端；`POST /api/drawings/verify` 用确定性规则把线对齐笔·中枢·买卖点，给 0–100 一致度与逐条结论 | `npm test`（10 个校验引擎单测）、`check:api`（4 个新接口）、`check:flow`（画线→复核→落库） |
| 2026-10-28 | v1.2 | **样式分层 + 冲突自动审计**：`f7-compat.css` 成为唯一框架对抗层（`mobile.css` 的 `!important` 归零），`check:css` 对 5706 条 F7 规则里的 111 个危险属性逐条核对 | `npm run check:pivot` | 中枢几何 + ASCII 画图，六个市场逐个校验 | ✅ 全通过 |
| `npm run check:matrix` | **全链路矩阵**：13 个商品搜索词 + 6 市场 27 个品种 ×（K线/缠论/中枢字段）+ 报价 + 概览脉冲 | **108/108** |
| `npm run check:css` |
| 2026-10-28 | v1.2 | **性能预算门禁**：CDP Network 统计首屏压缩字节（手机 202KB/13 请求/FCP 0.8s），超 420KB 直接失败 | `npm run check:perf` |
| 2026-10-28 | v1.2 | **QA 六项缺陷修复**：切市场保留不兼容周期（白图+500）、`.btn.block` 不占满、自选池增删后总览不刷新、算卦切市场不换标的、切皮肤 html 类不同步、教学标注只有 7/19 种；顺带修掉潜伏的 `COL is not defined` | `check:flow` 六条新断言 |
| 2026-10-28 | v1.2 | **移动端体验**：下拉刷新（自绘，原生被 overscroll 禁用）、触感反馈（仅用户操作后）、`prefers-reduced-motion`、toast `aria-live`、返回键先关弹层 | `check:ui` / 手动截图 |
| 2026-10-27 | v1.0 | 打包下载（源码 zip + git bundle + 校验和）；下载产物改为不入库，`git filter-branch` 清掉历史里的 150MB 大包 | `/downloads/` 三个文件 + `SHA256SUMS.txt` |
| 2026-10-27 | v1.0 | 手机版接入 Framework7 8.3.3 组件层（同仓内置、零 CDN），iOS/Android 双皮肤 + 深浅双主题 | `/m/?skin=ios|android&theme=dark|light` |
| 2026-10-27 | v1.0 | 108 课索引（14 主题、仅收录可核实的课名）+ 天涯/博客言论集 | `npm test` 里的课数与主题唯一性断言 |
| 2026-10-27 | v1.0 | 形而上知识库（干支/紫微/奇门/梅花/六爻 + 14 本书目索引）、概念 1v1 教学走查 | `GET /api/metaphysics`、理论页 `?tx=` 深链 |
| 2026-10-27 | v1.0 | 天文算法农历（Meeus 新月 + 无中气置闰）、紫微斗数排盘、奇门遁甲时家简盘，全部接入择时评分与验证管线 | `npm test`（春节/中秋/闰月锚点、紫微五行局、奇门 8 门 9 星 8 神不变量） |
| 2026-10-27 | v1.0 | 择时实验室（7 法合成）、信号历史回测（命中率/盈亏比/超额）、理论语料量化 | `/api/timing`、`/api/backtest`、`/api/timing/validate` |
| 2026-10-27 | v1.0 | 竞品分析（czsc 6459★ / chan.py 2260★ / chanlun-pro 1072★ / chanvis 625★）与差异化定位 | `docs/COMPETITIVE.md` |
| 2026-10-27 | v1.0 | 发布工具链（GitHub API 发布器 + HF 脚本 + 发布指南） | `scripts/publish-github.js`、`docs/PUBLISH.md` |
| 2026-10-26 | v1.0.0 | 首版：确定性缠论引擎（包含处理→分型→笔→线段→中枢→走势→背驰→1/2/3 类买卖点）、四市场行情、桌面工作台、手机 PWA | `npm test` 42 项 |

### 已知限制（明确写在前面，不粉饰）

- 线段用"三笔成段"近似，属于简化实现；背驰用 MACD 面积比的数值阈值（段 0.92 / 笔 0.85），不是原文的递归级别证明。
- 择时验证的结论是直给的：上证 r≈-0.08、BTC r≈+0.125（61.5% 但有多重比较警告）、NVDA r≈+0.07。**没有稳定显著优势，当娱乐与观察用。**
- 108 课只标注了 50 个可核实的课名，其余按主题聚合；言论集为转述，不含原文版权内容；书目索引不含正文。

---

## Roadmap

- [x] Deterministic engine + tests
- [x] Multi-market adapters with fallback
- [x] Teaching annotations (concept → chart)
- [x] Mobile PWA with iOS / Android skins
- [x] Signal backtest (hit rate / profit factor / edge vs baseline) and the timing-method lab
- [x] 紫微斗数流日盘 + 奇门遁甲时家盘（农历排盘 → 统一打分 → 接入回测）
- [ ] English UI (i18n layer) — [help wanted](CONTRIBUTING.md)
- [ ] Python package (`pip install chanx`) wrapping the same rules with parity tests
- [ ] Publish computed structures as a Hugging Face **Dataset** (`chan-structures`) for reproducible research
- [ ] WebSocket streaming for intraday updates
- [ ] Strict feature-sequence segment implementation (gap handling) behind a flag

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/LAUNCH_PLAYBOOK.md](docs/LAUNCH_PLAYBOOK.md).

---

## Contributing

Issues, data-source adapters, translations and test cases are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the `good first issue` label.

Maintainers of quant frameworks (vectorbt, backtrader, qlib, ccxt, pandas-ta, …) who want a Chan indicator module or data adapter built on this engine: open an issue — the engine is designed to be embedded.

---

## Disclaimer

- Market data comes from third-party public endpoints and may be delayed, incomplete or unavailable. Interfaces change without notice; adapters are intentionally replaceable.
- Chan structure division has implementation-dependent variants. This project documents its own simplifications and does not claim to be the single correct reading.
- The I Ching module is traditional-culture entertainment. **Nothing in this repository is investment advice.** Trading involves substantial risk.

## License

MIT © 2026 Chan Structure Workstation contributors. See [LICENSE](LICENSE).
