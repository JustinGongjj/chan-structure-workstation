# Mobile web stack review — chanlun-station

Review only; no files were modified. Line refs are `file:line`. The vendored
`web/vendor/f7/framework7-bundle.min.css` is 19 lines (minified); F7 rule refs cite the
rule text plus its line.

## TL;DR — the reported symptoms have one likely chain

`mobile.css` failing to apply (or applying an OLD copy) leaves Framework7's bare-element
reset in charge, and that reset alone reproduces **all four** symptoms:

| Symptom | Cause when `mobile.css` is stale/missing |
|---|---|
| sheet title 1 char/line | F7 `button{-webkit-appearance:none;appearance:none;width:100%}` (line 17) → `.sheet-close` claims 100 % of the `.sheet-head` flex row; the old CSS had no `button{width:auto}` (`mobile.css:75`) |
| transparent bottom sheet | `.sheet{background:var(--panel)}` (`mobile.css:257`) — F7 has **no** `.sheet` class, and `--panel` only exists in `mobile.css:12-41` |
| page content over sheet | `.sheet-mask{position:fixed;z-index:60;display:none}` (`:251-256`) is 100 % ours; F7 has no `.sheet-mask` |
| "server serves fixed CSS but phone is old" | see Q1 — nothing ever forces the phone to re-fetch or reload |

So: the CSS is not being *replaced* on the phone. Nothing in the stack guarantees it, and
several paths actively keep the old bytes.

---

# 1. Cache invalidation

Every path by which a phone runs stale HTML/CSS/JS:

**1.1 [blocker] The SPA is never reloaded, so a deployed change can never reach a running page.**
`go()` uses `history.replaceState` only (`mobile.js:69`); there is no `location.reload()`, no
`navigator.serviceWorker.oncontrollerchange` handler (`mobile.js:966-968` registers and stops),
and `html{overscroll-behavior-y:none}` (`mobile.css:64`) disables pull-to-refresh — the one
escape hatch a phone user has. A tab/PWA resumed from bfcache keeps the old HTML+CSS+JS for
days.
*Fix:* add `navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())`
(guarded by a once-flag) **and** a boot check `fetch('/api/health').then(r=>r.headers.get('x-build'))`
compared against a `BUILD` constant → `location.reload()` on mismatch.

**1.2 [blocker] The SW fetch fallback returns `/m/` (HTML) for CSS/JS requests.**
`sw.js:44` — `.catch(() => caches.match(req).then(r => r || caches.match('/m/')))`. A single
failed fetch of `/m/css/mobile.css` resolves the CSS request with the HTML document →
"Refused to apply style… MIME type ('text/html')" → unstyled page → the symptom table above.
Same for `/js/*.js` → dead app. Persists until a successful re-fetch.
*Fix:* only fall back to `/m/` when `req.mode === 'navigate'`; otherwise `return Response.error()`
(or a `new Response('', {status:504})`).

**1.3 [blocker] `install` is all-or-nothing and `addAll` failure pins the old SW forever.**
`sw.js:16-18` — `caches.open(VER).then(c => c.addAll(CORE))`; `addAll` rejects if **any** of the
10 URLs 404s or the network blips once. The install rejects, the previously active SW (and its
cache) stays in control indefinitely, and there is no retry guard. If that resident SW is an
older cache-first build, it keeps serving old assets forever — exactly "server serves fixed CSS,
phone shows old layout".
*Fix:* `await Promise.allSettled(CORE.map(u => c.add(new Request(u,{cache:'reload'}))))`, never
reject the install, log the failures.

**1.4 [major] No versioned asset URLs anywhere.** `index.html:16-17` (both stylesheets) and
`:79-84` (5 scripts) are bare paths; no `?v=`, no build hash, no `sw.js?v=`. `server/index.js:376`
sends `no-cache` (revalidate) with **no `ETag`/`Last-Modified`** → no 304 is possible, so every
layer between phone and origin (carrier proxy, corporate proxy, SW cache) can hand back old bytes
with no way to bust it.
*Fix:* at startup read+hash the 7 mobile assets into an in-memory map, string-replace
`href="/m/css/mobile.css"` → `…?v=<sha8>` while serving the HTML, and serve hashed URLs with
`Cache-Control: public, max-age=31536000, immutable`; HTML gets `no-store`.

**1.5 [major] `skipWaiting()` + `clients.claim()` with no reload → guaranteed mixed state.**
`sw.js:17,22` activate the new SW immediately while the page keeps the old CSS/JS. User sees
half-new UI until they manually reload.
*Fix:* drop `skipWaiting()`, register a waiting-worker prompt, and reload on `controllerchange` (1.1).

