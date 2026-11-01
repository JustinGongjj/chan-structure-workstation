# 二轮复审：手绘线 +「AI 复核」

仓库：`/home/node/default/chanlun-station`（提交 `20340a4`）
复审方式：只读代码 + 在 `/tmp` 的仓库副本（端口 8932）上跑接口 + 用最小 DOM stub 在 node 里直接驱动 `web/js/chart.js` 的事件处理器 + 用真实 `/api/chan` 结果驱动 `server/lib/drawing.js`。
仓库文件未做任何修改；文中每条结论都对应一次实际运行（复现命令见文末附录）。

---

## 结论摘要

- **4 个 blocker**：`dragRect` 泄漏导致指针移动抛 TypeError 并落一条幽灵矩形；`pendingStart` 不随模式/标的重置，单击一次就画出一条跨全图的线（可能横跨别的标的）；手机端图表重建后不再重载线，下一条线保存时把已有线全部覆盖；40 条上限是从**最旧**的截断，客户端既不限也不看返回值，画第 41 条起静默丢失。
- **13 个 major**：坐标以「数组下标」锚定（`limit=600` 的滑动窗口每来一根新 K 线，全部手绘线漂移一根）；越界下标不校验（线画到画布外看不见，复核却把下标夹到 593 照常出结论）；两条客户端 `loadDrawings` 无请求令牌（乱序返回会把别的标的的线套到当前标的，并随后存进当前 key）；手机端画矩形会同时平移图表；规则引擎的水平线把同一个点当起点+终点重复加分（同一条价位线，点在不同 K 线上得分 80 vs 100）；`extreme` 判定对随机价位 54% 命中（含「贴着区间最低价」这种巧合）；判定文案多次断言数字不支持的事实（`盘整` 也「方向一致」、单根插针也算「大量 K 线穿越」、只有端点吸附却说「价位也和中枢/买卖点对得上」）；等等。
- 10 个单测全绿（`node --test test/drawing.test.js` → 10/10），但没有一条覆盖上述任何一类问题：没有 hline 重复计分、没有越界下标、没有 NaN 坐标、没有 `cut-candles`/`extreme`/`盘整` 文案、没有交互状态机。

---

## BLOCKER

### B1. `dragRect` 泄漏 → 下一次 `pointermove` 抛 TypeError，并在下一次点击落下幽灵矩形
`web/js/chart.js:774`（`let dragRect`），`tool` 未绑定指针捕获；`web/js/chart.js:863-876`（`pointerup` 才清 `dragRect`），`web/js/chart.js:878-883`（只有 `pointercancel` 清），`web/js/chart.js:80-85`（`setDrawMode` 只清 `draft`，不清 `dragRect`），`web/js/chart.js:849-855`（`if (dragRect) { this.draft.x2 = ... }` 无空保护）。

- **为什么重要**：鼠标按下拖框、在画布外松手时，canvas 上收不到 `pointerup`（没有 `setPointerCapture`），`mouseleave` 也只清 `this.drag`。于是 `dragRect` 一直挂着、`draft` 继续跟着光标跑；此时按 Esc 或点工具栏（`setDrawMode('none')`）把 `draft` 置 null，下一次 `pointermove` 就 `TypeError: Cannot set properties of null (setting 'x2')`，每移动一次都抛；再点一下画布就 commit 一个从旧起点到点击处的矩形，并立刻 `onDraws` 落库。
- **已复现**：按下(bar100)→拖动(bar120)→画布外松手→`setDrawMode('none')`→`pointermove` 抛 `TypeError`→`pointerup` 落 `["rect",100,185]`。
- **一句话修复**：`setDrawMode`/`pointercancel`/`pointerup` 统一清 `dragRect`，`pointerdown` 里对 canvas 调 `setPointerCapture(e.pointerId)`，并把 `pointermove` 改成 `if (dragRect && this.draft && this.drawMode === 'rect')`。

### B2. `pendingStart` 不随模式切换 / 清空 / 换标的重置：一次点击就画出一条横跨全图的线
`web/js/chart.js:775`（`pendingStart` 闭包变量），`web/js/chart.js:835-844`（第二次 `pointerdown` 直接用旧 `pendingStart` commit），`web/js/chart.js:80-85`/`86-91`/`72-76`（`setDrawMode`/`clearDrawings`/`setDrawings` 都不动它），`web/js/pages/structure.js:422`（Esc 只调 `setDrawMode('none')`）。

