# Launch playbook — from "my repo" to a project people actually use

> Honest premise first: **500+ stars is a distribution problem, not a code problem.**
> Good code is necessary but not sufficient. What gets stars is (1) a crisp problem
> statement a stranger can repeat, (2) proof it works in 30 seconds, (3) someone with
> an audience mentioning it. This document is the plan for all three.

---

## 0. Reality check

| Situation | Typical outcome |
| --- | --- |
| Push to GitHub, tweet once, wait | 0–20 stars |
| Good README + one launch post on HN/Reddit | 50–300 stars |
| Above + 2–3 niche communities + a demo Space + ongoing replies | 300–800 stars |
| Above + translation + repeated content + becoming the default answer for "how do I code 缠论?" | 1k–3k stars |

Median time from launch to a stable plate is **4–8 weeks**. Stars arrive in bursts
tied to posts, not continuously. Plan for ~6 launches, not one.

The single most common failure: the README explains *what the code does* instead of
*what the reader gets*. The current README is written for the second one — keep it
that way.

---

## 1. Positioning (pick one sentence and never change it)

**EN:** "A deterministic, dependency-free Chan-theory structure engine — turn any OHLC
series into fractals, strokes, pivots, divergence and 1st/2nd/3rd class signals, and
*see each concept annotated on the chart*."

**CN:** "零依赖的缠论结构引擎：任意 OHLC → 分型/笔/中枢/背驰/三类买卖点，并把每个概念在图上标出来。"

Why this works:

- It names a **niche with search volume** (缠论 / Chan theory) and an **unserved need**
  (open, reproducible implementations).
- It makes a **verifiable claim** ("deterministic", "dependency-free", "annotated")
  instead of an unverifiable one ("powerful", "AI-driven").
- The visual proof is immediate: a screenshot shows the exact concept on a real chart.

Secondary hooks for different audiences:

| Audience | Hook |
| --- | --- |
| Quant devs | "MIT, 22 tests, zero deps, pure functions — embed it in your backtester." |
| 缠论 learners | "Every concept has a 'where is it on this chart' answer, with real dates/prices." |
| Crypto traders | "Same engine on BTC 15m as on 日线 — multi-level resonance built in." |
| Mobile users | "Installable PWA, two native skins." |
| HF community | "Space + dataset of computed structures for reproducible research." |

**Naming advice:** `chan-structure-workstation` is descriptive but long. Register the
GitHub repo as `chan-structure` or `chanx` and keep the long name as the tagline.
Avoid `chanlun-ai` style names — "AI" without a model reads as marketing.

---

## 2. Repo checklist before any launch

Must be green before you post anywhere (all already implemented here):

- [x] English README with a hero image, one-sentence pitch, comparison table, quickstart
      that works in one command, screenshots, API table, tests section, disclaimer
