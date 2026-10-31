# chanlun-station 第三批改动 · 独立复核报告

- 复核时间：2026-10-31 23:24 ~ 23:5x（Asia/Shanghai）
- 复核对象：`/home/node/default/chanlun-station`，HEAD = `c78775f`（`git log --oneline -6` 见下）
- 服务：`http://127.0.0.1:8931`（未重启；`/api/health` uptime 117s 起，assetVersion `3c1f2d5e11`）
- 只读审查：我本人未修改任何仓库文件（写报告时核对：我自己只写了 `/tmp`、`/tmp/rv/`；复核中后期仓库出现的 3 处未提交改动**是他人所为**，见文末「附：复核期间仓库被他人改动」）。
- 浏览器：`/opt/dsh-browser/playwright.mjs` + `/opt/dsh-browser/chromium`，1440×900 与 390×844 两种视口。

```
c78775f fix(review2): 离开段语义统一(终点出界…)；框中枢只罚框窄；overlapPrev 画到图上+状态面板说明；srcaudit 响应体校验+腾讯proxy域名；新鲜度45天…
5aaa222 docs: v1.8 review fixes
a72c026 fix(review): 复核agent两条BLOCKER——撤销中枢合并 / 修t1恒undefined / 区间套补CNF/USF …
2721ed7 feat(mobile): 商品板块弹层
7d531c3 docs: sectors page
ee172dd feat(sectors): 商品板块页——88个期货品种分8组 …
```

---

## 结论速览

| 级别 | 数量 | 摘要 |
| --- | --- | --- |
| BLOCKER | 2 | **BLOCKER-2（当前线上）**：腾讯 K 线两个 host 在复核期间全部转 501，**港股（HK）日/周/月线现在彻底不可用**（`/api/kline`、`/api/chan` 均 500，结构页是 300×150 空画布），仓库里只有 A 股有新浪兜底、港股无任何兜底。<br>**BLOCKER-1（根因，未修）**：`c78775f` 的"腾讯 proxy 域名优先"基于**错误前提**改反了，`sources.js:525-527` 的注释与 hosts 顺序、`srcaudit.js` 源名、`docs/DATA_SOURCES.md:12` 三处互相矛盾；A 股靠后加的新浪兜底才没挂。 |
| MAJOR | 5 | 框中枢"价格轴宽容度"过宽 + explain 自相矛盾 + `fullyCovered` 冗余项；离开段/延伸在"终点恰好等于 ZG/ZD"上不对称且描述与实现不符；结构页 picker 回归（市场 tab 路径会重新展开选择器）；sectors 页在"改板块集合"的滚动发布下会出错；A 股/港股/美股**完全没有新鲜度校验**（搜到 2013 年指数照样当实时展示） |
| MINOR | 10 | `leave` 为 null 时前端崩溃（不可达但真实缺陷）、enter/leave 明细两份代码、框焦点/可访问性、手机端数字格式不一致与耗时、模块导入期随机密钥导致重启即 401、srcaudit 规则误判、`docs/DATA_SOURCES.md` 与代码相反、fetch 失败静默缓存、README/注释与代码不符等 |

第三轮"声称修好的三处"实测结论：

- **B 离开段语义**：主逻辑（"终点出界 + 紧邻"）在真实数据上自洽，`pivotviz` 六市场全绿；但"恰好等于 ZG/ZD"的边界行为与注释里"互为补集"的说法矛盾（见 MAJOR-2）。
- **C 框中枢**：精确框 100、整震荡区 100、乱框 0 都符合预期；但"框窄一半"不是 ~70 而是 95，"只框中心 25%"反而 67（比窄一半还低），`fullyCovered` 里的 `tScore/pScore >= 0.75` 不可能是否决原因（见 MAJOR-1）。
- **D 结构页永远出图**：裸进确实出图、收起后 canvas 回到 top=222；但"选择器展开时 canvas 被推到首屏外"**没有任何改善**（1440×900 可见 162.7px，与复审前一致）；`App.render()`/市场 tab/导航路径会在 `pickedSymbol=false` 时重新 `showPicker()`（见 MAJOR-3）。另：**数据失败时**结构页反而回到"空画布"——港股现在正是这样（见 BLOCKER-2）。

---

## [BLOCKER-2] 港股日线通道全线 501 —— HK 市场目前不可用（复核期间发生，仓库里没有对应兜底）

**位置**：`server/lib/sources.js:527`（`hosts`）、`server/lib/sources.js:715-730`（`klines()` 里 **只有 `m === 'A'` 有新浪兜底**）、`server/lib/sources.js:502`（`emKline` 的 `116.` 港股 secid 在本环境 `UND_ERR_SOCKET`）

**实测（与代码无关的外部变化，但项目没有承载）**：

```
$ node …fetch 两个 host…
sh600519 proxy.finance.qq.com 501<!DOCTYPE html><html><head><script>var i=location.href
sh600519 ifzq.gtimg.cn         501
hk00700  proxy.finance.qq.com 501
hk00700  ifzq.gtimg.cn         501
```

```
$ curl '/api/kline?market=HK&code=00700&period=day&limit=5'
{"ok":false,"error":"tencent: HTTP 501 / HTTP 501 | fetch failed","path":"/api/kline"}

$ /api/chan  HK 00700 / 09988 / 03690 / 01810 / 00981 / 02318 / 03175 → 全部 http 500 ok=false
$ /api/kline A 600519 / 000001 / 300750 → ok:true source:"sina-daily"（父代理复核期间新增的兜底救回来了）
```

浏览器（`/?desktop=1&m=HK&c=00700&p=day#structure`）：

```
note:   加载失败：tencent: HTTP 501 / HTTP 501 | fetch failed
title:  HK · 00700 · 日线
canvas: { w: 300, h: 150 }   非空像素比例: 0.0000     ← 空画布，没有任何降级/提示性图表
```

**为什么是问题**

- 港股是产品六大市场之一（导航 tab、自选池默认 `HK:00700`、板块页无港股但结构页有 HK 周期组），现在**所有港股结构分析都是 500**；`web/js/pages/structure.js:96-99` 的 catch 只把提示塞进 `#chartNote`，canvas 保持初始 300×150 空画布，用户看到的是"一片空白 + 一行英文报错"。
- 兜底只给了 A 股（`klines()` 里 `if (m === 'A')`）。新浪港股接口实测也不可用（`__ERROR:3 Service not valid`），东财在本环境 `UND_ERR_SOCKET`——也就是说**当前没有任何可用港股源**，需要明确降级策略（把 HK tab 禁用并说明原因 / 用 `qt.gtimg.cn` 快照拼当天 / 接一个能用的源），而不是 500。

