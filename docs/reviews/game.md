# 缠关 · 108 — Second-pass review

**Reviewer scope:** read + executed, no repo files modified (report only).
**Build reviewed:** `4d25584` + the uncommitted working-tree changes present at 02:30 UTC
(`server/lib/game.js` +13, `web/game/game.js` +6, `web/js/chart.js` +1 — the
`revealedStructure` reveal and a time-label clamp). The tree was edited *while* this
review was running; every finding below was re-verified against the current working
tree (all browser/API probes ran at ≥02:40, after those edits). Line numbers are the
current ones.

**How it was verified (not just read):**
- `curl` against `http://127.0.0.1:8931` — every grading path, error path, edge input.
- A 108-level sweep replicating `computeAnswer` in-process (real kline sources, same
  `analyze` calls) → `/tmp/sweep.json`; 3 levels cross-checked against the live API.
- Headless Chromium via the flowcheck CDP pattern (360×640 + 390×844 mobile, 1280
  desktop): map, level, pick, rect-drag, submit, result, replay, corrupt storage,
  all-108 state, screenshots in `/tmp/gameshots/`.
- Answer derivation exploited end-to-end from public endpoints (see B1).
- `node --test test/game.test.js` → 5/5; `node scripts/flowcheck.js` → 32/32
  (including the 5 闯关 assertions — which is itself a finding, see m16).

Severity = blocker (ships broken / core premise false) · major (users hit it and lose
trust or learning value) · minor (polish, robustness, accessibility).

---

## BLOCKERS

### B1. The answer is one public request away (60/108 levels: all `predict`)
`server/lib/game.js:157-158` (level returns `market`, `code`, `cutoff`),
`web/game/game.js:144` (client even prints "US · META · 日线 · 数据源 nasdaq · 隐藏了后 12 根"),
`server/index.js:531-537` (`/api/kline` is open, no auth, no per-session scoping).

Evidence: took level 1 (`US/META`, `cutoff 308`, `hidden 12`), fetched
`/api/kline?market=US&code=META&period=day&limit=600`, aligned the 308 visible bars
(0 mismatches), computed the hidden 12 bars → `ret = -13.70%` → `down`, POSTed it →
`{"score":92,"stars":3}`. The whole "predict" mechanic (60 of 108 levels) is
solvable without looking at a chart — and a human can do it by hand: the game tells
you the symbol and the period, and the *same app* serves that symbol's full chart
(one click on the workstation, or the `/api/kline` URL).

Why it matters: the file header claims "答案绝不下发给客户端", and `apicheck`'s
"闯关不泄题" gate only greps the level payload for `"dir"`/`revealedBars`
(`scripts/apicheck.js:83`) — true but irrelevant. The secret is not in the payload,
it is in the neighbouring endpoint.
Fix (one line of design, not code): grade on a *historical* window that is inside the
already-public history and pick the cutoff from history (e.g. `bars.length - hidden - k`,
`k` random per run) so the "future" is decades old — or stop returning `code`/`cutoff`
before grading and grade by an opaque level id.

### B2. Grading is stateless: unlimited replays, so every mechanic is brute-forceable
`server/lib/game.js:124-126` (`tokenFor` binds only `no|market|code|cutoff` — no
attempt id, no nonce, no counter), `server/lib/game.js:189-194` (token is the only
check), `server/index.js:687-696` (no rate limit, no attempt tracking),
`web/game/game.js:253-259` ("再来一次" re-opens the same level → same token, and the
previous answer is already on screen).

Evidence:
- Same token, 5 submissions: `up`→8, `flat`→40, `down`→92, `down`→92, `garbage`→8.
  All `200`. No attempt counter anywhere. 3-option `predict` ⇒ a script gets 3 stars
  in ≤3 tries; 2-option `beichi` ⇒ ≤2 tries.
- `signal`: 306 sequential POSTs scanning `idx = 0…305` on level 53 (no 429, no slow
  down); on level 56 `idx 299/300/301` all returned **100** (tolerance ±1).
- In the real UI, "再来一次" produced `token 37eb3aed…` twice and the correct answer
  was already visible in the previous result card → a 0-point player re-answers for
  100 and `prog.streak`/`best` inflate (`web/game/game.js:224-226`).

