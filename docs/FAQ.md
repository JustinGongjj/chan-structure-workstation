# FAQ

**Is this investment advice?**
No. It is an analysis and teaching tool. See the disclaimer in `LICENSE` and the
banner inside the I Ching module.

**Why is there an I Ching module in a trading tool?**
Chan theory is culturally entangled with Chinese metaphysics, and plenty of traders
genuinely use 择时 rituals. It is implemented seriously (astronomical solar terms,
reproducible seeds, traditional Na Jia tables) but labeled as entertainment.

**Why zero dependencies?**
Auditability and longevity. A reviewer can read the whole runtime in an afternoon;
there is no supply-chain surface and no lockfile drift.

**Segments look different from my other software.**
Expected. Segment division has several accepted variants; this project documents its
3-stroke approximation and keeps the strict implementation on the roadmap. Pivots and
strokes are the stable, agreed part.

**Why does the A-share chart change between refreshes?**
The last candle is live. Intraday bars move until the session closes; the engine
recomputes on the live bar, so a fractal can appear and disappear.

**Why do HK/US have no 5-minute chart?**
No free intraday history source is reliable for those markets. Rather than fabricate
data, the UI hides unavailable levels.

**Can I use it commercially?**
The code is MIT. The data endpoints are not yours or mine — check their terms. For
production, plug in a licensed vendor via the adapter interface.

**Can I add a broker / my own vendor?**
Yes: implement one function returning `{ bars, source }` and add it to the chain in
`server/lib/sources.js`. See `docs/DATA_SOURCES.md`.

**Does it work offline?**
The UI shell is cached by the service worker on mobile, but market data needs network.
`npm test` and the engine run fully offline.

**How do I cite it?**
See `CITATION.cff`.
