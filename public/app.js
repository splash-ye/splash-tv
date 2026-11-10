const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- language (中文 / English), remembered in this browser ----------
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
let lang = store.get('lang') === 'en' ? 'en' : 'zh';
const EN = () => lang === 'en';
// L('中文', 'English') picks the string for the current language.
const L = (zh, en) => (EN() ? en : zh);
const locale = () => (EN() ? 'en-US' : 'zh-CN');

// Chinese team names per league (fallback to ESPN's English short name).
const ZH = {
  nba: {
    ATL: '老鹰', BOS: '凯尔特人', BKN: '篮网', CHA: '黄蜂', CHI: '公牛', CLE: '骑士', DAL: '独行侠', DEN: '掘金',
    DET: '活塞', GS: '勇士', HOU: '火箭', IND: '步行者', LAC: '快船', LAL: '湖人', MEM: '灰熊', MIA: '热火',
    MIL: '雄鹿', MIN: '森林狼', NO: '鹈鹕', NY: '尼克斯', OKC: '雷霆', ORL: '魔术', PHI: '76人', PHX: '太阳',
    POR: '开拓者', SAC: '国王', SA: '马刺', TOR: '猛龙', UTA: '爵士', UTAH: '爵士', WSH: '奇才',
  },
  nfl: {
    ARI: '红雀', ATL: '猎鹰', BAL: '乌鸦', BUF: '比尔', CAR: '黑豹', CHI: '熊', CIN: '猛虎', CLE: '布朗',
    DAL: '牛仔', DEN: '野马', DET: '雄狮', GB: '包装工', HOU: '德州人', IND: '小马', JAX: '美洲虎', KC: '酋长',
    LV: '突袭者', LAC: '闪电', LAR: '公羊', MIA: '海豚', MIN: '维京人', NE: '爱国者', NO: '圣徒', NYG: '巨人',
    NYJ: '喷气机', PHI: '老鹰', PIT: '钢人', SF: '49人', SEA: '海鹰', TB: '海盗', TEN: '泰坦', WSH: '指挥官',
  },
  soccer: { MNC: '曼城', ARS: '阿森纳', LIV: '利物浦', CHE: '切尔西', RMA: '皇马', BAR: '巴萨', ATM: '马竞', MUN: '拜仁', PSG: '巴黎' },
};
const NEWS_TYPE = {
  HeadlineNews: ['头条', 'Headline'], Story: ['深度', 'Story'], Recap: ['战报', 'Recap'], Media: ['视频', 'Video'], Preview: ['前瞻', 'Preview'],
};
const NBA_LABELS = {
  MIN: '时间', PTS: '得分', FG: '投篮', '3PT': '三分', FT: '罚球', REB: '篮板', AST: '助攻', TO: '失误',
  STL: '抢断', BLK: '盖帽', OREB: '前板', DREB: '后板', PF: '犯规',
};
const nbaLabel = (l) => (EN() ? l : NBA_LABELS[l] ?? l);
const FB_GROUPS = {
  passing: ['传球', 'Passing'], rushing: ['冲球', 'Rushing'], receiving: ['接球', 'Receiving'],
  defensive: ['防守', 'Defense'], interceptions: ['抄截', 'Interceptions'], kicking: ['踢球', 'Kicking'],
};
const RES = { W: ['胜', 'W'], L: ['负', 'L'], T: ['平', 'T'] };
const resWord = (r) => L(...RES[r]);

const teamName = (t, lg) => (EN() ? t.short ?? t.name : ZH[lg]?.[t.abbr] ?? t.short ?? t.name);
const leagueName = (league) => (EN() ? league.nameEn ?? league.name : league.name);
const badge = (league) => `<span class="lg lg-${esc(league.id)}">${esc(leagueName(league))}</span>`;

// Relative paths so the same page works on the local server and under a GitHub Pages subpath.
// Responses are kept for the page's lifetime, so switching language re-renders without refetching.
const apiCache = new Map();
async function fetchApi(endpoint) {
  const res = await fetch(`api/${endpoint}.json`, { cache: 'no-cache' });
  if (res.status === 404) throw new Error(L('暂无数据', 'No data yet'));
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
function api(endpoint) {
  if (!apiCache.has(endpoint)) apiCache.set(endpoint, fetchApi(endpoint).catch((err) => (apiCache.delete(endpoint), Promise.reject(err))));
  return apiCache.get(endpoint);
}

// ---------- formatting ----------
const dayKey = (d) => d.toLocaleDateString('en-CA');
const weekday = (d) => d.toLocaleDateString(locale(), { weekday: 'short' });
function dayLabel(d) {
  const diff = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / 864e5);
  const rel = { '-1': L('昨天 · ', 'Yesterday · '), 0: L('今天 · ', 'Today · '), 1: L('明天 · ', 'Tomorrow · ') }[diff] ?? '';
  return `${rel}${d.getMonth() + 1}/${d.getDate()} ${weekday(d)}`;
}
const hm = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
const longDate = (d) => d.toLocaleDateString(locale(), { month: EN() ? 'short' : 'long', day: 'numeric', weekday: 'short' });
const stamp = (iso) => new Date(iso ?? Date.now()).toLocaleString(locale(), { hour12: false });
const updatedNote = (iso) => `<div class="foot-note">${L('数据更新于 ', 'Updated ')}${esc(stamp(iso))}</div>`;
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return L(`${Math.max(1, Math.round(s / 60))} 分钟前`, `${Math.max(1, Math.round(s / 60))} min ago`);
  if (s < 86400) return L(`${Math.round(s / 3600)} 小时前`, `${Math.round(s / 3600)} h ago`);
  if (s < 86400 * 7) return L(`${Math.round(s / 86400)} 天前`, `${Math.round(s / 86400)} d ago`);
  return new Date(iso).toLocaleDateString(locale());
}
const weekOfLabel = (k) => `${Number(k.slice(4, 6))}/${Number(k.slice(6, 8))}`;
const errorsHtml = (errs) =>
  errs?.length ? `<div class="error">${L('部分数据加载失败：', 'Some data failed to load: ')}${errs.map(esc).join(L('；', '; '))}</div>` : '';

