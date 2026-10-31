# 缠论工作站 · 第二次严格复审报告

- 复审对象：`/home/node/default/chanlun-station`（只读，未改动仓库任何文件；只写了 `/tmp` 下的临时脚本与截图）
- 时间线：复审开始时 HEAD = `2721ed7`，前两批目标提交为 `af3d720`（数据层）与 `1ee28c1 / 167a93b / 3aa7fa9`（中枢严格化 + 期货市场 + 标的选择器）；复审进行到一半时又落了 `ee172dd`（商品板块）、`2721ed7`（移动端板块），**并在 22:38 落了修复提交 `a72c026`（作者明确写着按本次复核的 BLOCKER 修的）**，随后 `5aaa222`（docs）。
- 因此本文分三段：**§零 = 一审结论（针对 `af3d720`/`1ee28c1` 这一代代码，问题真实存在且已复现）**；**§一 = 二审：`a72c026` 修复后我重新逐条实测的结果**（哪些真修好了、哪些只修一半、哪些引入新问题）；**§二 = 修复后仍存在的问题清单**（这才是当前代码的待办）。§三 为原问题核对表，§四 为已验证清单，§五 为复现脚本。

---

## 零、一审结论（针对 `af3d720 / 1ee28c1 / 167a93b / 3aa7fa9` 这一代代码）

> 下面这些问题在修复前的 HEAD（`2721ed7`/`ee172dd`）上全部实测复现；`a72c026` 之后的状态见 §一。
> **一句话结论：中枢算法"看起来严格了"，但实际画出来的中枢系统性偏窄，合并分支里还引入了 count/t1/区间三处新的不一致；游戏"框中枢"直接用这个区间判分，错误会直接变成扣分。**

> **修复状态总览（`a72c026` 之后，复核于 `5aaa222`）：** BLOCKER 4 条 → 3 条已修、1 条部分修（flowcheck 25/32 → 27/32）；MAJOR 7 条 → 4 条已修、3 条仍在（离开段语义矛盾、框中枢判分偏严、默认入口看不到图）；MINOR 多数仍待处理（单字搜索、PA/6A/6S/ZL 死引用、标签避让、90 天新鲜度阈值、文案）。详见 §一。

### [BLOCKER]（✅ 已修复 `a72c026`）中枢"扩展合并"把两个真实中枢合成一个更窄的交集，原始最大中枢被吞掉
- 位置：`server/lib/chan.js:354-388`（修复前）（判据 `overlapRatio >= 0.3` + `gapSegments <= 3` → 合并，区间取 `[max(zd), min(zg)]`）
- 为什么是问题：
  1. **区间取交集必然变窄。** 两个中枢的 ZD/ZG 合并后是交集，那就意味着两个子中枢各自"外侧"的那部分价格永远不在新区间里。而合并后区间里只剩 **3 段**（`count=3`），三段内段根本不可能覆盖两个子中枢。
  2. 缠论里"中枢扩展"要有**第三类买卖点没出现**这个前提（即中间那个离开段又重新回到了原中枢区间内），代码只看了"重叠比例 + 段间距"，没有这个条件。
  3. 实测在 600519 日线上 **9 个中枢有 3 个是合并出来的，其中 2 个落成 `count=3`**；所有活跃样本合计 65 个中枢，合并出来 58 个，绝大多数合并成了 3 段小中枢。
- 实测证据：
  ```
  cd /tmp/rv && node merge5.js
  pts 33.3,22.14,11,19.52,11.83,16.52,13.19,21.11,13.05,14.12,17.26
    raw   [{"startBi":1,"endBi":5,"zg":19.52,"zd":11.83},{"startBi":6,"endBi":8,"zg":14.12,"zd":13.19}]
    final [{"s":1,"e":3,"zd":13.19,"zg":14.12,"merged":1}]        ← 5 笔的大中枢被"小中枢"取代
  ```
  真实数据（600519 日线，`node scripts/pivotviz.js A 600519 day` 输出）：
  ```
  #2 段8-11(4) 进7 离12 [1382.42, 1465.42] 已合并×1   ← 合并前是 seg8-11 [1382.4,1465.4] + seg12-13 [1452.4,1496.9]
  ```
  合并后中枢只剩 `[1452.4, 1465.4]`（高度 83，是原区间的 1/4），**seg12-13 那个中枢完全消失**；图上 1368~1452 这段本该是"中枢延伸"的震荡被划到了中枢外面——这恰好是本次改动想修的"中枢被拉成长条"的反向错误。
- 修复建议：合并前必须满足"中间那段（`cur.leaveBi`）整段回到 `cur` 的 `[zd,zg]` 内"（真正的中枢延伸/扩展），否则保持两个中枢；合并时区间用**并集跨度**（`min(zd)`/`max(zg)`）而不是交集，GG/DD 取两者极值，并保留 `count` 重新统计。

### [BLOCKER]（✅ 已修复 `a72c026`，随合并逻辑一并删除）合并后重筛内段："前三段用相交、延伸段用终点"，导致区间被重新加宽而内段终点落在区间之外
- 位置：`chan.js:362-371`（修复前；`const inside = isFirst3 ? bi.h > zd2 && bi.l < zg2 : bi.p1 <= zg2 + 1e-9 && bi.p1 >= zd2 - 1e-9;`）
- 为什么是问题：合并后的 `zg2/zd2` 是两个子中枢的交集（更窄），前三段只要求"与区间相交"就被接受；这些段的外侧端点本来就落在交集外面，所以"固定后的区间"里出现了不需要回中枢的笔，与注释"③ 区间在形成那一刻就固定，后续震荡只能在区间内延伸"直接冲突。
- 实测证据：
  ```
  cd /tmp/rv && node sw2.js            # BTCUSDT 日线
  #2 seg7-9 count 3 [111920,117900] merged 1 最远终点越上沿 6574.0 (段9)
  #7 seg31-34 count 4 [76264,81478.87] merged 0 最远终点越上沿 5916.8 (段33)
  ```
  浏览器截图 `/tmp/rv/prov/shots/chart-CR_BTCUSDT_day.png` 可以直接看到：中枢上沿 `ZG 81478.9` 下方那根橙色的笔从区间内一口气拉到 81478 之上；`RB0` 截图同理，中枢 `[3088.9,3118.1]` 内的第一根笔起点在 `ZG` 之上。
- 修复建议：合并后对 **所有** 内段（含前三段）统一用 `p1 ∈ [zd2,zg2]` 判定，不满足就 `end2 = b-1` 提前收口；这样 `count` 天然 ≥3，区间也自洽。