- **为什么重要**：趋势线第一次点击后按 Esc（或点「框」、点「清空」、换标的），`pendingStart` 仍在。再点一次 → 立刻 commit 一条从**旧起点**到新点击的线。跨标的情形最严重：`setData`+`setDrawings`（两个客户端都是这个顺序）之后单击一次，会生成一条从**上一个标的**第 60 根到当前标的的线，并且这条线直接存进**新标的**的 key。
- **已复现**：模式重进后单击一次 → `trend:40@100 -> 150@99.3`；换标的（`setData`+`setDrawings`）后单击一次 → `trend:60 -> 150`。
- **一句话修复**：在 `setDrawMode`、`clearDrawings`、`setDrawings`、`setData` 里都执行 `pendingStart = null; dragRect = null;`（把两者提升为实例字段），并给 `keydown` 增加 Esc → 取消未完成线。

### B3. 手机端：图表每次重建但只在 key 变化时重载线 → 线从画布上消失，下一条线保存时把其余线全删
`web/m/js/mobile.js:504-519`（`state.chart.destroy(); state.chart = new ChanChart(...)` 然后 `if (k2 !== drawKey) loadDrawings();`），`web/m/js/mobile.js:170-176`，`web/m/js/mobile.js:151-161`（新实例的 `onDraws` 把 `drawList` 覆盖为「新实例里的线」）。

- **为什么重要**：`renderStructure()` 会重建图表（新实例 `drawings = []`），但同一个标的/周期时 `k2 === drawKey`，**不会**重新加载。触发路径极常见：点任意「教学标注」chip、切市场再切回、切周期再切回。结果：用户已保存的线从图上消失，提示文字却仍写「当前 N 条」；用户再画一条，`onDraws` 拿到的列表只有这 1 条，`drawingsSave` 把服务端那组线**整组覆盖**为 1 条——已保存的线永久丢失。
- **一句话修复**：图表实例创建后无条件 `await loadDrawings()`（不要用 `drawKey` 短路），或在重建实例后先把 `drawList` 灌回 `setDrawings`。

### B4. 40 条上限：截断的是**最旧**的 40 条，客户端不设限且不看返回值 → 新线静默丢失
`server/index.js:678`（`(Array.isArray(body.drawings)?body.drawings:[]).slice(0,40).map(sanitizeDrawing)`），`web/js/pages/structure.js:376-385`（`persistDrawings` 只用 `.then(()=>'已保存')`，忽略 `count/drawings`），`web/m/js/mobile.js:156-159`（同样），`web/js/chart.js:802-808`（`commit` 不检查条数）。

- **为什么重要**：服务端保留列表**前** 40 条，也就是最旧的 40 条；用户画到第 41 条时截掉的是最新画的那些。响应 `ok:true, count:40`，客户端界面继续显示 41 条并提示「已保存」，刷新后新线消失。没有任何 UI 上限或告警。
- **已复现**：POST 45 条 → `count 40`，返回 `L0..L39`，`L40..L44` 被丢弃并从库中消失。
- **一句话修复**：客户端 `commit` 前拦住第 41 条（提示「最多 40 条」），服务端改成保留**最新** 40 条（`slice(-40)`）并在 `count !== 请求条数` 时回 `ok:false` 或 `truncated:true`，客户端据此提示。

---

## MAJOR

### M1. 坐标锚定在「数组下标」上：`limit=600` 的滑动窗口每新增一根 K 线，所有手绘线漂一根
`server/lib/sources.js:460`/`467`（`bars: daily.bars.slice(-limit)`），`web/js/pages/structure.js:68`、`web/m/js/mobile.js:509`（都写死 `limit:600`），`web/js/chart.js:104-114`（存的是 `idx`，没有任何时间锚）。

- **为什么重要**：`klines` 返回的是**最近 N 根**，下标是「距末尾 600 根」的相对位置。次日多一根 K 线，同一根 K 线的下标从 599 变 598，于是所有已保存线的 `x1/x2` 都相对价格右移一根；1 分钟周期等于每分钟漂一次。已用同一标的 `limit=600` 与 `limit=100` 验证：同一根 K 线在两窗口里的下标分别是 599 / 99。
- **一句话修复**：落库时同时存时间戳锚点（`t1`/`t2`），加载时按 `bars[].t` 二分找当前下标（找不到就夹到最近根并提示），只有回落旧数据时才用下标兜底。