**修复建议**：`klines()` 对所有市场统一走 `tryEach` 且失败时返回带 `ok:false` + 可读文案的结构化错误；前端在 `res.ok === false` 时隐藏 canvas 并显示"港股数据源暂不可用（腾讯 WAF 501）"；把 `matrixcheck` 的 HK 用例加进 CI，否则这类断源要等用户发现。

---

## [BLOCKER-1] 腾讯 K 线 hosts 顺序改反：proxy 域名才是被 WAF 拦的那个（原判断在复核中期已演变为"两个都被拦"）

**位置**：`server/lib/sources.js:525-527`（`tencentFq`），影响 `/api/kline`、`/api/chan` 的 A/HK 日/周/月线首源。

```js
// 主域名 ifzq.gtimg.cn 从 2026-10 起被腾讯 WAF 拦成 501，proxy 域名仍可用：
// 把可用的放前面，少一次无效请求
const hosts = ['https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get', 'https://ifzq.gtimg.cn/appstock/app/fqkline/get'];
```

**实测**（同一时刻、同样 Referer，三只标的）：

```
$ node -e "…fetch 两个 host…"
sh600519 proxy.finance.qq.com 501 378ms "<!DOCTYPE html><html><head><script>var i=location.href …waf.tencent.com/501page.html"
sh600519 ifzq.gtimg.cn         200 254ms "{\"code\":0,\"msg\":\"\",\"data\":{\"sh600519\":{\"qfqday\":[…"
sz000001 proxy.finance.qq.com 501  53ms
sz000001 ifzq.gtimg.cn         200 125ms
hk00700  proxy.finance.qq.com 501  44ms
hk00700  ifzq.gtimg.cn         200 123ms
```

- 每一条 A/HK 日线请求现在都要先吃一次 501 + WAF 脚本页，**再靠第二宿主兜底**才拿到数据（功能没死，但延迟和请求量翻倍，这个"兜底"一旦被限流就是全站 A/HK 不可用）。
- 这是 `c78775f` 自己引入的新问题：注释里的事实判断（"主域被拦、proxy 可用"）与实际完全相反；`scripts/srcaudit.js:22` 的 `tencent-kline (proxy)` 也因此在巡检里被标成"不可用"。

**证据（srcaudit 实跑）**：

```
✅ 可直接用（免 key）（14）
   腾讯行情[已接入]                    200 571ms
   腾讯K线(主域,已被WAF拦)              200 155ms · 501 页面 → 应用已自动降级到 proxy 域名
⛔ 域名层不可达（15）
   腾讯K线(proxy)[已接入]             599 60ms
已接入 10 个源，其中异常 1 个：腾讯K线(proxy)
```

```
### tencent-proxy-kline status=501 bytes=326
"<!DOCTYPE html><html><head><script>var i=location.href … window.location.href=\"https://waf.tencent.com/501page.html?u=…
### tencent-main-kline status=200 bytes=1997
"{\"code\":0,\"msg\":\"\",\"data\":{\"sh600519\":{\"qfqday\":[[\"2026-10-26\",\"1325.400\",…
```

**修复建议**：把 `hosts` 改回 `['https://ifzq.gtimg.cn/…', 'https://proxy.finance.qq.com/…']`，并把注释、`srcaudit.js:22-23` 的源名/备注（"主域被 WAF 拦"）和 `docs/DATA_SOURCES.md:12` 一起改对；否则下次巡检会继续误报 proxy。

---

## [MAJOR] 框中枢：价格轴宽容度其实是"最多 ~75%"，"框窄一半"拿 95 分，explain 自相矛盾

**位置**：`server/lib/game.js:305-330`（pivot 判分块）

### 实测（真实关卡 18，标准中枢 第 151~215 根 / 86.34~117.63，可见 225 根）

全部通过 `/api/game/level?no=18` + `/api/game/answer` 真实提交：

| 框 | score | stars | verdict |
| --- | --- | --- | --- |
| 精确框（i0~i1, zd~zg） | 100 | 3 | 框得很准 |
| 框住整个震荡区（0~224, 53.89~120.48） | 100 | 3 | 框得很准 |
| **时间极宽 + 价格精确**（第 5~215 根，= 锚点随便点） | **100** | 3 | 框得很准 |
| **价格极宽 + 时间精确**（zg 以下随便扩到 53.89） | **100** | 3 | 框得很准 |
| **价格只框下半 50%**（86.34~101.98） | **95（宣称应 ~70）** | 3 | 框得很准 |
| 只框价格带中间 25%（98.07~105.90） | 67 | 1 | 大致框住了 |
| 时间只框前半 50%，价格精确 | 72 | 2 | 大致框住了 |
| 乱框（第 0~3 根，远端空白） | 0 | 0 | 没框到中枢 |

```
[价格极宽+时间精确] score=100 stars=3 verdict=框得很准
    你的框：第 151~215 根，53.89~120.48。时间吻合 100%、价格吻合 100%（完整覆盖标准中枢）。
[时间精确, 价格只有下半 50%] score=95 stars=3 verdict=框得很准
    你的框：第 151~215 根，86.34~101.98。时间吻合 100%、价格吻合 100%（没有完全框住，把范围放大一点）。
```

### 为什么是问题