### [BLOCKER]（✅ 已修复 `a72c026`）`p.t1` 在合并分支里恒为 `undefined`（上一次复审已经指出、本次仍未修）
- 位置：`chan.js:383`（修复前）`t1: bis[end2].i1 != null ? undefined : cur.t1`
- 为什么是问题：`bis[end2].i1` 在正常情况下**永远不是 null**（笔一定有终点K线），所以三元表达式永远走 `undefined` 分支，`t1` 被无条件清空。任何合并过的中枢，`t1` 都与 `endBi` 对应的 K 线时间不符；`i1` 被更新成 `bis[end2].i1` 而 `t1` 没跟着更新，二者不再对应。`pivotviz.js` 的检查项里**没有 t1 一致性**，所以一直"✅ 通过"。
- 实测证据：
  ```
  cd /tmp/rv && node inv.js
  A:600519:day pivots=9 merged=3 violations=18
     ✗ #2[8-11] t1=undefined（合并后时间丢失）
  CR:BTCUSDT:day ... ✗ #2[7-9] t1=undefined
  ```
  （`node scripts/sw.js` 风格的统计：600519 上 `t1 === undefined` 的中枢 3 个，正好等于 merged 数量。）
- 修复建议：`t1: bars[bis[end2].i1].t`（与 `buildPivots` 里 `t1: bars[bis[endBi].i1].t` 同口径），并在 `pivotviz.js` 增加 `p.t1 === a.bars[p.i1].t` 断言。

### [BLOCKER]（✅ 复审尾声工作区已改成"结构页永远出图 + 收起/换标的"，`ui7.mjs` 实测已恢复出图，见 §1.2b；遗留：选择器展开时 canvas 被推到首屏之下）标的选择器改动让"结构页手绘/回测/AI 复核"整条链路在默认入口下失效
- 位置：`web/js/pages/structure.js:630-637`（`renderPage` 里 `if (!explicit) { showPicker(); return; }`）、`web/index.html:111` `#structBody`
- 为什么是问题：`App.state.pickedSymbol` 的初值是 `false`，只有 `openStructure()`（搜索、雷达、总览、板块、理论页跳转）或带 `?c=` 的深链才会置 `true`。用户从站点默认地址打开后点"结构分析"，`#structBody` 被 `display:none`，图上什么都点不到。`scripts/flowcheck.js` 用的正是默认地址，于是桌面端 7 项全红。
- 实测证据：
  ```
  node scripts/flowcheck.js      → 25/32 通过
  ✗ 桌面版·结构页图表+标注        — canvas=true
  ✗ 桌面版·手绘线可画出并保存      — 点两下画线 · 当前 0 条手绘线…
  ✗ 桌面版·AI 复核弹窗给出一致度   — 一致度 0 / 100 · 还没有画线
  ✗ 桌面版·手绘线已落库          — 0 条
  ✗ 桌面版·Esc 不留半成品线
  ✗ 桌面版·画布外松手不产生幽灵框
  ✗ 桌面版·信号回测卡片
  ```
- 修复建议：给选择器加一个"用默认标的直接看图"的入口（或记住上次选择），并让 flowcheck 显式带 `?c=600519` 或先点击一个 chip。

### [MAJOR]（✅ 已修复 `a72c026`：补 `pickedSymbol` + `syncURL`，`ui6.mjs` 实测刷新后仍在期货）选择器状态不回写：点热门 chip / 搜索选中后刷新页面，会变成"A 股图 + 期货标题"
- 位置：`web/js/pages/structure.js:377-383`（chip 点击）与 `structure.js:426-432`（搜索点击）只写了 `App.state.market / App.state.symbol[m]`，**没有写 `App.state.pickedSymbol`**；而 `web/js/app.js:244-252` 的深链解析只把 `?m=` 和 `?c=` 读回来，`boot()` 里也没有读 `#structure` 分支。
- 为什么是问题：刷新后 `App.state.market` 回到默认 `A`，但 `symbol[A]` 还是 A 股那个标的 → 页面显示 A 股图，`#structTitle` 却仍是上一次的"CNF · RB0 · 日线"（标题只在 `refresh()` 里更新，而选择器模式下 `refresh()` 不会跑）。
- 实测证据（`/tmp/rv/ui4.mjs`，playwright）：
  ```
  [A1] 深链后 {"market":"CNF","code":"RB0","picked":true,"picker":"none","body":"block","title":"CNF · RB0 · 日线"}
  [B] 清掉 pickedSymbol 后点“刷新” {"market":"CNF","code":"RB0","picked":false,"picker":"block","body":"none","title":"CNF · RB0 · 周线"}
  ```
- 修复建议：chip/搜索回调里补 `App.state.pickedSymbol = true`；`boot()` 里对 `?c=` 同时恢复对应页面；`renderPage()` 在选择器分支里把 `#structTitle` 置为"—"。

### [BLOCKER/MAJOR]（⚠️ 部分修复：22→65/76 分，仍低于"照抄引擎"的 100 分）游戏"框中枢"题用引擎区间当标准答案，错误区间直接变成扣分
- 位置：`server/lib/game.js:282-305`（用 `target.i0/i1/zd/zg` 算 IoU），`game.js:149` 取 `lastPivot` 也是这套结果
- 为什么是问题：如果中枢只是"画得偏窄"，影响有限；但这里是判分口径。玩家按缠论把整个震荡区框起来会被判"没框到中枢"。
- 实测证据（`/tmp/rv/quiz.js`）：
  ```
  22 玩家按缠论画完整震荡区 11.99~20（引擎判错的"宽框"）
  100 玩家采信引擎给的单框 11.99~14.5（"标准答案"）
  14 画第一段子中枢 14~20
  ```
- 修复建议：先把中枢合并逻辑修正确（见前两条），再让题目的"标准答案"用**原始未合并**的中枢；判分时对玩家框与"任一子中枢/合并后中枢"取最大 IoU。

### [MAJOR]（❌ 仍在）中枢"离开段"的语义前后矛盾：代码注释要求"整段离开"，实现是"终点离开"，`a72c026` 还把实现的判据写进了 pivotviz 断言
- 位置：`chan.js:269-270`（注释）vs `chan.js:291-298`（实现只看 `b.p1`），`scripts/pivotviz.js:76-78`（`lb.p1 > p.zg || lb.p1 < p.zd`）
- 为什么是问题：按注释，离开段应该"整段低点 > ZG 或整段高点 < ZD"；实际会出现离开段的整段高点**正好压在 ZG 上**（回抽摸到中枢上沿）的情况，这时回抽没有真正离开中枢，但代码把它当离开段、`status='done'`，后面的三买（`chan.js:586-597` 用 `p.leaveBi`）也会因此误判。
- 实测证据（`/tmp/rv/merge4.js` 随机扫描，很快命中）：
  ```
  中枢 {"s":1,"e":3,"zd":15.67,"zg":20.44}  leave 段 4 整段 14.97~15.67 终点 14.97
  raw中枢 [{"s":1,"e":3,"zd":15.67,"zg":20.44},{"s":4,"e":6,"zd":14.97,"zg":15.67}]  ← seg4 恰好在 ZD 处止步，又构成新中枢
  ```