// ---------- shared game table (schedule + results use identical columns) ----------
const COLGROUP = '<colgroup><col class="c-lead"><col class="c-lg"><col><col class="c-mid"><col><col class="c-end"></colgroup>';

const lostSide = (g, side) => g[side === 'away' ? 'home' : 'away'].winner === true;

function teamTd(g, side) {
  const t = g[side];
  const cls = [side, g.focusIds.includes(t.id) ? 'focus' : '', g.status.completed && lostSide(g, side) ? 'lost' : ''].join(' ');
  return `<td class="team ${cls}"><div class="tmx"><img src="${esc(t.logo)}" alt="${esc(teamName(t, g.league.id))}" title="${esc(t.name)}" loading="lazy" />
    <div class="tx"><span class="nm" title="${esc(t.name)}">${esc(teamName(t, g.league.id))}</span></div></div></td>`;
}

// rows: [{ g, lead, mid, end, attrs }] already sorted; inserts a day header whenever the date changes.
function gameTable(rows, after = () => '', cls = '') {
  let lastDay = '';
  const body = rows
    .map((r, i) => {
      const dt = new Date(r.g.date);
      const day = dayKey(dt);
      const sep = day !== lastDay ? `<tr class="day"><td colspan="6">${esc(dayLabel(dt))}</td></tr>` : '';
      lastDay = day;
      return `${sep}<tr class="row" data-i="${i}" ${r.attrs ?? ''}>
        <td class="lead">${r.lead}</td>
        <td class="lgc">${badge(r.g.league)}</td>
        ${teamTd(r.g, 'away')}
        <td class="mid">${r.mid}</td>
        ${teamTd(r.g, 'home')}
        <td class="end" ${r.endTitle ? `title="${esc(r.endTitle)}"` : ''}>${r.end}</td>
      </tr>${after(r, i)}`;
    })
    .join('');
  return `<table class="games ${cls}">${COLGROUP}<tbody>${body}</tbody></table>`;
}

const teamChips = (teams, recordOf) =>
  `<div class="chips">${teams
    .map((t) => `<span class="chip" title="${esc(t.name)}${t.standing ? ` · ${esc(t.standing)}` : ''}"><img src="${esc(t.logo)}" alt="" />${esc(teamName(t, t.league.id))} <b>${esc(recordOf(t))}</b></span>`)
    .join('')}</div>`;

// ---------- schedule (daily snapshot) ----------
let scheduleTimer = null;
// Started games stay listed until the server sees their result; they show 进行中 instead of a time.
const started = (g) => g.timeValid && new Date(g.date) <= Date.now();

// Games the viewer removed with ×; kept in this browser only (the site is static).
const gameKey = (g) => `${g.league.id}:${g.id}`;
const hiddenGames = {
  load() {
    try {
      return new Set(JSON.parse(store.get('hiddenGames') || '[]'));
    } catch {
      return new Set();
    }
  },
  save(set) {
    store.set('hiddenGames', JSON.stringify([...set]));
  },
};

