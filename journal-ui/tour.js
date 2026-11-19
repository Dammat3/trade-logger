'use strict';
// Tutorial guidato: evidenzia un punto del programma e mostra una nuvoletta con Avanti / Indietro / Salta.
(function () {
  const KEY = 'journal-tour-done';
  const $ = (s, r) => (r || document).querySelector(s);
  const card = (title) => Array.from(document.querySelectorAll('.card')).find((c) => { const h = c.querySelector('h2'); return h && h.textContent.trim() === title; });
  const STEPS = [
    { title: 'Benvenuto nel Journal', text: 'Ti faccio fare un giro veloce: ogni passo evidenzia una parte del programma e ti spiega a cosa serve. Premi <b>Avanti</b> per continuare, <b>Indietro</b> per tornare, <b>Salta</b> per chiudere quando vuoi.' },
    { page: 'dashboard', sel: () => $('.side'), title: 'Il menu', text: 'Qui passi da una pagina all\'altra: Dashboard, Reports, Progress, News e Impostazioni. Le vediamo una per una.', side: 'right' },
    { page: 'dashboard', sel: () => $('#accBtn'), title: 'Il conto', text: 'Qui scegli su quale conto lavori. Puoi avere conti live e conti di backtest, ognuno con i suoi trade. Si creano e si rinominano in Impostazioni.', side: 'bottom' },
    { page: 'dashboard', sel: () => $('.kpis'), title: 'Le statistiche principali', text: 'Risultato netto, win rate, aspettativa per trade, profit factor e le altre cifre chiave del conto aperto. Si aggiornano da sole ogni volta che aggiungi o modifichi un trade.', side: 'bottom' },
    { page: 'dashboard', sel: () => $('#calCard'), title: 'Il calendario', text: 'Ogni giorno mostra quanto hai guadagnato o perso e quanti trade hai fatto. <b>Clicca un giorno</b> per aprirlo: lì trovi i trade, gli screenshot e puoi scrivere l\'analisi della giornata (il puntino colorato indica che c\'è già).', side: 'top' },
    { page: 'dashboard', sel: () => $('#logCard'), title: 'Il trade log', text: 'L\'elenco di tutti i trade. Aprendone uno puoi correggere setup, tag, risultato e screenshot se hai sbagliato qualcosa al momento dell\'inserimento.', side: 'top' },
    { page: 'dashboard', sel: () => $('#eqCard'), title: 'La curva equity', text: 'Come è cresciuto (o calato) il conto nel tempo. Serve a vedere a colpo d\'occhio se stai andando nella direzione giusta.', side: 'top' },
    { page: 'reports', sel: () => $('[data-page="reports"]'), title: 'Reports', text: 'Qui i tuoi dati diventano risposte: andamento mese per mese, giorno della settimana, fascia oraria, risultato per setup, long contro short, tag ed emozioni. Serve a capire dove guadagni e dove perdi.', side: 'right' },
    { page: 'progress', sel: () => $('[data-page="progress"]'), title: 'Progress', text: 'Misura la costanza: quanti giorni di fila hai tenuto il journal, quali giornate hanno trade ma nessuna analisi scritta e le tue ultime analisi.', side: 'right' },
    { page: 'news', sel: () => $('[data-page="news"]'), title: 'News', text: 'Il calendario delle notizie economiche della settimana. Si aggiorna da solo e ti dice a che ora escono i dati importanti, utile per non farti sorprendere.', side: 'right' },
    { page: 'settings', sel: () => card('Aspetto'), title: 'Aspetto', text: 'Scegli il tema grafico. Cambia solo l\'aspetto, le funzioni restano identiche.', side: 'bottom' },
    { page: 'settings', sel: () => card('Aggiornamenti'), title: 'Aggiornamenti', text: 'Qui vedi la versione installata e, con <b>Cerca aggiornamenti</b>, controlli se ce n\'è una nuova. Il Journal controlla comunque da solo ogni volta che lo apri.', side: 'bottom' },
    { page: 'settings', sel: () => card('Dati sul tuo PC'), title: 'I tuoi dati', text: 'Tutto è salvato in cartelle sul tuo PC. Da qui apri le cartelle, scegli dove tenere gli screenshot e crei una copia di sicurezza. Una copia automatica viene fatta anche una volta al giorno.', side: 'top' },
    { page: 'settings', sel: () => card('Conti e backtest'), title: 'Conti e backtest', text: 'Crea un nuovo conto con <b>+ Nuovo</b>, rinominalo o eliminalo. Eliminare cancella per sempre i suoi trade, per questo ti chiede conferma.', side: 'top' },
    { page: 'settings', sel: () => card('Setup'), title: 'Setup e tag', text: 'Le liste che compaiono quando registri un trade. Puoi aggiungerne, rinominarli (si cambiano su tutti i trade) o nasconderli. Vedi anche quanti trade usano ciascuno.', side: 'top' },
    { title: 'Il resto lo fa Trade Logger', text: 'I trade arrivano dalla barra di <b>Trade Logger</b> mentre operi: funziona con FX Replay e TradeSea, le piattaforme principali, ma anche con qualsiasi altra piattaforma di trading. Il Journal li mostra qui da solo. Puoi rifare questo giro quando vuoi dal pulsante <b>? Tutorial</b> nel menu a sinistra.' },
  ];
  let i = 0, ui = null, active = false, dir = 1;

  const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  function build() {
    ui = { wrap: mk('div', 'tour'), block: mk('div', 'tour-block'), hl: mk('div', 'tour-hl'), tip: mk('div', 'tour-tip') };
    ui.tip.setAttribute('aria-live', 'polite');
    ui.tip.innerHTML = '<div class="tour-step"></div><h3></h3><p></p><div class="tour-btns"><button type="button" class="btn ghost" data-t="skip">Salta</button><span class="grow"></span><button type="button" class="btn" data-t="back">Indietro</button><button type="button" class="btn primary" data-t="next">Avanti</button></div>';
    ui.wrap.append(ui.block, ui.hl, ui.tip);
    document.body.appendChild(ui.wrap);
    ui.tip.onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t; if (t === 'skip') stop(); else if (t === 'back') go(i - 1); else go(i + 1); };
  }
  async function waitFor(fn, ms) { const t0 = Date.now(); for (;;) { const e = fn(); if (e) return e; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 60)); } }

  async function go(n) {
    if (!active) return;
    if (n < 0) n = 0;
    if (n >= STEPS.length) { stop(); return; }
    dir = n >= i ? 1 : -1; const prev = i; i = n;
    const s = STEPS[i];
    if (s.page && S.page !== s.page) { goPage(s.page); await new Promise((r) => setTimeout(r, 80)); }
    if (!active || i !== n) return;
    const el = s.sel ? await waitFor(s.sel, 1500) : null;
    if (!active || i !== n) return;
    if (s.sel && !el) { go(dir > 0 ? i + 1 : (i > 0 ? i - 1 : 1)); return; }   // la parte non esiste in questa versione: la salto
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'instant' in document.documentElement ? 'instant' : 'auto' });
    ui.tip.querySelector('.tour-step').textContent = `Passo ${i + 1} di ${STEPS.length}`;
    ui.tip.querySelector('h3').textContent = s.title;
    ui.tip.querySelector('p').innerHTML = s.text;
    ui.tip.querySelector('[data-t="back"]').hidden = i === 0;
    ui.tip.querySelector('[data-t="next"]').textContent = i === STEPS.length - 1 ? 'Fine' : (i === 0 ? 'Inizia' : 'Avanti');
    place(el, s.side);
    ui.tip.querySelector('[data-t="next"]').focus({ preventScroll: true });
  }
  function place(el, side) {
    const tip = ui.tip, hl = ui.hl;
    tip.style.visibility = 'hidden';
    if (!el) {            // passo senza bersaglio: nuvoletta al centro
      hl.hidden = true; ui.wrap.classList.add('dim');
      tip.style.left = Math.max(12, (innerWidth - tip.offsetWidth) / 2) + 'px';
      tip.style.top = Math.max(12, (innerHeight - tip.offsetHeight) / 2) + 'px';
      tip.className = 'tour-tip';
      tip.style.visibility = ''; return;
    }
    ui.wrap.classList.remove('dim'); hl.hidden = false;
    const r = el.getBoundingClientRect(), pad = 6;
    const hr = { x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad), w: Math.min(innerWidth - 8, r.width + pad * 2), h: Math.min(innerHeight - 8, r.height + pad * 2) };
    Object.assign(hl.style, { left: hr.x + 'px', top: hr.y + 'px', width: hr.w + 'px', height: hr.h + 'px' });
    const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
    const room = { right: innerWidth - (hr.x + hr.w), left: hr.x, bottom: innerHeight - (hr.y + hr.h), top: hr.y };
    let sd = side || 'bottom';
    const fits = (k) => (k === 'right' || k === 'left' ? room[k] >= tw + gap : room[k] >= th + gap);
    if (!fits(sd)) sd = ['bottom', 'top', 'right', 'left'].find(fits) || 'inside';
    let x, y;
    if (sd === 'right') { x = hr.x + hr.w + gap; y = hr.y; }
    else if (sd === 'left') { x = hr.x - tw - gap; y = hr.y; }
    else if (sd === 'bottom') { x = hr.x; y = hr.y + hr.h + gap; }
    else if (sd === 'top') { x = hr.x; y = hr.y - th - gap; }
    else { x = hr.x + 16; y = hr.y + 16; }   // bersaglio enorme: la nuvoletta sta dentro
    x = Math.min(Math.max(12, x), innerWidth - tw - 12);
    y = Math.min(Math.max(12, y), innerHeight - th - 12);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.className = 'tour-tip ' + sd;
    tip.style.visibility = '';
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  }
  // durante il giro la pagina non scorre: né con la rotella, né col tocco, né con la tastiera
  const stopScroll = (e) => { if (active) e.preventDefault(); };
  const SCROLL_KEYS = [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'];
  function onKeyLock(e) { if (active && SCROLL_KEYS.includes(e.key) && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) e.preventDefault(); }
  function lock(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('wheel', stopScroll, { passive: false, capture: true });
    document[f]('touchmove', stopScroll, { passive: false, capture: true });
    document[f]('keydown', onKeyLock, true);
  }
  function onResize() { if (active) go(i); }
  function start() {
    if (active) return;
    if (typeof S === 'undefined' || !S.accountId) return;
    active = true; build(); lock(true);
    document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);
    go(0);
  }
  function stop() {
    active = false; lock(false);
    document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize);
    if (ui) ui.wrap.remove(); ui = null;
    try { localStorage.setItem(KEY, '1'); } catch { /* senza memoria si rivede ogni volta, pazienza */ }
    if (typeof goPage === 'function' && S.page !== 'dashboard') goPage('dashboard');
  }

  // il pulsante "? Tutorial" sta nel menu a sinistra: lo aggiungo ogni volta che il menu viene ridisegnato
  function addButton() {
    const sp = $('.side .spacer');
    if (sp && !$('.side [data-tour]')) {
      const b = mk('button', 'nav'); b.dataset.tour = '1'; b.type = 'button'; b.textContent = '? Tutorial';
      b.onclick = () => start();
      sp.after(b);
    }
  }
  const origShell = renderShell;
  renderShell = function () { origShell.apply(this, arguments); addButton(); };
  addButton();
  window.addEventListener('load', () => {
    let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch { /* ok */ }
    if (seen) return;
    let tries = 0;
    const t = setInterval(() => {      // parte da solo la prima volta, quando il programma è pronto
      if (typeof S !== 'undefined' && S.accountId && $('#accBtn')) { clearInterval(t); setTimeout(start, 600); }
      else if (++tries > 40) clearInterval(t);
    }, 250);
  });
  window.startTour = start;
})();
