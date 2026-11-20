const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let msg = 'Pronto', open = null, online = null, pending = 0, mode = 'minimal', values = { setup: '', tags: [], note: '', target: 'draft' };

function render() {
  const dot = $('dot');
  const busy = /…$/.test(msg);
  dot.className = 'dot' + (busy ? ' busy' : open ? ' on' : '');   // blu che pulsa = sto leggendo; verde = c'è un trade aperto; arancione = nessun trade aperto
  const conn = online ? `Salvo sul PC e invio una copia online (${online.account || 'conto'})` + (pending ? `: ${pending} trade da inviare` : '') : 'Salvataggio sul PC (nessuna copia online)';
  const tr = open ? `Aperto: ${open.symbol || '—'} ${open.direction || ''}` : 'Nessun trade aperto';
  dot.title = `${conn}\n${msg}\n${tr}`;
  dot.setAttribute('aria-label', dot.title);
  $('trade').innerHTML = open ? `${esc(open.symbol || '')} <span class="${open.direction === 'SHORT' ? 'short' : 'long'}">${open.direction === 'SHORT' ? '▼' : '▲'}</span>${open.count > 1 ? `<span class="more-open">+${open.count - 1}</span>` : ''}` : '';
  $('trade').title = open ? `${tr}${open.count > 1 ? ` (+${open.count - 1} altri aperti)` : ''}\nClicca per vedere, chiudere o eliminare i trade aperti` : tr;
  for (const id of ['tp', 'sl', 'man']) $(id).disabled = !open;
  document.body.className = mode;
  const who = values.target === 'trade' ? 'del trade aperto' : 'del prossimo trade';
  $('setup').querySelector('.lbl').textContent = values.setup || 'Setup';
  $('setup').classList.toggle('set', !!values.setup);
  $('setup').title = values.setup ? `Setup ${who}: ${values.setup}` : `Scegli il setup ${who}`;
  $('tags').querySelector('.lbl').textContent = values.tags.length ? `Tag ${values.tags.length}` : 'Tag';
  $('tags').classList.toggle('set', values.tags.length > 0);
  $('tags').title = values.tags.length ? `Tag ${who}: ${values.tags.join(', ')}` : `Scegli i tag ${who}`;
  const ni = $('noteIn');
  if (document.activeElement !== ni) ni.value = values.note;
  ni.title = `Note ${who}`;
  $('noteBtn').classList.toggle('has', !!values.note);
  $('noteBtn').title = values.note ? `Note ${who}: ${values.note}` : `Scrivi le note ${who}`;
  // la finestra si adatta alla larghezza della barra: niente spazio sprecato
  requestAnimationFrame(() => api.resize(Math.ceil(document.querySelector('.bar').getBoundingClientRect().width) + 6));
}

$('new').onclick = () => api.newTrade();
$('tp').onclick = () => api.closeTrade('TP');
$('sl').onclick = () => api.closeTrade('SL');
$('man').onclick = () => api.closeTrade('MANUALE');
$('more').onclick = () => api.menu();
$('trade').onclick = () => { const r = $('trade').getBoundingClientRect(); api.openTrades({ x: r.left, y: r.bottom + 2 }); };
const below = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 2 }; };
$('setup').onclick = () => api.setupMenu(below($('setup')));
$('tags').onclick = () => api.tagMenu(below($('tags')));
$('noteBtn').onclick = () => api.noteWindow();
let noteTimer = null;
$('noteIn').addEventListener('input', (e) => { clearTimeout(noteTimer); const v = e.target.value; noteTimer = setTimeout(() => api.setNote(v), 700); });
$('noteIn').addEventListener('blur', (e) => { clearTimeout(noteTimer); if (e.target.value !== values.note) api.setNote(e.target.value); });
$('noteIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });

// spostamento: tieni premuta la maniglia a sinistra e trascina
const grip = $('grip');
grip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('dragging');
  api.dragStart({ x: e.screenX, y: e.screenY });
});
grip.addEventListener('pointermove', (e) => { if (grip.hasPointerCapture(e.pointerId)) api.drag({ x: e.screenX, y: e.screenY }); });
const stop = (e) => { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); grip.classList.remove('dragging'); api.dragEnd(); };
grip.addEventListener('pointerup', stop);
grip.addEventListener('pointercancel', stop);

api.on('status', (s) => { msg = s; render(); });
api.on('state', (s) => { open = s.open; online = s.online; pending = s.pending || 0; mode = s.mode || 'minimal'; values = s.values || values; render(); });
render();
