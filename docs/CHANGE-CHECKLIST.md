# 改动检查清单（修一处必须全查同类）

> 这份清单不是提醒，是**纪律**。本项目已经因为"只修一半"连续踩坑两次：
> - v3.11.2 修了桌面版缺月线，**漏了手机版**
> - v3.11.3 才发现手机版 `PERIODS.CR` 同样缺 `month`

## 一、为什么必须全查同类

本项目的功能分布在**多个层级、多个端**：

| 层级 | 位置 | 特点 |
|---|---|---|
| 后端算法 | `server/lib/*.js` | 单一实现，改动影响全部 |
| 后端配置 | `sources.js` / `constants.js` | 名称、周期、市场定义 |
| 桌面前端 | `web/js/pages/*.js` | 渲染 + 交互 |
| 手机前端 | `web/m/js/mobile.js` | **独立实现一份**，最容易漏 |
| 图表 | `web/js/chart.js` | 独立绘制逻辑 |

实测分布（同一功能出现的处数）：

| 功能 | 前端 | 后端 | 风险 |
|---|---|---|---|
| 周期列表 | 4 处 | 3 处 | ⚠️ 各存一份 |
| 市场列表 | 6 处 | 4 处 | ⚠️ 各存一份 |
| 信号类型 | 2 处 | 5 处 | ⚠️ 各存一份 |
| 中枢渲染 | 4 处 | 9 处 | ⚠️ 各存一份 |
| 背驰判断 | 7 处 | 7 处 | ⚠️ 各存一份 |

## 二、动手前的四问

修任何 bug 前，先回答这四个问题，**答案写进提交信息**：

### 问 1：这个功能在手机版有吗？

```bash
grep -rn "<你的关键词>" web/m/js/mobile.js
```

有 → 必须同时修，或明确说明为什么手机版不受影响。

### 问 2：这个配置是不是别处也定义了一份？

```bash
node scripts/audit-misleading.js    # 规则⑤ 会报「配置漂移」
```

### 问 3：前后端是不是各维护一份？

```bash
# 例：改周期
grep -rn "PERIODS\|periods:" server/lib/sources.js server/lib/constants.js web/js/pages/structure.js web/m/js/mobile.js
```

### 问 4：这个数字/文案是从数据来的，还是写死的？

```bash
node scripts/audit-misleading.js    # 规则②③ 会报「固定话术」「计数在括号内」
```

## 三、五类高危改动

### ① 改周期/级别

- [ ] `server/lib/constants.js` 的 `PERIODS`
- [ ] `server/lib/sources.js` 的 `MARKETS[x].periods`
- [ ] `web/js/pages/structure.js` 的 `PERIODS`
- [ ] `web/m/js/mobile.js` 的 `PERIODS`
- [ ] 验证：桌面 + 手机都要切一遍

### ② 改市场

- [ ] `server/lib/constants.js` 的 `MARKETS` / `MARKET_ORDER`
- [ ] `web/js/ui.js` 的本地兜底值
- [ ] `web/m/js/mobile.js` 的市场横条
- [ ] 验证：每个市场都要能切

### ③ 改信号/买卖点

- [ ] `server/lib/chan.js`（检测逻辑）
- [ ] `server/lib/btengine.js`（回测用到的信号）
- [ ] `web/js/ui.js` 的 `SIG_SHORT` / `SIG_CLS`
- [ ] `web/m/js/mobile.js` 的信号显示
- [ ] 验证：回测 + 图表 + 手机都要看

### ④ 改结构式/文案

- [ ] 先问：这句话是**固定话术**还是**从数据生成**？
- [ ] 固定话术只能用于讲概念，不能用于讲"当前是什么"
- [ ] 关键数字写在**主文案**里，不放括号
- [ ] 验证：`node scripts/audit-misleading.js`

### ⑤ 改接口返回字段

- [ ] 前端所有消费该字段的地方（`grep -rn "字段名" web/`）
- [ ] 手机版单独再查一遍
- [ ] 验证：`node scripts/apicheck.js`

## 四、审计脚本能自动抓的（5 条规则）

```bash
npm run check:misleading
```

| # | 规则 | 抓什么 |
|---|---|---|
| 1 | 删括号 | `replace(/（.*?）/, '')` 丢失关键限定 |
| 2 | 固定话术 | 含结构术语、无插值、不在 if 分支内 |
| 3 | 计数在括号内 | 把"N 个中枢"塞进括号 |
| 4 | 周期不一致 | 前后端周期列表漂移 |
| 5 | 配置漂移 | 名称在 `constants.js` 之外重新定义 |

**自动抓不到的**：逻辑错误、算法边界、语义误导。这些必须靠人工判断。

## 五、提交前必跑

```bash
npm test                 # 单测
node scripts/audit-misleading.js   # 5 条规则
npm run check:all        # 全套门禁
```

## 六、两次真实教训

### 教训 1：只修了桌面

v3.11.2 修 `PERIODS.CR` 缺 `month`，只改了 `web/js/pages/structure.js`。
用户截图是桌面版，于是我就只看了桌面。

**结果**：手机版 `web/m/js/mobile.js` 里同样的 `PERIODS.CR` 也缺 `month`，
直到 v3.11.3 盘点配置时才被发现。

**正确做法**：看到"周期列表"这个词，就该 `grep -rn "PERIODS"` 全项目查一遍。

### 教训 2：测试失败先怀疑测试

flowcheck 报「算卦换卦失败」，我查了 10 分钟后端 nonce 逻辑——
后端 8 次起卦给出 8 个不同卦名，一直是好的。

**真正原因**：测试正则 `^(乾|兑|离|震|巽|坎|艮|坤)` 先命中了页面里的"离宫"，
抓到的是**宫位**不是**卦名**。

**正确做法**：测试失败时，先用同样的操作手工验证一次产品行为，
确认是产品坏还是测试坏。

## 七、一句话总结

> **改任何一个"名称/列表/文案"，先 grep 全项目；改任何 bug，先问手机版有没有。**
