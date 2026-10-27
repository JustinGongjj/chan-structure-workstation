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
