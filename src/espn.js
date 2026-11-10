// Client for ESPN's public (unofficial, keyless) site API.
// Works for any sport/league pair ESPN supports, e.g. basketball/nba, football/nfl, football/college-football.
import { cached, fetchJson, etDateKey, keyToDate, DAY_MS } from './util.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';
const COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports';
const MIN = 60 * 1000;

const scoreOf = (s) => (s == null ? null : typeof s === 'object' ? s.displayValue ?? String(s.value) : String(s));

function recordOf(c) {
  const list = c.records ?? c.record ?? [];
  const total = list.find((r) => r.type === 'total') ?? list[0];
  return total?.summary ?? total?.displayValue ?? null;
}

function logoOf(team) {
  if (team.logo) return team.logo;
  const logos = team.logos ?? [];
  return (logos.find((l) => l.rel?.includes('default')) ?? logos[0])?.href ?? null;
}

function normalizeCompetitor(c) {
  const t = c.team ?? {};
  const rank = c.curatedRank?.current;
  return {
    id: String(t.id),
    abbr: t.abbreviation,
    name: t.displayName,
    short: t.shortDisplayName ?? t.name,
    location: t.location ?? t.shortDisplayName,
    logo: logoOf(t),
    score: scoreOf(c.score),
    winner: c.winner ?? null,
    record: recordOf(c),
    rank: rank && rank < 99 ? rank : null, // college poll rank
  };
}

function broadcastsOf(comp) {
  const names = new Set();
  for (const b of comp.broadcasts ?? []) {
    if (b.media?.shortName) names.add(b.media.shortName);
    for (const n of b.names ?? []) names.add(n);
  }
  return [...names];
}

export function normalizeEvent(e) {
  const comp = e.competitions?.[0] ?? {};
  const competitors = (comp.competitors ?? []).map((c) => ({ side: c.homeAway, ...normalizeCompetitor(c) }));
  const status = comp.status?.type ?? e.status?.type ?? {};
  return {
    id: String(e.id),
    date: e.date,
    timeValid: e.timeValid !== false && comp.timeValid !== false,
    name: e.name,
    shortName: e.shortName,
    seasonYear: e.season?.year ?? null,
    seasonTypeId: Number(e.seasonType?.type ?? e.season?.type ?? 0) || null, // 1 pre, 2 regular, 3 post
    week: e.week?.number ?? null,
    note: comp.notes?.[0]?.headline ?? null,
    status: {
      state: status.state, // pre | in | post
      completed: !!status.completed,
      detail: status.shortDetail ?? status.detail ?? status.description,
    },
    home: competitors.find((c) => c.side === 'home') ?? competitors[0],
    away: competitors.find((c) => c.side === 'away') ?? competitors[1],
    venue: comp.venue?.fullName ?? null,
    broadcasts: broadcastsOf(comp),
    link: e.links?.find((l) => l.rel?.includes('desktop'))?.href ?? null,
  };
}

// Full season schedule for one team (regular season + postseason when available).
export function getTeamSchedule(sport, league, team) {
  return cached(`sched:${sport}/${league}/${team}`, 5 * MIN, async () => {
    const base = `${SITE}/${sport}/${league}/teams/${team}/schedule`;
    const [regular, post] = await Promise.all([
      fetchJson(base),
      fetchJson(`${base}?seasontype=3`).catch(() => ({ events: [] })),
    ]);
    const byId = new Map();
    for (const e of [...(regular.events ?? []), ...(post.events ?? [])]) byId.set(String(e.id), normalizeEvent(e));
    const events = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    const t = regular.team ?? {};
    // Use the same short name the game rows use (e.g. "Penn State", not "Nittany Lions").
    const asCompetitor = events.flatMap((e) => [e.home, e.away]).find((c) => c?.id === String(t.id));
    return {
      team: {
        id: String(t.id),
        abbr: t.abbreviation,
        name: t.displayName,
        short: asCompetitor?.short ?? t.shortDisplayName ?? t.name,
        logo: logoOf(t),
        record: t.recordSummary ?? null,
        standing: t.standingSummary ?? null,
      },
      events,
    };
  });
}