1. **TOL_PX = pCap*0.25 被算了两遍**：`pScore = pInter / (pCap - 2*TOL_PX)`，分母已经是 50% 的高度，等于把宽容度翻倍放成 ~75%；结果"框住一半"也算"价格吻合 100%"。
2. **`raw = 0.5*tScore + 0.5*pScore - underPenalty * 0.0`**：`* 0.0` 让 `underPenalty` 变成死代码；未 `fullyCovered` 时只扣 `(1-tCover)*0.1 + (1-pCover)*0.1`，扣分极轻，"框窄"根本没有被真正惩罚（标题宣称"只罚框窄"，实际是"既不罚宽也不罚窄"）。
3. **explain 与分数自相矛盾**：同一段文案里既写"价格吻合 100%"又写"（没有完全框住，把范围放大一点）"，而 verdict 是"框得很准"、三星。
4. **`fullyCovered` 里的 `tScore >= 0.75 && pScore >= 0.75` 是冗余的**：`tScore = tInter/(tCap-4)`，只要 `tCover = (i1-i0)/tCap >= 1` 就必然 `tScore >= 1`（同理 `pScore >= 1`）。所以这两条**永远不会**让"完全覆盖但极宽"的框掉到非 100；真正掉到非 100 的原因是 `tCover/pCover` 的门槛 `>= 1` + 浮点。
5. **可刷满分**：只框价格带、时间锚点随便点（151/151 个起点、9 个上沿取值全为 100 分），"找中枢区间"这个考点实际退化成"价格带画对就行"。
6. **反向不单调**：把价格框收窄到中间 25% 得 67 分，比"只框下半 50%"的 95 还低——玩家把框收窄反而"更错"，与"只罚框窄"的设计意图不一致。

### 修复建议

去掉分母里的 `2*TOL_PX`（保留一个 `TOL_PX` 做端点容差），`pScore` 与 `pCover` 用同一"覆盖"口径；把 `underPenalty` 真正接进去（或删掉）；未满覆盖时把 explain 的"吻合 100%"改成真值（例如显示覆盖比例），并让 verdict 与"没有完全框住"一致；`tScore/pScore >= 0.75` 两条约束删掉或改成对 **框的尺寸占比** 的限制（如 `(i1-i0)/n <= 0.6`）才能真正惩罚"框全图"。

---

## [MAJOR] 离开段/延伸边界不对称：终点恰好等于 ZG/ZD 判为"延伸"，但注释称"互为补集"；注释对"方向"的描述与实现不符

**位置**：`server/lib/chan.js:290-300`（延伸循环 `p1 <= zg && p1 >= zd`）、`server/lib/chan.js:270`（注释"p1 > ZG 或 p1 < ZD"）、`server/lib/chan.js:270-273`（"起点必然贴着中枢边界"）

### 构造边界数据（`/tmp/lv6.js`、`/tmp/lv8.js`，合成 K 线 + 真实 `buildBis/buildPivots`）

```
== A1 笔4 up 105->110 恰好==zg
  bis: 0[dn] 110.5->99.5  1[up] 99.5->120.5  2[dn] 120.5->104.5  3[up] 104.5->110.5
  #0 zg=110.5 zd=104.5 end=3(count 3) leave=null          ← 终点 == ZG，判"延伸"
== A3 笔4 up 105->109 区间内
  #0 zg=109.5 zd=104.5 end=3(count 3) leave=null
== B3 笔5 dn 109->105 恰好==zd
  #0 zg=109.5 zd=104.5 start=1 end=4(count 4) enter=0 leave=null   ← 终点 == ZD，判"延伸"
== B1 笔5 dn 终点 104.99 略下于 zd
  #0 end=3(count 3) leave=4  → 离开段 4: 109.5->104.49 终点在区间内=false leave===end+1? true
== B2 笔5 dn 终点 104 出下界
  #0 end=3(count 3) leave=4  → 离开段 4: 109.5->103.5  leave===end+1? true
```

**自洽性**：两种情况下 `leaveBi = endBi + 1`、`enterBi = startBi - 1`、`count = endBi-startBi+1` 都成立（真实数据 13 只标的 78 个中枢 + 合成样本 0 违例），"leaveBi 跳过 enterBi"的矛盾**没有出现**。

**但存在三个语义瑕疵**：

1. **不是严格补集**：注释/README（`README.md:268` "终点落在 `[ZD, ZG]` 内；终点出界即离开段"）把"延伸"和"离开段"表述为补集，实际实现是 `p1 ∈ [ZD, ZG]` 才延伸，`p1 == ZG` / `p1 == ZD` 判延伸，而"终点出界"应从 `> ZG` / `< ZD` 起算——边界上两种读法都能说得通，但代码与注释没有把这个边界定义讲清楚，且 `pivotviz.js:76` 的断言写的是 `lb.p1 > p.zg || lb.p1 < p.zd`（严格），三者只在容差 1e-6 内一致，属于"碰巧一致"而不是"完全一致"。
2. **"离开段起点必然贴着中枢边界"是错的**：实测离开段的起点常常在区间**外**（合成 B1/B2 里离开段起点 109.5 > ZG=109.5 的邻域、A5 里起点 196.5 = ZD，真实 `p.leave.p0` 也大量在区间外）。真正的笔离开只能是"从中枢内某点出发"，而这里离开段是**下一整笔**，起点在上一笔终点，可能在区间外。注释把一个更强的结论当成了理由。
3. **方向不对称**：中枢形成于 `[ZD, ZG]`，但后续笔向上延伸到正好 `p1 = ZG` 算延伸（`<=`），向下正好 `p1 = ZD` 也算延伸（`>=`），这意味着"恰好回踩边界"永远不算离开——在缠论上"回踩到 ZD 不破"确实是延伸，这一点没错；但既然 `pivotviz.js` 断言用的是严格不等号，建议统一写成显式的"闭区间 = 延伸"并在断言里加边界用例，避免以后改容差时悄悄反转。

**修复建议**：把 `endsInside` 改成显式函数 `inRange = (v) => v >= zd - EPS && v <= zg + EPS` 并在注释/README/`pivotviz.js` 断言里用同一句话描述（"终点落在闭区间 [ZD, ZG] 内即延伸，否则为离开段"）；删掉/改写"起点必然贴着中枢边界"这句（它不是判据成立的原因），改为"离开段 = 中枢后第一条终点出界的笔，其起点是上一笔终点，可以已在区间外"。

---

## [MAJOR] 结构页 picker 回归：走"市场 tab / 导航 / `App.render()`"会重新展开选择器，canvas 又被推到首屏外

**位置**：`web/js/pages/structure.js:648-652`（`renderPage()` 里 `if (App.state.pickedSymbol) hidePicker(); else showPicker();`）+ `web/js/app.js:67-76`（市场 tab 点击 → `App.render()`）+ `web/js/pages/structure.js:61-62`（`refresh()` 开头又调一次 `bindPickerOnce()`，但只有 `renderPage` 管显隐）

### 实测

