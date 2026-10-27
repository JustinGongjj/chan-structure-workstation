/* 数据源状态页 */
(function () {
  async function render() {
    U.$('#sourceList').innerHTML = '<div class="loading">探测各免费接口…</div>';
    try {
      const [src, mk, health] = await Promise.all([API.sources(), API.markets().catch(() => null), API.health().catch(() => null)]);
      U.$('#sourceList').innerHTML = (src.sources || [])
        .map(
          (s) => `<div class="src">
        <span class="st ${s.ok ? 'ok' : 'bad'}"></span>
        <div>
          <div class="nm">${U.esc(s.name)}</div>
          <div class="ms">${s.ok ? '正常 · ' + s.ms + 'ms' : '不可用 · ' + U.esc(s.note || '')}</div>
          <div class="hint" style="margin-top:3px">${(s.markets || []).map((m) => U.MK[m] || m).join(' / ')}</div>
        </div>
      </div>`
        )
        .join('');
      if (mk) {
        const markets = ['A', 'HK', 'US', 'CR'];
        const rows = markets
          .map((m) => {
            const mm = mk.markets[m];
            const intraday = mm.periods.filter((p) => !['day', 'week', 'month'].includes(p));
            const srcMap = { A: '腾讯日周月 + 新浪 1/5/15/30/60 分', HK: '腾讯日周月（分钟线暂缺）', US: '纳斯达克官方日线 + 聚合周月（分钟线暂缺）', CR: '币安 1m~4h/日/周' };
            return `<tr><td><span class="chip">${U.MK[m]}</span></td>
              <td>${mm.periods.map((p) => `<span class="chip gold">${mk.periods[p] || p}</span>`).join(' ')}</td>
              <td class="hint">${intraday.length ? '支持 ' + intraday.length + ' 个分钟级别' : '仅日/周/月'}</td>
              <td class="hint">${srcMap[m]}</td></tr>`;
          })
          .join('');
        U.$('#covTbl').innerHTML = `<table class="tbl"><thead><tr><th>市场</th><th>可用级别</th><th>分钟线</th><th>数据源组合</th></tr></thead><tbody>${rows}</tbody></table>`;
      }
      if (health) {
        U.$('#sysInfo').innerHTML = [
          ['服务状态', health.ok ? '运行中' : '异常'],
          ['Node 版本', health.node],
          ['运行时长', health.uptimeSec + ' 秒'],
          ['缓存条目', health.cache.entries + ' 条'],
          ['并发请求', health.cache.inflight + ' 个'],
        ]
          .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${U.esc(v)}</span></div>`)
          .join('');
      }
    } catch (e) {
      U.$('#sourceList').innerHTML = '<div class="loading">探测失败：' + U.esc(e.message) + '</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // 页面按钮在 app.js 中统一绑定
  });

  window.PageSources = { render };
})();