// Scoreboard for a single ET day (ESPN rejects date ranges at the moment).
export function getScoreboard(sport, league, date, params = '') {
  const key = etDateKey(date);
  const today = etDateKey(new Date());
  const ttl = key < today ? 6 * 60 * MIN : key === today ? 1 * MIN : 30 * MIN;
  return cached(`sb:${sport}/${league}/${key}?${params}`, ttl, async () => {
    const j = await fetchJson(`${SITE}/${sport}/${league}/scoreboard?dates=${key}${params ? `&${params}` : ''}`);
    return (j.events ?? []).map(normalizeEvent);
  });
}

// Scoreboards for a list of ET day keys, merged and sorted.
export async function getScoreboardDays(sport, league, keys, params = '') {
  const results = await Promise.all(keys.map((k) => getScoreboard(sport, league, keyToDate(k), params).catch(() => [])));
  const byId = new Map();
  for (const e of results.flat()) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Each entry is tagged with the name of the group that directly contains it
// (conference for NBA default, division for NFL with level=3) and its parent group.
function collectEntries(node, parent, out) {
  for (const e of node.standings?.entries ?? []) out.push({ e, group: node.name, parent });
  for (const child of node.children ?? []) collectEntries(child, node.name, out);
  return out;
}

// League standings, flattened and sorted by win percentage. level=3 → divisions (NFL).
export function getStandings(sport, league, level = null) {
  return cached(`standings:${sport}/${league}/${level}`, 10 * MIN, async () => {
    const j = await fetchJson(`${STANDINGS}/${sport}/${league}/standings${level ? `?level=${level}` : ''}`);
    const rows = collectEntries(j, null, []).map(({ e, group, parent }) => {
      const stat = (n) => e.stats?.find((s) => s.name === n || s.type === n);
      const num = (n) => Number(stat(n)?.value ?? 0);
      return {
        id: String(e.team.id),
        abbr: e.team.abbreviation,
        name: e.team.displayName,
        short: e.team.shortDisplayName,
        logo: logoOf(e.team),
        group,
        parent,
        wins: num('wins'),
        losses: num('losses'),
        ties: num('ties'),
        winPercent: num('winPercent'),
        seed: num('playoffSeed') || 99,
        record: stat('overall')?.displayValue ?? `${num('wins')}-${num('losses')}`,
        gamesBehind: stat('gamesBehind')?.displayValue ?? '-',
        streak: stat('streak')?.displayValue ?? '',
        last10: stat('Last Ten Games')?.displayValue ?? '',
        diff: stat('pointDifferential')?.displayValue ?? stat('differential')?.displayValue ?? '',
      };
    });
    rows.sort((a, b) => b.winPercent - a.winPercent || a.seed - b.seed || b.wins - a.wins);
    rows.forEach((r, i) => (r.leagueRank = i + 1));
    return rows;
  });
}

// College polls. Returns [{ type, name, week, label, date, others, ranks: [{ rank, previous, points, firstPlaceVotes, conf, id, abbr, name, short, logo, record }] }]
// previous is 0 for a team that was unranked last week. The CFP poll only shows up once the
// committee starts publishing (early November) and reports 0 points.
export function getRankings(sport, league) {
  return cached(`rankings:${sport}/${league}`, 30 * MIN, async () => {
    const j = await fetchJson(`${SITE}/${sport}/${league}/rankings`);
    return (j.rankings ?? []).map((p) => ({
      type: p.type,
      name: p.name,
      week: p.occurrence?.type === 'week' ? p.occurrence.number ?? null : null,
      label: p.occurrence?.displayValue ?? null,
      date: p.date ?? null,
      // Teams outside the top 25 that still received votes (AP / Coaches only).
      others: (p.others ?? []).map((r) => ({
        points: r.points ?? 0,
        id: String(r.team.id),
        abbr: r.team.abbreviation,
        short: r.team.location ?? r.team.nickname,
        logo: r.team.logos?.[0]?.href ?? r.team.logo ?? null,
        record: r.recordSummary ?? null,
      })),
      ranks: (p.ranks ?? []).map((r) => ({
        rank: r.current,
        previous: r.previous ?? 0,
        points: r.points ?? 0,
        firstPlaceVotes: r.firstPlaceVotes ?? 0,
        conf: r.team.groups?.shortName ?? null,
        id: String(r.team.id),
        abbr: r.team.abbreviation,
        name: `${r.team.location} ${r.team.name ?? ''}`.trim(),
        short: r.team.location ?? r.team.nickname,
        logo: r.team.logos?.[0]?.href ?? r.team.logo ?? null,
        record: r.recordSummary ?? null,
      })),
    }));
  });
}

// First poll of `wanted` that is published (default: CFP, then AP), else the first poll listed.
export function pickPoll(polls, wanted = ['cfp', 'ap']) {
  return wanted.map((w) => polls.find((p) => p.type === w || (w === 'cfp' && /playoff/i.test(p.name)))).find(Boolean) ?? polls[0] ?? null;
}

// Teams a story is tagged with, as { id, abbr }. College stories tag each team twice (the second
// time with the school name in the abbreviation field), so keep the first entry per team id.
function taggedTeams(a) {
  const byId = new Map();
  for (const c of a.categories ?? []) {
    if (c.type === 'team' && c.team && !byId.has(c.teamId)) byId.set(c.teamId, { id: String(c.teamId), abbr: c.team.abbreviation });
  }
  return [...byId.values()];
}

export function getNews(sport, league, team, limit = 25) {
  return cached(`news:${sport}/${league}/${team}/${limit}`, 10 * MIN, async () => {
    const j = await fetchJson(`${SITE}/${sport}/${league}/news?team=${encodeURIComponent(team)}&limit=${limit}`);
    return (j.articles ?? []).map((a) => ({
      id: String(a.id),
      type: a.type, // HeadlineNews | Story | Recap | Media | Preview ...
      headline: a.headline,
      description: a.description ?? '',
      published: a.published,
      byline: a.byline ?? null,
      image: a.images?.[0]?.url ?? null,
      link: a.links?.web?.href ?? a.links?.mobile?.href ?? null,
      premium: !!a.premium,
      teams: taggedTeams(a),
    }));
  });
}

// Player box score for one game.
// → { teams: [{ team, groups: [{ key, title, labels, descriptions, players: [{ name, pos, starter, dnp, reason, stats }], totals }] }] }
export function getBoxscore(sport, league, eventId) {
  return cached(`box:${sport}/${league}/${eventId}`, 6 * 60 * MIN, async () => {
    const j = await fetchJson(`${SITE}/${sport}/${league}/summary?event=${encodeURIComponent(eventId)}`);
    return {
      teams: (j.boxscore?.players ?? []).map((t) => ({
        team: { id: String(t.team.id), abbr: t.team.abbreviation, name: t.team.displayName, short: t.team.shortDisplayName, logo: logoOf(t.team) },
        groups: (t.statistics ?? []).map((g) => ({
          key: g.name ?? 'players',
          title: g.text ?? null,
          labels: g.labels ?? [],
          descriptions: g.descriptions ?? [],
          totals: g.totals ?? [],
          players: (g.athletes ?? []).map((a) => ({
            id: a.athlete?.id != null ? String(a.athlete.id) : null,
            name: a.athlete?.displayName,
            short: a.athlete?.shortName ?? a.athlete?.displayName,
            pos: a.athlete?.position?.abbreviation ?? null,
            starter: !!a.starter,
            dnp: !!a.didNotPlay || !(a.stats ?? []).length,
            reason: a.reason ?? null,
            stats: a.stats ?? [],
          })),
        })),
      })),
    };
  });
}

// All teams of a league (used to resolve names/logos for fixed club lists).
export function getTeams(sport, league) {
  return cached(`teams:${sport}/${league}`, 24 * 60 * MIN, async () => {
    const j = await fetchJson(`${SITE}/${sport}/${league}/teams`);
    return (j.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: t }) => ({
      id: String(t.id),
      abbr: t.abbreviation,
      name: t.displayName,
      short: t.shortDisplayName ?? t.name,
      logo: logoOf(t),
    }));
  });
}

