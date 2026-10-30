/* =========================================================
   缠论结构图 · Canvas 渲染器
   K线 + 笔 + 线段 + 中枢 + 买卖点 + 背驰 + 成交量 + MACD
   ========================================================= */
(function () {
  // 主题调色板：从 CSS 变量读取，切换主题时自动重算
  let COL_CACHE = null;
  let COL_THEME = null;
  function palette() {
    const theme = document.documentElement.dataset.theme || 'dark';
    if (COL_CACHE && COL_THEME === theme) return COL_CACHE;
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => {
      const x = (cs.getPropertyValue(name) || '').trim();
      return x || fb;
    };
    COL_CACHE = {
      up: v('--candle-up', '#f0544f'),
      down: v('--candle-down', '#22b884'),
      flat: v('--flat', '#8a94a8'),
      bi: v('--bi', '#e0b15a'),
      seg: v('--seg', '#a78bfa'),
      pivotFill: v('--pivot-fill', 'rgba(91,140,255,.13)'),
      pivotLine: v('--pivot-line', 'rgba(91,140,255,.55)'),
      grid: v('--chart-grid', 'rgba(255,255,255,.045)'),
      text: v('--chart-text', '#65718a'),
      text2: v('--muted', '#93a0b8'),
      buy: v('--candle-down', '#22b884'),
      sell: v('--candle-up', '#f0544f'),
      beichi: v('--bi', '#e0b15a'),
      dif: v('--dif', '#e8eef9'),
      dea: v('--dea', '#e0b15a'),
      zero: v('--zero', 'rgba(255,255,255,.12)'),
      gold: v('--gold', '#e0b15a'),
      goldInk: v('--gold-ink', '#1b1305'),
      accent: v('--accent', '#5b8cff'),
      dim: v('--dim-mask', 'rgba(6,10,16,.45)'),
    };
    COL_THEME = theme;
    return COL_CACHE;
  }

  class ChanChart {
    constructor(canvas, tipEl) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tip = tipEl;
      this.data = null;
      this.hl = null; // 教学标注
      this.toggles = { bi: true, seg: true, pivot: true, signal: true, beichi: true, vol: true, macd: true, fractal: false };
      this.view = { start: 0, count: 150 };
      this.hover = -1;
      this.drag = null;
      this.drawings = [];      // 用户手绘线（坐标用 K 线序号 + 价格，平移缩放不会漂）
      this.drawMode = 'none';  // none | trend | hline | rect
      this.selectedId = null;
      this.draft = null;
      this._pendingStart = null;
      this._dragRect = null;
      this.onDraws = null;
      this._drawWanted = -1;   // 只画到最近一根"已走完"的 K 线，避免手绘线被未来数据带偏
      this.bind();
      this._onResize = () => this.draw();
      window.addEventListener('resize', this._onResize);
    }

    destroy() {
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      this._onResize = null;
      this.data = null;
    }

    /* ---------------- 手绘线 ---------------- */
    setDrawings(list) {
      this.drawings = Array.isArray(list) ? list.slice() : [];
      this.selectedId = null;
      this._pendingStart = null;
      this._dragRect = null;
      this.draft = null;
      this.draw({ redrawOnly: true });
    }
    getDrawings() {
      return this.drawings.slice();
    }
    setDrawMode(mode) {
      this.drawMode = ['trend', 'hline', 'rect'].includes(mode) ? mode : 'none';
      // 退出/切换画线模式时丢掉半成品：否则"上一步的点"会在新标的上生效
      this.draft = null;
      this._pendingStart = null;
      this._dragRect = null;
      if (this.canvas) this.canvas.style.cursor = this.drawMode === 'none' ? 'default' : 'crosshair';
      this.draw({ redrawOnly: true });
    }
    clearDrawings() {
      this.drawings = [];
      this.selectedId = null;
      this.emitDraws();
      this.draw({ redrawOnly: true });
    }
    deleteSelected() {
      if (!this.selectedId) return false;
      this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
      this.selectedId = null;
      this.emitDraws();
      this.draw({ redrawOnly: true });
      return true;
    }
    emitDraws() {
      // 同时写入时间戳：K 线下标会随 limit 变化/新数据漂移，t 才是稳定锚点
      const bars = (this.data && this.data.bars) || [];
      const withT = this.drawings.map((d) => {
        const out = { ...d };
        if (bars[d.x1]) out.t1 = bars[d.x1].t;
        if (d.x2 != null && bars[d.x2]) out.t2 = bars[d.x2].t;
        return out;
      });
      this.drawings = withT;
      if (typeof this.onDraws === 'function') this.onDraws(this.getDrawings());
    }

    /* 用 t 把线重新对到当前数据上（下标只作为 t 缺失时的兜底） */
    reanchor() {
      const bars = (this.data && this.data.bars) || [];
      if (!bars.length) return;
      const idxOfT = (t) => {
        if (!t) return null;
        let best = null;
        for (let i = 0; i < bars.length; i++) {
          const d = Math.abs(bars[i].t - t);
          if (!best || d < best.d) best = { d, i };
        }
        return best && best.d <= 86400000 * 3 ? best.i : null;
      };
      this.drawings = this.drawings.map((d) => {
        const out = { ...d };
        const i1 = d.t1 ? idxOfT(d.t1) : null;
        if (i1 != null) out.x1 = i1;
        const i2 = d.t2 ? idxOfT(d.t2) : null;
        if (i2 != null) out.x2 = i2;
        return out;
      });
    }
    /* 屏幕坐标 → 数据坐标（吸附到笔端点优先，其次最近收盘价） */
    dataAt(clientX, clientY) {
      const g = this.geom();
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const idxF = this.view.start + (x - g.padL) / this.barW(g) - 0.5;
      const idx = Math.max(0, Math.min((this.data ? this.data.bars.length : 1) - 1, Math.round(idxF)));
      const r = this.priceRange(g);
      const price = r.lo + (1 - (y - g.priceTop) / g.priceH) * (r.hi - r.lo);
      return this.snap(idx, price, x, y, g);
    }
    /* 吸附：笔端点（±10px）> 当前价收盘（默认） */
    snap(idx, price, x, y, g) {
      const cands = [];
      const bis = (this.data && this.data.bis) || [];
      for (const bi of bis) {
        for (const [i, p] of [[bi.i0, bi.p0], [bi.i1, bi.p1]]) {
          const sx = this.xOf(i, g);
          const sy = this.yOf(p, g, this.priceRange(g));
          const dist = Math.hypot(sx - x, sy - y);
          if (dist <= 14) cands.push({ idx: i, price: p, dist, kind: 'bi' });
        }
      }
      if (cands.length) {
        cands.sort((a, b) => a.dist - b.dist);
        return { idx: cands[0].idx, price: cands[0].price, snapped: 'bi' };
      }
      // 没有吸附目标时保留指针的原始价格（不要退化成收盘价，否则永远对不上 ZG/ZD）
      return { idx, price, snapped: 'free' };
    }

    setData(a, opts) {
      this.data = a;
      this.draft = null;
      this._pendingStart = null;
      this._dragRect = null;
      const n = a && a.bars ? a.bars.length : 0;
      if (opts && opts.keepView) {
        this.view = { start: Math.min(this.view.start, Math.max(0, n - 30)), count: Math.min(this.view.count, n) };
      } else {
        this.view = { start: Math.max(0, n - 150), count: Math.min(150, n) };
      }
      this.reanchor();
      this.draw();
    }

    /* ---------------- 坐标 ---------------- */
    geom() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      const padL = 6;
      const padR = 62;
      const padT = 8;
      const padB = 18;
      const plotW = Math.max(10, w - padL - padR);
      const totalH = h - padT - padB;
      const hasMacd = this.toggles.macd;
      const hasVol = this.toggles.vol;
      const volH = hasVol ? totalH * 0.13 : 0;
      const macdH = hasMacd ? totalH * 0.24 : 0;
      const priceH = totalH - volH - macdH - 10;
      return {
        dpr, w, h, padL, padR, padT, padB, plotW, totalH,
        priceTop: padT, priceH,
        volTop: padT + priceH + 5, volH,
        macdTop: padT + priceH + volH + 10, macdH,
        hasMacd, hasVol,
      };
    }

    xOf(i, g) {
      const { start, count } = this.view;
      const bw = g.plotW / count;
      return g.padL + (i - start + 0.5) * bw;
    }
    barW(g) {
      return g.plotW / this.view.count;
    }
    priceRange(g) {
      const { start, count } = this.view;
      const bars = this.data.bars.slice(start, start + count);
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of bars) {
        lo = Math.min(lo, b.l);
        hi = Math.max(hi, b.h);
      }
      const pivots = (this.data.pivots || []).filter((p) => p.i1 >= start && p.i0 <= start + count);
      for (const p of pivots) {
        lo = Math.min(lo, p.zd);
        hi = Math.max(hi, p.zg);
      }
      const sig = (this.data.signals || []).filter((s) => s.barIdx >= start && s.barIdx <= start + count);
      for (const s of sig) {
        lo = Math.min(lo, s.price);
        hi = Math.max(hi, s.price);
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
      const pad = (hi - lo) * 0.08 || hi * 0.01;
      return { lo: lo - pad, hi: hi + pad };
    }
    yOf(p, g, r) {
      return g.priceTop + g.priceH * (1 - (p - r.lo) / (r.hi - r.lo || 1));
    }

    /* ---------------- 主绘制 ---------------- */
    draw(opts) {
      this._paint(opts);
    }

    _paint() {
      const { ctx, canvas } = this;
      const g = this.geom();
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);
      if (!this.data || !this.data.bars || !this.data.bars.length) {
        ctx.fillStyle = palette().text;
        ctx.font = '12px -apple-system,sans-serif';
        ctx.fillText('等待数据…', g.padL + 10, 30);
        return;
      }
      const d = this.data;
      const C = palette();
      const r = this.priceRange(g);
      const bw = this.barW(g);
      this._g = g;
      this._r = r;

      // 网格 + 价格轴（避开最新价标签）
      const lastPrice = d.bars[d.bars.length - 1].c;
      const lastYP = this.yOf(lastPrice, g, r);
      ctx.font = '10px ui-monospace,Menlo,monospace';
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const y = g.priceTop + (g.priceH * i) / ticks;
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(g.padL, y);
        ctx.lineTo(g.padL + g.plotW, y);
        ctx.stroke();
        if (Math.abs(y - lastYP) < 16) continue;
        const price = r.hi - ((r.hi - r.lo) * i) / ticks;
        ctx.fillStyle = C.text;
        ctx.fillText(this.fmtPrice(price), g.padL + g.plotW + 6, y + 3);
      }

      // 时间轴
      const step = Math.max(1, Math.floor(this.view.count / 6));
      ctx.fillStyle = C.text;
      for (let i = this.view.start; i < this.view.start + this.view.count; i += step) {
        const x = this.xOf(i, g);
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(x, g.priceTop);
        ctx.lineTo(x, g.priceTop + g.priceH);
        ctx.stroke();
        const label = U.ts(d.bars[i].t, d.period);
        ctx.fillText(label, Math.max(2, x - 16), g.h - 5);
      }

      // K线
      const bodyW = Math.max(1, bw * 0.66);
      for (let i = this.view.start; i < this.view.start + this.view.count; i++) {
        const b = d.bars[i];
        if (!b) continue;
        const x = this.xOf(i, g);
        const up = b.c >= b.o;
        const c = up ? C.up : C.down;
        ctx.strokeStyle = c;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x, this.yOf(b.h, g, r));
        ctx.lineTo(x, this.yOf(b.l, g, r));
        ctx.stroke();
        const y1 = this.yOf(Math.max(b.o, b.c), g, r);
        const y2 = this.yOf(Math.min(b.o, b.c), g, r);
        const hh = Math.max(1, y2 - y1);
        if (up) {
          ctx.fillStyle = C.up;
          ctx.fillRect(x - bodyW / 2, y1, bodyW, hh);
        } else {
          ctx.fillStyle = C.down;
          ctx.fillRect(x - bodyW / 2, y1, bodyW, hh);
        }
      }

      // 中枢
      if (this.toggles.pivot) {
        ctx.font = '10px ui-monospace,Menlo,monospace';
        const placed = []; // 已放置的标签矩形，用于避让（进/离段标签很密，不避让会糊成一团）
        const collides = (r) => placed.some((q) => !(r.x2 < q.x1 || r.x1 > q.x2 || r.y2 < q.y1 || r.y1 > q.y2));
        for (const p of d.pivots || []) {
          const x0 = this.xOf(p.i0, g) - bw / 2;
          const x1 = this.xOf(p.i1, g) + bw / 2;
          if (x1 < g.padL || x0 > g.padL + g.plotW) continue;
          const yT = this.yOf(p.zg, g, r);
          const yB = this.yOf(p.zd, g, r);
          const col = p.active ? C.gold : C.pivotLine;

          // ① 中枢本体：ZG/ZD 之间的色带（区间固定，不随后续震荡变化）
          ctx.globalAlpha = p.active ? 0.95 : 0.85;
          ctx.fillStyle = C.pivotFill;
          ctx.fillRect(x0, yT, Math.max(2, x1 - x0), Math.max(1, yB - yT));

          // ② 区间上下沿：实线贯穿中枢，并且延伸到离开段起点，体现"离开前一直有效"
          ctx.globalAlpha = 1;
          ctx.strokeStyle = col;
          ctx.lineWidth = p.active ? 1.6 : 1.2;
          ctx.beginPath();
          ctx.moveTo(x0, yT);
          ctx.lineTo(x1, yT);
          ctx.moveTo(x0, yB);
          ctx.lineTo(x1, yB);
          ctx.stroke();

          // ③ 中枢左右边界（虚线）
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, yT);
          ctx.lineTo(x0, yB);
          ctx.moveTo(x1, yT);
          ctx.lineTo(x1, yB);
          ctx.stroke();
          ctx.setLineDash([]);

          // ④ GG / DD：中枢内触及的最高/最低（缠论里中枢区间与波动区间是两回事）
          if (p.gg != null && p.dd != null && this.toggles.beichi) {
            ctx.globalAlpha = 0.5;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x0, this.yOf(p.gg, g, r));
            ctx.lineTo(x1, this.yOf(p.gg, g, r));
            ctx.moveTo(x0, this.yOf(p.dd, g, r));
            ctx.lineTo(x1, this.yOf(p.dd, g, r));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }

          // ⑤ 进入段 / 离开段：从中枢边界画箭头到该段终点，并标注
          const arrow = (x1b, y1b, x2b, y2b, color, label, labelSide) => {
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x1b, y1b);
            ctx.lineTo(x2b, y2b);
            ctx.stroke();
            const ang = Math.atan2(y2b - y1b, x2b - x1b);
            const ah = 6;
            ctx.beginPath();
            ctx.moveTo(x2b, y2b);
            ctx.lineTo(x2b - ah * Math.cos(ang - 0.4), y2b - ah * Math.sin(ang - 0.4));
            ctx.lineTo(x2b - ah * Math.cos(ang + 0.4), y2b - ah * Math.sin(ang + 0.4));
            ctx.closePath();
            ctx.fill();
            if (label) {
              ctx.font = '9.5px ui-monospace,Menlo,monospace';
              const tw = ctx.measureText(label).width + 8;
              const lx = Math.max(g.padL + 2, Math.min(g.padL + g.plotW - tw - 2, x2b - tw / 2));
              // 标签错位：进入段贴上方、离开段贴下方，避免相邻中枢的两个标签叠在一起
              let ly = labelSide === 'above' ? y2b - 16 : labelSide === 'below' ? y2b + 16 : y2b + (y2b < y1b ? -14 : 10);
              let rect = { x1: lx, y1: ly - 9, x2: lx + tw, y2: ly + 4 };
              for (let k = 0; k < 6 && collides(rect); k++) {
                ly += labelSide === 'above' ? -14 : 14;
                rect = { x1: lx, y1: ly - 9, x2: lx + tw, y2: ly + 4 };
              }
              placed.push(rect);
              ctx.globalAlpha = 0.92;
              ctx.fillRect(lx, ly - 9, tw, 13);
              ctx.fillStyle = C.goldInk;
              ctx.fillText(label, lx + 4, ly + 1);
              ctx.globalAlpha = 1;
            }
          };
          if (p.enter && this.toggles.pivot) {
            // 进入段：从中枢左边界往回画到进段起点（方向表示"如何进入中枢"）
            const ex = this.xOf(p.enter.i0, g);
            const ey = this.yOf(p.enter.p0, g, r);
            const sx = x0;
            const sy = this.yOf(p.enter.p1, g, r);
            if (Math.abs(ex - sx) > 6) arrow(ex, ey, sx, sy, C.seg, '进入段', 'above');
          }
          if (p.leave) {
            const lx2 = this.xOf(p.leave.i1, g);
            const ly2 = this.yOf(p.leave.p1, g, r);
            const sx2 = x1;
            const sy2 = this.yOf(p.leave.p0, g, r);
            if (Math.abs(lx2 - sx2) > 6) {
              // 离开段颜色跟方向走（A 股习惯：涨红跌绿），并且标签压在下方避免与进入段重叠
              const leaveColor = p.leave.dir > 0 ? C.up : C.down;
              arrow(sx2, sy2, lx2, ly2, leaveColor, p.leave.dir > 0 ? '离开段↑' : '离开段↓', 'below');
            }
          }

          // ⑥ 标注
          if (x1 - x0 > 30) {
            ctx.font = '10px ui-monospace,Menlo,monospace';
            ctx.fillStyle = col;
            ctx.fillText(`ZG ${this.fmtPrice(p.zg)}`, x0 + 3, yT - 3);
            ctx.fillText(`ZD ${this.fmtPrice(p.zd)}`, x0 + 3, yB + 10);
          }
          if (p.upgraded && x1 - x0 > 60) {
            ctx.fillStyle = C.gold;
            ctx.fillText(`9段升级(${p.count})`, x0 + 3, (yT + yB) / 2 + 3);
          }
          ctx.globalAlpha = 1;
        }
      }

      // 线段
      if (this.toggles.seg && d.segments) {
        ctx.strokeStyle = C.seg;
        ctx.lineWidth = 2.4;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        let started = false;
        for (const s of d.segments) {
          const x0 = this.xOf(s.i0, g);
          const x1 = this.xOf(s.i1, g);
          if (x1 < g.padL - 20 || x0 > g.padL + g.plotW + 20) continue;
          if (!started) {
            ctx.moveTo(x0, this.yOf(s.p0, g, r));
            started = true;
          }
          ctx.lineTo(x1, this.yOf(s.p1, g, r));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 笔
      if (this.toggles.bi && d.bis) {
        ctx.strokeStyle = C.bi;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (const s of d.bis) {
          const x0 = this.xOf(s.i0, g);
          const x1 = this.xOf(s.i1, g);
          if (x1 < g.padL - 20 || x0 > g.padL + g.plotW + 20) continue;
          if (!started) {
            ctx.moveTo(x0, this.yOf(s.p0, g, r));
            started = true;
          }
          ctx.lineTo(x1, this.yOf(s.p1, g, r));
        }
        ctx.stroke();
        // 笔端点
        ctx.fillStyle = C.bi;
        for (const s of d.bis) {
          if (s.i1 < this.view.start || s.i1 > this.view.start + this.view.count) continue;
          const x = this.xOf(s.i1, g);
          const y = this.yOf(s.p1, g, r);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 买卖点
      if (this.toggles.signal && d.signals) {
        ctx.font = '10px -apple-system,sans-serif';
        for (const s of d.signals) {
          if (s.barIdx < this.view.start - 2 || s.barIdx > this.view.start + this.view.count + 2) continue;
          const x = this.xOf(s.barIdx, g);
          const y = this.yOf(s.price, g, r);
          const buy = s.type.endsWith('B');
          const col = buy ? C.buy : C.sell;
          const dy = buy ? 16 : -16;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
          const label = U.SIG_SHORT[s.type] || s.type;
          const tw = ctx.measureText(label).width + 8;
          const ly = y + dy;
          ctx.fillStyle = buy ? C.buy : C.sell;
          roundRect(ctx, x - tw / 2, ly - 8, tw, 14, 4);
          ctx.fill();
          ctx.fillStyle = C.goldInk;
          ctx.fillText(label, x - tw / 2 + 4, ly + 2);
        }
      }

      // 背驰标记
      if (this.toggles.beichi && d.beichi) {
        for (const b of d.beichi) {
          if (b.barIdx < this.view.start || b.barIdx > this.view.start + this.view.count) continue;
          const x = this.xOf(b.barIdx, g);
          const y = this.yOf(b.price, g, r);
          ctx.fillStyle = C.gold;
          ctx.beginPath();
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x + 5, y);
          ctx.lineTo(x, y + 7);
          ctx.lineTo(x - 5, y);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 最新价线
      const last = d.bars[d.bars.length - 1];
      const lastY = this.yOf(last.c, g, r);
      if (lastY > g.priceTop && lastY < g.priceTop + g.priceH) {
        ctx.strokeStyle = C.gold;
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(g.padL, lastY);
        ctx.lineTo(g.padL + g.plotW, lastY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.gold;
        ctx.fillRect(g.padL + g.plotW + 2, lastY - 8, g.padR - 6, 15);
        ctx.fillStyle = C.goldInk;
        ctx.fillText(this.fmtPrice(last.c), g.padL + g.plotW + 6, lastY + 3);
      }

      // 成交量
      if (g.hasVol) {
        let vmax = 0;
        for (let i = this.view.start; i < this.view.start + this.view.count; i++) vmax = Math.max(vmax, d.bars[i].v || 0);
        for (let i = this.view.start; i < this.view.start + this.view.count; i++) {
          const b = d.bars[i];
          if (!b) continue;
          const x = this.xOf(i, g);
          const hh = vmax ? ((b.v || 0) / vmax) * (g.volH - 4) : 0;
          ctx.fillStyle = b.c >= b.o ? C.up : C.down;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x - bodyW / 2, g.volTop + g.volH - hh, bodyW, hh);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.text;
        ctx.font = '9.5px ui-monospace,Menlo,monospace';
        ctx.fillText('VOL', g.padL + g.plotW + 6, g.volTop + 8);
      }

      // MACD
      if (g.hasMacd) {
        const md = d.macd || { dif: [], dea: [], hist: [] };
        let lo = 0;
        let hi = 0;
        for (let i = this.view.start; i < this.view.start + this.view.count; i++) {
          lo = Math.min(lo, md.dif[i] || 0, md.dea[i] || 0, md.hist[i] || 0);
          hi = Math.max(hi, md.dif[i] || 0, md.dea[i] || 0, md.hist[i] || 0);
        }
        const span = hi - lo || 1;
        const y = (v) => g.macdTop + g.macdH * (1 - (v - lo) / span);
        ctx.strokeStyle = C.zero;
        ctx.beginPath();
        ctx.moveTo(g.padL, y(0));
        ctx.lineTo(g.padL + g.plotW, y(0));
        ctx.stroke();
        for (let i = this.view.start; i < this.view.start + this.view.count; i++) {
          const v = md.hist[i] || 0;
          const x = this.xOf(i, g);
          const y0 = y(0);
          const y1 = y(v);
          ctx.fillStyle = v >= 0 ? C.up : C.down;
          ctx.globalAlpha = 0.65;
          ctx.fillRect(x - bodyW / 2, Math.min(y0, y1), bodyW, Math.max(1, Math.abs(y1 - y0)));
        }
        ctx.globalAlpha = 1;
        const line = (arr, color) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          let started = false;
          for (let i = this.view.start; i < this.view.start + this.view.count; i++) {
            const x = this.xOf(i, g);
            const yy = y(arr[i] || 0);
            if (!started) {
              ctx.moveTo(x, yy);
              started = true;
            } else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        };
        line(md.dif, C.dif);
        line(md.dea, C.dea);
        ctx.fillStyle = C.text;
        ctx.font = '9.5px ui-monospace,Menlo,monospace';
        ctx.fillText('MACD(12,26,9)', g.padL + g.plotW + 6, g.macdTop + 10);
      }

      // 教学标注
      this.drawHighlight(g, r, C, bodyW);

      // 十字光标
      if (this.hover >= 0 && this.hover < d.bars.length) {
        const x = this.xOf(this.hover, g);
        ctx.strokeStyle = C.gold;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, g.priceTop);
        ctx.lineTo(x, g.priceTop + g.priceH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const b = d.bars[this.hover];
        if (this.tip) {
          const rows = [
            `<b>${U.tsFull(b.t, d.period)}</b>`,
            `开 ${fmtP(b.o)}　高 ${fmtP(b.h)}`,
            `低 ${fmtP(b.l)}　收 <b style="color:${b.c >= b.o ? C.up : C.down}">${fmtP(b.c)}</b>`,
            `量 ${U.money(b.v)}`,
          ];
          const sigs = (d.signals || []).filter((s) => s.barIdx === this.hover);
          if (sigs.length) rows.push(`<span style="color:var(--gold)">${sigs.map((s) => s.name).join(' / ')}</span>`);
          const piv = (d.pivots || []).find((p) => this.hover >= p.i0 && this.hover <= p.i1);
          if (piv) rows.push(`中枢 ${fmtP(piv.zd)} ~ ${fmtP(piv.zg)}`);
          this.tip.innerHTML = rows.join('<br>');
          this.tip.style.display = 'block';
          const tw = this.tip.offsetWidth;
          const left = Math.min(g.padL + g.plotW - tw - 6, Math.max(6, x + 14));
          this.tip.style.left = left + 'px';
          this.tip.style.top = Math.max(6, Math.min(g.h - 90, this.lastY - 10)) + 'px';
        }
      } else if (this.tip) {
        this.tip.style.display = 'none';
      }
      this.paintDrawings(g);
    }

    /* ---------------- 手绘线渲染 ---------------- */
    paintDrawings(g) {
      const list = this.drawings || [];
      const draft = this.draft;
      if (!list.length && !draft) return;
      const ctx = this.ctx;
      const r = this.priceRange(g);
      ctx.save();
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      ctx.font = '11px -apple-system,sans-serif';

      const drawOne = (dl, isDraft) => {
        const sel = !isDraft && dl.id === this.selectedId;
        ctx.strokeStyle = isDraft ? 'rgba(224,177,90,.75)' : sel ? '#e0b15a' : dl.color || '#5b8cff';
        ctx.lineWidth = sel ? 2.4 : 1.6;
        ctx.setLineDash(isDraft ? [5, 4] : []);
        const x1 = this.xOf(dl.x1, g);
        const y1 = this.yOf(dl.y1, g, r);
        if (dl.type === 'hline') {
          ctx.beginPath();
          ctx.moveTo(g.padL, y1);
          ctx.lineTo(g.padL + g.plotW, y1);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillText(this.fmtPrice(dl.y1), g.padL + g.plotW + 4, y1 + 3);
        } else if (dl.type === 'rect') {
          const x2 = this.xOf(dl.x2, g);
          const y2 = this.yOf(dl.y2, g, r);
          const rx = Math.min(x1, x2);
          const ry = Math.min(y1, y2);
          ctx.fillStyle = 'rgba(91,140,255,.10)';
          ctx.fillRect(rx, ry, Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.strokeRect(rx, ry, Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else {
          const x2 = this.xOf(dl.x2 != null ? dl.x2 : dl.x1, g);
          const y2 = this.yOf(dl.y2 != null ? dl.y2 : dl.y1, g, r);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (!isDraft) {
            // 端点小圆点：方便确认是否吸附到笔端点
            ctx.setLineDash([]);
            ctx.fillStyle = ctx.strokeStyle;
            for (const [px, py] of [[x1, y1], [x2, y2]]) {
              ctx.beginPath();
              ctx.arc(px, py, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        if (dl.label && !isDraft) {
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          const tx = Math.min(this.xOf(dl.x1, g) + 6, g.padL + g.plotW - 60);
          const ty = Math.max(g.priceTop + 12, this.yOf(dl.y1, g, r) - 8);
          const tw = ctx.measureText(dl.label).width + 8;
          ctx.fillRect(tx, ty - 11, tw, 16);
          ctx.fillStyle = '#fff';
          ctx.fillText(dl.label, tx + 4, ty);
        }
      };

      // 只画落在可视/有效范围内的线：越界线既看不见也选不中，不该参与后续结论
      const nBars = (this.data && this.data.bars.length) || 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.padL, g.priceTop, g.plotW, g.priceH);
      ctx.clip();
      for (const dl of list) {
        if (dl.x1 < 0 || dl.x1 >= nBars || (dl.x2 != null && (dl.x2 < 0 || dl.x2 >= nBars))) continue;
        drawOne(dl, false);
      }
      ctx.restore();
      if (draft && draft.x2 != null) drawOne(draft, true);
      ctx.restore();
    }

    /* ---------------- 教学标注 ---------------- */
    setHighlight(spec, opts) {
      this.hl = spec || null;
      if (spec && spec.range && this.data && !(opts && opts.keepView)) {
        const n = this.data.bars.length;
        const pad = Math.max(8, Math.round((spec.range[1] - spec.range[0]) * 0.25));
        const start = Math.max(0, spec.range[0] - pad);
        const count = Math.min(n - start, spec.range[1] - spec.range[0] + pad * 2 + 1);
        this.view = { start, count: Math.max(30, count) };
      }
      this.draw();
    }

    colorOf(C, name) {
      return C[name] || C.gold;
    }

    drawHighlight(g, r, C, bodyW) {
      const hl = this.hl;
      if (!hl) return;
      const { ctx } = this;
      const left = g.padL;
      const right = g.padL + g.plotW;
      const xOfClamp = (i) => Math.max(left, Math.min(right, this.xOf(i, g)));
      const xs = hl.range ? xOfClamp(hl.range[0]) : left;
      const xe = hl.range ? xOfClamp(hl.range[1]) : right;

      // 区间外压暗，聚焦标注范围
      ctx.save();
      ctx.fillStyle = C.dim;
      if (xs > left) ctx.fillRect(left, g.priceTop, xs - left, g.priceH + g.volH + g.macdH + 12);
      if (xe < right) ctx.fillRect(xe, g.priceTop, right - xe, g.priceH + g.volH + g.macdH + 12);
      ctx.restore();

      // 段落色带
      for (const b of hl.bands || []) {
        const x0 = xOfClamp(b.from);
        const x1 = xOfClamp(b.to);
        const w = Math.max(2, x1 - x0);
        const col = this.colorOf(C, b.color || 'gold');
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = col;
        let bandTop = g.priceTop;
        let bandH = g.priceH;
        if (b.zd != null && b.zg != null) {
          const yTop = this.yOf(b.zg, g, r);
          const yBot = this.yOf(b.zd, g, r);
          bandTop = Math.max(g.priceTop, Math.min(yTop, yBot));
          bandH = Math.max(2, Math.abs(yBot - yTop));
        }
        ctx.fillRect(x0, bandTop, w, bandH);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, g.priceTop);
        ctx.lineTo(x0, g.priceTop + g.priceH);
        ctx.moveTo(x1, g.priceTop);
        ctx.lineTo(x1, g.priceTop + g.priceH);
        ctx.stroke();
        ctx.setLineDash([]);
        // 顶部标签
        if (b.label) {
          ctx.font = '10.5px -apple-system,sans-serif';
          const tw = ctx.measureText(b.label).width + 12;
          const lx = Math.min(right - tw - 2, x0 + 2);
          ctx.fillStyle = col;
          roundRect(ctx, lx, g.priceTop + 2, tw, 16, 5);
          ctx.fill();
          ctx.fillStyle = C.goldInk;
          ctx.fillText(b.label, lx + 6, g.priceTop + 13);
        }
        ctx.restore();
      }

      // 水平参考线（ZG / ZD / 止损）
      for (const l of hl.hlines || []) {
        const y = this.yOf(l.y, g, r);
        if (y < g.priceTop || y > g.priceTop + g.priceH) continue;
        const col = this.colorOf(C, l.color || 'gold');
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xs, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (l.text) {
          ctx.font = '10px ui-monospace,Menlo,monospace';
          const tw = ctx.measureText(l.text).width + 10;
          ctx.globalAlpha = 1;
          ctx.fillStyle = col;
          roundRect(ctx, right - tw - 2, y - 8, tw, 15, 4);
          ctx.fill();
          ctx.fillStyle = C.goldInk;
          ctx.fillText(l.text, right - tw + 3, y + 3);
        }
        ctx.restore();
      }

      // 关键点
      for (const m of hl.marks || []) {
        const bar = m.bar != null ? m.bar : m.idx;
        if (bar == null) continue;
        const px = m.price != null ? m.price : (this.data.bars[bar] ? this.data.bars[bar].c : null);
        if (px == null) continue;
        const x = xOfClamp(bar);
        const y = this.yOf(px, g, r);
        const col = this.colorOf(C, m.color || 'gold');
        ctx.save();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (m.text) {
          ctx.font = '10px -apple-system,sans-serif';
          const tw = ctx.measureText(m.text).width + 10;
          const ly = m.pos === 'below' ? y + 10 : y - 24;
          ctx.fillStyle = col;
          roundRect(ctx, Math.min(right - tw, Math.max(left, x - tw / 2)), ly, tw, 15, 4);
          ctx.fill();
          ctx.fillStyle = C.goldInk;
          ctx.fillText(m.text, Math.min(right - tw, Math.max(left, x - tw / 2)) + 5, ly + 11);
        }
        ctx.restore();
      }
    }

    fmtPrice(v) {
      const n = +v;
      if (!Number.isFinite(n)) return '—';
      if (Math.abs(n) >= 1000) return n.toFixed(1);
      if (Math.abs(n) >= 10) return n.toFixed(2);
      if (Math.abs(n) >= 1) return n.toFixed(3);
      return n.toFixed(5);
    }

    /* ---------------- 交互 ---------------- */
    bind() {
      const c = this.canvas;
      c.addEventListener('mousemove', (e) => {
        const rect = c.getBoundingClientRect();
        const g = this.geom();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.lastY = y;
        if (this.drag) {
          const dx = x - this.drag.x;
          const dIdx = Math.round(-dx / this.barW(g));
          const n = this.data.bars.length;
          const count = this.view.count;
          this.view.start = Math.max(0, Math.min(n - count, this.drag.start + dIdx));
          this.draw();
          return;
        }
        const idx = this.view.start + Math.floor((x - g.padL) / this.barW(g));
        this.hover = Math.max(0, Math.min((this.data ? this.data.bars.length : 1) - 1, idx));
        this.draw();
      });
      c.addEventListener('mouseleave', () => {
        this.hover = -1;
        this.drag = null;
        this.draw();
      });
      c.addEventListener('mousedown', (e) => {
        const rect = c.getBoundingClientRect();
        this.drag = { x: e.clientX - rect.left, start: this.view.start };
      });
      window.addEventListener('mouseup', () => {
        this.drag = null;
      });
      c.addEventListener('dblclick', () => this.resetView());

      /* ---------- 手绘线交互 ---------- */
      const newId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

      const hitTest = (x, y, g) => {
        const r = this.priceRange(g);
        let best = null;
        for (const dl of this.drawings) {
          let dist = Infinity;
          if (dl.type === 'hline') dist = Math.abs(this.yOf(dl.y1, g, r) - y);
          else if (dl.type === 'rect') {
            const x1 = this.xOf(dl.x1, g), x2 = this.xOf(dl.x2, g);
            const y1 = this.yOf(dl.y1, g, r), y2 = this.yOf(dl.y2, g, r);
            const inside = x >= Math.min(x1, x2) - 4 && x <= Math.max(x1, x2) + 4 && y >= Math.min(y1, y2) - 4 && y <= Math.max(y1, y2) + 4;
            dist = inside ? 0 : Infinity;
          } else {
            const x1 = this.xOf(dl.x1, g), x2 = this.xOf(dl.x2 != null ? dl.x2 : dl.x1, g);
            const y1 = this.yOf(dl.y1, g, r), y2 = this.yOf(dl.y2 != null ? dl.y2 : dl.y1, g, r);
            const dx = x2 - x1, dy = y2 - y1;
            const len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
            dist = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
          }
          if (dist <= 9 && (!best || dist < best.dist)) best = { dl, dist };
        }
        return best ? best.dl : null;
      };

      const commit = (dl) => {
        this.drawings.push(dl);
        this.selectedId = dl.id;
        this.emitDraws();
        this.draft = null;
        this.setDrawMode('none'); // 画完自动退出，手机上不会"停不下来"
      };

      c.addEventListener('pointerdown', (e) => {
        if (!this.data || !this.data.bars.length) return;
        const g = this.geom();
        const rect = c.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (this.drawMode === 'none') {
          const hit = hitTest(x, y, g);
          this.selectedId = hit ? hit.id : null;
          this.draw({ redrawOnly: true });
          return;
        }
        e.preventDefault();
        const p = this.dataAt(e.clientX, e.clientY);
        if (this.drawMode === 'hline') {
          commit({ id: newId(), type: 'hline', x1: p.idx, y1: p.price });
          return;
        }
        if (this.drawMode === 'rect') {
          this._dragRect = { start: p };
          this.draft = { id: 'draft', type: 'rect', x1: p.idx, y1: p.price, x2: p.idx, y2: p.price };
          this.draw({ redrawOnly: true });
          return;
        }
        // trend：第一次点定起点，第二次点成交
        if (!this._pendingStart) {
          this._pendingStart = { idx: p.idx, price: p.price, t: (this.data.bars[p.idx] || {}).t };
          this.draft = { id: 'draft', type: 'trend', x1: p.idx, y1: p.price, x2: p.idx, y2: p.price };
          this.draw({ redrawOnly: true });
        } else {
          const st = this._pendingStart;
          if (p.idx !== st.idx || true) {
            commit({ id: newId(), type: 'trend', x1: st.idx, y1: st.price, x2: p.idx, y2: p.price });
          }
          this._pendingStart = null;
        }
      });

      c.addEventListener('pointermove', (e) => {
        if (!this.data) return;
        if (this._dragRect) {
          const p = this.dataAt(e.clientX, e.clientY);
          this.draft.x2 = p.idx;
          this.draft.y2 = p.price;
          this.draw({ redrawOnly: true });
          return;
        }
        if (this._pendingStart && this.drawMode === 'trend') {
          const p = this.dataAt(e.clientX, e.clientY);
          this.draft = { id: 'draft', type: 'trend', x1: this._pendingStart.idx, y1: this._pendingStart.price, x2: p.idx, y2: p.price };
          this.draw({ redrawOnly: true });
        }
      });

      c.addEventListener('pointerup', (e) => {
        const dr = this._dragRect;
        this._dragRect = null;          // 无论成败都复位：画布外松手也不会留下半成品
        if (!dr) return;
        const p = this.dataAt(e.clientX, e.clientY);
        const dxBars = Math.abs(p.idx - dr.start.idx);
        const dyPct = Math.abs(p.price - dr.start.price) / (dr.start.price || 1);
        if (dxBars >= 2 && dyPct >= 0.002) {
          commit({ id: newId(), type: 'rect', x1: dr.start.idx, y1: dr.start.price, x2: p.idx, y2: p.price });
        } else {
          this.draft = null;
          this.setDrawMode('none');
          this.draw({ redrawOnly: true });
        }
      });

      window.addEventListener('pointerup', (e) => {
        if (!this._dragRect) return;
        const dr = this._dragRect;
        this._dragRect = null;
        const rect = c.getBoundingClientRect();
        const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        if (outside) {
          // 画布外松手 = 取消，不要用画布外的坐标凭空生成一条矩形
          this.draft = null;
          this.setDrawMode('none');
          this.draw({ redrawOnly: true });
          return;
        }
        const p = this.dataAt(e.clientX, e.clientY);
        const dxBars = Math.abs(p.idx - dr.start.idx);
        const dyPct = Math.abs(p.price - dr.start.price) / (dr.start.price || 1);
        if (dxBars >= 2 && dyPct >= 0.002) {
          commit({ id: newId(), type: 'rect', x1: dr.start.idx, y1: dr.start.price, x2: p.idx, y2: p.price });
        } else {
          this.draft = null;
          this.setDrawMode('none');
          this.draw({ redrawOnly: true });
        }
      });

      c.addEventListener('pointercancel', () => {
        this._dragRect = null;
        this._pendingStart = null;
        this.draft = null;
        this.draw({ redrawOnly: true });
      });
      /* ---------- 触屏：单指平移，双指捏合缩放，抬手后收提示 ---------- */
      let touchState = null;
      c.addEventListener(
        'touchstart',
        (e) => {
          if (!this.data) return;
          if (this.drawMode !== 'none') return;  // 画线时不响应平移/捏合（否则拖框会把图一起拖走）
          const rect = c.getBoundingClientRect();
          if (e.touches.length >= 2) {
            const [a, b] = e.touches;
            touchState = {
              type: 'pinch', locked: 'pinch',
              dist: Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
              count: this.view.count, start: this.view.start
            };
            e.preventDefault();
          } else if (e.touches.length === 1) {
            const t = e.touches[0];
            // 先不拦截：手势方向未定，交给 touchmove 判定（纵向滑动要让页面滚）
            touchState = { type: 'pan', locked: null, x: t.clientX - rect.left, y0: t.clientY, x0: t.clientX, start: this.view.start };
          }
        },
        { passive: false }
      );
      c.addEventListener(
        'touchmove',
        (e) => {
          if (!touchState || !this.data) return;
          if (touchState.type === 'pan' && touchState.locked !== 'pan') {
            const t0 = e.touches[0];
            if (!t0) return;
            const dx = Math.abs(t0.clientX - touchState.x0);
            const dy = Math.abs(t0.clientY - touchState.y0);
            if (dy > 8 && dy > dx) { touchState = null; return; }   // 纵向：放行页面滚动
            if (dx > 6 && dx >= dy) touchState.locked = 'pan';       // 横向：接管为平移
            else return;
          }
          e.preventDefault();
          const g = this.geom();
          const rect = c.getBoundingClientRect();
          const n = this.data.bars.length;
          if (touchState.type === 'pinch' && e.touches.length >= 2) {
            const [a, b] = e.touches;
            const dist = Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
            const factor = touchState.dist / dist;
            const count = Math.max(20, Math.min(n, Math.round(touchState.count * factor)));
            const center = touchState.start + touchState.count / 2;
            this.view = { count, start: Math.max(0, Math.min(n - count, Math.round(center - count / 2))) };
            this.draw();
          } else if (touchState.type === 'pan' && e.touches.length === 1) {
            const t = e.touches[0];
            const x = t.clientX - rect.left;
            const dIdx = Math.round(-(x - touchState.x) / this.barW(g));
            this.view.start = Math.max(0, Math.min(n - this.view.count, touchState.start + dIdx));
            this.hover = Math.max(0, Math.min(n - 1, this.view.start + Math.floor((x - g.padL) / this.barW(g))));
            this.lastY = t.clientY - rect.top;
            this.draw();
          }
        },
        { passive: false }
      );
      c.addEventListener('touchend', (e) => {
        if (e.touches && e.touches.length > 0) {
          // 双指捏合抬起一指：降级为单指平移，别把状态直接清空
          if (touchState && touchState.type === 'pinch') {
            const t = e.touches[0];
            const rect = c.getBoundingClientRect();
            touchState = { type: 'pan', locked: 'pan', x: t.clientX - rect.left, y0: t.clientY, x0: t.clientX, start: this.view.start };
          }
          return;
        }
        touchState = null;
        clearTimeout(this._touchTimer);
        this._touchTimer = setTimeout(() => {
          this.hover = -1;
          this.draw();
        }, 1400);
      });
      c.addEventListener('touchcancel', () => {
        touchState = null;
        clearTimeout(this._touchTimer);
        this.hover = -1;
        this.draw();
      });

      c.addEventListener(
        'wheel',
        (e) => {
          if (!this.data) return;
          if (!(e.ctrlKey || e.metaKey)) return; // 交给页面滚动；Ctrl/⌘ + 滚轮才缩放
          e.preventDefault();
          const g = this.geom();
          const rect = c.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const anchor = this.view.start + (mx - g.padL) / this.barW(g);
          const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
          const count = Math.max(30, Math.min(this.data.bars.length, Math.round(this.view.count * factor)));
          const start = Math.max(0, Math.min(this.data.bars.length - count, Math.round(anchor - (anchor - this.view.start) * (count / this.view.count))));
          this.view = { start, count };
          this.draw();
        },
        { passive: false }
      );
    }

    zoom(f) {
      if (!this.data) return;
      const n = this.data.bars.length;
      const count = Math.max(30, Math.min(n, Math.round(this.view.count * f)));
      const center = this.view.start + this.view.count / 2;
      this.view = { count, start: Math.max(0, Math.min(n - count, Math.round(center - count / 2))) };
      this.draw();
    }

    resetView() {
      if (!this.data) return;
      const n = this.data.bars.length;
      this.view = { start: Math.max(0, n - 150), count: Math.min(150, n) };
      this.draw();
    }

    setToggle(k, v) {
      this.toggles[k] = v;
      this.draw();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fmtP(v) {
    const n = +v;
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return n.toFixed(1);
    if (Math.abs(n) >= 10) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(3);
    return n.toFixed(5);
  }

  window.ChanChart = ChanChart;
})();
