# GitHub 更新与版本说明

仓库：**https://github.com/JustinGongjj/chan-structure-workstation**

源码版本：**3.16.0（本地整合待审，尚未公开发布）**

当前公开下载版本：**v3.12.1**

## 本轮本地整合状态

此工作副本以远程 `main` 为基底，保留远程独有提交并合入 bundle 独有提交；本地预演合并和后续修复仍待审阅。此文件不代表已经向 GitHub 推送或创建 Release。

请勿把旧 bundle 直接推到已有仓库，也不要用 `--force` 覆盖远程历史。远程有独有提交时，先 fetch 并审阅差异，再通过保留历史的 merge 或 Pull Request 整合。

## 版本与下载包

- `package.json` 使用语义化版本格式，当前本地源码版本为 `3.16.0`；尚未创建 `v3.16.0` Git tag 或 GitHub Release。
- `web/downloads/index.html` 和 `SHA256SUMS.txt` 保留当前有效的 v3.12.1 发布信息；对应 bundle 与源码 zip 已作为 v3.12.1 Release 附件存在。
- 仓库忽略生成的 `.bundle` 和 `.zip` 文件，因此当前没有 v3.16.0 下载附件。不要将页面链接改到尚未生成或发布的文件。
- `npm run release` 可在本地生成下载包和校验值；本轮未运行。生成、校验并上传新附件应在版本内容审核之后另行确认。

## 发布前检查

```bash
npm run check:all
```

此命令包含 Node 单元测试、HTML/CSS、API/UI、表格、端到端流程、性能和误导文案审计；部分检查需要本地服务或 Chromium。只有检查结果和文件差异均获审核后，才进行后续公开操作。

## 本地运行

```bash
node server/index.js
```

服务默认地址为 `http://127.0.0.1:8931/`，要求 Node.js ≥20；项目无运行时 npm 依赖。运行时状态写入 `data/`，由 `.gitignore` 排除。