### M2. 越界下标不校验：线画到画布外（看不见、选不中），复核却把它夹到最后一根照常出结论
`web/js/chart.js:72-76`（`setDrawings` 原样接收），`web/js/chart.js:175-179`（`xOf` 不夹取、不裁剪），`server/lib/drawing.js:70`（`clampIdx` 夹到 `bars.length-1`）。

- **为什么重要**：换到 K 线更少的标的/周期后，`x1:900` 这种线的屏幕 x 远超绘图区，被 canvas 边界裁掉——用户看不到；`hitTest` 永远选不中；但 `/api/drawings/verify` 会把 900 夹成 593 再和笔端点比较。已复现：`x1=900,x2=950`（数据 600 根）→「起点离最近的笔端点有 6 根、0.62% 的价格差（第 593 根）」。给用户看的是**不存在于图上**的几何结论。
- **一句话修复**：加载时按当前 `bars.length` 校验（越界即夹到区间并在 `drawHint` 明示「N 条线超出当前数据范围，已按最后一根对齐」），`paintDrawings` 里对绘图区做裁剪。

### M3. 两个客户端的 `loadDrawings` 没有请求令牌：乱序返回会把别的标的的线套到当前标的，并在下一次编辑时存进当前 key
`web/js/pages/structure.js:363-374`，`web/m/js/mobile.js:170-176`（`drawingKey` 同步赋值，`await` 之后直接 `chart.setDrawings(res.drawings)`，不比对 key）。

- **为什么重要**：快速 A→B 切换时两个 GET 可能乱序落地，晚到的 A 组线覆盖 B 的画布，同时 `drawList` 也变成 A 的线；用户此时画一笔，`onDraws` 就把「A 的线 + 新线」存进 B 的 key。另外 `refresh()` 里 `chart.setData(res)` 在取线**之前**执行，取线这几十/几百毫秒内，上一个标的的线是直接画在新标的 K 线上的（对应「线落在错误 K 线上」的可视窗口）。
- **一句话修复**：`const mine = key; const r = await API.drawings(...); if (mine !== currentKeyStr()) return;`，并在切标的瞬间先 `chart.setDrawings([])`。

### M4. 手机端画矩形会同时平移图表，框的落点按平移后的视角换算 → 框落在错误的 K 线上
`web/js/chart.js:886-943`（`touchstart/touchmove` 完全不看 `this.drawMode`），`web/m/css/mobile.css:195`（`.chart-wrap canvas{touch-action:pan-y}`，横向手势交给 JS），`web/js/chart.js:849-855`（`pointermove` 用 `dataAt` 按**当前** `view` 换算）。

- **为什么重要**：手指横向拖动画框，`touchmove` 判定 `locked='pan'` 并 `preventDefault` 平移视图，同一次移动里 `pointermove` 又在改 `draft.x2/y2`。已复现：一次 200px 的框选拖动把 `view.start` 从 50 改到 14（平移 36 根），提交的框与用户看到的边界不一致。趋势线的第二次点击同理（手指稍微横移就平移了）。
- **一句话修复**：`drawMode !== 'none'` 时让 `touchstart/touchmove` 直接 return（并把 canvas 的 `touch-action` 切成 `none`），绘图期间禁止平移/缩放。

### M5. 规则引擎把水平线的同一点同时当「起点」「终点」：同一条价位线得分 80 或 100，取决于你点在哪根 K 线上
`server/lib/drawing.js:189-198`（`for (const [idx,price,tag] of [[x1,y1,'起点'],[x2,y2,'终点']])`），`server/lib/drawing.js:79-80`（`hline` 时 `x2=x1, y2=y1`）。

