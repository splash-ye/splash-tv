// Weekly "marquee" qualifiers: which teams count as top teams for strong-vs-strong matchups.
// The list is computed once per week (first check on/after Monday 00:00 ET) and frozen
// in data/marquee.json. Past weeks are kept so last week's games are judged by last week's list.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStandings, getRankings, getTeams } from './espn.js';
import { etDateKey, DAY_MS } from './util.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'marquee.json');
const KEEP_WEEKS = 6;

const DIR_ZH = { East: '东区', West: '西区', North: '北区', South: '南区' };
const divisionZh = (name) => name.replace(/^(AFC|NFC)\s+(East|West|North|South)$/, (_, c, d) => `${c}${DIR_ZH[d]}`);

// Monday (ET) of the week containing `when`, as YYYYMMDD.
export function weekOf(when = Date.now()) {
  const t = new Date(when).getTime();
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(t);
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd];
  return etDateKey(new Date(t - back * DAY_MS));
}

const pick = (t, extra) => ({ id: t.id, abbr: t.abbr, name: t.name, short: t.short, logo: t.logo, record: t.record, ...extra });

const BUILDERS = {
  // Top N by league-wide win percentage (NBA).
  async leagueTop(lg, m) {
    const rows = await getStandings(lg.sport, lg.league);
    return {
      criteria: `联盟战绩前 ${m.topN}`,
      teams: rows.slice(0, m.topN).map((t) => pick(t, { label: `#${t.leagueRank}` })),
    };
  },
  // Top K of each division, optionally only teams with more wins than losses (NFL).
  async divisionTop(lg, m) {
    const rows = await getStandings(lg.sport, lg.league, 3);
    const byDiv = new Map();
    for (const r of rows) byDiv.set(r.group, [...(byDiv.get(r.group) ?? []), r]);
    const teams = [];
    for (const [div, list] of byDiv) {
      list.slice(0, m.perDivision).forEach((t, i) => {
        if (m.winningRecord && !(t.wins > t.losses)) return;
        teams.push(pick(t, { label: `${divisionZh(div)}第${i + 1}` }));
      });
    }
    return { criteria: `各分区前 ${m.perDivision}${m.winningRecord ? '且胜多负少' : ''}`, teams };
  },
  // A fixed list of clubs (soccer "big clubs"). Names/logos come from the domestic leagues.
  async fixedList(lg, m) {
    const want = new Set(m.clubs.map(String));
    const sources = [...(lg.competitions ?? [{ league: lg.league }]).map((c) => c.league), ...(m.lookupLeagues ?? [])];
    const lists = await Promise.all(sources.map((l) => getTeams(lg.sport, l).catch(() => [])));
    const byId = new Map(lists.flat().filter((t) => want.has(t.id)).map((t) => [t.id, t]));
    // Membership is by id; a club missing from the lookups still counts, just without a logo.
    return {
      criteria: m.criteria ?? '固定名单',
      fixed: true,
      teams: [...want].map((id) => pick(byId.get(id) ?? { id, abbr: '', name: id, short: id }, { label: '' })),
    };
  },
  // Top N of the first available poll (CFP, then AP) (college).
  async poll(lg, m) {
    const polls = await getRankings(lg.sport, lg.league);
    const wanted = m.polls ?? ['cfp', 'ap'];
    const poll =
      wanted.map((w) => polls.find((p) => p.type === w || (w === 'cfp' && /playoff/i.test(p.name)))).find(Boolean) ?? polls[0];
    if (!poll) return { criteria: `排名前 ${m.topN}`, teams: [] };
    return {
      criteria: `${poll.name} 前 ${m.topN}`,
      teams: poll.ranks.filter((r) => r.rank <= m.topN).map((t) => pick(t, { label: `#${t.rank}` })),
    };
  },
};

let store = null;
async function load() {
  if (store) return store;
  try {
    store = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    store = {};
  }
  // Migrate the old single-snapshot format.
  for (const [id, v] of Object.entries(store)) if (v?.weekOf) store[id] = { weeks: { [v.weekOf]: v } };
  return store;
}

const inflight = new Map();

// This week's qualifiers, building the snapshot if needed.
export async function getQualifiers(lg) {
  const m = lg.marquee;
  if (!m || !BUILDERS[m.type]) return null;
  const s = await load();
  const week = weekOf();
  const cfgKey = JSON.stringify(m);
  const hit = s[lg.id]?.weeks?.[week];
  if (hit && hit.cfgKey === cfgKey) return hit;

  if (!inflight.has(lg.id)) {
    inflight.set(
      lg.id,
      (async () => {
        const built = await BUILDERS[m.type](lg, m);
        const snap = { weekOf: week, takenAt: new Date().toISOString(), cfgKey, ...built };
        const weeks = { ...(s[lg.id]?.weeks ?? {}), [week]: snap };
        const keep = Object.keys(weeks).sort().slice(-KEEP_WEEKS);
        s[lg.id] = { weeks: Object.fromEntries(keep.map((k) => [k, weeks[k]])) };
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(FILE, JSON.stringify(s, null, 2));
        console.log(`[marquee] ${lg.id} snapshot for week of ${week}: ${built.teams.map((t) => t.abbr).join(', ')}`);
        return snap;
      })().finally(() => inflight.delete(lg.id)),
    );
  }
  return inflight.get(lg.id);
}

// Qualifiers that were in force when a game was played (falls back to this week's list
// for weeks before the service started keeping snapshots).
export async function getQualifiersAt(lg, when) {
  const current = await getQualifiers(lg);
  if (!current) return null;
  const snap = store[lg.id]?.weeks?.[weekOf(when)];
  return snap && snap.cfgKey === current.cfgKey ? snap : current;
}