```
新会话（无 ?c=）:              picker=block canvasTop=737          ← 首次引导
点击 #switchSymbol:            picker=none  canvasTop=222          ← 换完图
App.openStructure('CNF','AL0') → 点 #marketTabs[data-market=CNF]:
   { title: 'CNF · AL0 · 日线', picker: 'none', canvasTop: 222 }   ← 本次恰好不再展开（因为 CNF 市场下标还没点过？见下）
```

更直接的复现（用户上一轮 BLOCKER 的场景：**收起选择器后，用 `App.render()` 重渲染结构页**）：

```
await App.openStructure('CNF','AL0');   // 深链
页面内 App.state.pickedSymbol = true
→ 任何走 App.render() 的路径（市场 tab、导航、实时 tick 触发重渲染、?live 刷新）
```

在本次复现里，`App.state.pickedSymbol` 为 true 时 picker 确实隐藏。**真正的回归点在"本次会话还没显式选过标的"这一分支**：

实测（`/tmp/rv/ui5.mjs`，全新会话，`?desktop=1#structure`）：

```
初始:                 sc=737.28  disp='block'    ← 裸进：选择器展开，canvas 顶在 737
换标的(未收起时):      sc=222.41  disp='none'     ← 点"换标的"把选择器收起
再点一次"换标的":      sc=717.28  disp='block'    ← 再展开，canvas 又掉回首屏外
```

即：**选择器展开 → canvasTop=737，1440×900 首屏只剩 900-737=163px 可见**，与上一轮复审报告里的"<170px"**完全一致，没有任何改善**。`renderPage()` 每次进结构页都会在 `pickedSymbol=false` 时 `showPicker()`，所以"导航回结构页""市场 tab""实时刷新重渲染"都可能把用户刚收起的面板重新拉开（取决于 `pickedSymbol` 状态），而且展开态下永远把图表推到首屏外。

第二个回归：`bindPickerOnce()` 在 `refresh()` 里也被调用，但 `pickerBound` 只保护了事件绑定，显隐只在 `renderPage()` 处理——两处职责分裂，任何新增的 `App.render()` 调用点（例如 `app.js` 的实时 tick 里对 structure 的重渲染）都会走到"没有显式选标的 → 展开"分支。

### 修复建议

1. 把"是否展开"做成显式状态（`App.state.pickerOpen`，默认 false），`renderPage()` 只在**首次进入且没有 `?c=`** 时展开一次，之后任何重渲染都尊重用户最后一次选择（收起/展开）。
2. 展开时**不要**把图表整体顶下去：把 `#symbolPicker` 改成浮层/抽屉（`position:sticky` + 最大高度 + 内部滚动），或展开时保持 `#structBody` 的 `scroll-margin-top`，保证 canvas 始终在首屏。
3. 加一条 uicheck 断言：`picker.style.display !== 'none'` 时 `#mainChart.getBoundingClientRect().top < innerHeight - 200`。

---

## [MAJOR] 板块页对"滚动发布"不安全：固定 `catalog[0].id` 与缓存目录，跨部署时会出现"标签高亮 A、列表是 B"

**位置**：`web/js/pages/sectors.js:47-58`（`curId` 只在 `!curId` 时取 `catalog[0].id`；`catalog` 是模块级缓存）、`web/m/js/mobile.js:396-435`（`openSectors` 里 `load(catalog[0].id)`）

### 实测（`/tmp/rv/ui7.mjs`：拦截 `/api/sectors` 轮转首板块 + 第一次请求延迟 2.5s，`/api/sector` 延迟 3s）

```
{"tabs":["precious","ferrous","energy","agri","fin","index","light","base"],
 "active":"precious","cards":["AG0","AU0","GC","SI"]}
列表首项是否与 active 板块一致: AG0 precious        ← 轮转后仍一致（因为 curId 与目录同一次渲染取自同一份响应）
```

**本次未触发**，但代码路径上确实存在不一致窗口：

- `catalog` 一旦缓存就永不刷新（`/api/sectors` 只在页面首次 `render()` 时取一次），而 `catalog[0].id` 在部署切换（板块集合变化、`ZC0/WR0` 这类剔除）后会变。
- `render()` 的 `curId` 只检查"当前 id 是否还在新目录里"，**不检查它的位置**；标签高亮用 `curId`，列表也按 `curId` 取——两者一致，但用户看到的"默认板块"会随部署漂移，且手机端 `openSectors()` 每次都硬取 `catalog[0].id`，桌面端却保留 `curId`，两端默认不一致。
- `getQuoteMap` 是逐板块 N 个品种的批量请求；`/api/sector?id=` 一次返回整板块，失败时前端只把 head 改成"实时行情拉取失败"，卡片仍停在"加载中…"（实测 `模拟失败` 后 `豆一 | A0 | — | 加载中… | DCE`），用户会以为一直在加载。

**修复建议**：`curId` 在目录变化时按"id 优先、否则首板块"处理并写入 URL（`#sectors/base`）；`catalog` 加短 TTL（如 60s）或在 `visibilitychange` 时失效；失败态把卡片文案改成"行情暂不可用"而不是"加载中…"。

---

## [MAJOR] 新鲜度校验只覆盖期货；A 股/港股/美股毫无陈旧数据保护，搜索能进来 2013 年的指数并当作实时画

**位置**：`server/lib/sources.js:160-166`（仅 `sinaFuturesDaily` 有 45 天校验）；`server/lib/sources.js:984-1010`（`search()` 把腾讯搜索命中的 `A:399137` 原样返回，无可用性校验）；`server/lib/sources.js:527-545`（`tencentFq` 只判 `bars.length < 10`）

### 实测

```
$ curl '/api/kline?market=A&code=399137&period=day&limit=60'
http 200 bars 60 last=2013-03-01        ← 距今 13 年，当"最新日线"返回
$ node -e "S.klines({market:'A',code:'399137',…})"
A 399137 source tencent bars 60 first 2012-11-28 last 2013-03-01 warning? -
```

浏览器（`/?desktop=1&m=A&c=399137&p=day#structure`）：

```
标题   A · 399137 · 日线
note   数据源：tencentK线 600 根 → 合并 487笔 47 / 线段 7 / 中枢 11 级别：日线级别
状态   现价 | 913.03（0.00%）| 趋势类型 盘整 | 当前中枢 [812.90, 836.96] · 3 笔 | …
liveStamp 23:37:59 更新          ← 页面上仍显示"更新"，没有任何陈旧提示
```

另外搜索链路里还有多个**搜得到却打不开**的条目（`/api/search?q=铜|原油|A` 命中）：