- **为什么重要**：`hline` 没有第二个端点，但循环照样跑两遍：同一个点匹配到同一个买卖点就 +12 **两次**，文案还会出现「终点贴着第二类买点」这种不存在的终点。已复现：价位 1270.33（既是某中枢 ZD，又正好等于 3B 信号的价），点在第 559 根 → 100 分（`pivot-edge` + 两条相同的 `near-signal`），点在第 0/120/300/555/600 根 → 80 分。同一个价位、同一条线，分数由「你点在哪根 K 线」决定，与线的结构含义无关。`rect` 同理：把「框的角」说成「终点贴着买卖点」没有语义。
- **一句话修复**：`hline` 的买点判定改成「该价位是否与任一信号价重合」（不分起终点、只加一次）；`rect` 的 `near-signal` 要么去掉，要么改文案为「框内/框边有买卖点」。

### M6. 分数上限掩盖重复计分；基础分 70 让「什么都没对上」的线也能到 58~64 分
`server/lib/drawing.js:72`（`let score = 70`），`server/lib/drawing.js:220`（`Math.max(0,Math.min(100,...))`），`server/lib/drawing.js:246`（`avg = 平均分`）。

- **为什么重要**：端点双吸附 + 两端各贴一个买卖点 = 70+8+8+12+12 = 110，被截到 100，于是 M5 的重复计分在总分上不可见。另一侧，一条纯粹随手画的线只是 70−6−6−4=54，verdict 落在「偏离较多」，但 70 的基础分意味着「合法即 70% 好」，`>=80` 阈值实际只需要「两端吸附」就跨过（已复现 score 86 仅由 `snap-bi`+`snap-bi-end`+`with-trend` 构成）。0–100 这个数字看起来像是测量值，实际主要是可加项的堆叠。
- **一句话修复**：把加分/扣分合成「对齐项占比」再映射到 0–100（每类最多计一次），并暴露 `findings` 的类别清单，让分数可解释。

### M7. 判定文案断言了数字不支持的事实（三处，均已复现）
- `server/lib/drawing.js:251`：`avg>=80` 的结论固定写「端点多落在笔的端点上，**价位也和中枢/买卖点对得上**」。实测只触发 `snap-bi`+`snap-bi-end`+`with-trend`（score 86）时，没有任何 `pivot-edge`/`near-signal`/`box-pivot`，却照样输出这句。
- `server/lib/drawing.js:124`：`else if (trendType) add('ok','with-trend', 线的方向与「${trendType}」一致)`。`classifyTrend`（`server/lib/chan.js:329`）会返回 `盘整`，此时上涨线和下跌线**都**得到「方向与「盘整」一致」。
- `server/lib/drawing.js:214`：`cut-candles` 固定写「中途**大量** K 线穿到线的另一侧」，但代码只算了一个 `max(overshoot)`。实测 20 根里 1 根插针就报「大量」；同一段文案还写「**线的方向没错**」，而紧挨着上一条 finding 可能是 `against-trend`（逆势），自相矛盾。
- **一句话修复**：结论按实际命中的 code 拼装（没有 pivot/signal 的 ok 就不写那句）；`盘整` 走单独分支（「盘整里画趋势线意义有限」）；`cut-candles` 改成统计穿越根数 `n/total` 并把数字写进文案，去掉「方向没错」这一断言。

### M8. 水平线的 `extreme` 判定几乎恒真，中枢内部价位被误描述成「贴近区间最低价」
`server/lib/drawing.js:152-162`（`Math.min(...highs.map(h=>Math.abs(pct(y1,h)))) <= TOL_PRICE`）。

- **为什么重要**：600 根 K 线的最高/最低点各有 600 个样本，`TOL_PRICE=0.004` 的带宽下，任取一个价位几乎总能命中某个 K 线极值。实测：在真实价格区间里随机取 300 个价位画水平线，`extreme`+4 命中 **163/300（54%）**，`pivot-edge`+10 命中 75 个，两者合计 79% 的「随机价位」被判定为「有结构含义」，只有 21% 会触发 `floating-level`。同时，把线画在**中枢带内部**（ZD..ZG 中点 1304.59）得到的结论是「水平线贴近区间最低价」——巧合，且完全没提「你在中枢内部」这个真正有意义的事实。
- **一句话修复**：`extreme` 只在「近端 K 线（如最近 120 根）的极值」上判定并收紧到 `TOL_PRICE/3`；并先判「价格落在某中枢 ZD..ZG 内」给独立 finding。

