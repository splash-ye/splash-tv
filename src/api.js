// Data layer shared by the local server (src/server.js) and the static build (src/build.js).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTeamSchedule, getScoreboardDays, getNews, getBoxscore, getSoccerGoals, getStandings } from './espn.js';
import { getZhibo8News } from './zhibo8.js';
import { findHighlights, findRoundup, ROUNDUPS } from './youtube.js';
import { getQualifiers, getQualifiersAt } from './qualifiers.js';
import { mapLimit, etDateKey, etLongDate, addDays, dayRange, keyToDate, DAY_MS } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));

const SCHEDULE_DAYS = config.schedule?.daysAhead ?? 7;
const RESULTS_DAYS = config.results?.daysBack ?? 7;
const HIGHLIGHT_DAYS = config.highlights?.daysBack ?? 7;

const leagueTag = (lg) => ({ id: lg.id, name: lg.name });
const marqueeLeagues = () => config.leagues.filter((lg) => lg.marquee);
// A league entry may span several ESPN competitions (soccer: leagues + cups + UCL).
const competitionsOf = (lg) => lg.competitions ?? [{ league: lg.league, name: lg.name }];
const compTag = (lg, c) => (lg.competitions ? { id: lg.id, name: c.name, comp: c.league } : leagueTag(lg));