```
A:000076   http 500 bars 0 tencent: HTTP 501 / 空数据 | fetch failed | sina 日线无数据
US:copx.am http 500 bars 0 nasdaq 无数据 | sina-us 无数据 | AlphaVantage 限流或需正式 key | fetch failed
US:emet.am http 500 bars 0（同上）
US:oilk.am http 500 bars 0（同上）
US:usoy.oq http 500 bars 0（同上）
```

50 天前的 `301139` 也一样：`/api/kline` 返回 last=2026-10-27，但 2013 年的 `399137` 却无任何提示——说明"45 天"这条规则只治了期货。

**修复建议**：把新鲜度检查提到 `klines()` 出口（对所有市场统一）：`ageDays > 45` 时返回 `stale: true` + 页面顶部黄条"数据截至 2013-03-01"；搜索结果的 `push()` 增加一层"最近 N 天有没有数据"的缓存过滤（或在结构页对 500 结果给"换一个标的"引导）。

---

## [MINOR] `leave` 为 null 时仍做 `p.leave.p0`，前端会抛 TypeError（当前 chan.js 不可达，但防护缺失）

**位置**：`web/js/chart.js` 中枢绘制区（`p.leave.p0/p1` 使用处，约 430-470 行附近）、`server/lib/chan.js:325`（`leave` 只在 `leaveBi != null` 时给，`leaveBi == null` 是两个中枢之间的**常态**）

实测数据：`A 600519` 最后一个中枢 `p.leaveBi = null`；`CR BTCUSDT` 等多个样本也存在。浏览器中目前没崩，是因为绘制分支先判了 `p.leaveBi`；但 `annotate()` 里 `p.leave` 与 `p.leaveBi` 是两处独立赋值，一旦有人只判 `p.leaveBi` 而读 `p.leave.p0`（或反过来），就会 500/白屏。

**修复建议**：统一以 `p.leave` 为准（`leaveBi` 由 `leave ? leave.bi : null` 派生），或在前端所有画图入口先 `if (!p.leave) skip`。

---

## [MINOR] enter/leave 明细在 `buildPivots` 与 `annotate` 里各写一份，容易漂移

**位置**：`server/lib/chan.js:324-325`（写一次）与 `server/lib/chan.js:364-365`（`annotate` 又写一次）

实测 78 个中枢 enter/leave 明细与 `bis` 完全一致（`enter mismatch 0 / leave mismatch 0`），但两处重复构造同一个对象，属于典型"将来改一处忘另一处"的隐患（`t1` 就曾这么出过 bug）。

**修复建议**：`annotate()` 里删掉 enter/leave 的二次构造，只做 `overlapPrev` 与 `idx` 的补充。

---

## [MINOR] 框选的交互与无障碍：键盘/触屏用户无法作答，一题一次答错就作废

**位置**：`server/lib/game.js:239-247`（`att.used = true` 单次有效）；游戏前端框选依赖鼠标拖拽

`ATTEMPTS` 单次有效是设计意图（防试错），但 `answer:{box:{x1,x2,y1,y2}}` 允许提交空框（`{x1:0,x2:0,y1:0,y2:0}`）且得 0 分、"没框到中枢"，**没有参数校验**——`x1 > x2`、NaN、越界都不报错，直接按 0 分结算并消耗唯一一次机会。对触屏/键盘用户来说这是一次性"误触即废"。

**修复建议**：`answer.box` 做数值/顺序校验，非法时返回 400 而不是判 0 分；前端给键盘（Tab+方向键调 x1/x2/y1/y2）或"重做本题"一次机会。

---

## [MINOR] `explain` 文案模板与实际分支不一致（"把范围放大一点"对"框宽了"也出现）

**位置**：`server/lib/game.js:334`

`tCover >= 1 && pCover >= 1 ? '（完整覆盖标准中枢）' : '（没有完全框住，把范围放大一点）'` —— 当用户框**比中枢大很多**但因为浮点/覆盖边界被判非满分时（例如价格框超宽、时间框超宽），文案仍然说"把范围放大一点"，方向相反。

**修复建议**：按 `pScore < pCover`（框窄）还是 `(hi-lo) > pCap`（框宽）分别给文案。

---

## [MINOR] 手机端板块弹层与桌面端数字格式/价格口径不一致

**位置**：`web/m/js/mobile.js:404-415`（`px = it.price >= 1000 ? it.price.toFixed(1) : toFixed(2)`；无 `T0/TF0/TS0/TL0` 处理、无千分位）、`web/js/pages/sectors.js:21-26`（`/^T[FSL]?0$/` 三位小数、`>=1000` 保留 1 位）

实测同一时刻：

```
桌面 沪铝 AL0  23395.0    手机 沪铝 AL0  23395.0
桌面 沪铜 CU0  108050.0   手机 沪铜 CU0  108050.0
桌面 T0（10年国债，会走 toFixed(3)） 手机 T0  走 toFixed(2)   ← 国债期货价格差一个数量级精度
```

而且手机端 `openSectors()` 是 `async`，**入口按钮点击后要等 `/api/sectors` 返回才弹层**（桌面端有骨架/加载态，手机端是"点了没反应"）。实测移动视口下点"商品板块 · 有色/黑色/能化/农产品/贵金属"到弹层出现约 1.2~2s。

**修复建议**：手机端复用同一套 `fmtP/fmtPct`（抽到 `ui.js`），先弹层再异步填目录；T0 系列三位小数。

---

## [MINOR] `GAME_SECRET` 未设置时在**模块导入期**随机生成，任何 `require('./server/lib/game')` 都会让正在跑的服务的关卡 token 全部失效

**位置**：`server/lib/game.js:22-23`

```
$ node -e "require('./server/lib/game')"
[game] GAME_SECRET 未设置，已随机生成（重启后旧关卡会失效，属预期）
```

任何运维脚本/测试（我本次为了做反例就 `require` 了 game）都会打印这条并生成新密钥——虽然进程内 `tokenFor` 与 `gradeLevel` 用同一密钥所以自洽，但**多进程/热重载**场景下会出现"出题进程 A、判分进程 B"密钥不同 → 所有提交都"校验失败"。`docs/GAME.md` 没有说明必须设 `GAME_SECRET`。