- 修复建议：二选一并写清楚——(a) 严格按缠论"回抽不回中枢"，判据改成 `b.p1 > zg || b.p1 < zd` 且**该段极值也不触及** `[zd,zg]`；(b) 保留现判据但把注释和 pivotviz 的断言改成同一口径，并在 `leaveBi` 上标注 `touched` 标志供三买使用。

### [MAJOR]（✅ 已修复 `a72c026`）区间套（多级别）没有接入 CNF/USF
- 位置：`server/index.js:168-173` `SUITE_PERIODS`（只有 A/HK/US/CR）
- 实测：`/api/suite?market=CNF&code=RB0` 只返回 1 个级别（day）；浏览器结构页"区间套 · 多级别联立"卡片只有一张"日线级别"，hint = "无多级别共振"（`/tmp/rv/ui5.mjs`）。而 CNF/USF 已支持 60m/30m/15m/5m/1m。
- 修复建议：`CNF/USF: ['day','60m','30m','15m','5m']`（1m 只有约 2 天数据，不放）。

### [MAJOR]（✅ 已修复 `a72c026`：normalize 补全市场 + 旧存档迁移）总览页自选池不显示期货，但每次都被拉了一遍报价
- 位置：`server/index.js:85-106`（`normalizeWatchlist` 硬编码 `{A,HK,US,CR}`）＋ `data/watchlist.json`（持久化后只有 4 个市场）；`overview()` 却按 `ALL_MARKETS` 拉了 CNF/USF 的自选报价。
- 实测：
  ```
  curl /api/overview → watch 里 CNF/USF 行数 = 0
  node -e "S.quotes([10 个期货])" → 2744 ms（串行补日线）
  web/m 移动端总览实测渲染出 6 张卡，CNF/USF 显示 “-0.00% 涨 0 跌 0”
  ```
- 修复建议：`normalizeWatchlist` 与持久化结构里补 `CNF`/`USF`（或回退到 `WATCHLIST` 默认值），否则把 CNF/USF 从 overview 的拉取里去掉，别白付 2.7s。

### [MAJOR]（✅ 已修复 `a72c026`：改为 `{...had, …}` 并补 high/low/volume/open）数据层：CNF 报价被"日线兜底"整行覆盖，丢掉字段并与 USF 口径不一致
- 位置：`server/lib/sources.js:421-441`（`out[...] = { market, code, name, price, prevClose, pct, source }`）
- 实测：`CNF:T0` 返回只有 5 个字段（无 `high/low/volume/staleSnapshot/ts`），`A:600519` 有全部字段；USF 与 CNF 的 `pct` 一个按外盘结算、一个按国内日线收盘。
- 修复建议：`{ ...had, price, prevClose, pct, source:'sina-futures+day', asOf: last.t }`，并给日线兜底的结果加 `snapshotAge` 字段，发现"日线落不到今天"时置 `stale:true`。

### [MAJOR]（⚠️ 部分修复：pivotviz 加了 t1/count/合并断言，matrixcheck 加了时间递增与 <45 天新鲜度，208/208；中枢几何断言仍只看字段存在）现有校验脚本的"绿"是假绿
- `scripts/pivotviz.js`：
  - 真实数据上 9 个中枢里合并后剩下的内段数 ≥3 且"前三段"本来就在区间内，所以 `count<3`、`t1` 一致性、区间"加宽"都检查不到；
  - `i > 0` 分支的"重叠>50% 且紧邻应合并"用的是 **50%** 阈值，而 `chan.js` 是 **30%**——正好留出 30%~50% 重叠不合并的漏洞；
  - 只检查 `startBi/endBi/count` 与"段相交"，没有检查"延伸段终点在区间内"对**合并后**的区间是否成立（注释写了 check，实现用的是 `p.startBi` 之后的段，忽略了合并把区间改小的情形）。
- `scripts/matrixcheck.js:60-62` 对新加的分钟线只断言 `bars >= 5`（不查时间递增/新鲜度），只测 8 个期货品种；USF 的 `RTY/NKD/BZ/SB` 日线是 2019 残档（被新鲜度校验拒绝）也没被覆盖。当前 `node scripts/matrixcheck.js` 仍 113/113 全绿。
- 修复建议：pivotviz 补 4 条硬断言（`count===endBi-startBi+1`、`t1===bars[i1].t`、所有内段 `p1` 在区间内、`leaveBi===endBi+1`），阈值与 chan.js 对齐到同一常量；matrixcheck 增加"时间严格递增 / 最后一根距今 < X 天"断言并遍历 `USF_LIST`。

### [MINOR]（✅ 随合并逻辑删除而消失）合并判定里的"重叠比例"分母取两个中枢高度的较小值，会放大误合并
- 位置：`chan.js:350-354`。`minHeight` 取较矮者做分母，窄中枢只要被包含一半就算"实质重叠"。实测有 8/20000 随机样本合并后 `ZG-ZD ≤ 0.01`（`node rand.js`），其中一例 `[22.27,22.28]` 的 ZD 来自一个中枢、ZG 来自另一个，画出来是一条零高度的线。
- 修复建议：分母改用 `max(cur.height, nxt.height)`，并加 `zg2 - zd2 > 0.2 * min(child heights)` 的下限。

### [MINOR]（✅ 复审尾声工作区已修：单字只做精确匹配，实测「A」「金」「元」不再淹没有效结果）搜索：单字别名 + 单字代码子串匹配会挤掉真正要搜的东西
- 位置：`server/lib/sources.js:950-951`（`alias.includes(raw)`）、`955`（`code.includes(kw)`）、`862`（`it.base.startsWith(kw)` 对单字也生效）、`868`（`slice(0,10)`）。实测：
  ```
  搜「A」 → USF:PA USF:6A CNF:AL0 CNF:AU0 CNF:AG0 CNF:A0 CNF:TA0 CNF:MA0 CNF:SA0 CNF:AP0 | CR:ADAUSDT ATOMUSDT ALGOUSDT ANKRUSDT ARPAUSDT AVAXUSDT ... （16 条上限，A 股结果被挤到后面）
  搜「金」 → USF:GC CNF:AU0 USF:SI USF:PA CR:BCHUSDT + A 股（BCH 中“CH”并无“金”义，是 alias.includes 的副作用）
  搜「元」 → USF:6A（“美元”别名）
  ```
- 修复建议：`alias.includes(raw)` 只在 `raw.length >= 2` 时生效；`kw.length < 2` 时只做 `code === kw` / `name` 精确匹配。