async function renderSchedule() {
  const el = $('#schedule-card');
  clearTimeout(scheduleTimer);
  try {
    const d = { ...(await api('schedule')) };
    // Forget removed games that have left the schedule so the list doesn't grow forever.
    const hidden = hiddenGames.load();
    const upcoming = new Set(d.games.map(gameKey));
    const kept = new Set([...hidden].filter((k) => upcoming.has(k)));
    if (kept.size !== hidden.size) hiddenGames.save(kept);
    d.games = d.games.filter((g) => !kept.has(gameKey(g)));
    // Re-render right after the next kickoff so the game flips to 进行中 while the page stays open.
    const next = d.games.filter((g) => g.timeValid).map((g) => new Date(g.date).getTime()).find((t) => t > Date.now());
    if (next) scheduleTimer = setTimeout(renderSchedule, Math.min(next - Date.now() + 5000, 2 ** 31 - 1));
    $('#sched-sub').textContent = L(`未来 ${d.daysAhead} 天 · 每天更新`, `Next ${d.daysAhead} days · updated daily`);
    const rows = d.games.map((g) => ({
      g,
      lead: started(g)
        ? `<span class="live" title="${esc(L(`${hm(new Date(g.date))} 开赛`, `Started ${hm(new Date(g.date))}`))}">${L('进行中', 'Live')}</span>`
        : g.timeValid ? esc(hm(new Date(g.date))) : L('待定', 'TBD'),
      mid: '<span class="at">@</span>',
      end: `<div class="endx"><div class="bcs">${g.broadcasts.map((b) => `<span class="bc">${esc(b)}</span>`).join('')}</div>
        <button class="rm" title="${L('移除这场比赛', 'Remove this game')}" aria-label="${L('移除这场比赛', 'Remove this game')}">×</button></div>`,
      endTitle: [g.broadcasts.join(' / '), g.note].filter(Boolean).join(' · '),
    }));
    el.innerHTML = `
      ${teamChips(d.teams, (t) => t.record ?? '')}
      <details class="rules">
        <summary><span class="tag tag-marquee">${L('强强', 'Marquee')}</span>${L('对话规则', 'matchup rules')}</summary>
        <div class="quals">${d.qualifiers
          .map((q) => `<div class="qual">
            <div class="qh">${badge(q.league)}${esc(EN() ? q.criteriaEn ?? q.criteria : q.criteria)} <span class="sub">· ${
              q.fixed ? L('固定名单', 'fixed list') : L(`${weekOfLabel(q.weekOf)} 周一排名`, `as of Mon ${weekOfLabel(q.weekOf)}`)
            }</span></div>
            <div class="chips">${q.teams
              .map((t) => {
                const label = EN() ? t.labelEn ?? t.label : t.label;
                return `<span class="chip" title="${esc(t.name)}"><img src="${esc(t.logo)}" alt="" />${label ? `<b>${esc(label)}</b>` : ''}${esc(teamName(t, q.league.id))} ${esc(t.record ?? '')}</span>`;
              })
              .join('') || `<span class="empty">${L('暂无符合条件的球队', 'No qualifying teams')}</span>`}</div>
          </div>`)
          .join('')}</div>
      </details>
      ${errorsHtml(d.errors)}
      ${rows.length ? gameTable(rows, undefined, 'sched') : `<div class="empty">${L(`未来 ${d.daysAhead} 天没有比赛`, `No games in the next ${d.daysAhead} days`)}</div>`}
      <div class="foot-note">${kept.size ? `${L(`已移除 ${kept.size} 场`, `${kept.size} removed`)} · <button class="restore">${L('恢复', 'Restore')}</button> · ` : ''}${L('生成于 ', 'Generated ')}${esc(stamp(d.generatedAt))}</div>`;
    el.querySelectorAll('tr.row').forEach((tr) => {
      const g = rows[Number(tr.dataset.i)].g;
      if (g.link) tr.addEventListener('click', () => window.open(g.link, '_blank', 'noopener'));
      tr.querySelector('.rm').addEventListener('click', (e) => {
        e.stopPropagation();
        hiddenGames.save(new Set([...kept, gameKey(g)]));
        renderSchedule();
      });
    });
    el.querySelector('.restore')?.addEventListener('click', () => {
      hiddenGames.save(new Set());
      renderSchedule();
    });
  } catch (err) {
    el.innerHTML = `<div class="error">${L('赛程加载失败：', 'Failed to load schedule: ')}${esc(err.message)}</div>`;
  }
}

// ---------- results + box scores ----------
function resultCells(g) {
  const focus = [g.away, g.home].find((t) => g.focusIds.includes(t.id));
  const tie = g.away.score === g.home.score;
  const res = focus ? (tie ? 'T' : focus.winner ? 'W' : 'L') : null;
  const sc = (side) => `<span class="sc ${lostSide(g, side) ? 'lost' : ''}">${esc(g[side].score ?? '')}</span>`;
  const detail = g.status.detail ?? '';
  const ot = /Pen|PK|SO/i.test(detail)
    ? L('点球', 'PKs')
    : /AET/i.test(detail)
      ? L('加时', 'AET')
      : detail.match(/\/(\d*OT)/)?.[1]?.replace(/^OT$/, L('加时', 'OT'));
  return {
    g,
    lead: res ? `<span class="res ${res}">${resWord(res)}</span>` : `<span class="fin">${L('完赛', 'Final')}</span>`,
    mid: `${sc('away')}<span class="colon">:</span>${sc('home')}${ot ? `<span class="ot">${esc(ot)}</span>` : ''}`,
    end: '<span class="chev">▾</span>',
    attrs: 'aria-expanded="false"',
  };
}