**修复建议**：在 `.env.example`/`docs/GAME.md` 里把 `GAME_SECRET` 写成部署必填；未设置时打到 `data/` 下持久化一个随机密钥而不是每次启动新生成；导入期只 warn（现在就是 warn，但应该更醒目）。

---

## [MINOR] `srcaudit` 响应体规则会误判合法行情 JSON，也放过部分错误体

**位置**：`scripts/srcaudit.js:88-96`

用同一段逻辑跑边界输入（`/tmp` 内复刻）：

```
合法行情: {"error":0}                  badBody=true   ← 误判（cryptocompare/okx 常见 error:0 表示成功）
合法行情: {…"Information":"600519"…}    badBody=true   ← 误判（字段名含 Information）
合法 K 线 JSON                          badBody=false
错误: Error Message / Information / Note / error  badBody=true（OK）
通用 HTML 首页 / WAF 501 页               badBody=true（OK）
```

- `/"error"/i` 无法区分 `"error":0` 与 `"error":"invalid"`；
- 没有状态码与 body 的交叉判断（HTML + 200 判 599 是对的，但 JSON 里 `code: 9501` 这种业务错误不判）。
- 另外 `looksCsv = /^\s*\S+,\S+/m` 对 HTML 里的 `<td>1,2` 之类也会误判为 CSV，实际靠后面的 HTML 分支兜住。

**修复建议**：先尝试 `JSON.parse`，只对"顶层 `error` 为**非零/非空**"或顶层 `code` 非 0 判坏；`Information/Note` 只在它是顶层键且 body 里没有业务数据字段时判坏。

---

## [MINOR] `scripts/pivotviz.js` 断言抓不到"画图用的明细数据"和"时间轴"两类错误

**位置**：`scripts/pivotviz.js:71-101`

用真实 600519 数据做反例（`/tmp/fudge.js`，只改内存对象）：

```
baseline fails: 0
倒挂区间 zg<zd                                抓到
离开段跳过一段 (leave=end+3)                   抓到
区间整体上移 1000（内部段不相交）               抓到
延伸段终点越界却不算离开                        抓到
p.leave.p1 与 bis 不一致（画图数据源）           ❌ 没抓到
p.enter.dir 与 bis 不一致                       ❌ 没抓到
中枢时间轴重叠（i1 超过下一中枢 i0）             ❌ 没抓到   ← 文件头注释第 6 条声称检查
中枢时间倒序                                   抓到（借 t1 断言）
```

- 文件头写着"6. 中枢不在时间轴上倒序/重叠"，但**没有任何断言**检查 `p.i1 <= q.i0`；
- 前端画箭头用的是 `p.leave.p0/p1`、`p.enter.dir`（不是 `bis[...]`），这两份数据没有被比对。

**修复建议**：加 `ok(p.i1 <= q.i0)`；加 `ok(p.leave.p1 === bis[p.leaveBi].p1 && p.leave.dir === bis[p.leaveBi].dir)` 和 enter 的同款断言；加一条边界用例（`p1 === zg` / `p1 === zd`）固定"闭区间=延伸"语义。

---

## [MINOR] `scripts/matrixcheck.js` 的断言过宽：只测 30/82 个品种，"中枢字段"检查恒真

**位置**：`scripts/matrixcheck.js:59-70`

- `enabled` 断言 `ok(ch.ok && bis >= 5, …)`：`bis >= 5` 对任何 600 根日线都恒真，不能证明中枢/买卖点/背驰算对；而且**不检查 `ch.ok` 失败时 `error` 是否为空**。
- `ok(noEnter === 0, …)`：只查 `enterBi === undefined`，`null`（合法值，第一个中枢）和 `NaN` 都会通过。
- **覆盖只有 20 个股票 + 10 个期货**（`CASES`），而板块页现在挂 82 个期货品种；`matrixcheck` 的"208 项"里没有任何一项来自 `/api/sectors`、`/api/sector`、`/api/game/*`。
- `ok(ageDays < 45)` 只对矩阵里的品种生效（所以 399137 这种永远测不到）。

**修复建议**：把板块目录的 82 个品种纳入矩阵（或新增 `check:sectors`），断言 `items.length === count`、每个 `code` 都能 `/api/kline`；中枢断言改成"每个中枢的 `enterBi` 满足 `enterBi === startBi - 1 || startBi === 0` 且 `leaveBi === endBi + 1 || leaveBi === null`"；`enterBi` 检查用 `!('enterBi' in p)`。

---

## [MINOR] `docs/DATA_SOURCES.md` 与代码相反；`data/fetch 失败`静默缓存；README/注释与实现不符

**位置**：`docs/DATA_SOURCES.md:12`、`server/lib/http.js`（`cached()`）、`README.md:329`、`README.md:447`

- `docs/DATA_SOURCES.md:12`：`ifzq.gtimg.cn → we use ifzq.gtimg.cn and proxy.finance.qq.com`——与 `sources.js` 的"proxy 优先"注释以及实测（proxy 才被拦）三方相互矛盾。
- `README.md:329` 仍写"最后一天 >90 天前"，而代码 `sources.js:164` 已是 45 天。
- `README.md:447`（v1.9）写"`srcaudit` 加响应体校验（IBKR/门户页判为不可用）"——但实测 IBKR 等仍是 `599`/`UND_ERR`，很难从 README 复盘到底哪一项被这套校验捕获。
- `/tmp` 抓包：`A:000076` 的 `/api/kline` 返回 500 `tencent: HTTP 501 / 空数据 | fetch failed | sina 日线无数据`，其中 `fetch failed` 来自 AlphaVantage/兜底源的**底层异常被吞成字符串**，看不到根因；`cached()` 对失败的失败结果（实测 500 之后的再次请求仍是"加载中…"）缺少"失败短 TTL"的统一约定，不同源各写各的。

**修复建议**：同步文档；`cached()` 支持 `staleMs`（失败后 30s 内直接返回错误，不再打上游）；错误串里带上源名与状态码。

---

## [MINOR] 手机端 `openSectors` 闭包：不泄漏，但 `seq` 只在一次 `after()` 内有效，关闭弹层后不会取消在途请求

**位置**：`web/m/js/mobile.js:396-435`（`seq` 定义在 `after` 内）、`web/m/js/mobile.js:991-994`（`closeSheet` 只改 class）

实测（390×844，移动 UA）：

