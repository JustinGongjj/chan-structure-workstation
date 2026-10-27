/* =========================================================
   缠论教学标注构建器（PC 端与手机端共用）
   输入：概念 key + /api/chan 的分析结果
   输出：{title, range, bands, hlines, marks, steps, level, period}
   ========================================================= */
(function () {
  const U = window.U;
  const HL_TITLE = {
    fenxing: '分型',
    bi: '笔',
    xianduan: '线段',
    zhongshu: '中枢',
    a_A_b: 'a + A + b 走势结构',
    zoushi_wanmei: '走势终完美',
    zoushi_jibie: '级别',
    beichi: '趋势背驰',
    panzheng_beichi: '盘整背驰',
    buy1: '第一类买点',
    buy2: '第二类买点',
    buy3: '第三类买点',
    qujian_tao: '区间套',
    zhongyin: '中阴阶段',
    zhongshu_kuozhan: '中枢扩展与扩张',
    tongjibie_fenjie: '同级别分解',
    jiehelv: '结合律与多义性',
    xiaozhuanda: '小转大',
    zoushi_digui: '走势递归',
  };

  function area(res, from, to, dir) {
    const hist = (res.macd && res.macd.hist) || [];
    let a = 0;
    for (let i = from; i <= to; i++) a += dir > 0 ? Math.max(0, hist[i] || 0) : Math.max(0, -(hist[i] || 0));
    return a;
  }
  function fmtP(v) {
    const n = +v;
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return n.toFixed(1);
    if (Math.abs(n) >= 10) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(3);
    return n.toFixed(5);
  }
  function dayOf(res, bar) {
    const b = res.bars[bar];
    return b ? U.ts(b.t, res.period) : '—';
  }
  function biEndingAt(res, bar) {
    return (res.bis || []).find((b) => b.i1 === bar) || null;
  }
  function biStartingAt(res, bar) {
    return (res.bis || []).find((b) => b.i0 === bar) || null;
  }

  function buildHighlight(key, res) {
    const bars = res.bars || [];
    if (!bars.length) return null;
    const bis = res.bis || [];
    const segs = res.segments || [];
    const pivots = res.pivots || [];
    const beichi = res.beichi || [];
    const signals = res.signals || [];
    const lastP = pivots[pivots.length - 1] || null;
    const L = res.level ? res.level.levelName : '';
    const title = HL_TITLE[key] || '结构标注';
    const bands = [];
    const hlines = [];
    const marks = [];
    const steps = [];
    let range = null;

    const pushBand = (from, to, color, label) => {
      if (from == null || to == null) return;
      bands.push({ from, to, color, label });
      range = range ? [Math.min(range[0], from), Math.max(range[1], to)] : [from, to];
    };

    const pivotSteps = (p, prefix = '') => {
      if (!p) return;
      steps.push(`${prefix}中枢区间：<b>ZD ${fmtP(p.zd)} ~ ZG ${fmtP(p.zg)}</b>，由 <b>${p.count} 笔</b>重叠构成，跨度 ${dayOf(res, p.i0)} → ${dayOf(res, p.i1)}。`);
    };

    if (key === 'fenxing' || key === 'bi') {
      const tail = bis.slice(-4);
      tail.forEach((b, i) => {
        const color = b.dir > 0 ? 'gold' : 'accent';
        pushBand(b.i0, b.i1, color, `${b.dir > 0 ? '向上笔' : '向下笔'}${i + 1}`);
        marks.push({ bar: b.i1, price: b.p1, text: b.dir > 0 ? '顶分型' : '底分型', color: b.dir > 0 ? 'gold' : 'accent', pos: b.dir > 0 ? 'above' : 'below' });
      });
      if (key === 'fenxing') {
        steps.push('图上每一根金色折线的<b>端点</b>就是一个分型：向上笔的终点是<b>顶分型</b>，向下笔的终点是<b>底分型</b>。');
        steps.push(`最近四笔的端点价格：${tail.map((b) => fmtP(b.p1)).join(' / ')}（${tail.map((b) => dayOf(res, b.i1)).join(' / ')}）。`);
        steps.push('分型成立的条件是：中间那根（合并后）K 线的高点最高、低点也最高（顶分型），或低点最低、高点也最低（底分型）。');
        steps.push('分型只是<b>候选</b>：还要等「笔」成立（顶底之间至少 1 根独立 K 线、且方向相反）才算数。');
      } else {
        steps.push(`本级别共 <b>${bis.length}</b> 笔，图上是金色折线；每一笔都是两个相邻分型之间的连接。`);
        steps.push(`一笔至少要有 <b>5 根合并 K 线</b>（顶底分型各 3 根、共享 1 根），当前最后一笔：${fmtP(bis[bis.length - 1].p0)} → ${fmtP(bis[bis.length - 1].p1)}（${dayOf(res, bis[bis.length - 1].i0)} → ${dayOf(res, bis[bis.length - 1].i1)}）。`);
        steps.push('笔的方向必须交替：向上笔之后一定是向下笔；出现更极端的同向分型时，最后一笔会被「延长」而不是新起一笔。');
        steps.push('笔是缠论的最小分析单位，中枢、线段、买卖点全都建立在笔之上。');
      }
    } else if (key === 'xianduan') {
      const tail = segs.slice(-3);
      tail.forEach((g, i) => pushBand(g.i0, g.i1, 'seg', `线段${i + 1}${g.done ? '' : '（未完成）'}`));
      steps.push('线段由<b>至少 3 笔</b>构成，图上用紫色粗线表示，一眼就能和金色笔区分开。');
      if (tail.length) {
        const g = tail[tail.length - 1];
        steps.push(`最后一条线段：<b>${g.dir > 0 ? '向上' : '向下'}</b>，${fmtP(g.p0)} → ${fmtP(g.p1)}（${dayOf(res, g.i0)} → ${dayOf(res, g.i1)}），${g.done ? '已确认完成' : '尚未走完'}。`);
      }
      steps.push('线段被破坏的标准：反向三笔形成分型且第三笔不再创新极值；线段一旦确认，就是高一级走势的「笔」。');
    } else if (key === 'zhongshu') {
      if (lastP) {
        pushBand(lastP.i0, lastP.i1, 'gold', `中枢 A（${lastP.count} 笔）`);
        hlines.push({ y: lastP.zg, text: `ZG ${fmtP(lastP.zg)}`, color: 'gold' });
        hlines.push({ y: lastP.zd, text: `ZD ${fmtP(lastP.zd)}`, color: 'gold' });
        marks.push({ bar: lastP.i0, price: lastP.zg, text: '起点', color: 'gold', pos: 'above' });
      }
      steps.push('图上<b>半透明蓝/金色矩形</b>就是中枢：三笔连续重叠的价格区间。');
      pivotSteps(lastP, '最近一个');
      if (lastP) {
        steps.push(`现价 ${fmtP(res.stats.price)} 位于<b>${U.POS_TXT[res.stats.position] || ''}</b>；${lastP.upgraded ? '该中枢已达 9 笔，按缠论会升级为更高级别中枢。' : `目前 ${lastP.count} 笔，未达九笔升级。`}`);
      }
      steps.push('中枢的作用：它是走势的「重心」，买卖点全部围绕它定义——下破回不来的是一卖，上破回不去的是三买。');
    } else if (key === 'a_A_b') {
      const a = lastP && lastP.enterBi != null ? bis[lastP.enterBi] : null;
      const b = lastP && lastP.leaveBi != null ? bis[lastP.leaveBi] : null;
      if (a) pushBand(a.i0, a.i1, 'accent', 'a 进入段');
      if (lastP) pushBand(lastP.i0, lastP.i1, 'gold', `A 中枢 ${lastP.count} 笔`);
      if (b) pushBand(b.i0, b.i1, 'seg', 'b 离开段');
      if (lastP) {
        hlines.push({ y: lastP.zg, text: `ZG ${fmtP(lastP.zg)}`, color: 'gold' });
        hlines.push({ y: lastP.zd, text: `ZD ${fmtP(lastP.zd)}`, color: 'gold' });
      }
      if (a) marks.push({ bar: a.i1, price: a.p1, text: 'a 结束', color: 'accent', pos: a.dir > 0 ? 'above' : 'below' });
      if (b) marks.push({ bar: b.i1, price: b.p1, text: 'b 结束', color: 'seg', pos: b.dir > 0 ? 'above' : 'below' });

      if (a) steps.push(`<b>a 进入段</b>：${dayOf(res, a.i0)} → ${dayOf(res, a.i1)}，${fmtP(a.p0)} → ${fmtP(a.p1)}（${a.dir > 0 ? '向上' : '向下'}，${a.i1 - a.i0 + 1} 根K线）。`);
      if (lastP) steps.push(`<b>A 中枢</b>：ZD ${fmtP(lastP.zd)} ~ ZG ${fmtP(lastP.zg)}，${lastP.count} 笔重叠，${dayOf(res, lastP.i0)} → ${dayOf(res, lastP.i1)}。`);
      if (b) steps.push(`<b>b 离开段</b>：${dayOf(res, b.i0)} → ${dayOf(res, b.i1)}，终点 ${fmtP(b.p1)}，${b.p1 > lastP.zg ? '已上穿 ZG，属于<b>向上离开</b>' : b.p1 < lastP.zd ? '已下破 ZD，属于<b>向下离开</b>' : '仍在中枢区间内，属于<b>中枢延伸</b>'}。`);
      if (a && b) {
        const aa = area(res, a.i0, a.i1, a.dir);
        const bb = area(res, b.i0, b.i1, b.dir);
        if (a.dir !== b.dir) {
          steps.push(`<b>力度比较</b>：a 段 ${a.dir > 0 ? '向上' : '向下'}、b 段 ${b.dir > 0 ? '向上' : '向下'}，方向不同——严格来说该拿同向的「离开段」互相比，这里更适合直接看 b 是否回到中枢、以及是否出现三买/三卖。`);
        } else if (aa > 0) {
          const ratio = bb / aa;
          steps.push(
            `<b>力度比较</b>：b 段 MACD 面积 ${bb.toFixed(1)} / a 段 ${aa.toFixed(1)} = <b>${ratio.toFixed(2)}</b>；${
              ratio < 0.9
                ? 'b 力度明显弱于 a，<b>具备背驰条件</b>（还需价格创新极值来确认）→ 中枢可能结束。'
                : 'b 力度不弱于 a，<b>暂不构成背驰</b>，中枢更容易继续延伸。'
            }`
          );
        }
      } else {
        steps.push('当前中枢尚未走出离开段（b 还没形成），所以还不能比较 a、b 的力度。');
      }
      steps.push('结构升级：若 b 之后又形成第二个不与 A 重叠的中枢 B、再走 c 段，就变成 <b>a+A+b+B+c</b> 的趋势结构——切换周线/更高级别看会更清楚。');
    } else if (key === 'beichi' || key === 'panzheng_beichi') {
      const cand = beichi.filter((x) => x.kind === '段背驰');
      const be = cand[cand.length - 1] || beichi[beichi.length - 1] || null;
      if (key === 'panzheng_beichi') {
        const a = lastP && lastP.enterBi != null ? bis[lastP.enterBi] : null;
        const b = lastP && lastP.leaveBi != null ? bis[lastP.leaveBi] : null;
        if (prevPivotSafe(pivots)) {
          // 盘整：只画一个中枢
        }
        if (a) pushBand(a.i0, a.i1, 'accent', '进入段');
        if (lastP) pushBand(lastP.i0, lastP.i1, 'gold', '中枢 A');
        if (b) pushBand(b.i0, b.i1, 'up', '离开段');
        if (b) marks.push({ bar: b.i1, price: b.p1, text: '离开段极值', color: 'up', pos: b.dir > 0 ? 'above' : 'below' });
        steps.push('盘整背驰 = <b>中枢内部</b>的进入段与离开段力度比较，不需要两个中枢。');
        steps.push('判定：离开段价格创新极值（离开中枢），但 MACD 红绿柱面积明显小于进入段、DIF 也在回拉 → 力度衰竭。');
        steps.push('盘整背驰的终点叫「类一买 / 类一卖」，级别比趋势背驰低，通常只做一段反弹，不是趋势反转。');
        steps.push('如果之后价格又回中枢里震荡，说明背驰失败——这也是为什么盘整背驰要轻仓、快进快出。');
      } else if (be) {
        if (be.segIdx != null && segs[be.segIdx - 2]) pushBand(segs[be.segIdx - 2].i0, segs[be.segIdx - 2].i1, 'accent', '前一段');
        if (be.segIdx != null && segs[be.segIdx]) pushBand(segs[be.segIdx].i0, segs[be.segIdx].i1, be.dir > 0 ? 'up' : 'down', '背驰段');
        marks.push({ bar: be.barIdx, price: be.price, text: be.dir > 0 ? '顶背驰' : '底背驰', color: be.dir > 0 ? 'up' : 'down', pos: be.dir > 0 ? 'above' : 'below' });
        hlines.push({ y: be.price, text: `${be.dir > 0 ? '新高' : '新低'} ${fmtP(be.price)}`, color: be.dir > 0 ? 'up' : 'down' });
        steps.push(`<b>趋势背驰</b>：相邻两个同向段比较，后一段价格创新${be.dir > 0 ? '高' : '低'}（${fmtP(be.price)}，${dayOf(res, be.barIdx)}），但 MACD 面积只有前一段的 <b>${(be.areaRatio * 100).toFixed(0)}%</b>。`);
        steps.push(`图上左侧蓝带是前一段、右侧高亮带是背驰段；同向、同级别才有可比性。`);
        steps.push(`背驰点是<b>一类${be.dir > 0 ? '卖' : '买'}点</b>：${be.dir > 0 ? '上冲衰竭，先减仓再看是否跌破中枢下沿' : '下跌衰竭，可分批试探，止损放在背驰段极值下方'}。`);
        steps.push('验证：切换到小一级别（如日线看 30 分钟），若小级别也出现同向背驰＝区间套确认，信号更强。');
      } else {
        steps.push('当前级别在最近 120 根 K 线内没有检测到背驰；可以换小一级别（如 30 分钟）再看，或等下一个离开段形成。');
      }
    } else if (key === 'buy1' || key === 'buy2' || key === 'buy3') {
      const want = key === 'buy1' ? ['1B', '1S'] : key === 'buy2' ? ['2B', '2S'] : ['3B', '3S'];
      const list = signals.filter((x) => want.includes(x.type));
      const sig = list[list.length - 1] || null;
      if (sig) {
        const isBuy = sig.type.endsWith('B');
        const sigBi = biEndingAt(res, sig.barIdx);
        if (key === 'buy1') {
          const be = beichi.find((x) => x.barIdx === sig.barIdx) || null;
          if (be && be.segIdx != null && segs[be.segIdx]) pushBand(segs[be.segIdx].i0, segs[be.segIdx].i1, isBuy ? 'down' : 'up', '背驰段');
          // 一买要看「买点之前的那个下跌中枢」，而不是最新的中枢
          const pvBefore = [...pivots].reverse().find((p) => p.i1 < sig.barIdx) || lastP;
          if (pvBefore) {
            pushBand(pvBefore.i0, pvBefore.i1, 'gold', `买点前的中枢 ${pvBefore.count} 笔`);
            hlines.push({ y: pvBefore.zg, text: `ZG ${fmtP(pvBefore.zg)}`, color: 'gold' });
            hlines.push({ y: pvBefore.zd, text: `ZD ${fmtP(pvBefore.zd)}`, color: 'gold' });
          }
          marks.push({ bar: sig.barIdx, price: sig.price, text: `${U.SIG_SHORT[sig.type]} ${fmtP(sig.price)}`, color: isBuy ? 'down' : 'up', pos: isBuy ? 'below' : 'above' });
          steps.push(`<b>一类${isBuy ? '买' : '卖'}点</b>出现在 <b>${dayOf(res, sig.barIdx)}</b>，价格 <b>${fmtP(sig.price)}</b>${sig.beichi ? '（' + sig.beichi + '）' : ''}。`);
          steps.push('定义：下跌趋势最后一个中枢之后、c 段出现背驰的终点。图上即「背驰段的最低点」。');
          steps.push(`确认要点：① 前面至少两个不重叠中枢；② c 段创新低但 MACD 面积缩小；③ 背驰点之后必须出现反向笔。`);
          steps.push(`止损：放在 ${fmtP(sig.price)} 下方一小段；一类买点风险最大但赔率最高，仓位宜轻。`);
        } else if (key === 'buy2') {
          const refBar = sig.refBar != null ? sig.refBar : null;
          if (refBar != null) {
            const refBi = biEndingAt(res, refBar);
            if (refBi) pushBand(refBi.i0, refBi.i1, 'accent', '一买');
            marks.push({ bar: refBar, price: (refBi ? refBi.p1 : sig.price), text: '一买低点', color: 'accent', pos: 'below' });
          }
          if (sigBi) pushBand(sigBi.i0, sigBi.i1, isBuy ? 'down' : 'up', '回抽段');
          marks.push({ bar: sig.barIdx, price: sig.price, text: `${U.SIG_SHORT[sig.type]} ${fmtP(sig.price)}`, color: isBuy ? 'down' : 'up', pos: isBuy ? 'below' : 'above' });
          steps.push(`<b>二类${isBuy ? '买' : '卖'}点</b>：${dayOf(res, sig.barIdx)}，价格 ${fmtP(sig.price)}。`);
          steps.push('定义：一类买点后的第一次次级别回调，回调低点<b>不破一类买点低点</b>，这个回调结束点就是二买。');
          steps.push('本质上，二买就是「次级别走势里的一个一类买点」——把小一级别打开去找那个背驰低点，会更精确。');
          steps.push('二买比一买安全（右侧确认），但空间也小一些，止损放一买低点下方。');
        } else {
          const pv = sig.pivot != null ? pivots[sig.pivot] : lastP;
          if (pv) {
            pushBand(pv.i0, pv.i1, 'gold', `中枢 ZG ${fmtP(pv.zg)}`);
            hlines.push({ y: pv.zg, text: `ZG ${fmtP(pv.zg)}`, color: 'gold' });
          }
          if (sigBi) pushBand(sigBi.i0, sigBi.i1, isBuy ? 'down' : 'up', '回抽段');
          marks.push({ bar: sig.barIdx, price: sig.price, text: `${U.SIG_SHORT[sig.type]} ${fmtP(sig.price)}`, color: isBuy ? 'down' : 'up', pos: isBuy ? 'below' : 'above' });
          steps.push(`<b>三类${isBuy ? '买' : '卖'}点</b>：${dayOf(res, sig.barIdx)}，价格 ${fmtP(sig.price)}。`);
          steps.push(`定义：向上离开中枢后，<b>回抽不跌破中枢上沿 ZG（${pv ? fmtP(pv.zg) : '—'}）</b>，这个回抽低点就是三买。`);
          steps.push('三买意味着中枢被有效突破、回抽确认，是趋势延续的入场点，止损就放在 ZG 下方。');
          steps.push('要注意：回抽若跌回中枢内（跌破 ZG），三买不成立，会变成中枢震荡。');
        }
      } else {
        steps.push(`最近 160 根 K 线内没有出现${U.SIG_SHORT[want[0]]}信号，可以切换更小级别（如 30 分钟 / 5 分钟）再找。`);
      }
    } else if (key === 'zoushi_wanmei' || key === 'zhongyin' || key === 'zhongshu_kuozhan' || key === 'tongjibie_fenjie' || key === 'jiehelv' || key === 'xiaozhuanda' || key === 'zoushi_digui') {
      if (lastP) {
        pushBand(lastP.i0, lastP.i1, 'gold', `当前中枢 ${lastP.count} 笔`);
        hlines.push({ y: lastP.zg, text: `ZG ${fmtP(lastP.zg)}`, color: 'gold' });
        hlines.push({ y: lastP.zd, text: `ZD ${fmtP(lastP.zd)}`, color: 'gold' });
      }
      const lastBi = bis[bis.length - 1];
      if (lastBi) marks.push({ bar: lastBi.i1, price: lastBi.p1, text: '当前笔终点', color: 'gold', pos: lastBi.dir > 0 ? 'above' : 'below' });
      if (key === 'zoushi_wanmei') {
        steps.push('走势终完美：任何级别的走势类型，最终都会完成——也就是必然走出「进入段 + 中枢 + 离开段」，并形成明确的转折。');
        steps.push(`图上当前结构：<b>${res.trend.type}</b>（${res.trend.sub}），最后一个中枢 ${lastP ? fmtP(lastP.zd) + '~' + fmtP(lastP.zg) : '未形成'}。`);
        steps.push('判断「完没完」的唯一标准：中枢是否被有效离开 + 是否出现背驰；没离开就还在延伸，不能急着断言转折。');
        steps.push('所以终完美不是预测，而是「等到结构自己走完」的纪律。');
      } else if (key === 'zhongyin') {
        steps.push('中阴阶段＝前一个走势已完成、后一个走势还没确立的那段模糊震荡期，通常就发生在图上的<b>中枢延伸</b>区间里。');
        steps.push(`当前中枢已延伸 ${lastP ? lastP.count : 0} 笔，如果迟迟不离开且反复插针，就是典型中阴。`);
        steps.push('中阴阶段的纪律：降低频率、缩小仓位，不猜方向；等新的中枢/背驰出现再动手。');
      } else if (key === 'zhongshu_kuozhan') {
        steps.push('中枢扩展：中枢延伸过程中，后续笔的波动范围超过了原中枢区间，但结构没有升级。');
        steps.push('中枢扩张：出现两个同级别中枢，且它们的区间有重叠，按缠论可以合成一个更高级别的中枢来看。');
        steps.push(`图上绿色的 ZG/ZD 若被后续笔反复穿越，就进入扩展；出现第二个框与本框重叠，就是扩张。`);
        steps.push('实战意义：扩展/扩张会让「级别」变得模糊，此时应降低级别操作，或换更高级别重新定位中枢。');
      } else if (key === 'tongjibie_fenjie') {
        steps.push('同级别分解：把一个走势拆成若干个同级别的走势段（例如段与段之间用中枢连接），每段内部再递归。');
        steps.push('图上的紫色线段＋中枢框就是一次同级别分解的直观结果。');
        steps.push('分解后每一段都独立判断买卖点，不要把不同级别的信号混在一起用。');
      } else if (key === 'jiehelv') {
        steps.push('走势的多义性：同一段 K 线，按不同起点/不同级别可以有多种合理划分，这不是错，而是缠论承认的「多义」。');
        steps.push('处理办法：先固定级别，再选一个「中枢最少、背驰最清晰」的划分作为主划分。');
        steps.push('结合律保证：无论怎么划分，只要级别不变，买卖点的结论不会自相矛盾。');
      } else if (key === 'xiaozhuanda') {
        steps.push('小转大：小级别上出现剧烈背驰/放量反转，直接把大级别走势拽转过来。');
        steps.push('图上表现为：小级别一笔直接跌破大级别中枢下沿，且没有再回来。');
        steps.push('小转大不可预设，只能事后确认；确认前用仓位控制风险，确认后再按新结构跟随。');
      } else {
        steps.push('走势的递归与自相似：日线的「笔」，在 30 分钟图上就是「线段」；级别只是观察的放大倍数。');
        steps.push('切换级别按钮（日线 / 60 分 / 30 分 / 5 分）看同一段行情，结构会呈现相似的分形形态。');
      }
    } else if (key === 'zoushi_jibie') {
      steps.push(`当前级别：<b>${L}</b>；这一级别的笔、中枢、买卖点只用本级别的图判断。`);
      steps.push('级别不是「看哪个周期」，而是「用哪一级的笔构成中枢」：日线的一笔在 30 分钟上是一段，在 5 分钟上是一个走势。');
      steps.push('操作纪律：大级别定方向（周/日）、中级别找中枢（30/60 分）、小级别等买卖点（5/15 分）。');
      steps.push('点上方周期按钮切换级别，观察同一段行情结构如何「放大」——这就是级别的直观含义。');
    } else if (key === 'qujian_tao') {
      steps.push('区间套：用大级别的背驰段锁定区间，再在小级别里找同一位置的背驰点，层层收敛到最小级别的一买。');
      steps.push('图下方「区间套 · 多级别联立」卡片就是这个过程：日线定方向 → 60/30 分找中枢 → 5/1 分等信号。');
      steps.push('实操：大级别出现背驰段后，切到小级别，在背驰段内部再找一次背驰——两级共振才是高质量买点。');
      steps.push('注意：区间套只在「大级别已经走完」时才有意义，否则只是把小级别的噪音放大。');
    } else {
      if (lastP) {
        pushBand(lastP.i0, lastP.i1, 'gold', `中枢 ${lastP.count} 笔`);
        hlines.push({ y: lastP.zg, text: `ZG ${fmtP(lastP.zg)}`, color: 'gold' });
        hlines.push({ y: lastP.zd, text: `ZD ${fmtP(lastP.zd)}`, color: 'gold' });
      }
      steps.push('本概念在当前图上的对应位置：高亮的区间 + 中枢上下沿。');
      steps.push('可对照右侧「结构状态」与「体系解读」，把图形与文字一一对上。');
    }

    return {
      key,
      title,
      range,
      bands,
      hlines,
      marks,
      steps,
      level: L,
      period: res.period,
    };
  }

  function prevPivotSafe(list) {
    return list.length > 1;
  }


  window.CHAN_HL = { buildHighlight, HL_TITLE, area, fmtP, dayOf };
})();
