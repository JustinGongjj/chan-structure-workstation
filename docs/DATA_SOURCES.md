# Data sources

All adapters are free, key-less HTTP endpoints. They are **replaceable by design**:
`server/lib/sources.js` exposes one function per provider and a fallback chain per
market/period. If an endpoint dies, add or reorder a provider — nothing else changes.

## Provider matrix

| Provider | Used for | Endpoint shape | Notes |
| --- | --- | --- | --- |
| Tencent quotes | A/HK/US realtime | `qt.gtimg.cn/q=sh600519,hk00700,usNVDA` | GBK encoded, one batched request |
| Tencent kline | A/HK daily/weekly/monthly (forward-adjusted) | `ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,600,qfq` | `web.ifzq.gtimg.cn` returns an anti-bot 501 → we use `ifzq.gtimg.cn` and `proxy.finance.qq.com` |
| Tencent mkline | A-share intraday fallback | `ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m5,,320` | |
| Sina kline | A-share daily fallback + 1/5/15/30/60m | `quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=240&datalen=600` | `scale=240` is daily |
| Nasdaq | US daily | `api.nasdaq.com/api/quote/NVDA/historical?assetclass=stocks&…` | official, needs a browser-like UA |
| Sina US | US daily fallback | `stock.finance.sina.com.cn/usstock/api/jsonp.php/…/US_MinKService.getDailyK?symbol=AAPL` | returns full history (heavy) |
| Eastmoney | universal fallback | `push2his.eastmoney.com/api/qt/stock/kline/get?secid=…&ut=…` | intermittent from some networks |
| Binance | crypto klines + tickers | `data-api.binance.vision/api/v3/…` | `api.binance.com` is blocked in some regions; `data-api.binance.vision` is the public data mirror |

## Fallback chains

```
A-shares  daily : tencentFq → eastmoney → sinaDaily (+ week/month aggregated locally)
A-shares  1m-60m: sinaMinute → tencentMinute → eastmoney
Hong Kong daily : tencentFq → eastmoney            (intraday: unavailable → UI hides it)
US        daily : nasdaqDaily → sinaUsDaily → eastmoney   (week/month aggregated)
Crypto    all   : binanceKline
```

A provider is accepted only if it returns ≥ 5 valid bars; otherwise the chain moves on.
Failures never surface as empty charts — the last cached value is served with
`stale: true`.

## Symbol conventions

| Market | Input | Normalised |
| --- | --- | --- |
| `A` | `600519`, `sh600519`, `000001.SZ`, index `sh000001` | `600519` / `sh000519`-style prefix preserved for indices |
| `HK` | `00700`, `hk00700`, index `HSI` | `00700` |
| `US` | `NVDA`, `usNVDA` | `NVDA` |
| `CR` | `BTCUSDT`, `BTC`, `btc-usdt` | `BTCUSDT` (auto `USDT` suffix) |

## Terms of service & etiquette

- These endpoints are **public web endpoints**, not contractual APIs. Their terms may
  forbid commercial or high-frequency use. If you deploy this project publicly, you
  become the consumer of those endpoints — check the terms that apply to you.
- The server caches aggressively (4s quotes / 20–60s klines / 30s radar) and caps
  concurrency. Do not raise those limits to scrape history in bulk; use an official
  data vendor instead.
- Do not bypass anti-bot challenges (e.g. the `web.ifzq.gtimg.cn` 501 page). The
  project intentionally switched hosts instead of spoofing.
- For production or commercial use, plug in a licensed provider (Polygon, Twelve Data,
  Tushare Pro, Wind, etc.). The adapter interface is intentionally tiny:

```js
async function provider(market, code, period, limit) {
  return { bars: [{ t, o, h, l, c, v }], source: 'my-vendor' };
}
```

## Known gaps

- HK/US intraday history is not available from free sources; the UI only offers
  daily/weekly/monthly for those markets.
- A-share forward-adjusted (前复权) prices come from Tencent; other providers may
  differ slightly, which can shift structures near pivot boundaries.
- Crypto uses UTC-based daily bars; A-shares use exchange session bars.
