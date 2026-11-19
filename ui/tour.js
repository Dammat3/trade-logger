'use strict';
const $ = (id) => document.getElementById(id);
let i = 0, keys = {}, token = 0;
const nice = (k) => String(k || '—').replace('CommandOrControl', 'Ctrl').replace('Command', 'Cmd').replace('Control', 'Ctrl');
const K = (n) => `<kbd>${nice(keys[n])}</kbd>`;

const STEPS = () => [
  { title: 'Benvenuto in Trade Logger', text: 'È la barra che sta sopra la tua piattaforma di trading e registra i trade al posto tuo. Funziona con FX Replay e TradeSea, le piattaforme principali, ma anche con qualsiasi altra piattaforma di trading: basta calibrarla una volta. Al primo avvio una configurazione guidata ti accompagna passo per passo.<br><br>Per questo giro la barra è mostrata nella versione estesa: alla fine torna com\'era.' },
  { ids: ['grip'], title: 'La maniglia', text: 'Tieni premuta questa maniglia e trascina per spostare la barra dove non ti dà fastidio. Si ricorda l\'ultima posizione.' },
  { ids: ['dot'], title: 'Il pallino di stato', text: 'Cambia colore per dirti se sta lavorando, se la copia online è attiva e se ci sono trade ancora da inviare. Passandoci sopra col mouse leggi i dettagli.' },
  { ids: ['trade'], title: 'Il trade aperto', text: 'Quando c\'è un trade aperto qui compaiono il simbolo e la direzione (▲ long, ▼ short). Cliccandoci vedi, chiudi o elimini i trade aperti.' },
  { ids: ['new'], title: 'Nuovo trade', text: `Fotografa lo schermo, legge il trade (simbolo, direzione, prezzi, data) e lo registra. Sulla piattaforma il trade deve essere visibile con le linee di TP e SL. Scorciatoia da tastiera: ${K('new')}.<br><br>Se il programma ha letto tutto bene e hai attivato il <b>salvataggio rapido</b>, il trade si salva subito senza aprire nessuna finestra (vedi il passo sul salvataggio rapido).` },
  { ids: ['tp', 'sl', 'man'], title: 'Chiudere il trade', text: `<b>TP</b> take profit, <b>SL</b> stop loss, <b>Man</b> chiuso a mano o in pareggio. Si apre una finestra dove controlli i dati e puoi correggere data, setup, tag e note prima di salvare. Scorciatoie: ${K('tp')}, ${K('sl')}, ${K('man')}.` },
  { title: 'Salvataggio rapido', text: 'In <b>Impostazioni</b>, sezione <b>Conferma dei trade</b>, puoi attivare <b>Salva subito se è tutto a posto</b>. Se tutti i valori sono stati letti e tornano tra loro, il trade si salva da solo; se qualcosa non torna (o il programma ha dovuto correggere una cifra), la finestra di controllo si apre come sempre. Un trade salvato per errore lo correggi o lo elimini cliccando sul simbolo nella barra.' },
  { ids: ['setup'], title: 'Setup', text: 'Scegli il setup del prossimo trade, o del trade aperto se ce n\'è uno. Dal menu puoi anche crearne di nuovi.' },
  { ids: ['tags'], title: 'Tag', text: 'Stessa cosa per i tag: puoi sceglierne più di uno, e li ritrovi anche nella finestra di chiusura per cambiarli.' },
  { ids: ['noteIn'], title: 'Note', text: 'Scrivi una nota veloce sul trade. Si salva da sola. Nella barra minimal al suo posto c\'è l\'icona della matita.' },
  { ids: ['more'], title: 'Il menu dei tre puntini', text: 'Qui trovi: il <b>conto</b> su cui salvare, la <b>piattaforma</b> (con la calibrazione e il layout), le <b>Impostazioni</b>, l\'apertura del <b>Journal</b>, il tipo di barra, la copia online, l\'aggiornamento delle notizie economiche, <b>Novità di questa versione…</b> e la chiusura del programma.' },
  { title: 'Tre tipi di barra', text: '<b>Minimal</b>: la più compatta. <b>Estesa</b>: quella che vedi ora, con note e pulsanti di chiusura. <b>Tasti rapidi</b>: solo Setup e Tag, per chi usa le scorciatoie da tastiera. Cambi dal menu dei tre puntini oppure da Impostazioni.' },
  { title: 'Calibrare una piattaforma', text: 'La prima volta su una piattaforma apri il suo grafico con un trade aperto (TP e SL visibili) e, dal menu dei tre puntini o da Impostazioni, scegli <b>Calibra</b>. Parte un conto alla rovescia: metti il mouse sul grafico, così sotto compare la data. Il programma trova da solo i numeri sullo schermo; tu controlli i rettangoli e, se serve, li correggi a mano. Se a volte usi la piattaforma a schermo intero, usa anche <b>Calibra a schermo intero</b>. Con <b>Prova la lettura</b> controlli cosa legge, senza salvare niente.' },
  { title: 'Finestre affiancate', text: 'Se tieni due grafici affiancati e sposti il divisore, la barra ritrova da sola la colonna dei prezzi. Quando succede, nella finestra di controllo trovi la scritta «Finestra spostata…». Se una lettura non ti convince, controlla sempre i valori prima di salvare.' },
  { title: 'Impostazioni', text: 'In alto trovi l\'essenziale: <b>Conto</b>, <b>Piattaforma e calibrazione</b>, <b>Barra</b> e <b>Conferma dei trade</b>. Le cose che si toccano di rado (layout, scorciatoie, cartella degli screenshot, aggiornamenti, condivisione locale) sono nella sezione <b>Avanzate</b>, che si ricorda se l\'hai lasciata aperta.' },
  { title: 'Aggiornamenti e novità', text: 'Con l\'installer unico gli aggiornamenti sono già configurati: la barra e il Journal controllano da soli all\'avvio e ti chiedono se aggiornare. Dopo ogni aggiornamento compare la finestra <b>Novità</b> con cosa è cambiato; la riapri dal menu dei tre puntini.' },
  { title: 'Fatto!', text: 'Quando vuoi rifare il giro: menu dei tre puntini, <b>Tutorial…</b>. Il Journal ha il suo tutorial, nel pulsante <b>? Tutorial</b> in basso a sinistra.' },
];