### [MINOR]（✅ 复审尾声工作区已在 `searchFutures` 的 `push()` 里加 `CNF_LIST/USF_LIST` 白名单，实测 PA/6A/6S/ZL 不再被搜到；定义本身仍残留）`COMMODITY_ALIAS`/`FUTURES_NAMES` 里仍有指向"搜得到打不开"的品种
- 位置：`sources.js:768`（PA）、`772`（6A/6S）、`770`（ZL），`CNF_LIST` 里的 `ZC0`。
- 实测（逐个打开验证）：
  ```
  USF:PA 钯金期货  FAIL 该品种数据陈旧（1 根，最后一根在 2019-04-18）
  USF:6A 澳元期货  FAIL 该品种数据陈旧（13 根，最后一根在 2019-05-07）
  USF:6S 瑞郎期货  FAIL 该品种数据陈旧（1 根，最后一根在 2019-04-18）
  USF:ZL 豆油期货  FAIL 期货K线为空
  CNF:ZC0 动力煤    FAIL 该品种数据陈旧（1760 根，最后一根在 2022-12-30）
  ```
  其中 PA/6A/6S/ZL 都是由搜索别名带出来的（"金/钯/澳元/瑞郎/豆油"）。
- 修复建议：`FUTURES_NAMES`/`COMMODITY_ALIAS`/`CNF_LIST` 只保留实测可用的品种（与 `USF_LIST`/`CNF_LIST` 同源），或给搜索结果挂 `usable:false` 并由前端置灰。

### [MINOR]（❌ 仍在）搜索冷启动 3~4 秒
- 位置：`sources.js:960-988`。每次 `/api/search` 都先 `request(腾讯智能提示)`，**再** `searchCrypto()` 拉 Binance `exchangeInfo`（30 分钟缓存、失败不缓存、`getJSON` 默认 `retries:1` + 9s 超时，最坏 18s+）。
- 实测：重启后首次搜索 3099ms / 4082ms，之后 86~95ms。
- 修复建议：`binanceSymbols()` 后端预热（启动时拉一次）或改用更小的 `/api/v3/exchangeInfo?permissions=SPOT` 之外的精简方案；失败时用指数退避且短暂缓存 `[]`，不要每次请求重试。

### [MINOR]（⚠️ 部分修复：WAF 页已识别，错误 JSON/1 字节响应仍判 available）`srcaudit.js` 的分级把"200 但不是数据"和反爬页判成 available
- 位置：`scripts/srcaudit.js:68`（反爬正则只有 `__verify|cf-challenge|Are you a robot`）、`74`（`200<=status<400` → available）
- 实测：
  ```
  东财数据中心  200 len=81  {"result":null,"success":false,"message":"返回字段参数不能为空"}
  IBKR API    200 len=1   "\n"
  雪球        200 text/html 110KB，正文含 "_waf_"（WAF 挑战页）
  巨潮资讯     200 text/html 104KB（首页）
  以上全部被判 ✅ 可直接用
  ```
  “4xx 非 401/403 被误判为 available” **不成立**：401/402/403→gated，其余 4xx（如 404）落到 blocked，方向反而偏严。
- 修复建议：对 `used:true` 的源追加"响应体结构断言"（JSON 必须含预期字段、HTML 大于 1KB 视为 guarded），反爬正则加 `_waf_|__jsl_|acw_sc__`。

### [MINOR]（✅ 已修复 `a72c026`）`srcaudit.js` 末尾用 `process.exit()` 直接退出，keep-alive 连接触发 Node AssertionError
- 位置：`scripts/srcaudit.js:108`。实测 `node scripts/srcaudit.js --json` 退出码 0，但 stderr 有 `AssertionError` 堆栈。
- 修复建议：`process.exitCode = usedDown.length ? 1 : 0;`，并 `await new Promise(r => setTimeout(r, 50))`。

### [MINOR]（❌ 仍在，中枢变多后更明显）`chart.js` 标签避让：最多退 6 格，密集中枢时会跑出价格区
- 位置：`web/js/chart.js:413-416`。循环有上限、不会死循环、也不会越界崩溃（`x` 被 clamp），但 `ly` 没有上下限。按同样逻辑模拟（`/tmp/rv/avoid2.js`）：5 个以上中枢且集中在同一价格带时，会出现标签 `y` 跑出价格区（压到成交量/时间轴）。600519/BTC 截图里已能看到"离开段↓"贴到 K 线顶部、ZK 标签被压在笔线上。
- 修复建议：`ly = Math.max(g.priceTop + 10, Math.min(g.priceTop + g.priceH - 6, ly))`，并在 6 次仍冲突时放弃背景底色只画文字（或缩小标签）。

### [MINOR]（✅ 已修复 `a72c026`：ZN → YM）自选池死引用
- `server/index.js:73` `{ code: 'ZN', name: '美债10Y期货' }` 不在 `USF_LIST` 里，报价实测返回"无报价"，总览自选会出现空行。
- 修复建议：删掉，或换成实测可取的品种。

### [MINOR]（❌ 仍在；matrixcheck 的 45 天断言能抓到，服务端 90 天阈值未改）新鲜度校验的边界
- `chan.js`… 不，`sources.js:159-165`：`bars.length < 60 || ageDays > 90`。实测 `WR0`（线材）最后一根日线在 **2026-09-09（53 天前）**仍能通过，点进去是一张 9 月的图；长假（>90 天不交易的情况理论上不会发生）不受影响，所以**不会误伤正常品种**，但"停更 50 多天"这种半死数据也拦不住。
- 修复建议：`ageDays` 阈值按周期区分（日线 10 天、分钟线 5 天），并在返回里带 `asOf` 让前端显示"最后更新时间：X 天前"。

### [MINOR]（✅ 复审尾声工作区已改为"六市场"）文案与新市场不一致
- `web/index.html:72` "四市场脉动"、`web/m/js/mobile.js:292` "四市场自选池"；而脉冲卡已渲染 6 个市场（其中 CNF/USF 恒为 0，见上文）。

---

## 一、二审：`a72c026` 修复后的逐条复核（当前代码 = `5aaa222`）

修复提交 `a72c026`（"复核agent两条BLOCKER——撤销中枢合并…"）把我的两条 BLOCKER 和多数 MAJOR 都动了。我按同一套脚本重跑了一遍，结论如下。

### 1.1 已确认修好的（重新实测通过）

