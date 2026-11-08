const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function request(url, headers = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

export const fetchJson = async (url, headers) => (await request(url, headers)).json();
export const fetchText = async (url, headers) => (await request(url, headers)).text();

// In-memory TTL cache that de-duplicates concurrent requests for the same key.
const store = new Map();
export function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.promise;
  const promise = Promise.resolve().then(fn);
  store.set(key, { promise, expires: now + ttlMs });
  promise.catch(() => store.delete(key));
  return promise;
}

// Run async fn over items with limited concurrency, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// YYYYMMDD in US Eastern time (ESPN and NBA both key game days by ET).
export function etDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

// "November 7, 2026" in US Eastern time — the format NBA uses in YouTube titles.
export function etLongDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar helpers on ET day keys (YYYYMMDD). Noon-ish UTC anchors avoid DST edge cases.
export function keyToDate(key) {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)), 17));
}
export function addDays(key, n) {
  return etDateKey(new Date(keyToDate(key).getTime() + n * DAY_MS));
}
export function dayRange(fromKey, n) {
  return Array.from({ length: n }, (_, i) => addDays(fromKey, i));
}