// Soccer: goals with scorer / assister, in match order. Own goals are credited to the
// benefiting team by ESPN, so teamId is always the side that scored.
export function getSoccerGoals(league, eventId) {
  return cached(`goals:${league}/${eventId}`, 6 * 60 * MIN, async () => {
    const j = await fetchJson(`${SITE}/soccer/${league}/summary?event=${encodeURIComponent(eventId)}`);
    const goals = (j.keyEvents ?? [])
      .filter((k) => k.scoringPlay && !k.shootout)
      .map((k) => ({
        minute: k.clock?.displayValue ?? '',
        teamId: String(k.team?.id),
        scorer: k.participants?.[0]?.athlete?.displayName ?? '?',
        assist: k.participants?.[1]?.athlete?.displayName ?? null,
        penalty: /penalty/.test(k.type?.type ?? ''),
        ownGoal: /own-goal/.test(k.type?.type ?? ''),
      }));
    const comps = j.header?.competitions?.[0]?.competitors ?? [];
    const shootout = comps.some((c) => c.shootoutScore != null)
      ? Object.fromEntries(comps.map((c) => [String(c.id), c.shootoutScore]))
      : null;
    return { goals, shootout };
  });
}

// One athlete: current team, headshot, position, jersey.
export function getAthlete(sport, league, id) {
  return cached(`athlete:${sport}/${league}/${id}`, 6 * 60 * MIN, async () => {
    const a = (await fetchJson(`${COMMON}/${sport}/${league}/athletes/${encodeURIComponent(id)}`)).athlete ?? {};
    return {
      id: String(a.id ?? id),
      name: a.displayName,
      headshot: a.headshot?.href ?? null,
      pos: a.position?.abbreviation ?? null,
      jersey: a.jersey ?? null,
      teamId: a.team?.id != null ? String(a.team.id) : null,
    };
  });
}