| 原问题 | 复核方法 | 结果 |
|---|---|---|
| BLOCKER：合并取交集导致中枢变窄/吞掉大中枢 | `node /tmp/rv/inv2.js`（16 个真实品种） | ✅ 合并逻辑整体删除，`merged=0`；每个中枢段数从"合并后 3~5"回到真实的 3~10；600519 从 9 个缩水中枢变成 **12 个独立中枢**，BTC 从 8 个变 **10 个** |
| BLOCKER：合并重筛放行区间外内段 | 同上 + 截图 | ✅ 不再合并，内段越界问题随之消失；BTC 截图里那根越出 `ZG 81478.9` 的笔已经不存在 |
| BLOCKER：`t1` 恒 `undefined` | `inv.js` 的 `t1 === bars[i1].t` 断言 | ✅ 全部样本 `t1` 与末笔终点 K 线一致；`pivotviz.js` 也补了 `t1` 断言 |
| 旧测试"紧邻重叠必须合并"把错误行为固化了 | `node --test test/chan.test.js` | ✅ 测试已反过来断言"绝不合并、只打 `overlapPrev`"，18/18 通过 |
| 游戏框中枢：按缠论画宽框只得 22 分 | 用新判分函数重算（`/tmp/rv/quiz3.js`） | ⚠️ 部分修好：宽框 11.99~20 → **65**；真实 10 笔中枢框整个震荡区 → **94**；但仍低于"照抄引擎单框"的 100（见 1.2-A） |
| 区间套不接 CNF/USF | `SUITE_PERIODS` 补 5 个级别 | ✅ `CNF/USF: ['day','60m','30m','15m','5m']`，`/api/suite?market=CNF` 现返回 5 个级别 |
| 自选池 normalize 只认 4 市场 | `normalizeWatchlist` 改 `ALL_MK` + 旧存档迁移 | ✅ `data/watchlist.json` 已补 CNF/USF；`/api/overview` 的 watch 不再丢期货 |
| 自选池 `ZN` 死引用 | `index.js:73` → `YM` | ✅ |
| CNF 报价被日线兜底整行覆盖 | `sources.js:429-445` 改 `{...had, …}` 并补 high/low/volume/open | ✅ `CNF:T0` 现在带 `high/low/volume/open/change/timeText` |
| USF 4 个 2019 残档（RTY/NKD/BZ/SB） | `USF_LIST`/`FUTURES_NAMES`/`COMMODITY_ALIAS`/`sectors.js` 同步剔除 | ✅ 列表、搜索、板块目录都不再出现 |
| matrixcheck 只看 `bars>=5` | 新增"时间严格递增 + 最后一根 <45 天"断言、USF 用例扩到 15 个 | ✅ `node scripts/matrixcheck.js` → **208/208**（原 113） |
| srcaudit 把 WAF 页判成 available | 反爬正则加 `_waf_|__jsl_|challenge-platform` | ✅ 雪球从 ✅ → ⚠️ guarded |
| srcaudit `process.exit()` 断言崩溃 | 改 `process.exitCode` | ✅ 不再输出 AssertionError |
| chip/搜索选中后刷新变成"A 股图 + 期货标题" | `structure.js` 补 `pickedSymbol = true` + `App.syncURL()`；浏览器 `ui6.mjs` 实测 | ✅ 点 chip → URL 变 `?m=CNF&c=RB0&p=day` → 刷新后仍是 `CNF · RB0 · 日线` |
| 中枢几何全部不变量 | `inv.js` 去掉"离开段整段"后 | ✅ 16 个样本 **violations = 0**（`pivotviz.js` 在 A/CR/CNF/USF、日线/5m 上也全绿） |

### 1.2 修复后仍然存在 / 修复引入的新问题（按严重度）

#### [MAJOR] 中枢"离开段"的语义仍是矛盾状态，新加的 pivotviz 断言把它焊死成了"实现即真理"
- 位置：`server/lib/chan.js:269-270`（注释要求"整段低点 > ZG 或整段高点 < ZD"）vs `chan.js:291-298`（只看 `b.p1`）+ `chan.js:300-303`（`leaveBi = j`），`scripts/pivotviz.js` 新断言 `lb.p1 > p.zg || lb.p1 < p.zd`。
- 为什么是问题：**一个中枢如果以"终点刚好等于 ZG（或 ZD）"结束，离开段就从 ZG 这个点起步**——离开段的整段高点**恰好等于** ZG、"整段低点 > ZG"永远不成立，按注释它根本不是离开段；但代码把它当离开段、`status='done'`，三买/三卖（`chan.js:586-597` 依赖 `p.leaveBi`）也在它基础上判。
- 实测（修复后的代码，`node /tmp/rv/inv.js`）：
  ```
  A:600519:day pivots=12 merged=0 violations=12
    ✗ #3[15-17] 离开段整段未离开区间 (h1465.419,l1382.419) vs [1382.419,1465.419]   ← 上沿=ZG、下沿=ZD，完全没离开
    ✗ #5[21-23] 离开段整段未离开区间 (h1486.039,l1362.019) vs [1362.019,1447.019]   ← 低点恰好 = ZD
  A:300750:day  ✗ #3[11-13] (h263.033,l233.233) vs [233.233,253.688]               ← 低点恰好 = ZD
  HK:00700:day  ✗ #0[1-6]   (h385.6,l365)   vs [365.2,391]
  ```
  12 个中枢里 12 条"离开段"全部违反注释定义（其中至少 3 条是"恰好贴着 ZG/ZD 起步"的强反例）。
- 修复建议：二选一，别两套口径并存——(a) 严格按注释：`leaveBi` 取第一个**整段**离开的笔，贴着边界起步的那笔算"边界确认笔"，附 `touchedEdge:true` 给三买用；(b) 保留终点判据，但把 chan.js:269-270 的注释和 pivotviz 的断言改成同一句话，并在返回里加 `leaveTouched: p1===zg||p1===zd`。

#### [MAJOR] 游戏"框中枢"判分对"按定义修正的窄框"仍然不公平
- 位置：`server/lib/game.js:294-320`（时间/价格各占 50%，价格容差 `pCap*0.25`，越界惩罚 `min(0.35, (tOver+pOver)*0.12)`）
- 实测（`/tmp/rv/quiz3.js`，可直接跑）：
  ```
  A 三条笔标准中枢 [14,20]：
    玩家框整个震荡区 [12,24] → 76      玩家框标准中枢 [14,20] → 100
  B 真实 10 笔中枢 [1375.5,1563.6]：
    玩家框整个震荡区 [1320,1564] → 94
  ```
  只要多框了"震荡区"，价格吻合立刻从 100% 掉到 `pCap/(pCap+越界量)`，扣分是**双向对称**的——但"框宽一点"在缠论里是合法答案，"框窄了"才是不合法。现在 65/76 分与"照抄引擎"100 分的差距，会让学员误以为"引擎窄框才是唯一正确答案"。
- 修复建议：时间/价格吻合都改成**单向**（`contained = 标准区间完全被框住 → 1.0`），只在"框得比标准窄"时扣分；越界惩罚只对"超过标准中枢高度 1.5 倍"生效。