### M9. `sanitizeDrawing` 把非法坐标悄悄变成 0；`/api/drawings/verify` 完全不校验 → 文案里出现 `NaN`
`server/index.js:496-502`（`num = v => Number.isFinite(Number(v)) ? Number(v) : 0`），`server/index.js:626`（verify 只做 `slice(0,40)`，不 `sanitizeDrawing`），`server/lib/drawing.js:70`（`clampIdx` 对 NaN 返回 NaN），`server/lib/drawing.js:90,113`（`dIdx` 为 NaN 时走 `off-bi` 分支）。

- **为什么重要**：保存路径把 `y1:null` 变成 0（一条画在价格 0 的线，永远在画布外，且 `bad-value` 的 fail 分支对**已存**数据不可达）；verify 路径不净化，`x2:'zz'` 会让文案输出「终点离最近的笔端点有 **NaN** 根、92.29% 的价格差」，且总分仍是 58（`warn`）而不是 fail。已复现（HTTP 200 + 上述文案）。
- **一句话修复**：`sanitizeDrawing` 对非有限值返回 `null` 并整条丢弃（或在 verify 里复用 `sanitizeDrawing`，`clampIdx` 对非有限输入直接给 0 并加 `bad-value`）。

### M10. 持久化 key：不做代码归一化、不校验 market/code
`server/index.js:492`（`drawKey = (market,code,period) => \`${market.toUpperCase()}:${code}:${period}\``），`server/index.js:674-679`（POST 不校验），`server/lib/sources.js:31-45`（`normCode` 有归一化但这里没用），`web/js/app.js:244`（URL 的 `?c=` 原样写入 state）。

- **为什么重要**：`A:600519` 与 `A:sh600519` 是同一只票（`tcCode` 会补前缀），但会落到两个 key；入口不同（URL 参数、指数芯片 `sh000001`、搜索结果）就可能「我的线不见了」。缺 code 时落到共享桶 `A::day`（已复现：POST 无 code → `key A::day`，GET 不带参数也能读到同一桶）。market 只做 `toUpperCase`，`XX` 之类非法市场也能建桶。
- **一句话修复**：两端统一 `code = S.normCode(market, code)`，并在 POST 里要求 `['A','HK','US','CR'].includes(market) && code`（失败回 400）。

### M11. 并发保存是「整组覆盖」的 last-write-wins，没有合并/版本号
`server/index.js:674-686`（`loadDrawings()[key] = { drawings: list }` 直接覆盖），`server/index.js:485-490`（整文件重写）。

- **为什么重要**：两个标签页各自拿着自己那份列表，谁后保存谁赢，另一个标签页新画的线静默消失；也没有跨标签同步（无 `storage` 事件、无 ETag/version）。另外整文件重写在「同一台机器跑两个进程」时也会互相覆盖（内存缓存 `DRAW_STORE` 是进程内的）。
- **一句话修复**：POST 带 `rev`（服务端递增），不一致时回 `409` + 当前列表让客户端合并；或在客户端做按 id 的并集合并。

---

## MINOR

### m1. 手绘线没有裁剪到价格区，水平线会画到成交量/MACD 面板上
`web/js/chart.js:556-563`（hline 直接 `moveTo(padL,y1)`，不判断 y 是否在 `[priceTop, priceTop+priceH]`），右侧价签 `chart.js:563` 也画在该 y。对比同日功能的 `drawHighlight` 有正确守卫：`chart.js:677-679`（`if (y < g.priceTop || y > g.priceTop + g.priceH) continue;`）。视图缩放后价格区间收窄，只要线价差出区间几个百分点（y≈281 对应 2.2% 下方）就压到 VOL 面板。**修复**：加同样的 y 区间守卫（或 `ctx.clip()` 到价格区）。

### m2. y 坐标被量化成「所点 K 线的收盘价」，引擎 0.4% 的价格容差几乎不可能命中
`web/js/chart.js:131-132`（`return { idx, price: bar ? bar.c : price }`）。实测点击价格 101.5 → 得到 99.34（差 **2.13%**，是 `TOL_PRICE` 的 5 倍）。后果：不靠笔端点吸附时，用户画得再准也一律得「离笔端点有 X% 的价格差」；水平线**无法**放在中枢 ZG/ZD 上（除非恰有某根 K 线收盘价等于它），而复核给的建议正是「把水平线贴到中枢上下沿」——自相矛盾。**修复**：非吸附时保留指针价格（或只在距收盘价 <0.15% 时才吸附），并在提示里说明。

