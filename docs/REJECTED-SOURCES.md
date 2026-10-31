# 评估过但未能接入的数据源（附实测证据）

> 这份文档记录"为什么某些常见数据源在本站用不了"，避免重复调研。
> 所有结论都在 2026-11-01 于本运行时实测，复跑命令写在每条下面。

## 结论速览

| 源 | 类型 | 结论 | 卡点 |
|---|---|---|---|
| **BaoStock** | Python 库 | ❌ 不可接入 | 自建 TCP 10030 端口，本运行时不通 |
| **AKShare** | Python 库 | ⬜ 无增量 | 上游就是东财/新浪/巨潮，本仓已直连 |
| **Stooq** | HTTP CSV | ❌ 不接入 | SHA-256 JS 人机校验，绕过违背原则 |

---

## 1. BaoStock

**它的工作方式**：Python 库，但**不是 HTTP API**——自己实现了一套 TCP 协议，默认连 `www.baostock.com:10030`。

**实测**：

```bash
# 官网本身可达（只是 443 的静态页，不代表数据接口可用）
curl -s -o /dev/null -w "%{http_code}\n" https://baostock.com
# → 200

# 真正的数据端口：不通
timeout 5 bash -c "echo > /dev/tcp/baostock.com/10030"   # → 超时
bash -c "echo > /dev/tcp/114.80.154.107/10030"           # → 超时
bash -c "echo > /dev/tcp/180.168.135.12/10030"           # → 超时
```

**另一个障碍**：BaoStock 依赖 pandas 解析返回，而本运行时 `python3 -c "import pandas"` 直接 `ModuleNotFoundError`。

**判断**：即使装好 pandas，数据端口不通也没用。本运行时出网策略只放行 80/443，
这类"自定义端口的 TCP 服务"一律连不上（长桥 OpenAPI 也是同样原因）。

**替代**：A 股历史日线本仓已用 **新浪日线**（`sina-daily`，当前主力）+ 腾讯/东财多级降级覆盖，
支持 1m/5m/15m/30m/60m/日/周/月，且有前复权。

---

## 2. AKShare

**它是怎么拿数据的**：AKShare 本身**不生产数据**，它是把东财、新浪、巨潮、上交所/深交所、
生意社等公开站点包装成 Python 函数。

**实测（验证"上游 = 我们已接的站点"）**：

```bash
# AKShare 的核心上游
curl -s -o /dev/null -w "%{http_code}\n" "https://datacenter-web.eastmoney.com/api/data/v1/get?..."   # 200 可用
curl -s -o /dev/null -w "%{http_code}\n" "https://stock.finance.sina.com.cn/futures/api/jsonp.php/..."    # 200 可用
curl -s -o /dev/null -w "%{http_code}\n" "https://push2his.eastmoney.com/api/qt/stock/kline/get?..."      # 连接失败
```

**判断**：本站是**零依赖 Node.js**，不引 Python 运行时。AKShare 能给的，我们直连上游都能给，
而且少一层"接口随时改"的风险——AKShare 官方文档自己也写明"接口可能变化，适合研究用途"。

**它确实更强的地方**（诚实说明）：AKShare 覆盖了**基金净值、财报明细、龙虎榜、股东户数、
宏观数据**等非行情类数据，这部分本站没有。如果你需要这些，我建议**单独起一个 Python 分析脚本**，
而不是把它塞进这个零依赖的 Node 服务。

---

## 3. Stooq

**现象**：所有 CSV 下载接口都返回一个 JS 挑战页。

```bash
curl -s "https://stooq.com/q/d/l/?s=aapl.us&i=d" | head -c 120
# → <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
#   <body><noscript>This site requires JavaScript to verify your browser...
```

页面里的逻辑是：服务端给一个随机串，要求用 SHA-256 找出一个 nonce 使哈希以 `0000` 开头
（工作量证明），然后 POST 到 `/__verify` 换取 cookie。

**为什么不接**：这个挑战是**明确用来区分人和程序的**。破解它的成本不高（几行代码就能算），
但那是绕过对方设置的反爬保护，我不做。Stooq 的服务条款也限定"仅限个人使用"。

**替代**：
- 美股日线 → 纳斯达克官方 / StockAnalysis / 新浪美股 / Alpha Vantage
- 全球指数 → 已有腾讯、新浪、纳斯达克

---

## 附：本运行时对"网络形态"的限制

这三条卡点其实是同一个原因：**本运行时只放行 HTTP/HTTPS（80/443）**。

| 形态 | 例子 | 能否接入 |
| --- | --- | --- |
| HTTP/HTTPS 公开接口 | 新浪、腾讯、Binance、FRED | ✅ |
| 需自定义端口的 TCP 服务 | BaoStock 10030、长桥、CTP | ❌ |
| 需要常驻客户端进程 | IBKR（IB Gateway）、CTP | ❌ |
| 有 JS/人机校验 | Stooq、雪球部分接口 | ❌（不绕过） |
| 整域不可达 | TradingView | ❌ |

所以本站在"HTTP 公开接口"这个空间里已经把可用的都拿全了：
腾讯、新浪、纳斯达克、Binance、Gate.io、Gold-API、FRED、StockAnalysis、东财数据中心、SEC EDGAR。