**1.6 [major] The SW cache key includes the query string → unbounded, inconsistent cache.**
`sw.js:41` `c.put(req, …)` keys on the full URL; `mobile.js:69` writes `?tab=…&skin=…` on every tab
switch, so `/m/?tab=overview`, `/m/?tab=radar`, … each get their own cached HTML copy, while the
`/m/` fallback (`sw.js:44`) only ever matches the bare `/m/` key — a *different, older* generation.
`caches.match` has no `ignoreSearch` (`sw.js:44`).
*Fix:* `c.put(new Request(url.origin + url.pathname), …)` (strip the search), and `caches.match(req, {ignoreSearch:true})`.

**1.7 [major] `VER = 'chan-m-v2'` is a hard-coded constant.** (`sw.js:2`) The cache name never
changes, so `activate` (`sw.js:20-24`) never deletes anything on a real deploy; entries for URLs
dropped from `CORE` live forever, and a poisoned entry survives.
*Fix:* `const VER = 'chan-m-' + self.__BUILD__` where `__BUILD__` is injected (or derive from the
`CORE` manifest hash).

**1.8 [major] `res.ok` is checked for caching but the response is returned regardless.**
`sw.js:41,54` — a 500/404 HTML error page served at a `.css`/`.js` URL (server restarting,
`server/index.js:370` 404 text/plain) is handed to the page. CSS/JS parse failure → broken layout.
*Fix:* on `!res.ok` for a `CODE` request, serve the cached copy instead of the error body.

**1.9 [minor] Cached-but-never-read entries.** `CORE` (`sw.js:3-14`) precaches `/js/api.js`,
`/js/ui.js`, `/js/chart.js`, `/js/highlight.js`, `/js/theory-content.js` — those are outside the
SW's `/m/` *scope* (they are still intercepted because the controller sees all subresource
requests, so this is only wasted quota, not a break).

**1.10 [minor] UA redirect is a cacheable 302 with no `Vary`.** `server/index.js:357` —
`res.writeHead(302,{Location:'/m/'})` with no `Cache-Control`/`Vary: User-Agent`. Proxies/browsers
may replay it for the wrong UA, or cache a non-redirect.
*Fix:* `res.writeHead(302,{Location:'/m/','Cache-Control':'no-store','Vary':'User-Agent'})`.

**1.11 [minor] PNG/SVG/ICO are cache-first + `max-age=300`.** `sw.js:49-60`,
`server/index.js:376` → icons can lag 5 min after a rebrand.

**1.12 [minor] No compression / no `Vary: Accept-Encoding`.** `server/index.js:374-378` —
`framework7-bundle.min.css` is **526 KB** and served raw with `no-cache` on every navigation
(≈ no 304s), i.e. half a megabyte per page load on mobile data.
*Fix:* pre-gzip the file once at startup and serve with `Content-Encoding: gzip`, or (better) drop
the F7 stylesheet entirely and inline the ~15 rules actually needed (see §2).

---

# 2. Cascade / collision audit

Your selectors were searched in `framework7-bundle.min.css`. Rules that **collide**:

### 2.1 Class collisions

