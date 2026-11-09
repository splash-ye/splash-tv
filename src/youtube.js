// Finds official game highlight videos on YouTube without an API key.
//  1. RSS feeds of the configured official channels (latest ~15 uploads each)
//  2. YouTube search results page, restricted to the same channels (backfill)
// Each league has a title matcher, because every channel names its videos differently.
// Matches are persisted to data/highlights.json so each game is only resolved once.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached, fetchText, etLongDate, DAY_MS } from './util.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'highlights.json');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---------- persistent store ----------
let store = null;
let saveTimer = null;

async function loadStore() {
  if (store) return store;
  try {
    store = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    store = {};
  }
  return store;
}

// Only games with found videos are persisted; "not found yet" retries stay in memory, so the
// file changes only when something new is found (keeps the CI data commits rare).
async function save() {
  clearTimeout(saveTimer);
  if (!store) return;
  const found = Object.fromEntries(Object.entries(store).filter(([, v]) => v.videos?.length));
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(found, null, 2));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

export const flushHighlights = save;

// ---------- helpers ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decodeXml = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Whole-word, case-insensitive name match. "WASHINGTON" must not match "WASHINGTON STATE".
// Uppercase + strip accents so "Atlético" matches "ATLETICO".
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

function hasName(T, name) {
  const N = name.toUpperCase();
  const notState = /\bSTATE$/.test(N) ? '' : '(?!\\s+(?:STATE|ST\\.))';
  return new RegExp(`(?<![A-Z0-9])${escapeRe(N)}(?![A-Z0-9])${notState}`).test(T);
}

