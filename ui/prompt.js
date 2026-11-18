const $ = (id) => document.getElementById(id);
api.promptGet().then((o) => {
  o = o || {};
  document.title = o.title || '';
  $('label').textContent = o.label || '';
  const f = document.createElement(o.multiline ? 'textarea' : 'input');
  f.id = 'field'; f.value = o.value || '';
  if (o.multiline) f.placeholder = 'Perché entri, cosa vedi sul grafico, come pensi di gestirlo…';
  $('box').appendChild(f);
  $('hint').textContent = o.multiline ? 'Ctrl+Invio per salvare' : 'Invio per salvare';
  f.focus(); f.setSelectionRange(f.value.length, f.value.length);
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.promptDone(null);
    if (e.key === 'Enter' && (!o.multiline || e.ctrlKey)) { e.preventDefault(); api.promptDone(f.value); }
  });
  $('ok').onclick = () => api.promptDone(f.value);
  $('cancel').onclick = () => api.promptDone(null);
});
