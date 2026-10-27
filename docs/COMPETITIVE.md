# 竞品与差异化（GitHub 实测，2026-10）

数据用 GitHub Search API 逐条拉取（`stargazers_count` / `created_at` / `language`），不是印象。

## 1. 缠论生态：已经很卷，但都是"库 + 回测"

| 项目 | ★ | 语言 | 定位 | 它强在哪 | 它的空缺 |
| --- | ---: | --- | --- | --- | --- |
| [waditu/czsc](https://github.com/waditu/czsc) | 6459 | Rust/Python | 缠中说禅技术分析工具、量化交易 | 老牌（2019）、生态大、和 tushare 绑定 | Python 生态、无前端产品、无"概念→图上标注"、无可视化教学 |
| [Vespa314/chan.py](https://github.com/Vespa314/chan.py) | 2260 | Python | 形态学/动力学买卖点、多级别联立、区间套 | 结构完整、可视化绘图、策略接入 | Python 重框架、学习曲线陡、无移动端、无多市场免费数据 |
| [yijixiuxin/chanlun-pro](https://github.com/yijixiuxin/chanlun-pro) | 1072 | Python | 量化分析工具 | 功能全、图表多 | 仓库 260MB+、部署重、偏本地工具 |
| [ibaihuo/chanvis](https://github.com/ibaihuo/chanvis) | 625 | Vue | TradingView 本地 SDK 可视化 | 图好看 | 只是可视化壳，不含引擎与理论 |
| [tomcat123a/-chanlun](https://github.com/tomcat123a/-chanlun) | 569 | Python | 笔/线段/中枢划分脚本 | 单文件易读 | 无工程化、无测试、无数据层 |
| [kldcty/ChanlunX](https://github.com/kldcty/ChanlunX) | 426 | C++ | 通达信插件 | 直接进交易软件 | 平台绑定、不可复现 |
| [chan2zen/rust-chan](https://github.com/chan2zen/rust-chan) | 347 | Rust | 通达信 Rust 插件 | 性能 | 同上 |
| [neil-pan-s/one-quant-doc](https://github.com/neil-pan-s/one-quant-doc) | 603 | Python | 实时画线/中枢标识/递归分析 | 实时性强 | 文档型仓库、维护不定 |
| AI Agent Skill 形态（多个） | 19–80 | Python | 让 LLM 会"讲缠论" | 贴合当下 AI 趋势 | 引擎多为玩具级、无回测、无标的校验 |

**结论：缠论赛道里，"引擎"已经很拥挤，"产品 + 可解释 + 可验证"几乎空白。**

## 2. 玄学赛道为什么能爆（对标你说的紫微斗数）

| 项目 | ★ | 关键动作 |
| --- | ---: | --- |
| [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu) | 8288 | TS 排盘引擎 + **格局知识库 + 古籍原文数据** + Next.js 在线排盘 |
| [SylarLong/iztro](https://github.com/SylarLong/iztro) | 4264 | **库优先**（npm 可装）+ 多语言移植（react 535★ / dart 153★ / python 136★）+ 文档站 |
| jangviktor-web/nihaixia | 3835 | **AI Agent Skill**（把教学内容蒸馏成 skill） |
| [DestinyLinker/MingLi-Bench](https://github.com/DestinyLinker/MingLi-Bench) | 2482 | **基准数据集**（给 LLM 打分） |
| [Brhiza/mingyu](https://github.com/Brhiza/mingyu) | 516 | 一站式多体系 + **公开 API + MCP Server + skill** |
| learnwithu/mingli-master | 763 | 排盘 + **可视化 HTML** |

爆火公式（可复用）：
1. **库优先**，能被别的项目 `npm i` / `pip install`；
2. **知识库/古籍原文数据**——内容资产比代码更稀缺；
3. **多语言移植生态**（一个人维护核心，社区做端口）；
4. **基准数据集**（让研究者有东西可测）；
5. **AI Agent Skill / MCP** 形态；
6. **在线 Demo**（Next.js 站点或 Space）。

## 3. 我们的差异化（已落地 / 待落地）

| 维度 | 现有缠论项目 | 本项目 | 状态 |
| --- | --- | --- | --- |
| 引擎可复现 | 部分 | 纯函数 + 22 项单测 + 确定性断言 | ✅ |
| 依赖 | Python/第三方一堆 | **0 运行时依赖**（Node 标准库） | ✅ |
| 多市场免费数据 | 单市场为主 | A股/港股/美股/加密 + 多源降级 | ✅ |
| **概念 → 图上标注** | 无 | 40 个概念一键在图上圈出 a/A/b、背驰两段、止损线 | ✅ |
| **信号历史胜率** | 少见 | 每个标的/级别给出命中率、均值、盈亏比、相对基线超额（含小样本警告） | ✅ 新增 |
| **择时可检验** | 无 | 5 种方法并行 + 综合分 + **逐日回测相关系数**，诚实报告"无显著优势" | ✅ 新增 |
| 理论量化 | 无 | 40 概念 / 14 问答 / 108 课 14 专题 / **4.56 万字自建正文** / 3 本书目索引 | ✅ 新增 |
| 移动端 | 无 | PWA（iOS/Android 双皮肤、触屏图表、可安装） | ✅ |
| 库化（npm/pip） | Python 库有 | **待做**：抽 `chan-structure` npm 包 + `chanx` Python 移植 + parity fixtures | ⏳ |
| 数据集 | 无 | **待做**：HF `chan-structures`（结构标签 + engine_version + git_sha） | ⏳ |
| AI Skill / MCP | 有 | **待做**：`SKILL.md` + MCP server（把分析能力暴露给 LLM 客户端） | ⏳ |
| 英文内容 | 少 | README EN + docs EN | ✅ |

## 4. 下一步优先级（按投入产出）

1. **npm 包化**（1–2 天）：`packages/chan-engine` 导出 `analyze()` 与类型定义，仓库内 workspace 复用同一份代码；这是"被别的项目引用"的前提。
2. **Python 移植 `chanx`**（3–5 天）：与 JS 版本跑同一批 fixture，输出 diff 为 0；这是进 vectorbt/pandas-ta/qlib 的门票。
3. **HF 数据集**（2 天）：结构标签 JSONL + schema + 复现脚本，带 `engine_version`。
4. **AI Skill / MCP**（2 天）：把 `/api/chan`、`/api/backtest` 包成 MCP 工具，附 `SKILL.md` 说明"先定级别、再认结构、最后写失效点"。
5. **择时方法扩展**：紫微斗数流日盘（需农历排盘，已有天文算法基础）、奇门遁甲时家盘——两者都按"必须可回测"的标准接入，不做纯玄学装饰。

## 5. 一句话差异化

> 别人给的是"能算缠论的库"，我们给的是"能验证、能解释、能上手机、能告诉你这套东西在这个标的上到底准不准"的工作站。

配套发布策略见 [LAUNCH_PLAYBOOK.md](LAUNCH_PLAYBOOK.md)。