#### [MAJOR] 结构页默认入口仍看不到图（flowcheck 仍有 5 项红）
- 位置：`web/js/pages/structure.js` `renderPage()` 仍以 `pickedSymbol` 为唯一开关；`scripts/flowcheck.js:238` 仍打开不带 `?c=` 的地址。
- 实测（`5aaa222` 上重跑）：`node scripts/flowcheck.js` → **27/32**（此前 25/32），剩下 5 项全在桌面结构页手绘链路：
  ```
  ✗ 桌面版·手绘线可画出并保存 / AI 复核 / 手绘线已落库 / Esc 不留半成品线 / 画布外松手不产生幽灵框
  ```
  原因不是新 BUG，而是"结构页只有选择器"这一设计的连带影响：flowcheck 从不点 chip。
- 修复建议：要么给选择器一个"用默认标的直接看图"的按钮并在 flowcheck 里点它，要么让 flowcheck 带 `?m=A&c=600519`，否则 CI 会一直是红的。

#### [MAJOR] `overlapPrev` 只算不画：7 个重叠中枢在图上跟普通中枢长得一模一样
- 位置：`chan.js:339-358` 生成 `overlapPrev`；`grep -n overlapPrev web/js/chart.js web/m/js/mobile.js` → **0 处引用**。
- 实测：600519 日线 12 个中枢里 **7 个** `overlapPrev:true`（#1/#3/#4/#6/#7…），BTC 10 个里 5 个。修复说明写的是"改为相邻重叠只标注不改几何"，但"标注"只存在于 JSON 里。
- 修复建议：chart.js 在中枢色带边缘画一条不同颜色的描边/角标（或在 `#structState` 里加"与上一中枢重叠：中枢扩展形态"），否则用户看到的仍是两个互不相干、彼此重叠的框。

#### [MINOR] srcaudit 的"响应体校验"只覆盖一种形态
- `scripts/srcaudit.js:66-70`：只有"已接入 + 以 `{` 开头 + 含 `"error"/"Error Message"/"Information"`"才降级。实测：
  ```
  东财数据中心 200  {"version":null,"result":null,"success":false,"message":"返回字段参数不能为空"}  → 仍判 available
  IBKR API    200  1 字节换行                                                              → 仍判 available
  巨潮资讯     200  104KB 首页 HTML                                                         → 仍判 available
  雪球         200  WAF 页                                                                  → 已正确判 guarded ✅
  ```
- 修复建议：`used` 源要求 `content-type` 含 json 且 JSON parse 成功 + 业务字段存在；HTML > 1KB 直接判 guarded。

#### [MINOR] 搜索单字仍会淹没结果
- `sources.js:950-951 / 955` 未改。实测搜「A」：`USF:PA USF:6A CNF:AL0 CNF:AU0 CNF:AG0 CNF:A0 CNF:TA0 CNF:MA0 …` 占满 16 条，A 股结果被挤出前 8；搜「金」第 3 位还是 `USF:PA`（2019 残档，点开仍报"数据陈旧"）。

#### [MINOR] 仍有 3 个"搜到打不开"的外盘品种
- 原因同上：`FUTURES_NAMES` 保留了 `PA/6A/6S/ZL`（`sources.js:776-780`）。实测：`USF:PA` 1 根/2019-04-18、`USF:6A` 13 根/2019-05-07、`USF:6S` 1 根/2019-04-18、`USF:ZL` 空。
- 修复建议：`FUTURES_NAMES`/`COMMODITY_ALIAS` 与 `USF_LIST` 同源生成，不要在 `sectors.js` 剔了、在 `sources.js` 还留着。

#### [MINOR] `SUITE_PERIODS` 补了期货，但相关展示没跟着改
- `/api/suite?market=CNF` 现在 5 个级别都能出（✅），但结构页的"换级别看同一结构"按钮（`structure.js:267` `levels = (PERIODS[market]||[]).slice(0,4)`）和区间套卡片对期货仍然没有专门的"仅日内、数据只有 1~3 天"提示；`USF 15m` 只有 92 根，5 级别里有 3 个级别会返回"数据不足"，卡片会显示三张"无数据"，容易被当成故障。
- 修复建议：`USF` 的区间套按可用根数动态裁剪（>=120 根才展示该级别）。

#### [MINOR] `chart.js` 标签避让仍是硬上限 6 格、无纵向 clamp（本轮未改）
- `chart.js:413-416`，见 §零 同名条目；修复后中枢数量从 9 增到 12，标签更密，`/tmp/rv/prov/shots-after/` 截图里"离开段↓/9段升级"已经开始贴在笔线上。

#### [MINOR] 新旧文档/文案仍不一致
- `web/index.html:72` "四市场脉动"、`web/m/js/mobile.js:292` "四市场自选池"（现在已接 6 个市场）；README 的检查项矩阵里仍写着"56 项接口 / 39/39"，实际 `apicheck` 已 64 项。

#### [MINOR] 新加的"板块目录无死引用"单测会随网络波动
- `test/chan.test.js` 新用例逐个联网请求 15 个外盘品种日线（`S.klines` 无 mock），断网/限流时会红；同类问题在 `matrixcheck` 里也存在。建议给联网用例加 `skip` 条件（`process.env.LIVE === '1'`）。

### 1.2b 复审结束时（`5aaa222` + 未提交工作区）又进行了两轮修复——现场实测

复审尾声时工作区里出现了两处**未提交**的改动（不是我改的），正好对应 §一 里还没修完的两条，我在浏览器里当场验了：

- **结构页默认入口**（`web/js/pages/structure.js` `renderPage()` 改成"永远出图，选择器只做引导 + 加 `#pickerClose`/`#switchSymbol`"）：`node /tmp/rv/ui7.mjs` 实测
  ```
  裸进结构页: picker=block body=block title="A · 600519 · 日线" canvas=820x560@top733
  点“收起”:   picker=none  body=block title="A · 600519 · 日线" canvas=820x560@top222
  点“换标的”: picker=block body=block                               （无 JS 报错）
  ```
  → 默认入口现在能看到图了（§一 的 MAJOR 已解决），但**选择器展开时 canvas 的 top=733**，图表几乎被推到首屏之外（1440×900 视口下 canvas 只剩不到 170px 高可见），需要滚动才能看到——这仍然是"先选标的"设计遗留下来的版面问题。建议把选择器做成抽屉/弹层，或首屏只保留一行热门 chip。
- **搜索**（`server/lib/sources.js`：单字只做精确匹配、`push()` 里加 `CNF_LIST/USF_LIST` 白名单、单字结果截断到 4 条）：实测
  ```
  「A」→ 10 条 US:a.n A:000002 A:000805 …   「元」→ 10 条 A:002878 …（不再出现 USF:6A）
  「金」→ USF:GC CNF:AU0 A:000076 …（USF:PA/USF:SI 不再出现）
  「黄金」→ USF:GC CNF:AU0 USF:SI A:518880 …   「以太坊」→ CR:ETHUSDT US:etha.oq …
  ```
  → 单字淹没问题与"搜到打不开"（PA/6A/6S/ZL）**都解决了**，§一 的两条 MINOR 可关闭。