// nba: translate the column labels and mark where the bench starts.
function statTable(labels, descriptions, players, totals, nba = false) {
  const head = labels.map((l, i) => `<th title="${esc(descriptions[i] ?? '')}">${esc(nba ? nbaLabel(l) : l)}</th>`).join('');
  let benchMarked = false;
  const rows = players
    .map((p) => {
      const bench = nba && !p.starter && !benchMarked && (benchMarked = true);
      return `<tr class="${bench ? 'bench' : ''}"><td class="pl" title="${esc(p.name)}">${esc(p.short)}${p.pos ? `<span class="pos">${esc(p.pos)}</span>` : ''}</td>${p.stats.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>`;
    })
    .join('');
  const total = totals?.some(Boolean) ? `<tr class="total"><td class="pl">${L('合计', 'Total')}</td>${totals.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>` : '';
  return `<div class="scroll"><table class="stats"><thead><tr><th class="pl">${L('球员', 'Player')}</th>${head}</tr></thead><tbody>${rows}${total}</tbody></table></div>`;
}

function teamBox(t, leagueId) {
  const none = `<div class="empty">${L('暂无数据', 'No data')}</div>`;
  if (leagueId === 'nba') {
    const g = t.groups[0];
    if (!g) return none;
    const played = g.players.filter((p) => !p.dnp);
    const dnp = g.players.filter((p) => p.dnp);
    const reason = (p) => (p.reason ? L(`（${p.reason.toLowerCase()}）`, ` (${p.reason.toLowerCase()})`) : '');
    return (
      statTable(g.labels, g.descriptions, played, g.totals, true) +
      (dnp.length ? `<div class="dnp">${L('未上场：', 'DNP: ')}${dnp.map((p) => `${esc(p.short)}${esc(reason(p))}`).join(L('、', ', '))}</div>` : '')
    );
  }
  const groups = Object.keys(FB_GROUPS)
    .map((key) => t.groups.find((g) => g.key === key))
    .filter((g) => g?.players.length);
  if (!groups.length) return none;
  return groups
    .map((g) => {
      // ESPN sorts defenders by tackles; the long tail is noise.
      const players = g.key === 'defensive' ? g.players.slice(0, 8) : g.players;
      const name = L(...FB_GROUPS[g.key]);
      const title = g.key === 'defensive' && g.players.length > 8 ? `${name} <span class="sub">${L('（擒抱前 8）', '(top 8 by tackles)')}</span>` : name;
      return `<div class="grp">${title}</div>${statTable(g.labels, g.descriptions, players, g.key === 'defensive' ? null : g.totals)}`;
    })
    .join('');
}

// Soccer: goal list (scorer + assist), in match order.
function goalsBox(data, g) {
  const team = (id) => [g.away, g.home].find((t) => t.id === id);
  const rows = data.goals
    .map((x) => {
      const t = team(x.teamId);
      const kind = x.ownGoal ? `<span class="gk">${L('乌龙', 'OG')}</span>` : x.penalty ? `<span class="gk">${L('点球', 'Pen')}</span>` : '';
      return `<tr><td class="min">${esc(x.minute)}</td>
        <td class="gt">${t ? `<img src="${esc(t.logo)}" alt="" />${esc(teamName(t, g.league.id))}` : ''}</td>
        <td class="gs">⚽ ${esc(x.scorer)}${kind}</td>
        <td class="ga">${x.assist ? `${L('助攻 ', 'Assist: ')}${esc(x.assist)}` : ''}</td></tr>`;
    })
    .join('');
  const so = data.shootout
    ? `<div class="so">${L('点球大战', 'Shootout')} ${esc(teamName(g.away, g.league.id))} ${esc(data.shootout[g.away.id] ?? '-')} : ${esc(data.shootout[g.home.id] ?? '-')} ${esc(teamName(g.home, g.league.id))}</div>`
    : '';
  return `${rows ? `<table class="goals"><tbody>${rows}</tbody></table>` : `<div class="empty">${L('本场没有进球', 'No goals')}</div>`}${so}
    ${g.link ? `<div class="box-foot"><a class="ext" href="${esc(g.link)}" target="_blank" rel="noopener">ESPN ↗</a></div>` : ''}`;
}