### m3. 「AI 复核」文案高估，引擎自述与免责声明从未渲染
`web/index.html:159,174`、`web/m/js/mobile.js:449`（按钮/卡片写「AI 复核」）；响应里 `engine:'rule-based (deterministic)'`、`disclaimer` 都在（`server/lib/drawing.js:276-277`），但 `web/js/pages/structure.js:443-458`、`web/m/js/mobile.js:185-193` 只用 `score/verdict/lines/method.steps`，两者都没渲染（同项目里 `mobile.js:792` 的算卦功能是渲染 `disclaimer` 的，说明这是遗漏不是规范）。另外空列表时界面显示「一致度 **0** / 100」（`structure.js:445`、`mobile.js:188`），读起来像「你的画法 0 分」而不是「还没画」。**修复**：按钮改「结构复核（规则引擎）」，卡片脚注渲染 `res.disclaimer`；`res.lines.length===0` 时隐藏分数。

### m4. 键盘与无障碍
`web/js/pages/structure.js:418-423`：删除只在 `document.activeElement === document.body` 时生效——点过任一工具栏按钮后焦点在按钮上，`Delete` 静默无效（提示语仍写「Delete 删除」）；`Escape` 只在桌面存在，且不能取消未完成线（见 B2）。工具栏按钮只有 `.primary`/`.gold` 视觉态，无 `aria-pressed`，屏幕阅读器读不出当前模式；`#drawVerifyCard` 的结果无 `aria-live`；canvas 无 `tabindex`/`aria-label`，键盘用户无法选中线。**修复**：把删除键监听挂到 `#mainChart` 容器的 `tabindex=0` 上（或去掉 body 判定）、按钮加 `aria-pressed`、结果容器加 `role="status"`。

### m5. 「已保存」是乐观文案；失败会提示但不重试；切换标的会丢掉挂起的保存
`web/js/pages/structure.js:424-427`（`onDraws` 先 `updateDrawHint('已保存')` 再起 350ms 防抖），`structure.js:376-385`（`clearTimeout(saveTimer)` 会被下一次保存覆盖，若两次之间换了标的，前一 key 的待保存被丢弃），`web/m/js/mobile.js:152-159`（同）。**修复**：只在 `drawingsSave` resolve 后写「已保存」，失败时保留脏标记并在下次进入该 key 时重试；防抖定时器按 key 分开。

### m6. `/api/drawings` 的 POST 不写访问日志，也不校验 Origin/Content-Type
`server/index.js:674-686`：在 `routes` 分派之前 `return`，因此 `finally` 里的访问日志（`server/index.js:773-775`)不会执行（实测 8932 端口日志里只有 GET）。`readBody`（`server/index.js:110-130`）不看 `Content-Type`，`sendJSON`（`server/index.js:376-384`）也不带 CORS 头——任意网页用 `text/plain` 发一个简单请求就能覆盖本机某个 key 的手绘线（无预检、无需读响应）。**修复**：把日志移到 `finally` 外层或在该分支里补日志；写操作校验 `Origin`（同源或空）与 `Content-Type: application/json`。

### m7. 接口契约的小问题
- `server/lib/drawing.js:271`：`level: a.level || period`，但 `a.level` 是对象（实测 `{levelNo:6,levelName:"日线级别",short:"D"}`），`|| period` 的兜底暗示本想输出字符串；字段类型不一致，客户端也没用。
- `server/index.js:630`：`target.price` 恒为 `null`（`withQuote:false` → `res.quote` 为空），`target.name` 恒为 `''`，是死字段。
- `README.md:209` 写 `GET/POST /api/drawings?market=...`，但 POST 只读 body（query 被忽略）。
- verify 不做 `drawings` 净化（M9），而保存路径做了——两条入口对同一份数据的接受度不一致。
- **修复**：`level` 输出 `a.level && a.level.levelName || period`；删除或补全 `target`；README 拆成 GET(query)/POST(body)；verify 复用同一 `sanitize`。

