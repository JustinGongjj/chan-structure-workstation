const S = require('/home/node/default/chanlun-station/server/lib/sources');
const C = require('/home/node/default/chanlun-station/server/lib/chan');
(async()=>{
  const k = await S.klines({market:'A', code:'600519', period:'day', limit:600});
  const r = C.analyze(k.bars, {period:'day'});
  console.log('bis', r.bis.length, 'segs', r.segments.length, 'pivots', r.pivots.length);
  console.log('segments:', r.segments.map(s=>`dir${s.dir} bi${s.startBi}-${s.endBi} bars ${s.i0}-${s.i1} ${s.done?'done':'open'}`).join('\n'));
  console.log('bis idx:', r.bis.map((b,i)=>`${i}:${b.dir>0?'U':'D'}${b.p0.toFixed(0)}->${b.p1.toFixed(0)}@${b.i0}-${b.i1}`).slice(0,12).join(' '));
  // beichi candidates
  const bars = r.bars;
  const md = C.macd(bars.map(b=>b.c));
  console.log('pivots:', r.pivots.map(p=>`#${p.idx} [${p.zd.toFixed(1)},${p.zg.toFixed(1)}] n=${p.count} bars ${p.i0}-${p.i1}`).join('\n'));
})();