| Ours | F7 rule (line) | Neutralised? | Property at risk |
|---|---|---|---|
| `.toast` `mobile.css:318` | `.toast{…position:absolute;z-index:20000;opacity:0}` + **`.ios .toast{transition-duration:.3s;width:100%;left:0}`** / `.md .toast{…width:calc(100% - 16px);…left:8px}` (line 17) | **NO** — `.ios .toast` is (0,2,0) vs our `.toast` (0,1,0) | **`left` + `width`** → toast is pinned to the left edge *and* shifted `-50%` by our `transform` → renders half off-screen. Every toast in the app ("已添加", "删除失败", "请输入代码") is mispositioned. `[blocker]` |
| `.btn.button` (all of them) | `.button{…height:var(--f7-button-height);line-height:calc(var(--f7-button-height) - 0);overflow:hidden;padding:…}` (line 17) | **NO** — our `.btn` (`:196-204`) never declares `height`/`line-height` | **`height` = 28 px (iOS) / 40 px (MD)**, `line-height` = 28 px, `overflow:hidden`; with our `padding:10px 16px` the content box is 6 px → **"起卦/添加/恢复默认/强制刷新" text is vertically clipped**. Only `.segmented .button` got `height:auto!important` (`:185`). `[blocker]` |
| `.chip` `:163` | `.chip{…margin:2px 0;height:var(--f7-chip-height)=28px/32px;line-height:<same>;border-radius:…}` (line 17) | **NO** | **`height`/`line-height` (28/32 px)** + `margin`. Our 10.5 px chips are forced 28 px tall — visibly the wrong control size. `[major]` |
| `.badge` `:160` | `.badge{…height:var(--f7-badge-size)=20px;min-width:20px;border-radius:20px}` (line 17) | **partial** (we set font-size/padding/radius only) | **`height` + `min-width` = 20 px** → buy/sell badges become 20 px pills. `[minor]` |
| `.page-title` `:102` | `.page-title{position:relative;z-index:10;line-height:1.2;padding-left:calc(16px + safe-area);padding-right:…;padding-top/bottom:6-8px;width:100%;overflow:hidden}` (line 17) | **NO** | **`padding-left` = 16 px** (asymmetric: `padding-right` is invalid-at-computed-value because `--f7-page-title-padding-right` is undefined), `line-height:1.2`, `z-index:10`. `[minor]` |
| `.list` `:151` | `.list{position:relative;z-index:1;font-size:var(--f7-list-font-size)=17px/16px;margin:35px 0}` (line 17) | **partial** (we set `z-index:auto`, `margin`, bg, border, radius — no `font-size`) | **`font-size` 17 px** leaks into every unstyled node inside `.list`; `position:relative` leaks. `[minor]` |
| `.card` `:112` | `.card{background:…;position:relative;border-radius;color;margin-*}` (line 17) | **partial** | `position:relative` leaks (new containing block / latent stacking trap under the z-60 sheet). Also `.card .list{margin:0}` (0,2,0) silently beats our `.list{margin:0 0 12px}` (0,1,0) — latent. `[minor]` |
| `.segmented` / `.seg` `:169,183` | `.segmented{align-self:center;flex-wrap:nowrap;border-radius;box-shadow:var(--f7-button-box-shadow)}`; `.segmented .button{width:100%;flex-shrink:1;**min-width:0**;border-radius:0}`; `.segmented .button:not(.button-outline):first-child{border-left:none}` (line 17) | **partial** — `box-shadow` is safe (`--f7-button-box-shadow` is undefined → initial `none`), width is killed by `!important`, but **`min-width:0` leaks** | **`min-width:0`** + our `white-space:nowrap` → seg labels can be squeezed and clipped with ellipsis (worst on `#sPeriod`, 6 items + `#sMarket`, 5 items). `[minor]` |
| `.input` `:205` | `.input{position:relative}`; `.md .input:after{content:'';position:absolute;…height:1px;bottom:0;left:0;width:100%}` (line 17) | effectively yes | `position:relative` on a replaced `<input>` is inert, and `::after` does not render on `<input>`. Harmless **today**, but the `.md .input:after` bar appears the moment anyone switches to F7's `<div class="input"><input></div>` wrapper. `[minor]` |
| `.view` / `#view` `:180` | `.view,.views{position:relative;height:100%;z-index:5000;overflow:hidden}` (line 17) | **YES** — fully neutralised by `main.view,#view{…!important}` | — ✅ |
| `.tabbar` `:236` | `.views>.tabbar{z-index:5001}`, `.tabbar .link{…}` (line 17) | n/a | our `.tabbar` children are `.tab`, not `.link`; `.views` ancestor absent. ✅ |
| `.tab` `:244` | `.tabs .tab{display:none}` (line 17) | n/a | requires a `.tabs` ancestor we never use. ✅ |

### 2.2 Element-selector collisions