// Merge game items from several sources (followed teams, marquee) into one list.
// item: { lg, event, focusId?, ranks?, tag? }  →  event + { league, focusIds, tags, ranks }
function mergeEvents(items) {
  const byKey = new Map();
  for (const { lg, event, focusId, ranks, tag } of items) {
    const key = `${lg.id}:${event.id}`;
    const g = byKey.get(key) ?? { ...event, league: tag ?? leagueTag(lg), focusIds: [], tags: [], ranks: null };
    if (focusId && !g.focusIds.includes(focusId)) g.focusIds.push(focusId);
    if (focusId && !g.tags.includes('follow')) g.tags.push('follow');
    if (ranks) {
      g.ranks = ranks;
      if (!g.tags.includes('marquee')) g.tags.push('marquee');
    }
    byKey.set(key, g);
  }
  return [...byKey.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Schedules of every followed team across leagues. A failing team does not break the rest.
async function followedSchedules() {
  const jobs = config.leagues.flatMap((lg) => lg.teams.map((team) => ({ lg, team })));
  const results = await Promise.allSettled(jobs.map(({ lg, team }) => getTeamSchedule(lg.sport, lg.league, team)));
  const errors = [];
  const teams = [];
  results.forEach((r, i) => {
    const { lg, team } = jobs[i];
    if (r.status === 'fulfilled') teams.push({ lg, ...r.value });
    else errors.push(`${lg.name} ${team}: ${r.reason.message}`);
  });
  return { teams, errors };
}

// Marquee games on the given ET days; `qualifiersFor(lg, game)` decides which snapshot applies.
async function marqueeGames(keys, qualifiersFor, errors) {
  const lists = await Promise.all(
    marqueeLeagues().flatMap((lg) =>
      competitionsOf(lg).map(async (c) => {
        try {
          const games = await getScoreboardDays(lg.sport, c.league, keys, c.scoreboardParams ?? lg.scoreboardParams ?? '');
          const out = [];
          for (const g of games) {
            const q = await qualifiersFor(lg, g);
            const label = new Map(q.teams.map((t) => [t.id, t.label]));
            if (label.has(g.home.id) && label.has(g.away.id)) {
              out.push({ lg, tag: compTag(lg, c), event: g, ranks: { home: label.get(g.home.id), away: label.get(g.away.id) } });
            }
          }
          return out;
        } catch (err) {
          errors.push(`${c.name ?? lg.name} 强强对话: ${err.message}`);
          return [];
        }
      }),
    ),
  );
  return lists.flat();
}

// ---------- daily snapshots (rebuilt once per ET day) ----------
// Persisted to data/<name>.json. Rebuilt when the ET day, the version or the config changes,
// or when the last build was partial (some source failed). build(day) → { partial, ...data }.
function dailySnapshot(name, version, cfgKeyOf, build) {
  const file = path.join(DATA_DIR, `${name}.json`);
  let snap = null;
  let inflight = null;
  return async () => {
    const day = etDateKey(new Date());
    const cfgKey = cfgKeyOf();
    if (!snap) snap = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
    if (snap && snap.version === version && snap.day === day && !snap.partial && snap.cfgKey === cfgKey) return snap;
    inflight ??= (async () => {
      const built = { version, day, generatedAt: new Date().toISOString(), cfgKey, ...(await build(day)) };
      snap = built;
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(built, null, 2));
      console.log(`[${name}] built for ${day}${built.partial ? ' (partial)' : ''}`);
      return built;
    })().finally(() => (inflight = null));
    return inflight;
  };
}

// Bump when a snapshot's shape or window changes so a same-day snapshot gets rebuilt.
const SCHEDULE_VERSION = 2;
const NEWS_VERSION = 2;

// Starts at yesterday (ET) so a game still in progress after midnight stays in the snapshot.
async function buildDailySchedule(day) {
  const keys = dayRange(addDays(day, -1), SCHEDULE_DAYS + 1);
  const inWindow = (e) => keys.includes(etDateKey(new Date(e.date)));
  const { teams, errors } = await followedSchedules();
  const followItems = teams.flatMap(({ lg, team, events }) =>
    events.filter(inWindow).map((event) => ({ lg, event, focusId: team.id })),
  );
  const marqueeItems = await marqueeGames(keys, (lg) => getQualifiers(lg), errors);
  const qualifiers = [];
  for (const lg of marqueeLeagues()) {
    const q = await getQualifiers(lg).catch(() => null);
    if (q) qualifiers.push({ league: leagueTag(lg), criteria: q.criteria, weekOf: q.weekOf, fixed: !!q.fixed, teams: q.teams });
  }
  return {
    partial: errors.length > 0,
    daysAhead: SCHEDULE_DAYS,
    teams: teams.map(({ lg, team }) => ({ ...team, league: leagueTag(lg) })),
    qualifiers,
    games: mergeEvents([...followItems, ...marqueeItems]),
    errors,
  };
}

const getDailySchedule = dailySnapshot('schedule', SCHEDULE_VERSION, () => JSON.stringify(config.leagues), buildDailySchedule);

// ---------- handlers ----------
// The snapshot is built once a day. A game stays listed after kickoff until its result shows up
// (in the results feed, or already final in the snapshot). If the result never comes (feed error,
// postponement), a timed game drops off LINGER_MS after kickoff; a TBD kickoff after its ET day.
const LINGER_MS = 12 * 60 * 60 * 1000;
const gameKey = (g) => `${g.league.id}:${g.id}`;
const pending = (g, finished, now = Date.now()) =>
  !finished.has(gameKey(g)) &&
  !g.status.completed &&
  (g.timeValid ? new Date(g.date).getTime() > now - LINGER_MS : etDateKey(new Date(g.date)) >= etDateKey(new Date(now)));

// `res` is a results() response; pass it in when you already have one to avoid refetching.
export async function schedule(res) {
  const [snap, r] = await Promise.all([getDailySchedule(), res ?? results().catch(() => ({ games: [] }))]);
  const finished = new Set(r.games.map(gameKey));
  return { ...snap, games: snap.games.filter((g) => pending(g, finished)) };
}

export async function results() {
  const now = Date.now();
  const since = now - RESULTS_DAYS * DAY_MS;
  const today = etDateKey(new Date());
  const keys = dayRange(addDays(today, -RESULTS_DAYS), RESULTS_DAYS + 1);
  const recent = (e) => e.status.completed && new Date(e.date).getTime() >= since;

  const { teams, errors } = await followedSchedules();
  const followItems = teams.flatMap(({ lg, team, events }) => events.filter(recent).map((event) => ({ lg, event, focusId: team.id })));
  const marqueeItems = (await marqueeGames(keys, (lg, g) => getQualifiersAt(lg, g.date), errors)).filter((x) => recent(x.event));
  return {
    daysBack: RESULTS_DAYS,
    teams: teams.map(({ lg, team }) => ({ ...team, league: leagueTag(lg) })),
    games: mergeEvents([...followItems, ...marqueeItems]).reverse(),
    errors,
  };
}

// comp is the ESPN competition code for multi-competition leagues (soccer), otherwise ignored.
export async function boxscore(leagueId, compCode, event) {
  const lg = config.leagues.find((l) => l.id === leagueId);
  if (!lg || !/^\d+$/.test(event ?? '')) throw Object.assign(new Error('bad league or event'), { status: 400 });
  if (lg.sport === 'soccer') {
    const comp = competitionsOf(lg).find((c) => c.league === compCode);
    if (!comp) throw Object.assign(new Error('bad competition'), { status: 400 });
    return getSoccerGoals(comp.league, event);
  }
  return getBoxscore(lg.sport, lg.league, event);
}

// ESPN English news for each followed team of a league: the latest `limit` stories of the past
// week that are really about the team. League-wide pieces (betting lines, draft order, power
// rankings) are tagged with most of the league, so stories tagged with more than 3 teams are skipped.
const NEWS_MAX_TEAMS = 3;
const NEWS_DAYS = 7;
async function espnNews(lg, errors) {
  const since = Date.now() - NEWS_DAYS * DAY_MS;
  const lists = await Promise.all(
    lg.teams.map((team) =>
      getNews(lg.sport, lg.league, team, 50)
        .then((articles) =>
          articles
            .filter((a) => a.type !== 'Eticket') // sponsored widget
            .filter((a) => a.teams.length <= NEWS_MAX_TEAMS && a.teams.some((t) => t?.toLowerCase() === team.toLowerCase()))
            .filter((a) => new Date(a.published).getTime() >= since)
            .slice(0, lg.news.limit ?? 5)
            .map(({ teams, ...a }) => ({ ...a, team })),
        )
        .catch((err) => (errors.push(`${lg.name} ${team} 新闻: ${err.message}`), [])),
    ),
  );
  return lists.flat();
}

// news.zhibo8 → Chinese stories from 直播吧 (falls back to ESPN if the feed is unreachable);
// otherwise ESPN English news for the followed teams.
async function leagueNews(lg, errors) {
  const z = lg.news.zhibo8;
  if (!z) return espnNews(lg, errors);
  try {
    return await getZhibo8News(z.type, z.tags, z.perTag ?? 3);
  } catch (err) {
    errors.push(`直播吧 ${lg.name}: ${err.message}`);
    return lg.teams.length ? espnNews(lg, errors) : [];
  }
}

const newsLeagues = () => config.leagues.filter((lg) => lg.news);

// Taken once a day (first build after midnight ET), so 直播吧's ranking covers a full 24 hours.
async function buildDailyNews() {
  const errors = [];
  const lists = await Promise.all(
    newsLeagues().map((lg) => leagueNews(lg, errors).then((articles) => articles.map((a) => ({ ...a, league: leagueTag(lg) })))),
  );
  const seen = new Set();
  const articles = lists
    .flat()
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => new Date(b.published) - new Date(a.published));
  return { partial: errors.length > 0, articles, errors };
}

