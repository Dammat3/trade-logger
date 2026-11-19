const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
api.novitaGet().then(({ current, since }) => {
  // since = ultima versione già vista: mostro quelle più nuove (se non c'è, tutte); sempre almeno l'ultima
  let list = window.NOVITA.filter((n) => cmp(n.v, current) <= 0 && (!since || cmp(n.v, since) > 0));
  if (!list.length) list = window.NOVITA.slice(0, 1);
  $('head').textContent = `Trade Logger ${current}: cosa è cambiato`;
  $('sub').textContent = since ? `Dalla versione ${since} che avevi prima.` : 'Le novità delle ultime versioni.';
  $('list').innerHTML = list.map((n, i) => `<section class="ver ${i === 0 ? 'now' : ''}"><h2>${esc(n.titolo)} <span>${esc(n.v)}</span></h2><ul>${n.righe.map(([t, x]) => `<li><span class="tag ${esc(t)}">${esc(t)}</span><span>${esc(x)}</span></li>`).join('')}</ul></section>`).join('');
});
$('ok').onclick = () => api.novitaClose();
