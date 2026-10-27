# 移动端（Android / iOS）

## 1. 架构

| 层 | 实现 | 说明 |
| --- | --- | --- |
| 框架 | **Framework7 8.3.3（CSS 组件层，已内置到本仓库）** | `web/vendor/f7/framework7-bundle.min.css`，无 CDN、无构建、离线可用 |
| 交互 | 自写 `web/m/js/mobile.js`（原生 JS，约 900 行） | 5 个底部 Tab、底部抽屉（sheet）、触摸图表、实时轮询 |
| 主题 | `web/m/css/mobile.css` | `[data-skin=ios\|android] × [data-theme=dark\|light]` 四套 token |
| 安装 | `web/manifest.webmanifest` + `web/m/sw.js` | PWA：可加到主屏，Service Worker 缓存外壳 |

入口分流由服务端完成：`server/index.js` 检测 `MOBILE_UA`，手机访问 `/` 直接 302 到 `/m/`；
桌面端访问 `/m/` 或 `?desktop=1` 可强制留在桌面版。

```
/m/                 → 移动端外壳
/m/?skin=ios|android     指定皮肤（默认按 UA 自动判断）
/m/?theme=light|dark     指定明暗
/m/?tab=overview|radar|structure|theory|divination
/m/?tab=structure&hl=a_A_b   直接跳到某一段的标注（与桌面端 hash 深链一致）
```

## 2. 为什么用 Framework7 CSS 而不是整套 JS 框架

- 仓库运行时**不能 npm install**（内网 registry 不通），所以框架必须与源码同仓：直接内置 `framework7-bundle.min.css`（526 KB）即可获得 iOS/Android 双风格的组件外观。
- 页面交互是"图表 + 轮询"，用 F7 的 JS 路由/组件会引入 300 KB+ 的运行时和构建链，收益低；因此只取**组件样式层**（`navbar` / `tabbar` / `segmented` / `button` / `list` / `sheet` / `chip`），行为由自己的 JS 驱动。
- 覆盖策略：`mobile.css` 在 F7 之后加载，并对 F7 的强默认值做显式加固（例如 F7 的 `.button` 默认 `width:100%`，会把同行的标题挤成竖排；我们统一改成 `width:auto`）。

如果后续要接 F7 的 JS（例如 `f7-sheet` 手势、`f7-router` 动画），只需在 `web/m/index.html` 里追加
`framework7-bundle.min.js` 并在 `mobile.js` 初始化 `new Framework7({...})`，现有 DOM 类名已兼容。

## 3. 打包成原生 App（Capacitor，可选）

```bash
# 在你自己机器上（需要 npm 网络）
mkdir chan-app && cd chan-app
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android @capacitor/ios
npx cap init "缠论工作站" cn.chan.station --web-dir=www
# 把 web/ 目录内容拷到 www/（或直接指向线上地址做 WebView 壳）
npx cap add android && npx cap add ios
npx cap open android   # Android Studio
npx cap open ios       # Xcode（需 macOS + 开发者账号）
```

纯 WebView 壳更省事：`server.url` 指向 `https://dsh-qzmkvbrntwlsdhfa.apps.gai.cn/m/`，
然后 `npx cap sync`。注意 App Store 审核对"纯网页壳"较严格，若要上架建议补原生能力（推送、离线缓存、小组件）。

## 4. 已验证的机型尺寸

| 设备 | 视口 | 结果 |
| --- | --- | --- |
| iPhone 14/15（Safari） | 390×844 | 无横向滚动，底部 Tab 适配 `safe-area-inset-bottom` |
| Pixel 8（Chrome） | 412×915 | 同上，Android 皮肤（`data-skin=android`） |
| 桌面窄窗口 | 390px 宽 | 顶栏折行 + "手机版"提示条，不出现横向溢出 |

## 5. 滚动为什么会被"锁死"（踩过的三个坑）

手机端最常见的"上下滑死机"不是 JS 卡住，而是**视口不再是滚动容器**。这里记录三个坑，改样式时别踩回去：

1. **Framework7 的全局 reset**
   `framework7-bundle.min.css` 里有 `html,body{position:relative;height:100%}` 和
   `body{overflow:hidden;overflow-y:scroll}`。加载后 `body` 变成固定 100% 高的独立滚动容器，
   内容被裁在首屏，手指怎么划都不动。→ `mobile.css` 里用 `!important` 把 `height` 改回 `auto`。

2. **`html` 的 `overflow-y` 不能是 `visible`**
   按 CSS 规范，根元素 `overflow: visible` 时，视口会去继承 `body` 的 overflow 值；两个都 visible，
   视口就不再是滚动容器。诡异之处：`window.scrollTo()` 仍然能动，所以"程序能滚、用户滚不动"。
   → `html{overflow-y:auto}` + `body{overflow-y:visible}`。

3. **`overscroll-behavior` 只能给 `html`，不能给 `body`**
   在 `body` 上写 `overscroll-behavior-y: contain/none`，Chrome 会把整个视口的用户滚动一起吞掉
   （滚轮/手指都不动，`scrollTo` 依然能动）。→ 只给 `html` 设 `none`，`body` 保持 `auto`。

另外：图表 `canvas` 用 `touch-action: pan-y`，并在 `touchmove` 里做方向仲裁——
纵向手势放行页面滚动，只有确认横向（`dx > 6 且 dx ≥ dy`）才 `preventDefault` 接管为平移。
否则手指落在 K 线图上时整页都滑不动。

## 6. 自动巡检（无第三方依赖，直接跑）

| 命令 | 覆盖 | 说明 |
| --- | --- | --- |
| `npm test` | 42 个单测 | 缠论引擎 / 干支 / 农历 / 紫微 / 奇门 / 择时 / 算卦 |
| `npm run check:api` | 39 项 | 逐条打所有 `/api/*`（四市场报价/K线/缠论、择时、回测、算卦、自选池增删去重、静态资源） |
| `npm run check:ui` | 6 个环境 | 真实 Chromium + CDP：桌面 1440/1024、iOS 390、Android 412 × 深浅色；查 JS 报错、横向溢出、**内容超出屏幕但滚不动**、轮询是否把滚动位置弹回顶部、5 个 Tab 是否都有内容 |
| `npm run check:flow` | 16 步 | 交互链路：搜索→进结构、自选池增删、算卦两次起卦必须换卦、理论弹层、深链、桌面 6 页与弹窗 |

`check:ui` / `check:flow` 直接驱动 `chrome-headless-shell`（CDP over WebSocket，Node 22 内置），
截图参数 `--shots /tmp/out`。手机滚动这条回归项就是这么抓出来的：

```
✅ ios-dark  390x844  滚动容器=document 可滚=1573px 手势位移=506px 横向溢出=0px
```