Why it matters: with B1 this makes the leaderboard-free game a "press the right
button" toy; even without B1, 3 tries beat any reasoning.
Fix: mint a one-shot `attempt` id at level time (server-side, short TTL) and consume
it on the first POST; reject repeats (`400 '这一关已经交过卷了'`). If replays are
wanted for learning, mark them `practice:true` and never let them raise score/stars/
streak.

---

## MAJORS

### M1. The answer marker never renders (chart highlight is a no-op)
`web/js/chart.js:681` — `drawHighlight` returns early unless `hl.bands` is a non-empty
array, so `marks` can never draw on their own; `web/js/chart.js:760-762` — marks read
`m.bar` / `m.price`, but the game passes `{idx, type}` (`web/game/game.js:192` pick,
`:239` reveal).
Evidence: in-page standalone `ChanChart`, `setData(level.visibleBars)` →
`toDataURL()` before/after `setHighlight({marks:[{idx,type}]})` → byte-identical
(`marks_idx_noop:true`); `ctx.arc` was never called with any coordinate; even the
"correct" field names don't draw while `bands` is absent.
Why it matters: the player gets **no visual confirmation of the tapped bar** (only the
text "已选第 N 根") and the review chart **does not show where the buy/sell point was**
— the single most important teaching moment of the `signal` mechanic (28 levels).
Fix: guard `bands` and `marks` separately in `drawHighlight`, and send
`{bar: idx, price: bars[idx].c, text: '你的选择'}` from the game.

### M2. Pivot reveal draws a vertical strip, ignoring the price range
`web/js/chart.js:696-728` uses only `b.from`/`b.to` (full panel height); the game
sends `zg`/`zd` (`web/game/game.js:240`), which are dropped.
Evidence: `bands:[{from,to,zg:1e9,zd:-1e9}]` and `bands:[{from,to}]` produce an
identical canvas (`bands_zgzd_ignored:true`); the result screenshot shows a full-height
gold band for a 中枢 that is 750.47–807.49.
Why it matters: a 中枢 is a *price×time* box; showing time only teaches the wrong shape,
and the explanation text ("价格 750.47~807.49") contradicts the picture.
Fix: when a band carries `zg`/`zd`, fill/stroke that rectangle instead of the full panel.

### M3. `pivot` levels: both buttons are dead, and a mis-drawn box cannot be redone
`web/game/game.js:174` creates `#rectBtn` ("拖框选中中枢") and `#clearBtn` ("清空");
neither has a listener anywhere in the file. `chart.js:860` auto-exits draw mode after
a commit (`setDrawMode('none')`).
Evidence (360×640): after a drag, `cursor:""/"default"`, note "已框选：确认后交卷";
clicking 清空 → note unchanged, submit still enabled, rect still counted; clicking
拖框 → cursor stays `default`, `#rectBtn` still looks active (`tool on`). The player
cannot clear or re-draw — only "返回地图" and start the level over.
Why it matters: 14 levels; the mechanic is `drag a box`, and the box is one-shot.
Fix: `#rectBtn` → `chart.setDrawMode('rect')`; `#clearBtn` → `chart.clearDrawings()`;
keep the button's visual state in sync inside `onDraws`.

### M4. `signal` levels: the instruction contradicts the answer, and 3 levels have none
`server/lib/game.js:223-233` (`target = ans.lastSignal` = the last signal anywhere in
the 300-bar window), `web/game/game.js:170` ("点最近的 K 线"), default view = last 150
bars (`chart.js:184`).
Evidence (sweep of 28 signal levels): target distance from the right edge is
`4,4,4,14,21,21,25,29,29,33,36,36,36,40,40,41,41,50,50,116,116,154,158,197,232` bars.
→ 4 levels (70, 84, 104, 106) put the answer **outside the initial 150-bar view**; level
84's answer is **232 bars** back, i.e. invisible until you pan, and a player who follows
"点最近的一根" literally gets 0. → 3 levels (53, 88, 107) have **no** signal and award a
flat **40** for *any* answer, including `{idx:-5}`, `{idx:1e9}`, `{idx:"abc"}`.
Why it matters: 25/28 are guess-the-bar at 1.57 px/bar on a 360 px screen (measured),
7/28 are literally unwinnable-or-free by following the text.
Fix: constrain the target to the visible window (`i1 >= cutoff-150`), reword to
"点出最近的那个买卖点（在可见区间内）", and replace the no-signal case with a different
question (e.g. "这一段有没有标准买卖点？有/没有") instead of a free 40.

