const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => n == null ? '' : n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const price = (n) => n == null ? '' : n.toLocaleString('it-IT', { maximumFractionDigits: 5 });
const date = (iso) => iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

function stats(trades) {
  const closed = trades.filter((t) => t.status === 'chiuso' && t.pnl != null);
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const sum = (a) => a.reduce((s, t) => s + t.pnl, 0);
  const total = sum(closed);
  const pf = losses.length ? sum(wins) / Math.abs(sum(losses)) : null;
  const rs = closed.filter((t) => t.rResult != null);
  const items = [
    ['Trade chiusi', closed.length],
    ['Win rate', closed.length ? Math.round(wins.length / closed.length * 100) + '%' : '—'],
    ['P&L totale', `<span class="${total > 0 ? 'pos' : total < 0 ? 'neg' : ''}">${money(total)}</span>`],
    ['Media vincita', wins.length ? money(sum(wins) / wins.length) : '—'],
    ['Media perdita', losses.length ? money(sum(losses) / losses.length) : '—'],
    ['Profit factor', pf == null ? '—' : pf.toFixed(2)],
    ['R totale', rs.length ? rs.reduce((s, t) => s + t.rResult, 0).toFixed(2) + ' R' : '—'],
  ];
  $('stats').innerHTML = items.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
}

function table(trades) {
  if (!trades.length) { $('table').innerHTML = '<tr><td class="empty">Ancora nessun trade. Premi "Nuovo trade" sulla barra quando apri una posizione.</td></tr>'; return; }
  const rows = [...trades].reverse().map((t) => `
    <tr class="${t.status === 'aperto' ? 'open' : ''}">
      <td>${date(t.openedAt)}</td>
      <td><b>${esc(t.symbol)}</b></td>
      <td><span class="tag ${esc(t.direction)}">${esc(t.direction)}</span></td>
      <td class="num">${price(t.entry)}</td>
      <td class="num">${price(t.sl)}</td>
      <td class="num">${price(t.tp)}</td>
      <td class="num">${t.rrPlanned != null ? t.rrPlanned.toFixed(2) : ''}</td>
      <td>${t.status === 'aperto' ? '<span class="muted">aperto</span>' : `<span class="tag ${esc(t.outcome)}">${t.outcome === 'MANUALE' ? 'A mano' : esc(t.outcome)}</span>`}</td>
      <td class="num ${t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : ''}">${money(t.pnl)}</td>
      <td class="note" title="${esc(t.note)}">${esc(t.note)}</td>
      <td title="${esc(t.syncError || '')}">${!t.rev ? '<span class="muted">—</span>' : (t.syncedRev || 0) >= t.rev ? '<span class="pos">✓</span>' : '<span class="muted">in attesa</span>'}</td>
      <td>
        ${t.shotOpen ? `<button data-open="${esc(t.shotOpen)}" title="Screenshot di apertura">Apertura</button>` : ''}
        ${t.shotClose ? `<button data-open="${esc(t.shotClose)}" title="Screenshot di chiusura">Chiusura</button>` : ''}
        <button data-del="${esc(t.id)}" title="Elimina">✕</button>
      </td>
    </tr>`).join('');
  $('table').innerHTML = `<thead><tr><th>Data</th><th>Simbolo</th><th>Dir.</th><th>Ingresso</th><th>Stop</th><th>Target</th><th>RR</th><th>Esito</th><th>P&amp;L</th><th>Note</th><th>Online</th><th></th></tr></thead><tbody>${rows}</tbody>`;
}

async function load() { const t = await api.listTrades(); stats(t); table(t); }

$('table').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) api.openFile(b.dataset.open);
  if (b.dataset.del) api.deleteTrade(b.dataset.del);
});
$('csv').onclick = () => api.exportCsv();
$('sync').onclick = () => api.syncNow();
$('folder').onclick = () => api.openDataFolder();
api.on('trades:changed', load);
load();