async function toggleBox(tr, boxRow, g) {
  const box = boxRow.querySelector('.box');
  const open = boxRow.hidden;
  boxRow.hidden = !open;
  tr.setAttribute('aria-expanded', String(open));
  if (!open || box.dataset.loaded) return;
  box.innerHTML = `<div class="loading">${L('加载技术统计…', 'Loading box score…')}</div>`;
  try {
    const data = await api(`boxscore/${g.league.id}/${g.league.comp ?? '_'}/${g.id}`);
    if (data.goals) {
      box.innerHTML = goalsBox(data, g);
      box.dataset.loaded = '1';
      return;
    }
    // Away first, matching the row; default tab = followed team when there is one.
    const teams = [g.away, g.home].map((s) => data.teams.find((t) => t.team.id === s.id)).filter(Boolean);
    if (!teams.length) throw new Error(L('暂无技术统计', 'No box score yet'));
    let active = Math.max(0, teams.findIndex((t) => g.focusIds.includes(t.team.id)));
    const draw = () => {
      box.innerHTML = `
        <div class="seg">${teams
          .map((t, i) => `<button data-i="${i}" class="${i === active ? 'active' : ''}"><img src="${esc(t.team.logo)}" alt="" />${esc(teamName(t.team, g.league.id))}</button>`)
          .join('')}${g.link ? `<a class="ext" href="${esc(g.link)}" target="_blank" rel="noopener">ESPN ↗</a>` : ''}</div>
        ${teamBox(teams[active], g.league.id)}`;
      box.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); active = Number(b.dataset.i); draw(); }));
    };
    draw();
    box.dataset.loaded = '1';
  } catch (err) {
    box.innerHTML = `<div class="error">${L('技术统计加载失败：', 'Failed to load box score: ')}${esc(err.message)}</div>`;
  }
}

// ---------- results card: tabs (results | players | NBA / NFL standings | NCAAF poll) ----------
const CONF_ZH = { 'Eastern Conference': '东部', 'Western Conference': '西部' };
const DIR_ZH = { East: '东区', West: '西区', North: '北区', South: '南区' };
const groupName = (name) =>
  EN() ? name : CONF_ZH[name] ?? name.replace(/^(AFC|NFC)\s+(East|West|North|South)$/, (_, c, d) => `${c}${DIR_ZH[d]}`);
const pct = (x) => x.toFixed(3).replace(/^0/, '');
const streak = (s) => (!EN() && s?.match(/^([WL])(\d+)$/) ? `${s.slice(1)}连${s[0] === 'W' ? '胜' : '败'}` : s ?? '');

// College poll (CFP or AP Top 25). CFP has no voting points, so that column only shows for AP.
const POLL_NAME = { cfp: ['CFP 排名', 'CFP Rankings'], ap: ['AP Top 25', 'AP Top 25'] };
const pollName = (p) => (POLL_NAME[p.type] ? L(...POLL_NAME[p.type]) : p.name);
const pollWhen = (p) => (p.week ? L(`第 ${p.week} 周`, `Week ${p.week}`) : p.label ?? '');

function pollHtml(lg) {
  const points = lg.teams.some((t) => t.points > 0);
  const move = (t) => {
    if (!t.previous) return `<span class="mv new">${L('新', 'NEW')}</span>`;
    const d = t.previous - t.rank;
    return d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : '<span class="mv">–</span>';
  };
  const head = `<th class="n">#</th><th class="tm">${L('球队', 'Team')}</th><th>${L('战绩', 'Record')}</th><th>${L('变化', 'Trend')}</th>${points ? `<th class="opt">${L('积分', 'Pts')}</th>` : ''}`;
  const row = (t) => `<tr class="${t.followed ? 'mine' : ''}"><td class="n">${t.rank}</td>
    <td class="tm"><img src="${esc(t.logo)}" alt="" loading="lazy" />${esc(t.short ?? t.name)}${t.conf ? `<span class="conf">${esc(t.conf)}</span>` : ''}</td>
    <td>${esc(t.record ?? '')}</td><td>${move(t)}</td>
    ${points ? `<td class="opt">${Math.round(t.points)}${t.firstPlaceVotes ? `<span class="fpv">(${t.firstPlaceVotes})</span>` : ''}</td>` : ''}</tr>`;
  const votes = (lg.votes ?? [])
    .map((t) => `<div class="poll-votes"><img src="${esc(t.logo)}" alt="" />${esc(t.short)} ${esc(t.record ?? '')} · ${
      L(`未进前 25，获 ${Math.round(t.points)} 票`, `unranked, ${Math.round(t.points)} votes`)
    }</div>`)
    .join('');
  const note = lg.poll.type === 'cfp'
    ? L('大学橄榄球季后赛委员会排名', 'College Football Playoff committee rankings')
    : L('CFP 排名公布前使用 AP 排名', 'AP poll until the CFP rankings come out');
  return `<table class="stand poll"><thead><tr>${head}</tr></thead><tbody>${lg.teams.map(row).join('')}</tbody></table>${votes}
    <div class="foot-note left">${note}${points ? L(' · 括号内为第一名选票', ' · first-place votes in parentheses') : ''}</div>`;
}