### M5. Panning the chart overwrites the pick
`web/game/game.js:196` — the pick handler is on `pointerdown` with no movement
threshold, while the chart's own pan/zoom handles `touchstart/touchmove`
(`chart.js:965-1030`) and its `pointerdown` path already consumed the gesture.
Evidence: dispatched a real horizontal swipe (CDP `Input.dispatchTouchEvent`) on a
signal level; the selection changed from `第 300 根` to `第 205 根`. On levels whose
answer is off-view the player *must* pan — every pan silently re-picks.
Why it matters: it converts the hardest mechanic into a trap.
Fix: record the down position, act on `pointerup` only if the pointer moved <6 px.

### M6. Tapping the chart after grading throws
`web/game/game.js:193` writes `$('#pickInfo').textContent` unconditionally; after
submit, `:212` replaces `#answerArea`, so the node is gone.
Evidence: after the result card rendered, one tap on the canvas →
`EXC TypeError: Cannot set properties of null (setting 'textContent')` (also the only
page error captured on an otherwise clean run).
Fix: `pickMode = false` in `doSubmit` (and null-guard the lookup).

### M7. Corrupt / legacy `localStorage` ⇒ blank page, no message, no recovery
`web/game/game.js:25-28` — `load()` only guarantees "something truthy", no shape check;
`stats()` then throws on `prog.levels`; `renderHome()` is `async` and is *not awaited*
at `:273`, so the `catch` at `:274` cannot see its rejection.
Evidence (four stored shapes): `"oops"`, `5`, `[]`, `{"levels":null}` → `#app` empty,
`document.body.innerText` = 42 chars (header+footer only), i.e. a blank screen; 4×
`EXC TypeError: Cannot convert undefined or null to object`. `null` and
`{"levels":{"1":{"score":"x"}}}` render fine.
Why it matters: any schema bump or partial write bricks the page for a returning player
with nothing to click.
Fix: validate the parsed shape in `load()` (object + `levels` object + per-entry
numeric `score/stars`), and `await renderHome()` (or `.catch`) so failures show
"进度数据损坏 — 清空重来" with a reset button.

### M8. 108 levels, 28 charts: 35 levels are exact duplicates, and the answers are skewed
`server/lib/game.js:24-29` (28 symbols), `:88-97` (symbol+hidden are pure functions of
`no`), `:116` (answer from that one window).
Evidence (sweep): 28 distinct `market:code` for 108 levels; 28 groups share
`symbol+hidden` — **35 levels are a byte-identical chart** to another level
(`1/8`, `10/12/17`, `22/26`, `32/33`, `89/90`, …), 13 of those groups even share the
mechanic (so the same question twice). Outcome skew over the 60 `predict` levels:
**down 35 (58%), flat 12, up 13** → "always tap 看跌" yields a 2–3 star answer on more
than half of them without any analysis.
Why it matters: the "108 关" promise is really "28 charts, some repeated"; and the
mode answer is a coin the player can call without reading the chart.
Fix: enumerate (symbol, cutoff, mechanic) so each level has a unique window (random
historical offsets are free), and balance/ignore-when-degenerate so no single answer
dominates.

