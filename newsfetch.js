'use strict';
// Scarica il calendario delle notizie economiche (usato da Trade Logger e dal Journal, che sono indipendenti).
const { NEWS_FEEDS, parseNewsFeed } = require('./news');
async function fetchEvents(fetchFn) {
  const events = []; let ok = 0, lastErr = '';
  for (const url of NEWS_FEEDS) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Trade Logger)', Accept: 'application/json' } });
      if (!res.ok) { lastErr = `risposta ${res.status}`; continue; }
      events.push(...parseNewsFeed(await res.json())); ok++;
    } catch (e) { lastErr = String((e && e.message) || e); }
  }
  return { events, ok, lastErr };
}
module.exports = { fetchEvents };
