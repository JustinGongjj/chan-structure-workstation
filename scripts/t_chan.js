const S = require('/home/node/default/chanlun-station/server/lib/sources');
const C = require('/home/node/default/chanlun-station/server/lib/chan');
function invariants(r){
  const errs=[];
  for(let i=1;i<r.bis.length;i++){
    if(r.bis[i].dir===r.bis[i-1].dir) errs.push('bi dir same at '+i);
    if(Math.abs(r.bis[i].p0 - r.bis[i-1].p1)>1e-6) errs.push('bi gap at '+i+' '+r.bis[i].p0+' vs '+r.bis[i-1].p1);
    if(r.bis[i].i1<=r.bis[i].i0) errs.push('bi index order '+i);
  }
  for(const p of r.pivots){ if(!(p.zg>p.zd)) errs.push('pivot zg<=zd '+p.idx); }
  for(let i=1;i<r.pivots.length;i++){ if(r.pivots[i].i0 <= r.pivots[i-1].i1) errs.push('pivot overlap '+i); }
  return errs;
}
(async()=>{
  const cases=[['A','600519','day',600],['A','600519','30m',600],['HK','00700','day',600],['US','NVDA','day',600],['CR','BTCUSDT','30m',600],['A','000001','week',400]];
  for(const [m,c,p,lim] of cases){
    try{
      const k = await S.klines({market:m, code:c, period:p, limit:lim});
      const r = C.analyze(k.bars, {period:p, market:m, code:c});
      console.log(`\n=== ${m} ${c} ${p} src=${k.source} bars=${r.bars.length} merged=${r.stats.mergedBars} bis=${r.stats.bis} segs=${r.stats.segments} pivots=${r.stats.pivots} trend=${r.trend.type}/${r.trend.sub}`);
      console.log('structure:', r.structure);
      console.log('invariants:', invariants(r).slice(0,5));
      console.log('pivots:', r.pivots.slice(-3).map(x=>`[${x.zd.toFixed(2)},${x.zg.toFixed(2)}]n=${x.count}bars=${x.i0}-${x.i1}`).join(' | '));
      console.log('signals(last6):', r.signals.slice(-6).map(s=>`${s.type}@${s.price.toFixed(2)}[bar${s.barIdx}]${s.note||''}`).join(' | '));
      console.log('beichi:', r.beichi.slice(-3).map(b=>`${b.kind}/${b.dir}@${b.price.toFixed(2)} ratio=${b.areaRatio}`).join(' | '));
      console.log('summary:', r.summary);
    }catch(e){ console.log(m,c,p,'ERR',e.message); }
  }
})();