- 同时 `web/index.html` / `web/m/js/mobile.js` 的"四市场"文案也改成了"六市场"（§一 文案 MINOR 关闭）。
- 仍**未**处理（截至本次复审结束）：中枢"离开段"语义矛盾（§1.2 第一条）、框中枢判分偏严（§1.2 第二条）、`overlapPrev` 只算不画、srcaudit 对错误 JSON/1 字节响应的校验、`chart.js` 标签避让越界、服务端 90 天新鲜度阈值、`FUTURES_NAMES` 里 PA/6A/6S/ZL 的残留定义（虽然已不会被搜到）。
- 提醒：这些改动**未提交**，`git status` 里 `server/lib/sources.js`、`web/js/pages/structure.js`、`web/index.html`、`web/m/js/mobile.js`、`scripts/flowcheck.js` 仍是 modified；flowcheck 也已补了 `#pickerClose` 点击与 chromium 路径回落。复审结束时未再重跑完整 flowcheck（正在被作者修改中）。

### 1.3 修复后仍未变的部分（复核确认依旧成立）
- `count === endBi-startBi+1` 恒成立、`i1` 与 `endBi` 一致、`enterBi === startBi-1` 且与首段反向、`leaveBi === endBi+1`、延伸边界（终点恰为 ZG/ZD 视为中枢内）——这些在修复前后都是对的（`inv.js`/`cases2.js`）。
- 数据层：分钟线时间戳无重复无倒序、`intradayOnly` 标注、贵金属现货交叉校验、`binanceSymbols` 失败降级——修复没有触碰，复测仍正常。
- 搜索冷启动仍是 3~4 秒（`exchangeInfo` 无预热），本轮未改。

---

## 二、一审问题清单（针对修复前的 `af3d720/1ee28c1`，保留完整证据以便追溯）

> 注：每条问题末尾的"✅ 已修复 / ⚠️ 部分修复"标注对应 `a72c026`（复核于 `5aaa222`）。


---

## 三、逐项核对你点名的问题（结论表）

> 下表是**一审**结论；括号里的"修复后"是对 `a72c026` 的复核结果。

| # | 你的问题 | 结论 |
|---|---|---|
| A1 | 进入段与中枢首段是否方向相反 | ✅ 成立。16 个真实样本、随机合成样本全部满足 `bis[enterBi].dir === -bis[startBi].dir`，且 `enterBi === startBi-1` |
| A2 | ZG/ZD 是否在形成时固定 | ⚠️ **不成立**（修复前；`a72c026` 已删掉合并，现成立）。初次形成后延伸确实不改 ZG/ZD（实测通过），但 `mergeAdjacent` 会把区间改成两中枢交集，等于"事后改区间"；且合并重筛用"相交"放行了落在区间外的内段 |
| A3 | 延伸判据 `p1 ∈ [ZD,ZG]` 在边界上会不会错 | ✅ 边界安全。构造了终点**恰好等于 ZG**、**恰好等于 ZD** 的数据，都被正确判定为"仍在中枢内"（`node cases2.js` 的反例见 A2 项）。判据本身没问题，问题在合并分支对前三段用了另一套判据 |
| A4 | `count === endBi-startBi+1`；`i1/t1` 是否与 `endBi` 一致 | 部分：`count` ✅ 恒等；`i1` ✅ 与 `bis[endBi].i1` 一致；**`t1` ❌ 合并后恒为 `undefined`**（`chan.js:383`；`a72c026` 已修） |
| A5 | 合并重筛 `isFirst3 && !inside` 会否错误剔除合法前三段导致 `count<3` | 不会导致 `count<3`（`end2` 从 `startBi` 起算，最坏也是 3），**但会放行落在区间外的前三段**（BLOCKER 2）。另外这个分支的两个 `if` 在前三段上是重复的，第一段 `b=startBi` 永远不会 break，属于"看起来有保护、其实没保护" |
| A6 | `leaveBi` 是否恒为 `endBi+1`；会不会"离开段其实还在区间里" | `leaveBi` ✅ 恒为 `endBi+1`；但"离开段还在区间里" ❌ 会出现：判据只看终点，回抽段可以整段贴着 ZG 甚至摸到 ZD（见 MAJOR），与注释"整段离开"矛盾 |
| B1 | 外盘分时跨夜聚合会不会重复/倒序 | ✅ 没复现。GC/ES/CL/NG 的 5m 聚合实测 `dups=0 sorted=true`，覆盖 10-30 06:00 → 10-31 04:55（北京时间），与"一个场次"吻合。真正的问题是（B5） |
| B2 | 新鲜度校验会不会误伤新品种 / 长假 | 不会误伤（阈值宽松），但反过来**太宽松**：WR0 停更 53 天仍通过 |
| B3 | `alias.includes(raw)` 单字命中一堆 | ⚠️ 会（搜"A"占满 16 条上限），见 MINOR；不致命但建议限制 `raw.length>=2` |
| B4 | `COMMODITY_ALIAS` 死引用 | 部分（`a72c026` 已剔除 SB/RTY/NKD/BZ，仍余 PA/6A/6S/ZL）：`DX` 已修（加了 `!FUTURES_NAMES[code]` 过滤），但仍有 PA/6A/6S/ZL/ZC0 五个搜到打不开 |
| B5 | `searchCrypto` 失败降级 / 519 对拖慢搜索 | 降级合理（只返回别名命中）；519 对遍历本身不是瓶颈，**冷启动 3~4s 是 exchangeInfo 网络请求**（无预热、失败重试 18s 上限） |
| B6 | 国内期货日线收盘兜底的涨跌幅 | 正常品种正确（RB0/IF0/AU0/T0/JD0 与日线核对一致），但字段被裁掉、与 USF 口径不一致、停更品种（WR0）会显示"三个月前的涨跌" |
| C1 | `#structBody` HTML 配平 | ✅ 正确：`div` 149/149、`section` 7/7、`#structBody` 内 34/34，id 无重复 |
| C2 | 隐藏 `#structBody` 后切页再切回会不会错乱 | ✅ 实测不错乱（`/tmp/rv/ui.mjs` [4]），`renderPage()` 每次重新判定；但状态源 `pickedSymbol` 只增不减，会走向"再也看不到选择器"的另一端 |
| C3 | 切市场 tab 后 `pickedSymbol` 是否更新 | ❌ 不更新（`a72c026` 已补 chip/搜索路径；市场 tab 仍不置位）（`app.js:67-75` 根本不碰它）；已选过标的后切 tab 直接出该市场默认标的的图；**点 chip 后刷新会显示 A 股图 + 期货标题** |
| C4 | `arrow()` 标签避让会不会死循环/越界 | ✅ 不会死循环（`k<6` 硬上限），但会越出价格区（MINOR） |
| D1 | matrixcheck 断言是否真能抓问题 | ❌（修复前）宽松，113/113 全绿却漏掉中枢问题；`a72c026` 已加时间递增/新鲜度断言（208/208），但中枢几何断言仍只看字段存在 |
| D2 | srcaudit 是否把 4xx 误判 available | 不成立（401/402/403→gated，其余→blocked）；真正的问题是 **200 + 无效/反爬页被判 ✅**（`a72c026` 只修了 WAF 页这一种） |