### m8. 存储卫生
`server/index.js:475-483`：`drawings.json` 解析失败时静默变成 `{}`，下一次保存把整库覆盖为空（无备份/无告警）；`server/index.js:679-680`：先改内存再落盘，落盘抛错时进程内状态已「成功」，后续 GET 会读到未持久化的数据；`server/index.js:485-490`：无 `fsync`（进程崩溃不丢，断电可能丢最后一笔——可接受）；**无过期清理**，key 只增不减（每个标的×周期一条，长期会到 MB 级）；`data/drawings.json` 已入库（`git show --stat HEAD`），且 `scripts/flowcheck.js:218-225` 与 `scripts/apicheck.js:76` 会对 `A:600519:day` POST 空列表——跑一次 `npm run check:all` 就会清掉开发机上该标的的真实手绘线。**复审期间现场观测到这一点**：会话开始时该文件是 1107B / 5 条（含 `label:"中枢上沿"` 这种人工画的线），中途变成 78B / 空、`updatedAt` 刷新——不是我发的（我的写操作全部发往 `/tmp` 仓库副本的 8932 端口，`DATA_DIR` 跟随 `__dirname`），而是项目自身的巡检/手工测试落在**同一个 live 库**上。**修复**：解析失败先备份为 `.corrupt.bak` 再重置；落盘失败回滚内存；加 `updatedAt` 超过 N 天且空组的清理；测试用独立 `DATA_DIR`（目前 `DATA_DIR` 在 `server/index.js:62` 写死，不支持 env 覆盖）。

### m9. 死代码 / 未用返回值
`server/lib/drawing.js:48-50`（`pivotAt` 未使用）、`server/lib/drawing.js:71`（`priceOf` 未使用）、`server/lib/drawing.js:31`（`best.bi` 未被读取）、`server/lib/drawing.js:119`（`spanBars` 只用于 stats）。**修复**：删除或接入（`pivotAt` 可用于 M8 的「价格在中枢内」判定）。

### m10. 「正好落在笔的端点」的措辞超出实际精度；没有笔时完全不提
`server/lib/drawing.js:90-93`（判定条件是 `dIdx<=2 && dPrice<=0.4%`，文案写「正好落在」）。另外 `bis` 为空时 `ep1=null`，两个分支都不进入，既不加分也不提示——一个还没形成笔的图（或刚上市标的）复核出来是「没有意见」，看上去像「通过了」。**修复**：文案改成「端点与笔端点相差 ≤2 根、≤0.4%」；`!bis.length` 时显式加 `warn/no-structure`「当前级别还没形成笔，无法校验端点」。

### m11. 交互细节
`web/js/chart.js:816-821`：`drawMode==='none'` 时任何点击都重置选中（空点即取消选中，符合预期），但 `pointerdown` 不区分 `e.button`（右键也会落线）与 `e.isPrimary`（第二根手指也会落线）；`web/js/chart.js:783`：水平线的 hit-test 只看纵向距离、不看 x，点击成交量面板同一高度也能选中它；`web/js/chart.js:802-808`：`commit` 后 `setDrawMode('none')` 会自动退出，但工具栏按钮的 `.primary`/`.gold`（`structure.js:403-405`、`mobile.js:145`）不会同步——按钮看起来仍激活，再点一次反而**重新进入**该模式；`web/js/chart.js:866-874`：矩形太小则静默取消，没有「框太小」的提示。**修复**：`pointerdown` 加 `e.button!==0 || !e.isPrimary → return`；hit-test 加上 x 范围；`commit` 里通过回调通知客户端同步按钮态；取消时 `toast('框太小，已取消')`。

### m12. 测试覆盖
`test/drawing.test.js` 10 条全绿，但都围绕「脚本设计的 happy/明显 negative path」：没有 hline 重复计分（M5）、没有越界下标（M2）、没有 NaN 坐标（M9）、没有 `extreme` 假阳性（M8）、没有 `盘整`/`cut-candles` 文案（M7）、没有交互状态机（B1/B2/B3）。`scripts/flowcheck.js:246-261` 的 UI 巡检只验证「能画出 2 条并落库」，恰好绕开了所有以上路径。**修复**：上述每条补一个确定性单测（规则层都很容易构造成本极低的用例），交互状态机可用本报告附录里的最小 DOM stub 直接驱动。

---

