# 可选 API Key 申请指南

本站**默认全部走免 key 数据源**，不开通任何账号也能完整使用。
下面这 5 个是"有 key 就更强"的增强源，全部有免费档，申请后贴进 `.env.local` 重启即生效。

> **为什么需要你自己申请**：这些站点注册都要邮箱验证，Finnhub / Polygon 还有 reCAPTCHA。
> 这类验证本身就是用来阻止自动化注册的，我不会绕过它，也不会用编造的身份去开户。

## 三步接入

```bash
# 1. 在项目根目录建 .env.local（已在 .gitignore 里，不会被提交）
cd /home/node/default/chanlun-station
echo 'FINNHUB_KEY=你的key' >> .env.local

# 2. 重启服务
#    （或用 service_manage 的 stop / start）

# 3. 打开「数据源」页，看到对应条目的圆点变绿 = 已生效
```

key 只在服务端使用，**永远不会下发到前端 HTML/JS**。`/api/keys` 只返回"是否已配置"。

## 五个源怎么选

| 源 | 免费额度 | 能换来什么 | 申请难度 | 建议 |
|---|---|---|---|---|
| **Alpha Vantage** | 25 次/日 | 美股日线增强、加密 | ⭐ 只要邮箱，**秒发 key** | **先申请这个**，最快见效 |
| **Twelve Data** | 800 次/日、8 次/分 | 美股/港股/外汇 K 线 + 技术指标 | ⭐⭐ 邮箱注册，无 captcha | **额度最大，最推荐** |
| **Tiingo** | 1000 次/日 | 美股 EOD、新闻情绪 | ⭐⭐ 邮箱注册 | 额度最大，适合日线 |
| **Finnhub** | 60 次/分钟 | **美股实时报价**、公司新闻 | ⭐⭐⭐ reCAPTCHA + 邮箱 | 要实时报价才申请 |
| Polygon.io | 5 次/分钟 | 美股日线/分钟线 | ⭐⭐⭐ 邮箱 | 额度太小，最后考虑 |

### 快速决策

- **只想补一个** → 选 **Twelve Data**（800 次/日，覆盖美股+港股+外汇，无 captcha）
- **想马上拿到 key** → 选 **Alpha Vantage**（表单提交后 key 直接显示在页面上）
- **要美股实时报价** → 只能选 **Finnhub**（需要过 reCAPTCHA）

## 申请直达链接

| 源 | 链接 |
|---|---|
| Alpha Vantage | https://www.alphavantage.co/support/#api-key |
| Twelve Data | https://twelvedata.com/pricing （选 Free 档注册） |
| Tiingo | https://www.tiingo.com/account/api/token |
| Finnhub | https://finnhub.io/register |
| Polygon.io | https://polygon.io/dashboard/signup |

## 已经有 key 之后，本站会怎么变

填入 key 后，数据源优先级自动变化（不影响原有免 key 链路，只是多一层）：

**美股日线**
```
纳斯达克官方 → 新浪 → StockAnalysis(免key) → Twelve Data(有key) → Alpha Vantage(有key) → 东财
```

**美股报价**
```
腾讯 → (Finnhub，若配置) → 新浪 → Gold-API(贵金属)
```

## 环境变量一览

| 变量名 | 源 |
|---|---|
| `ALPHAVANTAGE_KEY` | Alpha Vantage |
| `TWELVEDATA_KEY` | Twelve Data |
| `TIINGO_KEY` | Tiingo |
| `FINNHUB_KEY` | Finnhub |
| `POLYGON_KEY` | Polygon.io |
| `GAME_SECRET` | 闯关游戏 token 签名（不设则每次重启随机） |

## 免 key 已接入的源（无需任何操作）

| 源 | 覆盖 | 状态 |
|---|---|---|
| 腾讯行情 | A股/港股/美股 实时 | ✅ |
| 腾讯 K 线（港股 `hkfqkline` 路径） | 港股日周月 | ✅ |
| 新浪（行情/日线/分钟） | A股 全周期 | ✅ 当前 A 股 K 线主力 |
| 新浪期货（日线 + 分钟） | 国内期货 1m~月线 | ✅ |
| 新浪外盘期货（日线 + 分时） | 美期货 | ✅ |
| 纳斯达克官方 | 美股日线 | ✅ |
| **StockAnalysis** | 美股日线（独立兜底） | ✅ 新增 |
| Binance | 加密 519 交易对 | ✅ |
| **Gate.io** | 加密（备用） | 已探测可用 |
| **Gold-API** | XAU/XAG 现货 | ✅ |
| **FRED** | 美债 10Y/2Y、VIX | ✅ 新增，已进总览侧栏 |
| 东财数据中心 | 期货持仓排名 | ✅ |
| SEC EDGAR | 美股基本面 | 已探测可用 |
| open.er-api / Frankfurter | 汇率 | 已探测可用 |
| World Bank | 宏观 | 已探测可用 |

## 当前环境已确认代不可用的源

| 源 | 现象 |
|---|---|
| TradingView（全域名） | `UND_ERR_CONNECT_TIMEOUT`，整域不可达 |
| 长桥 LongPort | 连接超时，需账户 + IP 白名单 |
| 东财 push2 / push2his | `UND_ERR_SOCKET`（数据中心正常） |
| Coinbase / Kraken / OKX / Bybit / MEXC / HTX / KuCoin | 连接超时或 `ECONNRESET` |
| Yahoo / Stooq | 403（Stooq 另有 JS 反爬，不绕） |
| 网易财经 | 502 |
| IBKR | 需 IB Gateway 常驻进程 + 盈透账户 |

> 加密交易所大多不通，是因为本运行时的出网策略；Binance 与 Gate.io 可用，已接入。