function standingsHtml(lg) {
  if (lg.kind === 'poll') return pollHtml(lg);
  const conf = lg.kind === 'conference';
  const th = (zh, en, cls = '') => `<th${cls ? ` class="${cls}"` : ''}>${L(zh, en)}</th>`;
  const head = conf
    ? `<th class="n">#</th>${th('球队', 'Team', 'tm')}${th('胜', 'W')}${th('负', 'L')}${th('胜率', 'PCT')}${th('胜差', 'GB')}${th('近10场', 'L10', 'opt')}${th('连胜/败', 'STRK', 'opt')}`
    : `${th('球队', 'Team', 'tm')}${th('胜', 'W')}${th('负', 'L')}${th('平', 'T')}${th('胜率', 'PCT')}${th('净胜分', 'DIFF')}${th('连胜/败', 'STRK', 'opt')}`;
  const row = (t, i) => {
    // NBA: 1-6 direct playoff spots, 7-10 play-in; draw a line under 6 and 10.
    const cut = conf && (i === 5 || i === 9) ? ' cut' : '';
    const team = `<td class="tm"><img src="${esc(t.logo)}" alt="" loading="lazy" />${esc(teamName(t, lg.id))}</td>`;
    const cells = conf
      ? `<td class="n">${t.seed < 99 ? t.seed : i + 1}</td>${team}<td>${t.wins}</td><td>${t.losses}</td><td>${pct(t.winPercent)}</td><td>${esc(t.gamesBehind)}</td><td class="opt">${esc(t.last10)}</td><td class="opt">${esc(streak(t.streak))}</td>`
      : `${team}<td>${t.wins}</td><td>${t.losses}</td><td>${t.ties}</td><td>${pct(t.winPercent)}</td><td>${esc(t.diff)}</td><td class="opt">${esc(streak(t.streak))}</td>`;
    return `<tr class="${t.followed ? 'mine' : ''}${cut}">${cells}</tr>`;
  };
  return `<div class="stand-groups ${lg.kind}">${lg.groups
    .map((g) => `<div class="stand-group"><div class="grp">${esc(groupName(g.name))}</div>
      <table class="stand"><thead><tr>${head}</tr></thead><tbody>${g.teams.map(row).join('')}</tbody></table></div>`)
    .join('')}</div>${conf ? `<div class="foot-note left">${L('1–6 名直接进季后赛，7–10 名打附加赛', 'Seeds 1–6 make the playoffs, 7–10 go to the play-in')}</div>` : ''}`;
}

// ---------- followed players (留洋) ----------
const PLAYER_COLS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TO'];