---

## 四、已验证正常（实测过、确认没问题的点）

1. **中枢基础几何**：16 个真实样本（A/HK/US/CR/CNF/USF × 日线/4h/30m/15m/5m）+ 数万组合成序列：`ZG > ZD`、所有内段与区间相交、`gg/dd` 等于内段极值、相邻中枢段序不重叠、`count === endBi-startBi+1`、`i1 === bis[endBi].i1`、`enterBi === startBi-1` 且方向相反、`leaveBi === endBi+1` —— 去掉已确认的"离开段整段"和 `t1` 两类后，其余不变量 violations = 0（`node inv2.js`）。
2. **延伸边界**：构造第四笔终点恰为 ZG / 恰为 ZD 的数据，都被视为"中枢内延伸"，`count` +1，符合预期。
3. **`node scripts/pivotviz.js <market> <code> <period>`**：A 600519 日线（一级审时 9 个中枢）、CR BTCUSDT 日线、CNF RB0 日线、CNF IF0 5m、USF GC 日线全部通过；一审后脚本断言已加强（t1/count/不合并/overlapPrev），断言强度问题见 D1。
4. **单元测试**：`node --test test/*.test.js` → 64/64 通过（含新增的期货分钟线、外盘 intradayOnly 标注）。
5. **`node scripts/matrixcheck.js`** → 一审时 113/113；一审后扩到 208/208（新增时间递增与 <45 天新鲜度断言、USF 用例 8→15 个）。
6. **`node scripts/apicheck.js`** → 64/64，含 `/api/sectors`（8 个板块、88 个品种）、6 个板块快照、未知板块 400。
7. **`node scripts/uicheck.js`** → 4 个视口横向溢出 0px、手机版/闯关/理论弹窗/数据源页全通过；`node scripts/flowcheck.js` 一审时 25/32（桌面结构页 7 项红），`a72c026` 后 27/32（剩 5 项红，均因选择器挡住画布），详见 §1.2。
8. **浏览器实测出图**：`?m=A&c=600519`、`?m=CNF&c=RB0`（日线/60 分）、`?m=USF&c=GC&p=15m`、`?m=CNF&c=T0` 四类深链都能正常出图，canvas 820×560，无 JS 报错（`ui2.mjs`）。
9. **分钟线**：CNF 1m/5m/15m/30m/60m、USF 5m/15m 全部 `dups=0 sorted=true`；GBK→UTF-8、`+08:00` 解析正确（AU0 夜盘 10-31 02:30 → 11-02 00:00 的周一开盘衔接正常）。
10. **`intradayOnly` 标注**：USF 15m 返回 `intradayOnly:true`，`/api/kline` 透传正确。
11. **贵金属现货交叉校验**：`/api/quote?list=USF:GC,USF:SI` 返回 `spotPrice`（3876.40 / 49.25），偏离 <3% 时不误标 stale；沪金/沪银按币种正确跳过。
12. **搜索可用性**：搜"黄金/白银/铜/螺纹钢/铁矿石/沪深300/国债/苹果"都命中期货且可打开；"以太坊/狗狗币/比特币"命中加密；币安数据源 `symbols` 过滤 `USDT+TRADING` 正确。
13. **CNF 池健壮性**：68 个国内品种里只有 `ZC0`（停更）、`WR0`（53 天）两个有问题，其余 66 个日线都新鲜。
14. **板块目录一致性**：88 个品种全部落在 `CNF_LIST`/`USF_LIST` 里，无重复、无错市场（`test/chan.test.js` 的两个新用例有效）。
15. **中枢→游戏/绘图数据链路**：`analyze()` 现在用 `{...p, active}` 透传全部字段，`enter/leave/status/merged` 不再被白名单吃掉（`matrixcheck` 的 `enterBi` 断言在此前提下才有意义）。
16. **`binanceSymbols` 失败降级**：网络异常时 `searchCrypto` 返回别名命中，不影响 A 股搜索结果。
17. **只读约束**：复审全过程未执行 `git add/commit/checkout`，未写仓库文件；所有临时脚本在 `/tmp/rv`、截图在 `/tmp/rv/prov/shots`。

---

## 五、复现脚本

全部脚本在 `/tmp/rv/prov/`（说明见 `/tmp/rv/prov/REPRO.md`），均只 `require` 仓库模块，不写仓库；`ui*.mjs` 用 `/opt/dsh-browser/playwright.mjs` 打本地 8931 服务。

```
cd /tmp/rv && node cases2.js && node merge5.js && node merge3.js && node merge4.js \
  && node zeroh.js && node rand.js && node inv.js && node inv2.js && node quiz.js && node sw2.js
node /tmp/rv/ui.mjs   # 选择器 → 出图 → 切页 → 切市场 tab
node /tmp/rv/ui4.mjs  # 点 chip 后刷新 → A 股图 + 期货标题
```

截图：
- 修复前 `/tmp/rv/prov/shots/`：`chart-CR_BTCUSDT_day.png`（中枢内笔越出 ZG）、`chart-A_600519_day.png`（窄化到 83 的中枢）、`chart-CNF_RB0_day.png`、`chart-USF_GC_15m.png`
- 修复后 `/tmp/rv/prov/shots-after/`：同一组，中枢恢复为独立框。

补充脚本：`ui6.mjs`（chip → 刷新仍在期货）、`ui7.mjs`（裸进结构页是否能出图 / 收起 / 换标的）、`quiz3.js`（新判分函数下的宽框得分）。

> 复审约束说明：全程只读仓库（未 `git add/commit/checkout`、未写仓库文件）；`/api/drawings` 的写入是 `scripts/flowcheck.js` 自带的测试行为，不是本复审所为。复审结束时工作区里 `server/lib/sources.js`、`web/js/pages/structure.js`、`web/index.html`、`web/m/js/mobile.js`、`scripts/flowcheck.js` 有**他人未提交的改动**，本文 §1.2b 记录了对这些改动的现场实测。