function etParts(date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const get = (t) => Number(p.find((x) => x.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// "21h ago", "2 days ago", "Streamed 3 weeks ago" → approximate ISO timestamp
function parseRelative(text) {
  const m = text?.match(/(\d+)\s*(s|sec|second|m|min|minute|h|hour|d|day|w|week|mo|month|y|year)s?\b/i);
  if (!m) return null;
  const unit = { s: 1e3, sec: 1e3, second: 1e3, m: MIN, min: MIN, minute: MIN, h: HOUR, hour: HOUR, d: DAY_MS, day: DAY_MS, w: 7 * DAY_MS, week: 7 * DAY_MS, mo: 30 * DAY_MS, month: 30 * DAY_MS, y: 365 * DAY_MS, year: 365 * DAY_MS }[m[2].toLowerCase()];
  return new Date(Date.now() - Number(m[1]) * unit).toISOString();
}

// ---------- per-league matchers ----------
const MATCHERS = {
  // "MAGIC at WARRIORS | FULL GAME HIGHLIGHTS | November 7, 2026"
  // "#1 THUNDER at #8 GRIZZLIES | FULL GAME 1 HIGHLIGHTS | April 19, 2025"
  nba: {
    queries: (g) => [`${g.away.short} at ${g.home.short} full game highlights ${etLongDate(new Date(g.date))}`],
    match(T, g) {
      if (!T.includes('FULL GAME') || !T.includes(etLongDate(new Date(g.date)).toUpperCase())) return false;
      const team = (t) => `(?:#\\d+\\s+)?${escapeRe(t.short.toUpperCase())}`;
      const a = team(g.away), h = team(g.home);
      return new RegExp(`${a}\\s+AT\\s+${h}`).test(T) || new RegExp(`(${a}\\s+VS\\.?\\s+${h}|${h}\\s+VS\\.?\\s+${a})`).test(T);
    },
  },
  // "Kansas City Chiefs vs. New York Jets Game Highlights | 2026 NFL Season Week 9"
  nfl: {
    queries: (g) => {
      const when = `${g.seasonYear ?? ''} NFL Season${g.week && g.seasonTypeId === 2 ? ` Week ${g.week}` : ''}`;
      return [`${g.away.name} vs. ${g.home.name} Game Highlights ${when}`, `${g.away.short} ${g.home.short} Game Highlights ${when}`];
    },
    match(T, g) {
      if (!T.includes('GAME HIGHLIGHTS') || !hasName(T, g.away.name) || !hasName(T, g.home.name)) return false;
      if (g.seasonYear && !T.includes(String(g.seasonYear)) && !T.includes(String(g.seasonYear + 1))) return false;
      const wk = T.match(/WEEK\s+(\d+)/);
      return !(wk && g.week && g.seasonTypeId === 2 && Number(wk[1]) !== g.week);
    },
  },
  // Soccer (names vary by broadcaster, so each club can have aliases in config):
  //   "Crystal Palace v. Liverpool | PREMIER LEAGUE HIGHLIGHTS | 11/8/2026"      (NBC Sports)
  //   "Atlético Madrid vs. Barcelona | LALIGA Highlights | ESPN FC"              (ESPN FC)
  //   "Atlético Madrid vs. Bayern Munich: Extended Highlights | UCL ... "        (CBS Sports Golazo)
  //   "ATLÉTICO DE MADRID 1 - 2 FC BARCELONA | HIGHLIGHTS LALIGA EA SPORTS"     (LaLiga)
  soccer: {
    queries: (g) => [`${g.home.name} vs. ${g.away.name} highlights`, `${g.home.short} ${g.away.short} highlights`],
    match(T, g, cfg) {
      if (!T.includes('HIGHLIGHT')) return false;
      const names = (t) => [t.name, t.short, t.location, ...(cfg.aliases?.[t.id] ?? [])].filter(Boolean).map(norm);
      if (!names(g.home).some((n) => hasName(T, n)) || !names(g.away).some((n) => hasName(T, n))) return false;
      const d = T.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
      if (d) {
        const e = etParts(new Date(g.date));
        return Number(d[1]) === e.m && Number(d[2]) === e.d && Number(d[3]) === e.y;
      }
      return true;
    },
  },
  // "Penn State at Washington | Highlights | Big Ten Football | 11/07/2026"
  // "Penn State Nittany Lions vs Washington Huskies Highlights | FOX College Football"
  cfb: {
    queries: (g) => [`${g.away.location} at ${g.home.location} highlights`, `${g.away.location} vs ${g.home.location} highlights football`],
    match(T, g) {
      if (!T.includes('HIGHLIGHTS') || /BASKETBALL|VOLLEYBALL|SOCCER|HOCKEY|WRESTLING/.test(T)) return false;
      if (!hasName(T, g.away.location) || !hasName(T, g.home.location)) return false;
      const d = T.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
      if (d) {
        const e = etParts(new Date(g.date));
        return Number(d[1]) === e.m && Number(d[2]) === e.d && Number(d[3]) === e.y;
      }
      return true;
    },
  },
};

// Video must have been published between kickoff and a week after (when the date is known).
function publishedInWindow(v, g) {
  if (!v.published) return true;
  const t = new Date(v.published).getTime();
  const start = new Date(g.date).getTime();
  return t >= start - 6 * HOUR && t <= start + 8 * DAY_MS;
}

const toVideo = (id, title, channelId, published = null) => ({
  id,
  title,
  channelId,
  url: `https://www.youtube.com/watch?v=${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  extended: /EXTENDED/i.test(title),
  published,
});

// ---------- sources ----------
function getChannelFeed(channelId) {
  return cached(`yt-rss:${channelId}`, 10 * MIN, async () => {
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) =>
      toVideo(
        e.match(/<yt:videoId>([^<]+)/)?.[1],
        decodeXml(e.match(/<title>([^<]*)/)?.[1] ?? ''),
        channelId,
        e.match(/<published>([^<]+)/)?.[1] ?? null,
      ),
    );
  });
}

function collectVideoRenderers(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collectVideoRenderers(n, out);
    return out;
  }
  if (node.videoRenderer?.videoId) out.push(node.videoRenderer);
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectVideoRenderers(v, out);
  return out;
}

// Search one channel's uploads (much more precise), or all of YouTube when channelId is null.
async function searchYouTube(query, channelId = null) {
  const q = encodeURIComponent(query);
  const url = channelId
    ? `https://www.youtube.com/channel/${channelId}/search?query=${q}&hl=en&gl=US`
    : `https://www.youtube.com/results?search_query=${q}&hl=en&gl=US`;
  const html = await fetchText(url, { Cookie: 'CONSENT=YES+1' });
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return [];
  return collectVideoRenderers(JSON.parse(m[1]), []).map((r) => {
    const owner = r.ownerText?.runs?.[0] ?? r.longBylineText?.runs?.[0];
    return toVideo(
      r.videoId,
      r.title?.runs?.map((x) => x.text).join('') ?? '',
      owner?.navigationEndpoint?.browseEndpoint?.browseId ?? channelId,
      parseRelative(r.publishedTimeText?.simpleText),
    );
  });
}

// ---------- public ----------
function rank(videos, channels) {
  const seen = new Set();
  return videos
    .filter((v) => v.id && !seen.has(v.id) && seen.add(v.id))
    .sort((a, b) => channels.indexOf(a.channelId) - channels.indexOf(b.channelId) || Number(a.extended) - Number(b.extended));
}

// Returns { videos: [...] } for a completed game; empty if not found (yet).
export async function findHighlights(game, leagueId, cfg) {
  const matcher = MATCHERS[cfg.matcher];
  if (!matcher) return { videos: [] };
  const channels = cfg.channels ?? [];
  const key = `${leagueId}:${game.id}`;
  const s = await loadStore();
  const hit = s[key];
  // Done once a regular (non-extended) cut is known. If only an EXTENDED cut was found so far,
  // keep looking for the regular one (at most every 20 minutes).
  const hasRegular = (vs) => vs.some((v) => !v.extended);
  if (hit?.videos?.length && (hasRegular(hit.videos) || Date.now() < (hit.regularRetryAt ?? 0))) return hit;
  if (hit && !hit.videos?.length && Date.now() < hit.retryAt) return hit;

  const ok = (v) => channels.includes(v.channelId) && publishedInWindow(v, game) && matcher.match(norm(v.title), game, cfg);

  const feeds = await Promise.all(channels.map((c) => getChannelFeed(c).catch(() => [])));
  let videos = [...(hit?.videos ?? []), ...feeds.flat().filter(ok)];
  let source = hit?.source ?? (videos.length ? 'rss' : null);

  // Fallback: channel-scoped searches first, then a global search; stop once a regular cut is found.
  const attempts = [
    ...channels.flatMap((c) => matcher.queries(game).map((q) => [q, c])),
    [matcher.queries(game)[0], null],
  ];
  for (const [q, channelId] of attempts) {
    if (hasRegular(videos)) break;
    try {
      const found = (await searchYouTube(q, channelId)).filter(ok);
      if (found.length && !videos.length) source = channelId ? 'channel-search' : 'search';
      videos = [...videos, ...found];
    } catch (err) {
      console.warn(`[youtube] search failed for ${game.shortName} (${q}): ${err.message}`);
    }
  }

  const ageMs = Date.now() - new Date(game.date).getTime();
  const entry = videos.length
    ? {
        videos: rank(videos, channels),
        source,
        foundAt: hit?.foundAt ?? new Date().toISOString(),
        ...(hasRegular(videos) ? {} : { regularRetryAt: Date.now() + 20 * MIN }),
      }
    : { videos: [], retryAt: Date.now() + (ageMs < 36 * HOUR ? 20 * MIN : 6 * HOUR) };
  s[key] = entry;
  scheduleSave();
  return entry;
}

// ---------- roundups: league-wide compilation videos (not tied to one game) ----------
// period: { key, dateLong?, week?, year? }  (per-day types use the ET game date, per-week the NFL week)
export const ROUNDUPS = {
  // "NBA's Nightly Recap | November 5, 2026"
  nightly: {
    per: 'day',
    label: () => '每日回顾',
    match: (T, p) => T.includes('NIGHTLY RECAP') && T.includes(p.dateLong.toUpperCase()),
    queries: (p) => [`NBA's Nightly Recap ${p.dateLong}`],
  },
  // "NBA's Top 10 Plays of the Night | November 4, 2026" (light nights only get a Top 5)
  topPlays: {
    per: 'day',
    label: (title) => (/TOP 5 PLAYS/i.test(title) ? '五佳球' : '十佳球'),
    match: (T, p) => /TOP (5|10) PLAYS OF THE NIGHT/.test(T) && T.includes(p.dateLong.toUpperCase()),
    queries: (p) => [`NBA's Top 10 Plays of the Night ${p.dateLong}`, `NBA's Top 5 Plays of the Night ${p.dateLong}`],
  },
  // "Top 15 Plays of Week 8! | 2026 NFL Season"
  top15: {
    per: 'week',
    label: () => '一周 15 佳球',
    match: (T, p) => new RegExp(`TOP 15 PLAYS OF WEEK ${p.week}(?!\\d)`).test(T) && T.includes(String(p.year)),
    queries: (p) => [`Top 15 Plays of Week ${p.week} ${p.year} NFL Season`],
  },
};

// Returns { video, label } or null when not (yet) published.
export async function findRoundup(type, period, leagueId, cfg) {
  const def = ROUNDUPS[type];
  if (!def) return null;
  const channels = cfg.channels ?? [];
  const key = `roundup:${leagueId}:${type}:${period.key}`;
  const s = await loadStore();
  if (s[key]?.videos?.length) return { video: s[key].videos[0], label: def.label(s[key].videos[0].title) };
  if (s[key] && Date.now() < s[key].retryAt) return null;

  const ok = (v) => channels.includes(v.channelId) && def.match(v.title.toUpperCase(), period);
  const feeds = await Promise.all(channels.map((c) => getChannelFeed(c).catch(() => [])));
  let videos = feeds.flat().filter(ok);
  for (const q of def.queries(period)) {
    if (videos.length) break;
    for (const c of channels) {
      if (videos.length) break;
      try {
        videos = (await searchYouTube(q, c)).filter(ok);
      } catch (err) {
        console.warn(`[youtube] roundup search failed (${q}): ${err.message}`);
      }
    }
  }
  s[key] = videos.length
    ? { videos: [videos[0]], foundAt: new Date().toISOString() }
    : { videos: [], retryAt: Date.now() + 20 * MIN };
  scheduleSave();
  return videos.length ? { video: videos[0], label: def.label(videos[0].title) } : null;
}
