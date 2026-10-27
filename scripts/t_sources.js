const S = require('/home/node/default/chanlun-station/server/lib/sources');
(async()=>{
  const qs = await S.quotes([{market:'A',code:'600519'},{market:'A',code:'000001'},{market:'HK',code:'00700'},{market:'US',code:'NVDA'},{market:'CR',code:'BTCUSDT'}]);
  console.log('QUOTES', JSON.stringify(qs,null,0).slice(0,700));
  for (const [m,c,p] of [['A','600519','day'],['A','600519','5m'],['HK','00700','day'],['HK','00700','week'],['US','NVDA','day'],['US','NVDA','week'],['CR','BTCUSDT','day'],['CR','BTCUSDT','60m']]) {
    try { const r = await S.klines({market:m, code:c, period:p, limit:300}); console.log(m,c,p,'n=',r.bars.length,'src=',r.source,'last=',JSON.stringify(r.bars[r.bars.length-1])); }
    catch(e){ console.log(m,c,p,'ERR',e.message); }
  }
  console.log('SEARCH', JSON.stringify((await S.search('茅台')).slice(0,3)));
  console.log('PROBE', JSON.stringify(await S.probe()));
})();