### M9. The 108-lesson premise is nominal for more than half the levels
`server/lib/game.js:71-84` (title falls back to `${chapter} · 第 N 关`),
`server/lib/chan-lessons.js` (only 50/108 lessons carry a verified title, 24 carry a
gist — documented in `COVERAGE`), `server/lib/game.js:39-54` (mechanic is assigned per
*chapter*, not per lesson).
Evidence: 58/108 levels show a generated title — the UI h2 reads
"第 84 关 · 综合与答疑 · 第 84 关" (prefix + generated title repeat); 84/108 levels have
no 本关要点 at all; chapter sizes are 1/9/7/2/6/7/1/7/5/9/9/6/17/22 and level numbers
inside a chapter are non-contiguous (ch2 = 62-82, ch14 = 1-32), while the rank bands are
level-number bands — so "青铜 1-27" is mostly the 早期股市闲谈 杂文 chapter, and an essay
like lesson 1 ("不会赢钱的经济人，只是废人") becomes a "guess the next 12 bars" challenge.
Why it matters: the product claim is "the 108 lessons become challenges"; the link is a
title lookup for half of them and a chapter-level mechanic for all of them.
Fix: label unverified lessons honestly ("索引课 · 无标题"), gate 本关要点 out of the result
card when empty, and map mechanics from lesson content (or at least from `confirmed`).

### M10. Scoring: a correct-but-small call is capped at 1 star, `flat` is a trap but a safe hedge
`server/lib/game.js:208-218` (correct = `62 + min(30, |ret|/0.06*30)`, `agree +8`,
wrong-but-flat = **40**, wrong = 8), `:116` (flat band ±1.5% over the hidden window).
Evidence: level 4 correct `flat` (`ret +0.53%`) → **65 / 1 star** (2 stars need 70);
level 5 → 63/1★; level 62 correct `up` (+1.63%, signal agrees) → 78/2★; wrong `flat` on a
-18.79% level → **40**; wrong `up` on the same → 8. Measured hidden-window |ret| over the
60 predict levels: min 0.21%, p10 0.70%, median 3.94%, p90 18.79%, max 23.62%; only
**12/60** land inside ±1.5%. By market: A-share median 5.70%, US 7.59%, HK 7.69%,
**crypto 2.69%** — so the band is defensible-ish for crypto and much too tight for
A/HK/US.
Why it matters: the reward curve says "being right about a quiet 20 days is worth as
much as a 1-star miss", and the 40-point hedge means tapping 震荡 is never worse than
half-right — while being the least likely truth.
Fix: make the band volatility-relative (e.g. `|ret| < 0.5·ATR20·√n`) per rank, and floor
a correct answer at 70 so "correct" always reads as 2+ stars.

---

## MINOR

1. **Empty MACD panel wastes 24% of the result chart.** `web/game/game.js:231` sets
   `macd:true`, but `full` carries no `macd` series, so `chart.js:496` falls back to empty
   arrays while `chart.js:208` still reserves `0.24·H` — verified visually: a blank strip
   labelled `MACD(12,26,` under the candles. Fix: `macd:false`, or return `macd` from
   `revealedStructure`.
2. **"新纪录" is always shown on the first attempt**, even for 8 points.
   `web/game/game.js:222-223`: `prev` defaults to `{score:0}` → `8 > 0`. Fix: require
   `Object.prototype.hasOwnProperty.call(prog.levels, res.no)`.
3. **After grading, 交卷 becomes a disabled blue primary button** ("已判分") —
   `web/game/game.js:210-211` + `.btn.primary`; reads like the next step. Fix: hide it,
   or restyle to neutral.
4. **HMAC secret defaults to a repo literal.** `server/lib/game.js:20`
   (`'chan-game-2026'`); recomputed the server's token offline from that default
   (exact match). Impact today is low (a forged token buys nothing beyond the real one),
   but the "防伪造" gate is decorative. Fix: fail closed when `GAME_SECRET` is unset.
5. **`answer.idx` is not validated.** `server/lib/game.js:229-232`: `Number("abc")` →
   `NaN` → `score:NaN` → **`"score":null`** in the response (verdict still
   "偏得比较远"), and the explanation reads "你点在第 undefined 根". Fix:
   `Number.isFinite` guard before the distance.
6. **Every mismatch is reported as staleness.** `server/lib/game.js:193-194` returns
   "这道题的数据已过期（行情刷新了）" for a wrong `no` (999), a missing token and a
   stale token alike. Also, each bad POST still performs a full kline fetch + chan
   analysis before rejecting. Fix: separate "no/invalid" from "expired"; validate `no`
   first.