| Ours | F7 rule | Verdict |
|---|---|---|
| `*{margin:0}` `:58` | **`p{margin:1em 0}`** (line 13) | **F7 WINS** — a universal selector (0,0,0) loses to an element selector (0,0,1). Every `<p>` (`.md-sec p`, the 卦象解读 narrative `mobile.js:711`, `mobile.css:306`) gets a 14 px top margin. `[minor]` |
| `button` `:75` | `button{-webkit-appearance:none;appearance:none;width:100%}` (line 17) | ours wins **by source order only** (both 0,0,1). This is a single-rule-deep defence — see §3.1 of the mechanism table. Also `-webkit-appearance:none` leaks (harmless). |
| `html,body` `:61` | `body{position:relative;height:100%;width:100%}` / `html{position:relative;height:100%}` (line 17) | **YES**, via `!important`. ✅ |
| `body` `:67-73` | `body{background:#fff;overflow:hidden;overflow-y:scroll;scrollbar-width:none;…}` (line 17) | overflow yes (`!important`); **`scrollbar-width:none` and `body::-webkit-scrollbar{display:none}` leak** — no scrollbar affordance anywhere (on desktop preview the page has no visible scrollbar at all). `[minor]` |
| `html` `:64` | `html{overscroll-behavior:none}` (line 17) | equivalent (F7's shorthand also kills `-x`, which ours leaves). ✅ but see §3. |
| `a` `:76` | `a{cursor:pointer;text-decoration:none;color:var(--f7-theme-color)}` (line 17) | ours wins on `color`/`text-decoration`; `cursor:pointer` leaks (harmless). ✅ |
| `.section-head h3`, `.concept h4`, `.sheet-head h3` | the only F7 `h1-h4` selectors are `.block>hN:first-child` and `.block>hN:last-child` (line 17) | no collision (no `.block` ancestor). ✅ |
| `.yao` (`table/th/td/tr`), `.teach-steps`/`.md-steps` (`ol/li`) | F7 has **no** bare `table/th/td/tr/ul/li/ol/h1-h6/canvas` rules | no collision. ✅ |

### 2.3 Collisions *inside* our own file (the "fight F7" block backfires)

**2.3.1 [major] `!important` in the F7-override block (`:183-192`) kills the skin-specific
segment styling below it.** `.segmented .button{background:transparent!important;color:var(--muted)!important}`
(`:184`) and `.segmented .button.active{background:var(--panel)!important;color:var(--text)!important}`
(`:186`) are `!important`, so `[data-skin="ios"] .seg .sq.active{color:var(--accent)}` (`:174`) and
`[data-skin="android"] .seg .sq.active{background:var(--accent);color:var(--accent-ink)}` (`:175`)
can never apply → the Android gold pill and the iOS accent segment are dead code.
*Fix:* delete the blanket `!important` from `:184-192` and give `.seg .sq.active` the specificity it needs
(`.seg.segmented .sq.active`), keeping `!important` only on `width`.

**2.3.2 [minor]** `.card.button,.btn.button{display:inline-flex;…}` (`:193`) is dead
(F7 `.button{display:flex}` + our `.btn` sharing specificity, and `.card.button` is never used).

**2.3.3 [minor] Robustness:** the entire anti-F7 layer keys off class names that F7 owns
(`.button`, `.chip`, `.badge`, `.card`, `.list`, `.toast`, `.input`, `.segmented`, `.page-title`).
The cheapest structural fix is to stop loading 526 KB of F7 for ~15 reset rules: replace
`index.html:16` with a ~40-line `vendor/f7/reset-lite.css` containing only
`button{width:auto}`, `p{margin:0}`, `html,body{height:auto}` (i.e. what §2.2 shows is all you use).

---

# 3. Scroll / gesture correctness

**3.1 [major] The bottom sheet does not lock the page, because `html` is the scroller.**
`openSheet` sets `document.body.style.overflow='hidden'` (`mobile.js:722`) and `closeSheet`
restores it (`:732`). Since `mobile.css:64` made `html` the scroll container and `body` is
`overflow-y:visible` (`:67`), setting body overflow is a no-op → the page behind the mask still
scrolls under the finger, and the sheet's own `overflow-y:auto` (`:258`) fights the page for the
swipe.
*Fix:* toggle a class on `<html>` (`html{overflow:hidden}`), or `document.documentElement.style.overflow='hidden'`.

**3.2 [major] Nested horizontal scrollers can swallow a vertical swipe (scroll latching).**
`.hscroll{overflow-x:auto}` (`:139`), `.seg{overflow-x:auto}` (`:169`),
`.theory-tabs{overflow-x:auto}` (`:294`). Per spec the cross axis computes to `auto`, so each is a
2-D scroll container; the horizontal ones sit exactly where the thumb rests (index strip under the
page title, period/market segmented controls above the chart). A diagonal swipe latches to the
inner scroller and the page does not move; there is no `touch-action` hint and no
`overscroll-behavior` on them.
*Fix:* `touch-action:pan-x` on `.hscroll`/`.theory-tabs` and `.seg` (they are horizontal-only by
design); keep chaining to the page.

**3.3 [minor] `.sheet` momentum.** `:258` — no `-webkit-overflow-scrolling:touch` and no
`overscroll-behavior` on `.sheet` (the latter would be correct here: `overscroll-behavior:contain`
on the sheet stops the chained page scroll of 3.1 as well).

**3.4 [minor] iOS rubber-band.** `overscroll-behavior` on `html` is ignored by iOS Safari < 16;
the workaround is a `position:fixed` body lock while a sheet is open (3.1).

**3.5 [minor] Direction arbitration — it is mostly right, but the reset is incomplete.**
`chart.js:648-657`: `dy>8 && dy>dx` → release (returns, no `preventDefault`) ✅;
`dx>6 && dx>=dy` → lock horizontal ✅. Remaining defects:

- **`touchcancel` does not clear the pending hover timer** (`chart.js:689-693` vs `:683-687`):
  `this._touchTimer` survives the cancel and fires `hover=-1`/`draw()` 1.4 s later on a chart the
  user may have left. `[minor]`
- **`touchend` ignores `e.touches.length`** (`chart.js:681`): lifting one finger of a pinch nukes
  `touchState`, so the remaining finger is inert until it lifts and re-touches. `[minor]`
- **Finger-count change mid-pan freezes the gesture** (`chart.js:657` then `:669`): `preventDefault()`
  is called before the branch test; if a second finger lands, `e.touches.length===1` is false and
  neither the pinch nor the pan branch runs → page and chart both dead until all fingers lift. `[minor]`
- **`preventDefault()` is called on a possibly non-cancelable event** (`chart.js:657`): once the
  browser has started a native scroll, `e.cancelable===false`; the call is a silent no-op (a
  console violation) and the chart still pans while the page scrolls. Guard with `if (e.cancelable)`. `[minor]`
- **`wheel` unconditionally `preventDefault()`s** (`chart.js:697-699`): on the desktop build (this
  file is shared) you cannot scroll the page past the chart; on a Bluetooth mouse on Android too.
  Fix: only `preventDefault` when `e.ctrlKey` (pinch) or after an explicit zoom gesture. `[major]` for desktop.

**3.6 [minor] Fixed bars.** `.appbar` z-40, `.tabbar` z-40, `.sheet-mask` z-60, `.toast` z-80 are
consistent, but `.page-title{z-index:10}` (from F7, §2.1) puts page titles in a stacking context;
harmless today, a trap if a future overlay is given z < 10.

---

# 4. Live-refresh correctness (`mobile.js:913-944`)

**4.1 [blocker] The poll destroys chart zoom/pan whenever a teaching highlight is active.**
`applyTeach` (`:439`) calls `state.chart.setHighlight(spec)` **without** `{keepView:true}`, and
`setHighlight` (`chart.js:459-465`) rewrites `this.view` to the highlight range unless
`opts.keepView` — so every `tickN % 2` structure poll (20 s) snaps the chart back and pitches away
the user's pan/zoom. The `keepView:true` at `:931` for `setData` is undone two lines later.
*Fix:* `setHighlight(spec, {keepView:true})` in `applyTeach` (only reset the view on an explicit
chip tap).

**4.2 [major] Overlapping polls can paint out of order.** The interval callback is `async` and has
no in-flight guard or sequence token (`:919-938`); the radar/`chan` scans routinely take >10 s, so
tick *n* can resolve after tick *n+1* and repaint older data. `setLive(false)` (`:916`) clears the
interval but not in-flight fetches.
*Fix:* `if (state.polling) return; state.polling = true;` … `finally { state.polling = false }`,
plus a `const seq = ++state.seq` check before painting.

**4.3 [major] The radar poll rewrites the whole list and reorders it under the user's finger.**
`paintRadar` (`:257-280`) → `box.innerHTML = …` (rows re-sorted by score, `:225`). Scroll position
is preserved numerically but content height/rows change, and a tap that was aimed at row 3 can land
on a different symbol — on a trading app. `#rList` also loses any partial state.
*Fix:* patch rows in place keyed by `market:code` (like `patchOverview`), skip reordering while the
tab is focused, and cap the poll to `document.visibilityState === 'visible'`.

**4.4 [major] The 12 s divination timer survives tab changes and then throws every tick.**
`d.timer` (`:604`) is only cleared by the 跟随 toggle (`:601`). After leaving the tab, `castDiv` →
`paintDiv` runs `$('#dResult').innerHTML = …` (`:676`) → `null` → `TypeError` every 12 s forever,
plus a network request every 12 s. `castDiv`'s own `finally` guards `#dCast` (`:646`), `paintDiv` does not.
*Fix:* `clearInterval(state.div.timer)` at the top of `go()` (`:65`), and `const box=$('#dResult'); if(!box) return;` in `paintDiv`.

**4.5 [major] No cancellation between `go()` renders → a slow response paints over a newer tab.**
`go()` (`:64-84`) is `async`; `view.innerHTML` is written both immediately (`:70` skeleton) and after
the awaits. Tap 总览 → 雷达 quickly, and overview's two sequential awaits (`:88-89`) finish after
`renderDivination`'s synchronous paint → the wrong tab's DOM is shown; unguarded writes then throw
(`renderStructure:358`, `paintDiv:676`, `renderRadar` catch `:253`) or get swallowed by
`go()`'s catch (`:79-83`).
*Fix:* `const token = ++state.renderToken;` at the top of `go()`, and `if (token !== state.renderToken) return;`
after every `await` inside each `render*`; use `AbortController` in `api.js`.

**4.6 [minor] A long-open sheet freezes the poll without pausing it.** The `.sheet-mask.show`
early-return (`:922`) happens *after* `state.tickN++`, so the `%2`/`%3` cadences drift while a sheet
is open; and `catch(e){}` (`:938`) hides every failure, so a permanently failing poll looks like a
frozen timestamp.
*Fix:* skip the increment too; surface the last-error in `#ovStamp`.

**4.7 [minor] The radar tab forces `nocache=1` on every poll and every open** (`:249`, `:935`):
a full uncached multi-market scan every 10-30 s per device — upstream rate limits and battery.
*Fix:* use the server's 30 s cache (`nocache` only on an explicit pull-to-refresh).

**4.8 [minor]** `patchOverview` (`:189-221`) is the one thing done right (text-node patching);
the same pattern should be used for `#sSignals`/`#teachBox` instead of `innerHTML` replacement
(`:400-421`, `:440-443`), which discards any text selection and forces a full re-layout every 20 s.

---

# 5. Watchlist CRUD

**5.1 [major] `watchlist.json` is written non-atomically → total loss on crash/power-cut.**
`server/index.js:98` `fs.writeFileSync(WL_FILE, JSON.stringify(WL,null,2))`. A truncated file makes
`loadWatchlist` (`:88-91`) swallow the parse error and silently load
**defaults** — the user's whole list is gone with no warning.
*Fix:* write `WL_FILE+'.tmp'` then `fs.renameSync`; keep the previous file as `.bak`; log and 500 on failure.

**5.2 [major] `saveWatchlist` failure is invisible to the client.** `:99-101` logs and continues;
the POST still returns `{ok:true, added}` (`:554`) → the UI toasts "已添加" for data that was never
persisted.
*Fix:* make `saveWatchlist` throw and let the handler return 500.

**5.3 [major] Delete-everything silently reverts to defaults on restart.**
`normalizeWatchlist` (`:81-82`) returns `defaultWatchlist()` when the total across all four markets
is 0. The empty file is saved fine, then the next boot resurrects the defaults.
*Fix:* distinguish "file missing/corrupt" (→ defaults) from "valid but empty" (→ keep empty).

**5.4 [major] The 60-item cap is enforced on load but not on insert → silent truncation.**
`normalizeWatchlist:78` caps at 60 per market keeping the *first* 60; POST (`:552`) pushes without a
cap. Add #61..#100 look fine until restart, then vanish.
*Fix:* reject with `'该市场自选已达 60 个上限'` before push.

**5.5 [major] Duplicate rejection has a real race.** `:542` checks `wl[market].some(...)`, then
`:546` `await S.quotes(...)` yields to the event loop, then `:552` pushes. Two concurrent POSTs (two
taps, two devices, phone + desktop) both pass the check → duplicate entry + duplicate
`saveWatchlist`.
*Fix:* resolve the name first, then check-and-push synchronously in the same tick.

**5.6 [major] Garbage codes are accepted; only empty and duplicate are rejected.**
`S.normCode` (`server/lib/sources.js:31-45`) is permissive: `A`+`'ZZZ'` → `'ZZZ'`, `HK`+`'XYZ'` →
`'XYZ'`, `CR`+anything → anything. The POST only checks `!code.trim()` (`:539`). The junk then
poisons `/api/overview` and every `nocache` radar scan (a permanently erroring row + wasted upstream
calls), and `normalizeWatchlist` keeps it across restarts.
*Fix:* validate per market (`A`: `^\d{6}$|^(sh|sz|bj)\d{6}$`; `HK`: `^\d{1,5}$`; `US`: `^[A-Z.\-]{1,6}$`;
`CR`: `^[A-Z0-9]{2,12}(USDT|USDC|BTC|ETH|BUSD)?$`) and 400 on mismatch.

**5.7 [minor] DELETE accepts both query and body — but lies.** `:557-566` reads
`u.searchParams.get('market') || dbody.market` (both work; the client, `web/js/api.js:22-38`, does
both: it mirrors every param into the query **and** the JSON body). Problems: `market` is not
validated against the 4 markets (`:562` → `wl['XX']` undefined → no-op), a non-existent code returns
`{ok:true, removed:{…}}` (`:563-565`) and the UI toasts "已删除".
*Fix:* validate market; return 404/`ok:false` when nothing was removed.

**5.8 [minor] `GET /api/watchlist/reset` falls into the generic GET branch** (`:528` only matches
POST, `:568` lets GET through) and returns a list without `defaults` — harmless but sloppy.

**5.9 [major, security] Write endpoints are CORS-open with no auth.** `sendJSON:347` sets
`Access-Control-Allow-Origin: *` on every response including the watchlist mutations, and the
preflight at `:520-522` allows `*` headers → any web page the user visits can
`POST http://<host>:8931/api/watchlist/reset` and wipe the list (and read it back).
*Fix:* restrict ACAO to the app origin (or drop it for `/api/watchlist*`), and require a
same-origin `Origin`/`Sec-Fetch-Site` check.

**5.10 [minor] Client CRUD UX.** `openWatchlist`'s `render()` re-opens the whole sheet after every
add/delete (`:776-843`, `openSheet` called at `:785`), which resets the sheet's scroll position and
blows away whatever the user had typed in `#wCode` — adding two codes in a row needs a re-tap.
`confirm()` at `:830` blocks and shows the URL bar in an iOS standalone PWA.
*Fix:* after a mutation, re-render only the list container and keep the input value + focus.

**5.11 [minor] `loadWatchlist` caches in-process** (`:86-87`), so an external edit or a second
server instance is invisible until restart; two instances = last-writer-wins on the same file.

---

# 6. Other things that bite a real phone user

**6.1 [major] The back button leaves the app.** `go()` uses `history.replaceState` (`:69`), so no
history entry is ever created, and there is no `popstate`/`hashchange` listener in `boot()`
(`:947-969`) — the `#${tab}` fragment written at `:69` is never read back. Android back / iOS edge
swipe exits the PWA; back also cannot close a sheet. `?skin=`/`?theme=`/`?sheet=`/`?hl=`/`?desktop=1`
are dropped by the rewritten URL at `:69`.
*Fix:* `history.pushState` per tab + `window.addEventListener('popstate', () => go(location.hash.slice(1) || qp.get('tab')))`,
and push a state when opening a sheet so back closes it.

**6.2 [major] Chart objects leak; every resize listener is permanent.**
`chart.js:55` `window.addEventListener('resize', () => this.draw())` with no teardown, and
`renderStructure` constructs a **new** `ChanChart` on every market/period/highlight tap
(`mobile.js:354`) without destroying the old one. After N taps, a single resize/orientation change
runs N `draw()` calls into detached canvases and keeps N canvas+data graphs alive.
*Fix:* store the handler and `removeEventListener` in a `destroy()`; call it before
`state.chart = new ChanChart(...)`.

**6.3 [major] The divination interval is the other unbounded leak** — see 4.4 (12 s forever, plus
an uncaught rejection per tick).

**6.4 [minor] Safe-area: left/right insets are ignored.** `--safe-t`/`--safe-b` exist
(`mobile.css:7-8`) but landscape notch insets (`env(safe-area-inset-left/right)`) are not applied to
`.appbar`/`.tabbar`/`.sheet`/`body` → content slides under the notch in landscape. No
`user-select:none`/`-webkit-touch-callout:none` on the bars either → long-press on a tab raises the
iOS selection callout.

**6.5 [minor] iOS 100vh is avoided** (no `height:100vh` anywhere; the F7 `html/body{height:100%}` is
neutralised at `mobile.css:61` ✅). `.chart-wrap{height:46vh}` (`:218`) and `.sheet{max-height:86vh}`
(`:258`) do shift when the Safari toolbar collapses — expected, `resize` redraws, but on iOS `vh`
means the *large* viewport, so `86vh` can exceed the visible area by the toolbar height.

**6.6 [minor] Manifest / PWA icons.** `web/manifest.webmanifest` is correct in shape
(`start_url`/`scope`/`id` = `/m/`, `display_override`, shortcuts, `apple-touch-icon` present and
referenced at `index.html:14`). Gaps: `icon-512.png` is declared **both** `"any"` and `"maskable"` —
the same artwork cannot satisfy a maskable safe zone → Android crops it; no `"screenshots"` (richer
install UI); no `apple-touch-startup-image` → white flash on standalone launch. `theme-color` is set
in JS (`:34-35`) but there is no `media`-qualified pair, so the OS chrome can lag the theme toggle.

**6.7 [minor] No resilience for a JS failure.** `#view` is empty in `index.html` (`:51`) and nothing
listens to `window.onerror`; one uncaught exception during `boot()` leaves an empty page with a
working chrome. Add a `window.addEventListener('error'|'unhandledrejection')` → render a retry card.

**6.8 [minor] "强制刷新" (`mobile.js:866-873`) is the only escape hatch and it is buried** in the
more-sheet, requires a user who already knows to look there, and unregisters the SW *and* deletes
all caches (including the offline copy). Surface it as an automatic recovery: if
`fetch('/api/health')` fails or the build hash mismatches (§1.1), prompt/reload automatically.

**6.9 [minor] `web/js/ui.js` also defines `toast()` (`ui.js:55-60`, 2.2 s) duplicating
`mobile.js:43-49` (2.0 s) — both write `#toast`; harmless but confusing. `U.theme`/`U.stamp` are
desktop-only dead weight in the mobile bundle (`index.html:81`).

---

# Priority summary

**Blockers (fix first)**
1. `sw.js:44` — stop answering CSS/JS requests with `/m/` HTML (root cause of unstyled/transparent-sheet layout).
2. `sw.js:16-18` — make `install` non-fatal (`allSettled` + `cache:'reload'`), or the old SW is pinned forever.
3. `mobile.js:69` + no `controllerchange` — nothing ever reloads the page after a deploy.
4. Add build-hash query strings server-side + `immutable` for hashed URLs, `no-store` for HTML (`server/index.js:376`, `index.html:16-17,79-84`).
5. `mobile.css:318` `.toast` vs `.ios .toast`/`.md .toast` — toast renders off-screen left (`.ios .toast{left:0;width:100%}`).
6. `mobile.css:196` — declare `height:auto;line-height:normal` on `.btn`/`.button` so F7's 28/40 px `--f7-button-height` cannot clip every primary button.
7. `mobile.js:439` — `setHighlight(spec,{keepView:true})`, else the 20 s poll destroys chart zoom/pan.

**Majors**
8. `mobile.js:722,732` — sheet does not lock page scroll (lock `<html>`, not `body`).
9. `mobile.js:604`/`676` — divination timer never cleared → uncaught TypeError + 12 s network churn off-tab.
10. `mobile.js:64-84` — no render token/abort → overlapping polls and rapid tab taps paint out of order.
11. `mobile.js:257` — radar poll rewrites/reorders the list under the user's finger.
12. `chart.js:697` — unconditional `wheel` `preventDefault` kills page scroll on desktop.
13. `server/index.js:98` — atomic write (`tmp` + `rename`) for `watchlist.json`.
14. `server/index.js:81` — delete-all silently reverts to defaults on restart.
15. `server/index.js:552` — enforce the 60/market cap on insert (currently silently truncated later).
16. `server/index.js:542-552` — move the duplicate check after the `await` (insert race).
17. `server/index.js:539` — validate codes per market (garbage is accepted today).
18. `server/index.js:347` — CORS `*` on watchlist writes = cross-origin wipe.
19. `chart.js:55` + `mobile.js:354` — destroy the previous chart on re-render (resize-listener leak).
20. `mobile.js:947-969` — back button/hash routing not wired (`pushState` + `popstate`).
21. `mobile.css:139,169,294` — nested horizontal scrollers latch vertical swipes; add `touch-action:pan-x`.
22. `mobile.css:184-192` — the `!important` block nullifies the skin-specific active-segment styling (`:174-175`).

**Minors**
23. `mobile.css:163` `.chip` — F7 forces `height`/`line-height` 28/32 px.
24. `mobile.css:160` `.badge` — F7 forces `height`/`min-width` 20 px.
25. `mobile.css:102` `.page-title` — F7 adds 16 px `padding-left`, `line-height:1.2`, `z-index:10`.
26. `mobile.css:151` `.list` — F7 leaks `font-size:17px` and `position:relative`; `.card .list{margin:0}`.
27. `mobile.css:58` — `p{margin:1em 0}` (F7 line 13) beats `*{margin:0}`.
28. `mobile.css:183` `.segmented .button{min-width:0}` can clip long seg labels.
29. `chart.js:681/689/657` — `touchend` ignores `touches.length`, `touchcancel` leaks `_touchTimer`, finger-count change mid-gesture freezes, `preventDefault` on non-cancelable events.
30. `server/index.js:357` — 302 without `no-store`/`Vary: User-Agent`.
31. `server/index.js:374` — 526 KB F7 CSS served uncompressed and revalidated every load.
32. `mobile.css:7-8` — no landscape safe-area left/right insets; no `user-select:none` on bars.
33. `manifest.webmanifest` — `icon-512.png` reused as `maskable`; no screenshots/startup image.
34. `mobile.js:966` — no `error`/`unhandledrejection` handler; a boot exception leaves a blank `#view`.
35. `mobile.js:776-843` — watchlist sheet re-render loses the typed code and its scroll position.
36. `server/index.js:563` — DELETE of a non-existent code answers `ok:true`.
