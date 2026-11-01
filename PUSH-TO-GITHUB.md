# 推送到 GitHub 指南

仓库：**https://github.com/JustinGongjj/chan-structure-workstation**
当前版本：**v2.3.0**

---

## 方式 A：用完整 git bundle（推荐，保留全部 45 次提交历史）

随包提供 `chan-structure-workstation-v2.3.0-full.bundle`，它就是整个仓库（含历史）。

```bash
# 1. 从 bundle 克隆到本地
git clone chan-structure-workstation-v2.3.0-full.bundle chan-structure-workstation
cd chan-structure-workstation

# 2. 指到你自己的 GitHub 仓库
git remote set-url origin https://github.com/JustinGongjj/chan-structure-workstation.git

# 3. 推送（历史完整保留）
git push -u origin master
```

> 如果你的 GitHub 仓库默认分支是 `main`：
> `git branch -M master main && git push -u origin main`

### 如果远程已有内容，且你确定要用本地覆盖

```bash
git push -u origin master --force
```
⚠️ `--force` 会覆盖远程历史。只有在你确认远程那些提交不再需要时才用。

---

## 方式 B：用源码 zip（最简单，但只有一次提交）

```bash
# 1. 解压
unzip chan-structure-workstation-v2.3.0-src.zip
cd chan-structure-workstation

# 2. 初始化并提交
git init
git add -A
git commit -m "feat: 缠论工作站 v2.3.0"

# 3. 关联远程并推送
git branch -M main
git remote add origin https://github.com/JustinGongjj/chan-structure-workstation.git
git push -u origin main --force
```

---

## 推送完成后会看到什么

### 自动生效

| 项目 | 说明 |
|---|---|
| **CI 流水线** | `.github/workflows/ci.yml` 自动跑 4 个 job（见下） |
| **README 徽章** | CI 状态 / 版本 / 测试数 / 协议 自动显示 |
| **Issue 模板** | Bug 报告、功能请求、空白模板 |
| **PR 模板** | 带检查清单 |
| **依赖图** | 零运行时依赖，Dependabot 不会打扰你 |
| **语言统计** | JS + HTML + CSS（已用 `.gitattributes` 标注 vendored 目录） |

### CI 的 4 个 job

| Job | 内容 | 会不会因外部原因失败 |
|---|---|---|
| `static` | 语法检查、HTML 结构、71 个单测 | 不会（纯本地） |
| `gates` | 接口 65 项、UI 6 项、弹层 48 项、CSS 审计 | 不会（起本地服务） |
| `e2e` | 桌面+手机+闯关端到端 34 项（装 Chromium） | 不会 |
| `data-sources` | 全链路矩阵 208 项、数据源可达性 | **可能**（上游站点随时变），已设 `continue-on-error`，**不会阻塞合并** |

---

## 建议顺手改的设置

在仓库 **Settings** 里：

1. **General → Default branch**：改成 `main`（如果你用 --force 推了 master，可以在这里切换）
2. **Branches → Branch protection**：对 `main` 开启，要求 `static` 和 `gates` 通过才能合并
3. **Pages**（可选）：Settings → Pages → Source 选 `main` / `/docs`，可以放文档站；
   但本项目是**服务端渲染 + 实时行情**，静态 Pages 跑不了完整功能
4. **Topics**（项目标签，利于被搜索到）：
   ```
   chanlun 缠论 technical-analysis stock-analysis futures crypto 零依赖
   nodejs canvas trading-workstation
   ```

---

## 本地验证（推送前后都可以跑）

```bash
npm test              # 71 个单测
npm run check:html    # HTML 结构
npm run check:api     # 65 项接口
npm run check:flow    # 34 项端到端（需要 Chromium）
npm run check:all     # 全套门禁
```

第一次启动会自动创建 `data/` 目录（已在 `.gitignore` 里，**不会**把本地自选和手绘线传上去）。

---

## 部署到服务器 / 云

```bash
# Docker（仓库已带 Dockerfile + docker-compose.yml）
docker compose up -d

# 或直接跑
PORT=8931 node server/index.js
```

可选的 API Key（Finnhub / Twelve Data 等）写到 `.env.local`，见 **[docs/API-KEYS.md](docs/API-KEYS.md)**。
`.env.local` 已在 `.gitignore` 里，不会被推送。

---

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| `push` 被拒（non-fast-forward） | 远程有本地没有的提交。先 `git pull --rebase`，或确认可覆盖后 `--force` |
| `remote: Permission denied` | 换用 Personal Access Token（Settings → Developer settings → Tokens），密码填 token |
| CI `e2e` 失败 | 检查 Chromium 装没装上；本地跑 `npm run check:flow` 复现 |
| 徽章一直显 "no status" | 只有**第一次 push 之后** CI 跑过一次才会出现，稍等几分钟 |
| 语言统计里 `web/` 占比不对 | 已在 `.gitattributes` 声明；仍不对时可加 `.git/info/attributes` 覆盖 |