const getDailyNews = dailySnapshot(
  'news',
  NEWS_VERSION,
  () => JSON.stringify(newsLeagues().map((lg) => [lg.id, lg.teams, lg.news])),
  buildDailyNews,
);

export async function news() {
  const snap = await getDailyNews();
  return { enabled: newsLeagues().length > 0, generatedAt: snap.generatedAt, articles: snap.articles };
}

// Highlight config for one game: soccer competitions carry their own broadcaster channels.
function highlightCfg(lg, game) {
  const comp = competitionsOf(lg).find((c) => c.league === game.league.comp);
  return comp?.channels ? { ...lg.highlights, channels: comp.channels } : lg.highlights;
}

export async function highlights() {
  const { teams } = await followedSchedules();
  const since = Date.now() - HIGHLIGHT_DAYS * DAY_MS;
  const recent = (e) => e.status.completed && new Date(e.date).getTime() >= since;
  const followItems = teams
    .filter(({ lg }) => lg.highlights)
    .flatMap(({ lg, team, events }) => events.filter(recent).map((event) => ({ lg, event, focusId: team.id })));
  // Leagues without followed teams (soccer) can opt in to highlights for their marquee games.
  const keys = dayRange(addDays(etDateKey(new Date()), -HIGHLIGHT_DAYS), HIGHLIGHT_DAYS + 1);
  const marqueeItems = (await marqueeGames(keys, (lg, g) => getQualifiersAt(lg, g.date), []))
    .filter((x) => x.lg.highlights?.marquee && recent(x.event));
  const games = mergeEvents([...followItems, ...marqueeItems]).reverse();
  const out = await mapLimit(games, 3, async (game) => {
    const lg = config.leagues.find((l) => l.id === game.league.id);
    const cfg = highlightCfg(lg, game);
    const h = await findHighlights(game, lg.id, cfg).catch(() => ({ videos: [] }));
    return { game, videos: h.videos };
  });
  return { daysBack: HIGHLIGHT_DAYS, games: out, roundups: await roundups() };
}

