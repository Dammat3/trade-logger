// Notizie economiche: calendario pubblico (Forex Factory, tramite Fair Economy), settimana corrente e prossima.
const NEWS_FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
];
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

// feed -> eventi normalizzati (uno per riga del database)
function parseNewsFeed(json) {
  if (!Array.isArray(json)) throw new Error('Formato del feed non riconosciuto');
  const out = new Map();
  for (const it of json) {
    if (!it || typeof it !== 'object') continue;
    const t = new Date(it.date || it.dateRaw || it.timestamp);
    const title = str(it.title || it.event);
    if (isNaN(t) || !title) continue;
    const currency = str(it.country || it.currency).toUpperCase().slice(0, 4);
    const raw = str(it.impact);
    const impact = /^high/i.test(raw) ? 'High' : /^med/i.test(raw) ? 'Medium' : /^hol/i.test(raw) ? 'Holiday' : 'Low';
    const iso = t.toISOString();
    const key = `${iso}|${currency}|${title}`.slice(0, 200);
    const ev = { event_key: key, event_time: iso, currency, title: title.slice(0, 160), impact, forecast: str(it.forecast).slice(0, 40), previous: str(it.previous).slice(0, 40), actual: str(it.actual).slice(0, 40) };
    const old = out.get(key);
    if (!old || ev.forecast || ev.previous || ev.actual) out.set(key, ev);   // se è doppio tengo la riga più completa
  }
  return [...out.values()];
}
module.exports = { NEWS_FEEDS, parseNewsFeed };