- [x] Chinese README (`README.zh-CN.md`) linked from the hero
- [x] `LICENSE` (MIT) + NOTICE with a financial disclaimer
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff`
- [x] Issue templates + PR template
- [x] CI badge that is actually green (tests + smoke + docker build)
- [x] `Dockerfile` + `docker-compose.yml` + one-click Space
- [x] Tests that run **without network**
- [x] Honest "known limitations" section (reviewers trust projects that admit gaps)

GitHub settings to configure **before** announcing:

- Repository **description** (max 300 chars) — reuse the pitch sentence.
- **Topics**: `chan-theory`, `chang-lun`, `technical-analysis`, `stock-analysis`,
  `crypto`, `quantitative-finance`, `trading`, `canvas`, `pwa`, `zero-dependency`,
  `a-shares`, `hong-kong-stocks`, `us-stocks`, `iching`, `nodejs`
- **Social preview image**: `docs/assets/banner.png` (1280×640 crop)
- Enable Discussions; pin a "Show your chart" thread
- Release `v1.0.0` with notes + the banner (releases look alive to visitors)

---

## 3. Assets to produce (half a day, huge ROI)

1. **15-second GIF** — open the app → click a theory card → "annotate on chart" →
   the chart dims and draws `a+A+b`. This is *the* asset that sells the project.
   Record at 1440×900, ≤ 6 MB, put it directly under the hero (GitHub autoplays GIFs).
2. **Before/after chart image** — left: raw candles; right: same candles with strokes,
   pivots, signals. One image, no text needed.
3. **HF Space** (below) — a live demo someone can click without installing anything.
4. **Short video (60–90 s)**, narrated in Chinese, for Bilibili / 小红书 / Douyin.
5. **One-page "how it works" PNG** (the pipeline diagram from `docs/ARCHITECTURE.md`)
   for slide decks and threads.

---

## 4. Hugging Face: Space + Dataset

Hugging Face is where "ML-adjacent tooling" gets discovered — not only models.

### Space (live demo)

- Create → SDK **Docker** → blank; add `space/README.md` front-matter:

```yaml
---
title: Chan Structure Workstation
emoji: 📈
colorFrom: gray
colorTo: yellow
sdk: docker
app_port: 8931
pinned: false
license: mit
---
```

- Copy `server/`, `web/`, `data/`, `package.json`, and `space/Dockerfile` (same as root).
- Add a "Duplicate this Space" button block in the Space README — duplication is the
  strongest distribution mechanic on HF.
- Post the Space in the **#spaces** community tab and in the "Show your work" discussions.

### Dataset (this is what earns respect from researchers)

Publish `chan-structures`:

```
data/ohlc/600519.day.parquet        # raw bars
data/structures/600519.day.jsonl    # merged bars, fractals, strokes, pivots, divergence, signals
dataset_card.md                     # schema + engine version + how to reproduce
```

- License: CC-BY-4.0 for derived structures (check the upstream data terms first —
  do **not** re-publish raw vendor data if the terms forbid it; publish structure
  *labels* computed from your own fixtures instead).
- Include `engine_version` and `git_sha` columns for reproducibility — this is exactly
  what a dataset reviewer looks for.
- A dataset with a clean schema + a notebook showing "load → plot → verify" gets cited
  and starred far more reliably than another app.

---

## 5. Launch sequence (6 waves, ~2 weeks)

### Wave 0 — seed (T-7 days)

- Ship `v1.0.0`, confirm CI green, Space up.
- Post in your own socials once (soft launch) to catch broken links.
- Prepare the 6 texts below and the GIF; do not improvise during launch.

### Wave 1 — Hacker News (T-0, Tuesday–Thursday, 14:00–16:00 UTC)

Title format that works: **`Show HN: <what it is> – <the surprising property>`**

> **Show HN: Chan theory structure engine – dependency-free, deterministic, annotated**
>
> Chan theory (缠论) is a popular price-structure method in Chinese markets that has
> almost no open, reproducible implementations. I extracted the rules into ~900 lines
> of dependency-free JS: inclusion merging → fractals → strokes → segments → pivots →
> divergence → 1st/2nd/3rd class buy/sell points.
>
> Two things make it different from "another indicator":
> 1. It's deterministic and unit-tested (22 tests, `node --test`, no network).
> 2. Every concept can be highlighted on the chart with the real dates, prices and
>    MACD areas that produced it — so you can *check* the engine instead of trusting it.
>
> Demo (Space): <link>. Repo: <link>. MIT. Feedback on the segment-division
> approximation especially welcome — that's where implementations disagree.

HN rules to respect: don't ask for upvotes, reply to every substantive comment within
the first 3 hours, never argue about finance, keep it technical.

### Wave 2 — Reddit (T+1)

- **r/algotrading** — post the *engine* angle, not the UI: "I needed structured,
  testable primitives for price structure; here's the pivot/divergence layer." Read
  their self-promo rules first; include the open-source nature in the title.
- **r/quant** — dataset/HF angle: "publishing computed Chan structures as a dataset
  for reproducible research" (link the dataset, not only the app).
- **r/DayTrading / r/CryptoCurrency** — only after the above two; lead with the mobile
  PWA + the demo, not the code.
- Avoid r/wallstreetbets and anything that smells like signals-for-profit.

### Wave 3 — X/Twitter thread (T+2)

```
1/ Chan theory (缠论) has thousands of Chinese tutorials and almost no open,
   reproducible implementation. So I wrote one — 900 lines, zero dependencies.

2/ Pipeline: inclusion merge → fractal → stroke → segment → pivot → divergence
   → 1B/2B/3B. All pure functions, all tested.

3/ The part I'm most happy with: "annotate a concept on the chart".
   Pick "a+A+b" → the chart dims everything else and draws the entry leg, the
   pivot (ZG/ZD) and the exit leg, with the MACD area ratio that decides divergence.

[GIF]

4/ It runs on A-shares, HK, US and crypto via free adapters with fallback chains —
   zero paid keys.

5/ Mobile is an installable PWA with two skins (iOS/Android), because that's how
   most people actually look at charts.

6/ MIT, demo Space, docs on architecture + data sources. If you maintain a quant
   framework and want a Chan module, the engine is designed to be embedded.