// League-wide compilations (NBA nightly recap / top plays, NFL top 15 of the week) for every
// day or week in the window that had completed games.
async function roundups() {
  const since = Date.now() - HIGHLIGHT_DAYS * DAY_MS;
  const today = etDateKey(new Date());
  const keys = dayRange(addDays(today, -HIGHLIGHT_DAYS), HIGHLIGHT_DAYS + 1);
  const jobs = [];
  for (const lg of config.leagues.filter((l) => l.highlights?.roundups?.length)) {
    const done = (await getScoreboardDays(lg.sport, lg.league, keys).catch(() => [])).filter(
      (g) => g.status.completed && new Date(g.date).getTime() >= since,
    );
    for (const type of lg.highlights.roundups) {
      const def = ROUNDUPS[type];
      if (!def) continue;
      const periods = new Map();
      for (const g of done) {
        if (def.per === 'day') {
          const k = etDateKey(new Date(g.date));
          const prev = periods.get(k);
          if (!prev || g.date > prev.sortDate) periods.set(k, { key: k, dateLong: etLongDate(keyToDate(k)), sortDate: g.date });
        } else if (g.week && g.seasonTypeId === 2) {
          const k = `${g.seasonYear}-w${g.week}`;
          const prev = periods.get(k);
          if (!prev || g.date > prev.sortDate) periods.set(k, { key: k, week: g.week, year: g.seasonYear, sortDate: g.date });
        }
      }
      for (const p of periods.values()) jobs.push({ lg, type, p });
    }
  }
  const found = await mapLimit(jobs, 3, async ({ lg, type, p }) => {
    const r = await findRoundup(type, p, lg.id, lg.highlights).catch(() => null);
    return r && { league: leagueTag(lg), type, label: r.label, period: p, video: r.video };
  });
  return found.filter(Boolean).sort((a, b) => (b.period.sortDate > a.period.sortDate ? 1 : -1));
}

// League standings for leagues with `standings` in config (NBA by conference, NFL by division).
export async function standings() {
  const leagues = [];
  for (const lg of config.leagues.filter((l) => l.standings)) {
    const level = lg.standings.level ?? null;
    try {
      const rows = await getStandings(lg.sport, lg.league, level);
      const followed = new Set(lg.teams.map((t) => t.toLowerCase()));
      const groups = new Map();
      for (const r of rows) {
        if (!groups.has(r.group)) groups.set(r.group, { name: r.group, parent: r.parent, teams: [] });
        groups.get(r.group).teams.push({ ...r, followed: followed.has(r.abbr.toLowerCase()) });
      }
      for (const g of groups.values()) {
        // Conferences are ordered by playoff seed; divisions by win% (seed breaks ties).
        g.teams.sort((a, b) => (level === 3 ? b.winPercent - a.winPercent || a.seed - b.seed : a.seed - b.seed));
      }
      // Divisions in the usual order: AFC East/North/South/West, then NFC.
      const DIR = { East: 0, North: 1, South: 2, West: 3 };
      const order = (n) => (n.startsWith('NFC') ? 10 : 0) + (DIR[n.split(' ').pop()] ?? 5);
      const list = [...groups.values()];
      if (level === 3) list.sort((a, b) => order(a.name) - order(b.name));
      // Optional explicit order from config, e.g. NBA West before East.
      const pref = lg.standings.groupOrder ?? [];
      const rank = (n) => (pref.includes(n) ? pref.indexOf(n) : pref.length);
      if (pref.length) list.sort((a, b) => rank(a.name) - rank(b.name));
      leagues.push({ id: lg.id, name: lg.name, kind: level === 3 ? 'division' : 'conference', groups: list });
    } catch (err) {
      console.warn(`[standings] ${lg.id}: ${err.message}`);
    }
  }
  return { leagues };
}

// Weekly marquee snapshot (Mondays) and daily schedule + news snapshots.
export async function refreshSnapshots() {
  for (const lg of marqueeLeagues()) {
    await getQualifiers(lg).catch((err) => console.warn(`[marquee] ${lg.id} snapshot failed: ${err.message}`));
  }
  await getDailySchedule().catch((err) => console.warn(`[schedule] build failed: ${err.message}`));
  await getDailyNews().catch((err) => console.warn(`[news] build failed: ${err.message}`));
}

export { config, ROOT };