async function rectOf(ids) {
  if (!ids) return null;
  return api.tourRect(ids);
}
async function show(n) {
  const my = ++token, steps = STEPS();
  if (n < 0) n = 0;
  if (n >= steps.length) { api.tourClose(); return; }
  i = n;
  const s = steps[i];
  let r = null;
  if (s.ids) {                                  // la barra può ancora ridimensionarsi: ritento finché trovo il pezzo
    for (let t = 0; t < 10 && !r; t++) { r = await rectOf(s.ids); if (!r) await new Promise((x) => setTimeout(x, 150)); if (my !== token) return; }
    if (!r) { show(i + 1); return; }            // quel pezzo non c'è in questa barra: lo salto
  }
  $('step').textContent = `Passo ${i + 1} di ${steps.length}`;
  $('title').textContent = s.title;
  $('text').innerHTML = s.text;
  $('back').hidden = i === 0;
  $('next').textContent = i === steps.length - 1 ? 'Fine' : (i === 0 ? 'Inizia' : 'Avanti');
  place(r);
  $('next').focus();
}
function place(r) {
  const tip = $('tip'), hl = $('hl');
  tip.style.visibility = 'hidden';
  const tw = tip.offsetWidth, th = tip.offsetHeight, W = innerWidth, H = innerHeight, gap = 16;
  if (!r) {
    hl.hidden = true; document.body.classList.add('dim');
    tip.style.left = Math.round((W - tw) / 2) + 'px'; tip.style.top = Math.round((H - th) / 2) + 'px';
  } else {
    document.body.classList.remove('dim'); hl.hidden = false;
    const pad = 5, x = r.x - pad, y = r.y - pad, w = r.w + pad * 2, h = r.h + pad * 2;
    Object.assign(hl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    let ty = y + h + gap;                        // sotto la barra; se non c'è spazio, sopra
    if (ty + th > H - 12) ty = y - th - gap;
    let tx = x + w / 2 - tw / 2;
    tx = Math.min(Math.max(12, tx), W - tw - 12); ty = Math.min(Math.max(12, ty), H - th - 12);
    tip.style.left = Math.round(tx) + 'px'; tip.style.top = Math.round(ty) + 'px';
  }
  tip.style.visibility = '';
}
$('next').onclick = () => show(i + 1);
$('back').onclick = () => show(i - 1);
$('skip').onclick = () => api.tourClose();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.tourClose(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); show(i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
});
addEventListener('resize', () => show(i));
(async () => { try { keys = (await api.tourGet()).keys || {}; } catch { /* senza scorciatoie il testo mostra "—" */ } setTimeout(() => show(0), 700); })();
