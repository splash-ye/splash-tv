// Data layer shared by the local server (src/server.js) and the static build (src/build.js).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTeamSchedule, getScoreboardDays, getNews, getBoxscore, getSoccerGoals } from './espn.js';
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

// ---------- daily schedule snapshot (rebuilt once per ET day) ----------
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
let daily = null;
let dailyInflight = null;

async function buildDailySchedule(day) {
  const keys = dayRange(day, SCHEDULE_DAYS);
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
    day,
    generatedAt: new Date().toISOString(),
    cfgKey: JSON.stringify(config.leagues),
    partial: errors.length > 0,
    daysAhead: SCHEDULE_DAYS,
    teams: teams.map(({ lg, team }) => ({ ...team, league: leagueTag(lg) })),
    qualifiers,
    games: mergeEvents([...followItems, ...marqueeItems]),
    errors,
  };
}

async function getDailySchedule() {
  const day = etDateKey(new Date());
  if (!daily) daily = await readFile(SCHEDULE_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (daily && daily.day === day && !daily.partial && daily.cfgKey === JSON.stringify(config.leagues)) return daily;
  dailyInflight ??= (async () => {
    const built = await buildDailySchedule(day);
    daily = built;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SCHEDULE_FILE, JSON.stringify(built, null, 2));
    console.log(`[schedule] built for ${day}: ${built.games.length} games${built.partial ? ' (partial)' : ''}`);
    return built;
  })().finally(() => (dailyInflight = null));
  return dailyInflight;
}

// ---------- handlers ----------
// The snapshot is built once a day; games that have already started are hidden at read time.
// TBD kickoffs only have a placeholder time, so those stay until their (ET) day is over.
const notStarted = (g, now = Date.now()) =>
  g.timeValid ? new Date(g.date).getTime() > now : etDateKey(new Date(g.date)) >= etDateKey(new Date(now));

export async function schedule() {
  const snap = await getDailySchedule();
  return { ...snap, games: snap.games.filter((g) => notStarted(g)) };
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

export async function news() {
  const jobs = config.leagues.filter((lg) => lg.news).flatMap((lg) => lg.teams.map((team) => ({ lg, team })));
  const lists = await Promise.all(
    jobs.map(({ lg, team }) =>
      getNews(lg.sport, lg.league, team, lg.news.limit ?? 25)
        .then((articles) => articles.map((a) => ({ ...a, league: leagueTag(lg), team })))
        .catch(() => []),
    ),
  );
  const seen = new Set();
  const articles = lists
    .flat()
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => new Date(b.published) - new Date(a.published));
  return { enabled: jobs.length > 0, articles };
}

export async function highlights() {
  const { teams } = await followedSchedules();
  const since = Date.now() - HIGHLIGHT_DAYS * DAY_MS;
  const items = teams
    .filter(({ lg }) => lg.highlights)
    .flatMap(({ lg, team, events }) =>
      events.filter((e) => e.status.completed && new Date(e.date).getTime() >= since).map((event) => ({ lg, event, focusId: team.id })),
    );
  const games = mergeEvents(items).reverse();
  const out = await mapLimit(games, 3, async (game) => {
    const lg = config.leagues.find((l) => l.id === game.league.id);
    const h = await findHighlights(game, lg.id, lg.highlights).catch(() => ({ videos: [] }));
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
          periods.set(k, { key: k, dateLong: etLongDate(keyToDate(k)), sortDate: keyToDate(k).toISOString() });
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

// Weekly marquee snapshot (Mondays) and daily schedule snapshot.
export async function refreshSnapshots() {
  for (const lg of marqueeLeagues()) {
    await getQualifiers(lg).catch((err) => console.warn(`[marquee] ${lg.id} snapshot failed: ${err.message}`));
  }
  await getDailySchedule().catch((err) => console.warn(`[schedule] build failed: ${err.message}`));
}

export { config, ROOT };