```

Attach the GIF to tweet 3 — media drives the retweet rate.

### Wave 4 — Chinese communities (T+3 … T+5)

- **V2EX** (`/go/create`), **掘金**, **少数派**, **雪球** (article, not promo), **知乎**
  (answer existing "如何用代码实现缠论" questions rather than posting a new link),
  **Bilibili** (5–8 min demo + code walk-through), **小红书** (screenshots + 3-line
  story; the mobile UI is the hook there).
- Chinese copy (adjust per platform):

> **标题：** 我把缠论写成了 900 行零依赖代码，还给每个概念做了"图上标注"
>
> 缠论教程满天飞，但能跑、能复现、能验证的开源实现几乎没有。我把规则拆成
> 包含处理 → 分型 → 笔 → 线段 → 中枢 → 背驰 → 三类买卖点，纯函数、22 个单测、
> 零依赖（Node 标准库）。最实用的是"概念 → 图上标注"：点一下 a+A+b，图会压暗其余部分，
> 只画进入段、中枢上下沿、离开段，并给出 a/b 的 MACD 面积比来判定背驰。
>
> 支持 A股/港股/美股/加密，免费数据源多级降级；手机可装成 App（iOS/Android 两套皮肤）。
> MIT，欢迎拿去嵌进回测框架。

### Wave 5 — long tail (week 2+)

- PR to **awesome lists** (`awesome-quant`, `awesome-technical-analysis`,
  `awesome-crypto-tools`, `awesome-nodejs`): one line, alphabetical order, no adjectives.
- `dev.to` / Hashnode / Medium: "How I implemented Chan theory's pivot detection
  (with tests)" — engineering article, repo link at the end.
- `lobste.rs` (tags: `programming`, `finance`) if you have a plausible account.
- Answer Stack Overflow / GitHub Discussions questions mentioning Chan theory, linking
  the docs (not the repo root) — helpful, not spammy.
- Cold-email/DM 3–5 quant bloggers or YouTubers who cover Chinese market structure;
  offer a 20-minute walkthrough, not a retweet.

---

## 6. Path to "core contributor of a known framework"

Stars are one axis; credibility is another. The realistic route into a mainstream
framework from here:

1. **Pick one** (do not spread): `vectorbt` (Python, indicators), `backtrader`
   (strategies/indicators), `qlib` (features/datasets), `ccxt` (exchange adapters),
   `pandas-ta` (indicator library).
2. **Contribute small, high-value things first**: a failing-test fix, a docs example,
   a data adapter, a performance improvement. Aim for 3 merged PRs before proposing
   anything big — that is what "trusted drive-by" looks like.
3. **Propose the module**: "Chan structure primitives as a first-class indicator —
   fractals, strokes, pivots, divergence, 1B/2B/3B, plus a reference fixture dataset."
   Attach the tests, the API, and a benchmark. Reference this repo as the reference
   implementation.
4. **Offer to maintain it**: reviewers are volunteers; a ready maintainer is often the
   deciding factor. Commit to a version-support window.
5. **Ship parity tests**: your module's outputs must match fixtures generated by this
   engine, so reviewers can diff instead of debate.

Realistic timeline: 2–4 months of occasional contributions for a merged feature;
6–12 months to be listed as a maintainer. The fastest credibility comes from the
Python port (roadmap v1.2) — a second implementation in another language with parity
tests is exactly what framework maintainers want to see.

---

## 7. What to measure (and what not to)

Track weekly in a simple table:

| Metric | Where | Why |
| --- | --- | --- |
| Stars (delta) | GitHub | vanity, but correlates with discovery |
| **Referrers** | Insights → Traffic | tells you which channel to repeat |
| Clones / unique visitors | Insights → Traffic | code adoption, not just clicks |
| Space visitors / duplicates | HF | demo conversion |
| Issues opened (quality) | GitHub | real users; a bug report with a chart is worth 50 stars |
| Time-to-first-response | yourself | < 24h during launch week |

Ignore: forks without PRs, star spikes with no clones, "awesome" list adds alone.

Target milestones: **100 stars in week 1** (doable with HN front page),
**300 by week 4** (Chinese communities), **500+ by week 8** (long tail + dataset +
parity/py port). If week 1 lands under 30, the message is wrong, not the code — rewrite
the hero section and retry with a different hook (e.g. lead with the dataset instead).

---

## 8. Compliance & credibility guardrails

- Never promise returns, never post "signals", never market it as a trading bot.
  Every launch copy keeps the "not investment advice" line one sentence long.
- Do not publish raw vendor data as a dataset; publish *structures/labels* you computed
  from your own fixtures, with a clear provenance column.
- Respect the free endpoints: the adapters cache and back off. A repo that hammers
  providers gets blocked and gets a bad reputation.
- Keep the "known limitations" and "documented simplifications" sections. Reviewers
  trust a project that states where it is approximate, and it preempts the harshest
  comments.

---

## 9. 8-week calendar (copy into your issue tracker)

| Week | Action |
| --- | --- |
| 0 | Repo polish, CI green, GIF, Space, dataset draft, release v1.0.0 |
| 1 | Show HN + Reddit r/algotrading + X thread; reply loop |
| 2 | Chinese wave (V2EX/知乎/B站/小红书); awesome-list PRs |
| 3 | Engineering article; Reddit r/quant with dataset; fix reported issues |
| 4 | v1.1 (English UI + docs EN) release; second HN attempt with the dataset angle |
| 5 | Python port kickoff (`chanx`), publish parity fixtures |
| 6 | HF dataset v0.1 + notebook; post in HF discussions |
| 7 | Framework PR #1 (vectorbt or pandas-ta); write about the diff |
| 8 | Retrospective post: "what I learned shipping a 500-star niche tool"; plan v2 |

---

## 10. One-line summaries to reuse everywhere

- **EN:** "Chan theory in 900 dependency-free lines — deterministic, tested, and
  annotated on the chart."
- **CN:** "900 行零依赖，把缠论拆成可验证的代码，并把每个概念标在图上。"
- **HF:** "Interactive Space + reproducibility dataset for Chan-theory price structure."
- **GitHub description:** "Deterministic Chan-theory structure engine (fractals,
  strokes, pivots, divergence, 1B/2B/3B) + multi-market workstation. Zero dependencies."
