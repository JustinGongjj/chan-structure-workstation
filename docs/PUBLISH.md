# 发布指南（GitHub / Hugging Face）

本项目的运行时**没有 git push 到 github.com 的网络**（github.com:443 不通），但
`api.github.com` 可用，所以提供了一条**纯 API 发布**通道；也可以在本机用普通 git。

## 方案 A（推荐）：用 Token 走 GitHub API 发布

适合在当前环境直接发布，不需要 `git push`。

1. 创建 Token：<https://github.com/settings/tokens/new?scopes=repo,workflow&description=chan-station-publish>
   - classic：勾选 **repo** + **workflow**（`.github/workflows/ci.yml` 需要 workflow 权限）
   - fine-grained：Contents=Read/Write、Administration=Read/Write、Workflows=Read/Write
2. 发布：

```bash
cd chanlun-station
GH_TOKEN=ghp_xxx node scripts/publish-github.js
# 可选参数：--repo <名字> --private --dry（只演练） --tag v1.0.0
```

脚本会：创建仓库 → 增量上传全部文件（对比 git blob sha，只传变化的）→ 设置 description/
homepage/topics → 开启 Discussions → 创建 v1.0.0 Release。重复执行是幂等的。

3. 发布后手动做两件事（API 不支持）：
   - Settings → Social preview 上传 `docs/assets/og.png`
   - 确认 Discussions 已开启（脚本会尝试开启）

## 方案 B：本机 git push

```bash
git clone chan-station-v1.0.0.bundle chan-station   # 或用 zip 解压
cd chan-station
git remote add origin git@github.com:<you>/chan-structure-workstation.git
git push -u origin main
git push origin --tags
```

## Hugging Face Space

在能访问 huggingface.co 的机器上：

```bash
HF_TOKEN=hf_xxx HF_USER=yourname ./scripts/publish-hf.sh
```

脚本会自动组装 Space（`server/ web/ data/ package.json` + `space/README.md` + `space/Dockerfile`）
并推送到 `https://huggingface.co/spaces/<user>/chan-structure-workstation`。

Space 设置要点：

- SDK: **Docker**，`app_port: 8931`
- 免费 Space 空闲后会休眠，首次访问需等几秒
- 若 Space 出网受限，A 股适配器可能取不到数据；演示页仍可打开
- 在 Space README 里保留「Duplicate this Space」引导

## 发布后检查清单

- [ ] 仓库 Description = 一句英文 pitch；Topics 已填（脚本自动）
- [ ] Social preview 图已上传
- [ ] `v1.0.0` Release 已创建（脚本自动）
- [ ] Actions 里 CI 三个 Node 版本全绿
- [ ] Discussions 已开启并置顶「Show your chart」
- [ ] Space 可访问，且 `/m/` 手机版正常
- [ ] 把仓库链接填进 README 里的 `<you>` 占位（`grep -rl "<you>" .`）