## 我确认过、但没有列为缺陷的两点（避免误判）

1. **`dataAt()` 与 `xOf()/yOf()` 的逆变换本身是正确的**：在 harness 里把 `snap` 替换成恒等后，平移（`start=30`）、缩放（`count=60`）、左右边界（bar 0 / bar 199）都能精确回读（`101.50000`、`102.00000`、`103.00000`）。问题不在逆变换，而在 M1（下标锚点）与 m2（收盘价量化）。
2. **原子写是真的**：`fs.mkdirSync` + 临时文件 + `renameSync`（`server/index.js:485-490`），单进程下不会出现半个文件；`saveDrawings` 抛错也会被 POST 的 `catch` 转成 400（`server/index.js:682-684`）。`readBody` 的 64KB 上限（`server/index.js:110`）让「巨大 payload」不可行；`/api/drawings/verify` 的 40 条上限 + `klines` 60s 缓存（`server/lib/sources.js:435`）让重复调用只有 13–65ms（首次 403ms），**不构成实际 DoS**——但它每次都重算 `C.analyze`、无 result 缓存，且请求无 `Origin` 校验（见 m6）。
3. **未能验证的一点**：桌面鼠标在绘图模式下是否会同时平移（`chart.js:764-770` 的 `mousedown` 会置 `this.drag`，`chart.js:822` 的 `pointerdown.preventDefault()` 按规范应抑制兼容 `mousedown`，Chrome/Firefox 通常如此）。无浏览器环境，未实测，仅提示存在依赖浏览器行为的风险；B1/M4 是同一类问题的、已实测成立的分支。

---

## 附录：复现用的关键命令

```bash
# 1) 单测现状（10/10 绿）
cd /home/node/default/chanlun-station && node --test test/drawing.test.js

# 2) 水平线重复计分 + 得分随「点在哪根」漂移
node -e "
const a=require('/tmp/chan.json'), D=require('./server/lib/drawing.js');
for (const x of [0,300,559]) console.log(x, D.checkLine({type:'hline',x1:x,y1:1270.33},a,{}).score);
"
# -> 80, 80, 100（559 命中的是同一点的「起点」「终点」两次 near-signal）

# 3) 40 条上限丢最新 + 缺 code 落共享桶（在 /tmp 副本上跑第二个实例，端口 8932）
curl -s -X POST http://127.0.0.1:8932/api/drawings -H 'content-type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({market:"A",code:"600519",period:"day",drawings:Array.from({length:45},(_,i)=>({id:"L"+i,type:"hline",x1:i,y1:100+i}))}))')"
# -> {"ok":true,"count":40,...}，L40..L44 消失

# 4) verify 输出 NaN（未净化入参）
curl -s -X POST http://127.0.0.1:8932/api/drawings/verify -H 'content-type: application/json' \
  -d '{"market":"A","code":"600519","period":"day","drawings":[{"type":"trend","x1":null,"y1":100,"x2":"zz","y2":101}]}'

# 5) 越界下标被夹到最后一根后照常给结论
node -e "
const a=require('/tmp/chan.json'), D=require('./server/lib/drawing.js');
console.log(D.checkLine({type:'trend',x1:900,y1:1300,x2:950,y2:1300},a,{}).findings.map(f=>f.text));
"

# 6) 交互状态机（最小 DOM stub，直接驱动 web/js/chart.js 的事件处理器）
node -e "const {chart,fire,pev}=require('/tmp/chart-harness.js');
chart.setDrawMode('rect'); fire('pointerdown',pev(100,101)); fire('pointermove',pev(120,103));
chart.setDrawMode('none');                                  // 相当于按 Esc
try{fire('pointermove',pev(180,105))}catch(e){console.log('CRASH',e.message)}
fire('pointerup',pev(185,106)); console.log('phantom rect:',chart.drawings)"
# -> TypeError: Cannot set properties of null (setting 'x2') / phantom rect: rect 100->185
```

（`/tmp/chart-harness.js` 用 `Proxy` 造假 canvas 上下文、假 `window/document/getComputedStyle/U`，同步调用 `pointerdown/move/up`、`touchstart/move/end` 处理器；`/tmp/chan.json` 是真实 `/api/chan?market=A&code=600519&period=day&limit=600` 的响应。）