```
弹层正常：标签 8 个（有色金属 8 … 林木轻工 3），首板块 AL0…ZN0 全部有价
连点 energy→agri→light：激活 light，列表首项 BB0，items 3   ← 竞态保护有效
点"外盘指数"首项 ES → 跳 /m/?tab=structure#structure，标题 "美期货 · ES · 日线"  ← 正常
5 次开/关弹层新增监听 93 个（每次 openSheet 重建 innerHTML，旧节点被 GC，不属泄漏）
```

结论：**没有闭包/内存泄漏**；但 `closeSheet()` 不 `seq++`，关闭后到达的响应仍会写 `#secList`（节点已被下一次 openSheet 替换，实际无害，但语义上应在关闭时取消）。

---

## 其他需要记录的小问题

- `web/m/js/mobile.js` 的板块数字没有千分位（`23395.0` vs 桌面 `23,395.0` 的差异仅来自 `U.fmt`），`T0` 系列精度与桌面不一致（见上）。
- `server/lib/game.js` 的 `pScore=0` 时 verdict 仍是"框得很准/大致框住了"（实测"时间对价格错"得 50 分、"框得很准"以下），星级与文案分离。
- `server/lib/sectors.js:123` 用 `code.endsWith('0')` 推断市场：**本次全量核对通过**——`FUTURES_META` 82 条与 `CNF_LIST`(66)/`USF_LIST`(16) 完全一一对应，没有"以 0 结尾但不是国内期货"的代码（USF 全是 1-2 字母，如 `CL/GC/ES`），也没有"国内期货不以 0 结尾"的（`T0/TF0/TS0/TL0` 都以 0 结尾）。但这是**隐式契约**，任何人往 `FUTURES_META` 加一个 `M2601`（具体合约）或 `IF`（无 0 后缀写法）就会静默分错市场；测试 `test/chan.test.js:268` 用的也是同一条推断规则，等于"自己验证自己"。

  ```
  CNF_LIST 66 USF_LIST 16  FUTURES_META 82
  meta not in lists: []   CNF_LIST not in meta: []   USF_LIST not in meta: []
  catalog total 82 unique codes 82  CNF derived 66  USF derived 16
  meta codes ending 0 but not in CNF_LIST: []   meta codes not ending 0 but in CNF_LIST: []
  ```
  → 建议 `FUTURES_META` 显式写 `market`，`bySector()` 不再推断。

---

## 逐条回答"必须实际验证的点"

### A. 板块页

- `/api/sectors` 返回 8 个板块，`/api/sector?id=` 8 个 id 全部 200 且有数据；未知 id 返回 **400**：`{"ok":false,"error":"未知板块: nope","path":"/api/sector"}`。
- `code.endsWith('0')` 推断市场：**全量核对无错误**（见上），但属隐式契约。
- 目录 82 个品种**全部** `/api/kline` 取到 600 根（CNF 66 + USF 16，非抽查，全量）：
  ```
  total 82 empty 0   ；last dates [ '2026-10-30', '2026-10-29' ]
  ```
  （该脚本把 `BB0` 的 first=2018-09-14 也打出来了；`BB0/FB0` 数据本身是全的，只是起点早。）
- 竞态保护：人为延迟 `precious` 3s、`base` 80ms，快速"precious→base"，最终仍是 base 的价格，未被慢响应覆盖（`seq` 生效）。**但**目录缓存 + `catalog[0].id` 的跨部署问题见 MAJOR-4。
- 手机端 `openSectors`：`openSheet(title, html, after)` 的 `after` 同步执行，`load` 与 `seq` 都在闭包里，弹层关闭后节点 GC，无泄漏；关闭时不取消在途请求（MINOR）。

### B. 中枢"离开段"

- 注释/实现/断言三处的**主判据**一致（终点出界 + 紧邻），但边界（`===ZG/ZD`）与"互为补集""起点必然贴边界"的描述不一致（MAJOR-2）。
- `node scripts/pivotviz.js` 跑 6 市场（A 600519、HK 00700、US TSLA、CR ETHUSDT、CNF RB0、USF CL）**全部 exit=0、0 fails**；另测 A 000001、A 600519、HK 00700、US AAPL、CR BTCUSDT、CNF CU0、USF GC/CL 亦全绿。
- 离开段/进入段交接：13 只标的 78 个中枢，`leaveBi !== endBi+1` 0 次、`enterBi !== startBi-1` 0 次、`q.startBi > p.leaveBi` 恒成立；"同一条笔既是 A 的离开段又是 B 的进入段"——结构上允许且**没有产生矛盾**（B 的 `startBi` 恒 > A 的 `leaveBi`）。

### C. 框中枢判分

见 MAJOR-1。精确框 100 / 整震荡区 100 / 乱框 0 达标；框窄一半 **95（不是 ~70）**；`tScore/pScore >= 0.75` 是冗余条件；explain 已出现自相矛盾。

### D. 结构页

- 裸进 `/?desktop=1#structure`：图出现，`canvas 820×560`（canvas 尺寸 normal），`structBody` 在 y=593；但 **canvasTop=737.28，1440×900 首屏只可见 162.7px**（与复审前一致，未改善）。
- 点"收起"：`canvasTop=222.4`，整图 560px 全可见，`scrollY=0`（不跳位）——**正常**。
- 点"换标的"：能重新展开（`display=block`，canvasTop 回到 717）；再点一次收起——**正常**。
- 选期货标的（CNF IF0 / USF ES / USF NQ）后刷新：URL `?m=CNF&c=IF0&p=day#structure`，标题 `CNF · IF0 · 日线`，**不会变回 A 股**——正常。
- 但 `App.render()` 路径（市场 tab / 导航 / 实时 tick）在 `pickedSymbol=false` 时会重新 `showPicker()`（MAJOR-3）。

### E. 数据层

- 45 天：82 个期货品种日线全部通过，最新为 2026-10-30 / 2026-10-29（模拟 2026-10-31 周六），距离 1~2 天，长假后首个交易日（≤10 天）也不会误伤；但**误伤不了也保护不了股票**（MAJOR-5）。
- 腾讯 proxy：**复核开始时** A/HK 仍靠第二宿主可用（首个宿主每次 501）；**复核中后段两个宿主都转 501**，A 股由新浪兜底恢复，港股全挂（BLOCKER-2）。hosts 顺序与注释仍是错的（BLOCKER-1）。
- 别名白名单：`金`→`GC/AU0`（只有别名精确匹配）、`铜`→`HG/CU0/BC0`、`原油`→`CL/SC0/QM`、`A`→只命中中文名（`A股指数/阿里…`，无 `AL0/AU0/A0`）、`元`→只命中中文名，**均不再命中不可用品种**；但腾讯接口匹配出的 `A:000076`、`US:copx.am` 等仍会 500（MAJOR-5）。