function playerHtml(p) {
  const tag = p.league.id;
  const name = EN() ? p.athlete?.name ?? p.name : p.name;
  if (p.error) return `<div class="pl-card"><div class="pl-head"><div class="pl-name"><b>${esc(name)}</b>${badge(p.league)}</div></div><div class="error">${L('加载失败：', 'Failed to load: ')}${esc(p.error)}</div></div>`;
  const a = p.athlete;
  const team = EN() ? teamName(p.team, tag) : p.teamZh ?? teamName(p.team, tag);
  const s = p.season;
  const avgLine = !s
    ? L('本赛季暂未出场', 'No appearances this season')
    : EN()
      ? `<b>${esc(s.PTS)}</b> PPG · <b>${esc(s.REB)}</b> RPG · <b>${esc(s.AST)}</b> APG · ${esc(s.MIN)} MPG · ${p.seasonGames} GP`
      : `场均 <b>${esc(s.PTS)}</b> 分 <b>${esc(s.REB)}</b> 板 <b>${esc(s.AST)}</b> 助 · ${esc(s.MIN)} 分钟 · ${p.seasonGames} 场`;
  const head = `<th class="pl">${L('日期', 'Date')}</th><th class="opp">${L('对手', 'Opp')}</th><th>${L('比分', 'Score')}</th>${PLAYER_COLS.map((c) => `<th>${esc(nbaLabel(c))}</th>`).join('')}`;
  const rows = p.games
    .map((g, i) => {
      const home = g.home.id === p.team.id;
      const [me, opp] = home ? [g.home, g.away] : [g.away, g.home];
      const res = me.winner === true ? 'W' : opp.winner === true ? 'L' : 'T';
      const d = new Date(g.date);
      const lead = `<td class="pl">${esc(`${d.getMonth() + 1}/${d.getDate()}`)}</td>
        <td class="opp"><span class="at">${home ? 'vs' : '@'}</span><img src="${esc(opp.logo)}" alt="" loading="lazy" />${esc(teamName(opp, tag))}</td>
        <td><span class="res ${res}">${resWord(res)}</span> ${esc(me.score)}-${esc(opp.score)}</td>`;
      const cells = g.line
        ? PLAYER_COLS.map((c) => `<td class="${c === 'PTS' ? 'pts' : ''}">${esc(g.line[c] ?? '-')}</td>`).join('')
        : `<td colspan="${PLAYER_COLS.length}" class="dnp-cell">${g.dnp ? L('未上场', 'DNP') : L('暂无数据', 'No data')}</td>`;
      return `<tr class="${g.link ? 'link' : ''}" data-i="${i}">${lead}${cells}</tr>`;
    })
    .join('');
  return `<div class="pl-card">
    <div class="pl-head">
      <img class="pl-shot" src="${esc(a.headshot ?? p.team.logo)}" alt="" loading="lazy" />
      <div>
        <div class="pl-name"><b>${esc(name)}</b>${badge(p.league)}<span class="pl-team"><img src="${esc(p.team.logo)}" alt="" />${esc(team)}${a.pos ? ` · ${esc(a.pos)}` : ''}${a.jersey ? ` · #${esc(a.jersey)}` : ''}</span></div>
        <div class="pl-avg">${avgLine}</div>
      </div>
    </div>
    ${p.games.length ? `<div class="scroll"><table class="stats pl-games"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${L('本赛季还没有比赛', 'No games this season yet')}</div>`}
  </div>`;
}

function playersHtml(d) {
  return `${errorsHtml(d.errors)}<div class="pl-list">${d.players.map(playerHtml).join('')}</div>`;
}

let resultsTab = store.get('resultsTab') || 'results';

async function renderResults() {
  const el = $('#results-card');
  const [d, st, pl] = await Promise.all([
    api('results').catch((err) => ({ err })),
    api('standings').catch(() => ({ leagues: [] })),
    api('players').catch(() => ({ enabled: false })),
  ]);
  const tabs = [
    { key: 'results', label: L('战绩', 'Results') },
    ...(pl.enabled ? [{ key: 'players', label: L('留洋', 'Players') }] : []),
    // English tabs stay short (the card subtitle says standings / rankings) so they fit on a phone.
    ...st.leagues.map((l) => ({ key: l.id, label: L(`${l.name} 排名`, l.kind === 'poll' ? 'Top 25' : l.name) })),
  ];
  if (!tabs.some((t) => t.key === resultsTab)) resultsTab = 'results';

  const draw = () => {
    const seg = `<div class="seg card-tabs">${tabs
      .map((t) => `<button data-k="${t.key}" class="${t.key === resultsTab ? 'active' : ''}">${esc(t.label)}</button>`)
      .join('')}</div>`;
    if (resultsTab === 'results') {
      $('#res-sub').textContent = d.err ? '' : L(`过去 ${d.daysBack} 天 · 点开看球员数据`, `Last ${d.daysBack} days · tap a game for player stats`);
      if (d.err) {
        el.innerHTML = `${seg}<div class="error">${L('战绩加载失败：', 'Failed to load results: ')}${esc(d.err.message)}</div>`;
      } else {
        const rows = d.games.map(resultCells);
        el.innerHTML = `${seg}
          ${errorsHtml(d.errors)}
          ${rows.length ? gameTable(rows, () => '<tr class="box-row" hidden><td colspan="6"><div class="box"></div></td></tr>') : `<div class="empty">${L(`过去 ${d.daysBack} 天没有比赛`, `No games in the last ${d.daysBack} days`)}</div>`}
          ${updatedNote(d.builtAt)}`;
        el.querySelectorAll('tr.row').forEach((tr) => {
          const g = rows[Number(tr.dataset.i)].g;
          tr.addEventListener('click', () => toggleBox(tr, tr.nextElementSibling, g));
        });
      }
    } else if (resultsTab === 'players') {
      $('#res-sub').textContent = L('中国留洋球员 · 最近比赛', 'Chinese players abroad · recent games');
      el.innerHTML = `${seg}${playersHtml(pl)}${updatedNote(pl.builtAt)}`;
      el.querySelectorAll('.pl-card').forEach((card, ci) => {
        const p = pl.players[ci];
        card.querySelectorAll('tr.link').forEach((tr) =>
          tr.addEventListener('click', () => window.open(p.games[Number(tr.dataset.i)].link, '_blank', 'noopener')),
        );
      });
    } else {
      const lg = st.leagues.find((l) => l.id === resultsTab);
      $('#res-sub').textContent =
        lg.kind === 'poll'
          ? `${pollName(lg.poll)} · ${pollWhen(lg.poll)}`
          : lg.kind === 'conference'
            ? L(`${lg.name} 东西部排名`, `${lg.name} conference standings`)
            : L(`${lg.name} 分区排名`, `${lg.name} division standings`);
      el.innerHTML = `${seg}${standingsHtml(lg)}${updatedNote(st.builtAt)}`;
    }
    el.querySelectorAll('.card-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        resultsTab = b.dataset.k;
        store.set('resultsTab', resultsTab);
        draw();
      }),
    );
  };
  draw();
}

// ---------- news (ESPN) ----------
async function renderNews() {
  const el = $('#news-list');
  try {
    const { enabled, articles, generatedAt } = await api('news');
    $('#news').hidden = !enabled;
    $('#nav-news').hidden = !enabled;
    if (!enabled) return;
    const when = generatedAt
      ? ` · ${new Date(generatedAt).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`
      : '';
    $('#news-sub').textContent = `${L('每天更新', 'Updated daily')}${when}`;
    const item = (a) => `<div class="news-item">
      <a href="${esc(a.link)}" target="_blank" rel="noopener">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" />` : '<div class="noimg"></div>'}</a>
      <div>
        <a href="${esc(a.link)}" target="_blank" rel="noopener"><h4>${esc(a.headline)}</h4></a>
        ${a.description ? `<p>${esc(a.description)}</p>` : ''}
        <div class="nmeta">${badge(a.league)}${a.type ? `<span class="badge ${esc(a.type)}">${esc(NEWS_TYPE[a.type] ? L(...NEWS_TYPE[a.type]) : a.type)}</span>` : ''}${esc(timeAgo(a.published))}${a.byline ? ` · ${esc(a.byline)}` : ''}</div>
      </div></div>`;
    const PAGE = 8;
    let shown = PAGE;
    const draw = () => {
      el.innerHTML =
        (articles.length ? articles.slice(0, shown).map(item).join('') : `<div class="empty">${L('暂无新闻', 'No news')}</div>`) +
        (shown < articles.length ? `<div class="news-more"><button>${L('加载更多', 'Load more')}</button></div>` : '');
      el.querySelector('.news-more button')?.addEventListener('click', () => { shown += PAGE; draw(); });
    };
    draw();
  } catch (err) {
    el.innerHTML = `<div class="error">${L('新闻加载失败：', 'Failed to load news: ')}${esc(err.message)}</div>`;
  }
}

// ---------- highlights ----------
async function renderHighlights() {
  const el = $('#hl-wrap');
  try {
    const { games, daysBack, roundups = [] } = await api('highlights');
    $('#hl-sub').textContent = L(`最近 ${daysBack} 天`, `Last ${daysBack} days`);
    const gameCards = games
      .map(({ game: g, videos }) => ({ sort: g.date, html: (() => {
        const lg = g.league.id;
        // Followed team first with W/L; marquee-only games (soccer) show away @ home and the plain score.
        const focusTeam = [g.home, g.away].find((t) => g.focusIds.includes(t.id));
        const first = focusTeam ?? g.away;
        const second = first === g.home ? g.away : g.home;
        const res = !focusTeam ? null : first.winner === true ? 'W' : second.winner === true ? 'L' : 'T';
        const v = videos[0];
        const d = new Date(g.date);
        return `<div class="hl">
          ${v
            ? `<a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /></a>`
            : `<div class="thumb none">${L('集锦暂未上线', 'Highlights not up yet')}</div>`}
          <div class="body">
            <div class="line1">${badge(g.league)}
              <img src="${esc(first.logo)}" alt="" />${esc(teamName(first, lg))}
              <span class="vs">${first === g.away ? '@' : 'vs'}</span>
              <img src="${esc(second.logo)}" alt="" />${esc(teamName(second, lg))}</div>
            <div class="line2">
              <span>${esc(longDate(d))}${v?.extended ? L(' · 加长版', ' · Extended') : ''}</span>
              ${res ? `<span class="res ${res}">${resWord(res)} ${esc(first.score)}-${esc(second.score)}</span>` : `<span class="score">${esc(first.score)}-${esc(second.score)}</span>`}
            </div>
            ${videos.length > 1 ? `<div class="alt">${L('其他版本：', 'More: ')}${videos.slice(1).map((x, i) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}">${x.extended ? L('加长版', 'Extended') : L(`版本${i + 2}`, `Version ${i + 2}`)} ↗</a>`).join('')}</div>` : ''}
          </div></div>`;
      })() }));
    // League-wide compilations: NBA nightly recap / top plays, NFL top 15 of the week.
    const roundupCards = roundups.map((r) => {
        const v = r.video;
        const k = r.period.key;
        const when = r.period.week
          ? L(`第 ${r.period.week} 周`, `Week ${r.period.week}`)
          : longDate(new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)));
        return { sort: r.period.sortDate, html: `<div class="hl">
          <a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /></a>
          <div class="body">
            <div class="line1">${badge(r.league)}${esc(EN() ? r.labelEn ?? r.label : r.label)}</div>
            <div class="line2"><span>${esc(when)}</span></div>
          </div></div>` };
      });
    // Followed-team games and league roundups in one grid, newest first.
    const cards = [...gameCards, ...roundupCards].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
    el.innerHTML = cards.length
      ? `<div class="hl-grid">${cards.map((c) => c.html).join('')}</div>`
      : `<div class="empty">${L(`最近 ${daysBack} 天没有集锦`, `No highlights in the last ${daysBack} days`)}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${L('集锦加载失败：', 'Failed to load highlights: ')}${esc(err.message)}</div>`;
  }
}

// ---------- app ----------
// Static text in index.html carries its English version in data-en; the Chinese original is kept in data-zh.
function applyStaticText() {
  document.documentElement.lang = L('zh-CN', 'en');
  document.querySelectorAll('[data-en]').forEach((n) => {
    n.dataset.zh ??= n.textContent;
    n.textContent = EN() ? n.dataset.en : n.dataset.zh;
  });
  document.querySelectorAll('#lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
}

async function renderAll() {
  applyStaticText();
  await Promise.all([renderSchedule(), renderResults(), renderNews(), renderHighlights()]);
  const built = await api('results').then((d) => d.builtAt).catch(() => null);
  $('#updated').textContent = built ? `${L('数据更新于 ', 'Updated ')}${stamp(built)}` : '';
}

document.querySelectorAll('#lang button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    store.set('lang', lang);
    renderAll();
  }),
);
renderAll();