7. **Token expiry is a dead end for the player.** With a genuinely stale token (next
   day's bar, or a new bar at the open), `doSubmit`'s catch (`web/game/game.js:214-218`)
   only toasts; 交卷 is re-enabled and will fail forever, the chart still shows the old
   data. Verified the server side (`400`), read the client path. Fix: on that error,
   offer "重新出题" / auto-reload the level.
8. **The hidden window can contain the *unclosed* bar.** A/HK sources return
   `limit+1` bars (measured: 321 vs 320 for US/CR) and their last bar is today's
   in-progress candle (A 600519 last bar = 2026-10-28 while the US market was closed;
   CR BTCUSDT likewise) → the hidden window's final bar keeps moving, `cutoff` does not,
   so the **token stays valid while the answer can drift intraday**. `ret` is then taken
   against an unfinished candle. Fix: build the future window from closed bars only
   (`bars.filter(b => b.closed)` / drop the last bar while the session is open).
9. **Data-drift mechanics are otherwise sound** (answering Q3): `fetchBars` requires
   ≥120 bars and throws "行情样本不足，暂时开不了这一关" (`game.js:100-101`) — surfaced to
   the player by `openLevel`'s catch (`web/game/game.js:124-126`); `cutoff = len - hidden`
   is always ≥ ~100 so "no future bars" cannot happen; every POOL symbol has long
   history. The 320-bar request is honoured (320/321), and 108/108 levels fetched with
   0 errors in the sweep.
10. **Progress semantics overstate completion.** A 0-point submission is stored and
    counts as "已通关" and unlocks the next level (`web/game/game.js:224`);
    `unlockedMax = max(done)+1` (`:55`) unlocks gaps (seeded progress {1,7} → levels 1-8
    all unlocked, verified); with all 108 done the UI still says
    "继续第 108 关 →" / "下一关 108" and shows no completion state (`:37`).
11. **`streak` is written but never shown** (`web/game/game.js:225-226`; no 连胜 anywhere
    in the rendered page — verified with `streak:9, best:12` seeded), and there is no
    "reset progress" affordance. Also `prog.best` is dead data.
12. **Locked levels give no feedback at all.** `.lv` buttons carry `disabled`
    (`web/game/game.js:95`), so the click that shows `toast('先把前面的关卡打通')`
    (`:106`) never fires — verified: tapping a locked level changes nothing.
13. **Chart instance leaks global listeners.** `chart.destroy()` (`chart.js:67-71`)
    removes only the `resize` handler; `bind()` registers `window` `mouseup`
    (`:823`) and `window` `pointerup` (`:933`) per instance. Measured: 3 chart
    instances (each destroyed) left **6** extra window listeners; the game creates one
    per level open, so repeated play accumulates handlers.
14. **Accessibility.** The canvas has no `role`/`aria-label` (the chart is the whole
    question); `signal`/`pivot` (42/108 levels) are pointer-only with no keyboard path;
    the viewport pins `maximum-scale=1` (`web/game/index.html:5`) and the canvas sets
    `touch-action:pan-y`, so you cannot zoom in on a 1.57 px/bar chart; there are no
    `:focus-visible` styles at all (`web/game/game.css`). Good parts: every control is a
    real `<button>`, 0 clickable divs, the icon button has `aria-label`, level buttons
    have `title`. Fix: `aria-label` per level ("第 53 关 · 找买卖点 · 未通关"), allow
    zoom, add focus rings, and give `signal`/`pivot` a numeric/keyboard fallback.
15. **360 px layout nits.** The fixed footer squeezes "返回工作站" onto two lines and
    breaks the disclaimer mid-word (screenshot `/tmp/gameshots/a-home-360.png`); footer
    height 54 px vs 56 px body padding is 2 px of clearance. `.chapter header` has
    `cursor:pointer` (`game.css:54`) but is not clickable — a false affordance.
16. **The shipped gates cannot catch B1/B2/M1.** `apicheck`'s leak check is a payload
    string grep (`scripts/apicheck.js:83`), and `flowcheck` accepts any score
    (`scripts/flowcheck.js:362`: `Number(score) >= 0`), while tapping `.opt[0]` → 8 分
    still passes. `flowcheck` is 32/32 green on this build. Suggested additions: a second
    POST with the same token must 4xx; a `/api/kline`-derived answer must *not* be
    implied by the game API (or the game must pick a historical window); assert the
    canvas actually changes after a pick (`toDataURL` diff); assert a locked level gives
    visible feedback.
17. **Branding/honesty checks (all good, for the record):** `<title>缠关 · 108 关</title>`,
    h1 "缠关 · 108", no "炒股工作站" on the page (only the footer link "返回工作站"), and
    the footer carries "学习与娱乐用途，不构成投资建议". "实时行情" holds as *latest data*
    (A/HK/CR bars reach today, US the last close) but it is a daily + in-progress bar,
    and the "prediction" is about 12–20 bars that already happened — consider "最新日线".

---

## Verified working

- 108 levels / 14 chapters / 4 ranks / 4 mechanics render on the map; rank bands
  1-27/28-54/55-81/82-108 correct; hidden bars 12/14/16/20 = 27 levels each.
- `GET /api/game/map|level` and `POST /api/game/answer` all behave for valid input;
  5/5 unit tests, 5/5 apicheck game checks, 32/32 flowcheck (incl. the 5 闯关 ones).
- The **level payload itself carries no answer**: fields are exactly
  `ok,no,rank,rankName,mechanic,theme,title,gist,market,code,name,period,source,
  visibleBars,hidden,token,cutoff,question` — no `dir`/`ret`/`revealedBars`/structure.
  The token is an HMAC over non-secret inputs, so it leaks nothing about the answer,
  and it cannot be replayed across levels (`no` is in the MAC).
- Scores are clamped to 0–100 (`game.js:280-281`) and are monotonic in accuracy for
  all four mechanics; no nonsense input reaches a high score by itself (`idx:"abc"`,
  `box:{x1:"a"}`, `answer:null/true/1` all → 0/NaN-null, never 100).
- Pivot IoU math is sound: `min/max` normalisation makes `x1>x2`/`y1>y2` score
  identically to the correct box (verified: reversed → 100), degenerate/zero-area and
  NaN boxes fall to 0 via `union > 0 ? … : 0` (`game.js:247-254`), and a full-chart box
  is punished (0). Measured: exact box → 100; x±5 with the exact price band → 83;
  exact x with a loose y (700–850) → 59; x±10 with a wide y range → 29.
- `beichi` heuristic: `area = |Δp|·Δbars`, "yes" needs area < 80% *and* |Δp| < 90% of
  the previous same-direction bi (`game.js:266-267`). It is a defensible simplification
  and the "no" explanation says so explicitly ("按简化判据") — but the "yes" branch does
  not disclose it, and the inline comment at `:260` wrongly claims MACD-area
  ("以最后一笔与前一同向笔的 MACD 面积比判断") when no MACD is used. 6 levels total
  (24 YES, 43 YES, others no).
- Chart reuse is basically correct: `period` forwarded, `setData(..., {keepView:false})`
  resets the view to the revealed window, `destroy()` clears `data` and the resize
  listener, and `revealedStructure` (added at 02:30) now really draws 笔/线段
  (measured `bis:4, segs:1` in `setData`), so the result chart finally explains the
  structure — only the answer *mark* is still missing (M1).
- 360×640: no horizontal overflow (`scrollWidth == clientWidth == 360`); result card
  (379 px) clears the fixed footer; desktop clamps at 720 px. Options/交卷 require a
  scroll on a 640-high screen but remain reachable.
- Progress storage works for normal/absent/multi-level/all-108 states; `平均分`/`星星`/
  `已通关` numbers check out (seeded 100+50 → 75 avg, 4 stars).
- Keyboard: 6 focusables in the empty state, all real buttons, Enter activates
  `#goNext`; no console errors on the happy path.

## Not covered / caveats
- Live-session behaviour could only be observed through the server (no direct egress
  from this shell); the intraday-bar claim (m8) is inferred from the data itself
  (last bar timestamp = today on A/HK/CR while the US bar is the last close).
- Touch was exercised through CDP touch emulation, not a physical device.
- The working tree changed during the review (`revealedStructure` landing). Anything
  about the reveal chart reflects the current tree; if more edits land, re-run the
  probes in `/tmp/gamedrive.js`, `/tmp/gamedrive2.js`, `/tmp/sweep.js`.