### F. 三个校验脚本

- `srcaudit`：对正常行情 JSON 会误判（`{"error":0}`、字段名含 `Information`）（MINOR）。
- `pivotviz`：几何错误能抓到 4/7 类，抓不到 enter/leave 明细与时间轴重叠（MINOR）。
- `matrixcheck`：`bars.length >= 200` 是有效约束（82 个品种日线最少也有 600 根，但矩阵只测 30 个）；`bis >= 5`、`noEnter === 0` 属于"宽松/恒真"（MINOR）。

---

## 已验证正常（清单）

1. 8 个板块 id 全部 200 且有数据；未知 id 400（含错误信息与 `path`）。
2. `/api/sectors` 与 `/api/sector` 的 `count` 与 `items.length` 一致，82 个品种无重复。
3. 目录 82 个品种**全部**能取到 600 根日线（非抽查），且 `code.endsWith('0')` 的市场推断与 `CNF_LIST/USF_LIST` 完全一致。
4. 桌面板块页：8 个标签、卡片价格/涨跌幅/交易所正常渲染，颜色/字号正常（1440×900 截图确认）。
5. 桌面板块页竞态保护（`seq`）：人为延迟下快速切板块，旧响应不覆盖新板块。
6. 手机端板块弹层：标签横向滚动不压叠（`#secTabs .sq{flex:0 0 auto}` 生效），列表价、板块切换、点击跳结构页均正常；无闭包泄漏。
7. `openSheet` 关闭函数内定义 `load` 无泄漏（节点重建、事件随之 GC）。
8. `chan.js` 离开段主判据（终点出界）+ 紧邻（`leaveBi === endBi + 1`）+ 进入段紧邻（`enterBi === startBi - 1`）在真实数据与合成边界数据上均自洽；`t1 === bars[endBi.i1].t`、`count === endBi-startBi+1` 成立。
9. `pivotviz.js` 六市场全绿（exit 0 / 0 fails）。
10. `npm test`（node --test）**70/70 通过**。
11. 框中枢：精确框 100、框住整个震荡区（全图）100、乱框 0、只框时间半边 72、只框价格中间 25% 67 —— 顺序合理（问题在"价格框一半仍 95"与文案）。
12. 结构页裸进出图（`canvas 820×560`），"收起"后 canvas 回到 top=222、`scrollY` 不跳。
13. "换标的"能重新展开选择器；选择期货标的后刷新仍停在期货图（URL/标题一致）。
14. ~~A/HK/US 日线数据源仍可用~~ —— **已于复核期间过期**：复核开始时 A/HK 均可用（`A 600519 last=2026-10-30`、`HK 00700 last=2026-10-30`），复核后期腾讯两 host 全 501，A 股改走 `sina-daily` 仍可用（`US AAPL` 走 nasdaq、`CR BTCUSDT` 走 binance、`CNF RB0`/`USF GC` 走 sina-futures 均正常），**HK 全挂**，见 BLOCKER-2。
15. 搜索别名白名单："金/铜/原油/A/元" 不再命中 `AL0/AU0/A0/AG0` 等不可用代码。
16. `overlapPrev` 在真实数据中大量出现（600519: 10 个中枢中 6 个 `overlapPrev`），图上"扩展"角标与状态面板"与前一中枢重叠（扩展形态）"文案一致。
17. 浏览器控制台无 `pageerror`（桌面结构页、板块页、手机板块弹层均 0 错误）。

---

## 附：复核期间仓库被他人改动（记录，非本人所为）

本报告全程只读；复核进行中（23:39–23:44）工作区出现 3 处未提交改动，**由他人（父代理）修改**，`git status` 因此不再为空：

```
 M data/drawings.json      (23:43:49  updatedAt 时间戳漂移，前端手绘线的预期行为)
 M scripts/srcaudit.js     (23:41:31  把 tencent-kline 标为非 used、新增 sina-daily 探测项)
 M server/lib/sources.js   (23:39:45  A 股日线 tryEach 增加 sinaDaily 兜底)
```

- 我最后一次核对 `git status --porcelain` 为空是在 23:39 之前；此后上述文件被改。
- **`server/lib/sources.js:527` 的 `hosts` 顺序未被修改**，BLOCKER-1 依然成立（且 proxy 也已 501，BLOCKER-2）。
- `sources.js` 的兜底改动**只覆盖 A 股**（`if (m === 'A')`），港股没有任何兜底 → BLOCKER-2 的根本原因。
- 本报告对 `srcaudit.js` 的 MINOR 发现基于 `c78775f` 版本；新版 `srcaudit.js` 只是改了源清单，`probe()` 里"`looksJson && /"error"/i`"的误判逻辑没有变，结论仍然适用。

---

## 附：本次全部实测命令（可复现）

```bash
# 板块
curl -s http://127.0.0.1:8931/api/sectors
for id in base precious ferrous energy agri fin index light; do curl -s "…/api/sector?id=$id"; done
curl -s -w "\nHTTP %{http_code}\n" "…/api/sector?id=nope"          # → 400
node /tmp/klcheck.js day                                          # 82 品种 × /api/kline
# 中枢
node scripts/pivotviz.js {A 600519,HK 00700,US TSLA,CR ETHUSDT,CNF RB0,USF CL}
node /tmp/lv6.js ; node /tmp/lv8.js                               # 边界构造（p1 == zg / zd）
node /tmp/fudge.js                                                # pivotviz 反例注入
# 游戏
node /tmp/game3.js ; node /tmp/gamebox2.js ; node /tmp/game4.js    # level 18 各种框
# 数据
node scripts/srcaudit.js
node -e "…fetch proxy.finance.qq.com / ifzq.gtimg.cn…"             # 501 vs 200
curl "…/api/kline?market=A&code=399137&period=day&limit=60"        # 2013-03-01
curl "…/api/search?q=金|铜|原油|A|元"
# 前端
node /tmp/rv/ui1.mjs … ui14.mjs                                    # playwright 同目录下
npm test                                                           # 70/70
```