// Season averages from an athlete's game log (regular season; preseason/exhibitions skipped).
// → { labels, avg, games } or null when the player has no games in that season yet.
// NBA logs carry an averages row; college logs only season totals, so those get divided by games.
export function getSeasonAverages(sport, league, id, season) {
  return cached(`gamelog:${sport}/${league}/${id}/${season}`, 30 * MIN, async () => {
    const j = await fetchJson(`${COMMON}/${sport}/${league}/athletes/${encodeURIComponent(id)}/gamelog${season ? `?season=${season}` : ''}`);
    const labels = j.labels ?? [];
    const types = (j.seasonTypes ?? []).filter((t) => !/preseason/i.test(t.displayName ?? ''));
    const st = types.find((t) => /regular/i.test(t.displayName ?? '')) ?? types[0];
    const games = (st?.categories ?? []).reduce((n, c) => n + (c.events?.length ?? 0), 0);
    if (!games) return null;
    let avg = st.summary?.stats?.find((x) => x.type === 'avg')?.stats;
    if (!avg && j.totals && j.seasonTypes.length === 1) {
      const per = (v) => (Number(v) / games).toFixed(1);
      avg = j.totals.map((v, i) => (/%$/.test(labels[i]) ? v : String(v).split('-').map(per).join('-')));
    }
    return avg ? { labels, avg, games } : null;
  });
}

export { DAY_MS };
