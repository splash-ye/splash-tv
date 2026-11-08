const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
const NEWS_TYPE = { HeadlineNews: '头条', Story: '深度', Recap: '战报', Media: '视频', Preview: '前瞻' };
const TAG = { follow: '关注', marquee: '强强' };
const NBA_LABELS = {
  MIN: '时间', PTS: '得分', FG: '投篮', '3PT': '三分', FT: '罚球', REB: '篮板', AST: '助攻', TO: '失误',
  STL: '抢断', BLK: '盖帽', OREB: '前板', DREB: '后板', PF: '犯规',
};
const FB_GROUPS = { passing: '传球', rushing: '冲球', receiving: '接球', defensive: '防守', interceptions: '抄截', kicking: '踢球' };

const teamName = (t, lg) => ZH[lg]?.[t.abbr] ?? t.short ?? t.name;
const badge = (league) => `<span class="lg lg-${esc(league.id)}">${esc(league.name)}</span>`;
const tagsHtml = (tags) => tags.map((t) => `<span class="tag tag-${t}">${TAG[t]}</span>`).join('');

// Relative paths so the same page works on the local server and under a GitHub Pages subpath.
async function api(endpoint) {
  const res = await fetch(`api/${endpoint}.json`, { cache: 'no-cache' });
  if (res.status === 404) throw new Error('暂无数据');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

// ---------- formatting ----------
const dayKey = (d) => d.toLocaleDateString('en-CA');
function dayLabel(d) {
  const diff = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / 864e5);
  const rel = { '-1': '昨天 · ', 0: '今天 · ', 1: '明天 · ' }[diff] ?? '';
  return `${rel}${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleDateString('zh-CN', { weekday: 'short' })}`;
}
const hm = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const shortDate = (d) => `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleDateString('zh-CN', { weekday: 'short' })}`;
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
const weekOfLabel = (k) => `${Number(k.slice(4, 6))}/${Number(k.slice(6, 8))}`;
const rankOf = (g, side) => g.ranks?.[side] ?? (g[side].rank ? `#${g[side].rank}` : '');
const errorsHtml = (errs) => (errs?.length ? `<div class="error">部分数据加载失败：${errs.map(esc).join('；')}</div>` : '');

// ---------- shared game table (schedule + results use identical columns) ----------
const COLGROUP = '<colgroup><col class="c-lead"><col class="c-lg"><col><col class="c-mid"><col><col class="c-tg"><col class="c-end"></colgroup>';

const lostSide = (g, side) => g[side === 'away' ? 'home' : 'away'].winner === true;

function teamTd(g, side) {
  const t = g[side];
  const rk = rankOf(g, side);
  const cls = [side, g.focusIds.includes(t.id) ? 'focus' : '', g.status.completed && lostSide(g, side) ? 'lost' : ''].join(' ');
  return `<td class="team ${cls}"><div class="tmx"><img src="${esc(t.logo)}" alt="" loading="lazy" />
    <div class="tx"><span class="nm" title="${esc(t.name)}">${esc(teamName(t, g.league.id))}</span>${rk ? `<span class="rk">${esc(rk)}</span>` : ''}</div></div></td>`;
}

// rows: [{ g, lead, mid, end, attrs }] already sorted; inserts a day header whenever the date changes.
function gameTable(rows, after = () => '', cls = '') {
  let lastDay = '';
  const body = rows
    .map((r, i) => {
      const dt = new Date(r.g.date);
      const day = dayKey(dt);
      const sep = day !== lastDay ? `<tr class="day"><td colspan="7">${esc(dayLabel(dt))}</td></tr>` : '';
      lastDay = day;
      return `${sep}<tr class="row" data-i="${i}" ${r.attrs ?? ''}>
        <td class="lead">${r.lead}</td>
        <td class="lgc">${badge(r.g.league)}</td>
        ${teamTd(r.g, 'away')}
        <td class="mid">${r.mid}</td>
        ${teamTd(r.g, 'home')}
        <td class="tg">${tagsHtml(r.g.tags)}</td>
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
// Same rule as the server: hide started games; TBD kickoffs stay until their day is over.
const notStarted = (g) => (g.timeValid ? new Date(g.date) > Date.now() : dayKey(new Date(g.date)) >= dayKey(new Date()));
async function renderSchedule() {
  const el = $('#schedule-card');
  clearTimeout(scheduleTimer);
  try {
    const d = await api('schedule');
    d.games = d.games.filter((g) => notStarted(g));
    // Re-render right after the next kickoff so started games drop off while the page stays open.
    const next = d.games.filter((g) => g.timeValid).map((g) => new Date(g.date).getTime()).find((t) => t > Date.now());
    if (next) scheduleTimer = setTimeout(renderSchedule, Math.min(next - Date.now() + 5000, 2 ** 31 - 1));
    $('#sched-sub').textContent = `未来 ${d.daysAhead} 天 · 每天更新`;
    const rows = d.games.map((g) => ({
      g,
      lead: g.timeValid ? esc(hm(new Date(g.date))) : '待定',
      mid: '<span class="at">@</span>',
      end: g.broadcasts.map((b) => `<span class="bc">${esc(b)}</span>`).join(''),
      endTitle: [g.broadcasts.join(' / '), g.note].filter(Boolean).join(' · '),
    }));
    el.innerHTML = `
      ${teamChips(d.teams, (t) => t.record ?? '')}
      <details class="rules">
        <summary><span class="tag tag-marquee">强强</span>对话规则</summary>
        <div class="quals">${d.qualifiers
          .map((q) => `<div class="qual">
            <div class="qh">${badge(q.league)}${esc(q.criteria)} <span class="sub">· ${q.fixed ? '固定名单' : `${weekOfLabel(q.weekOf)} 周一排名`}</span></div>
            <div class="chips">${q.teams
              .map((t) => `<span class="chip" title="${esc(t.name)}"><img src="${esc(t.logo)}" alt="" />${t.label ? `<b>${esc(t.label)}</b>` : ''}${esc(teamName(t, q.league.id))} ${esc(t.record ?? '')}</span>`)
              .join('') || '<span class="empty">暂无符合条件的球队</span>'}</div>
          </div>`)
          .join('')}</div>
      </details>
      ${errorsHtml(d.errors)}
      ${rows.length ? gameTable(rows, undefined, 'sched') : `<div class="empty">未来 ${d.daysAhead} 天没有比赛</div>`}
      <div class="foot-note">生成于 ${esc(new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }))}</div>`;
    el.querySelectorAll('tr.row').forEach((tr) => {
      const g = rows[Number(tr.dataset.i)].g;
      if (g.link) tr.addEventListener('click', () => window.open(g.link, '_blank', 'noopener'));
    });
  } catch (err) {
    el.innerHTML = `<div class="error">赛程加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- results + box scores ----------
function resultCells(g) {
  const focus = [g.away, g.home].find((t) => g.focusIds.includes(t.id));
  const tie = g.away.score === g.home.score;
  const res = focus ? (tie ? 'T' : focus.winner ? 'W' : 'L') : null;
  const sc = (side) => `<span class="sc ${lostSide(g, side) ? 'lost' : ''}">${esc(g[side].score ?? '')}</span>`;
  const detail = g.status.detail ?? '';
  const ot = /Pen|PK|SO/i.test(detail) ? '点球' : /AET/i.test(detail) ? '加时' : detail.match(/\/(\d*OT)/)?.[1]?.replace(/^OT$/, '加时');
  return {
    g,
    lead: res ? `<span class="res ${res}">${{ W: '胜', L: '负', T: '平' }[res]}</span>` : '<span class="fin">完赛</span>',
    mid: `${sc('away')}<span class="colon">:</span>${sc('home')}${ot ? `<span class="ot">${esc(ot)}</span>` : ''}`,
    end: '<span class="chev">▾</span>',
    attrs: 'aria-expanded="false"',
  };
}

function statTable(labels, descriptions, players, totals, translate) {
  const head = labels.map((l, i) => `<th title="${esc(descriptions[i] ?? '')}">${esc(translate?.[l] ?? l)}</th>`).join('');
  let benchMarked = false;
  const rows = players
    .map((p) => {
      const bench = translate && !p.starter && !benchMarked && (benchMarked = true);
      return `<tr class="${bench ? 'bench' : ''}"><td class="pl" title="${esc(p.name)}">${esc(p.short)}${p.pos ? `<span class="pos">${esc(p.pos)}</span>` : ''}</td>${p.stats.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>`;
    })
    .join('');
  const total = totals?.some(Boolean) ? `<tr class="total"><td class="pl">合计</td>${totals.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>` : '';
  return `<div class="scroll"><table class="stats"><thead><tr><th class="pl">球员</th>${head}</tr></thead><tbody>${rows}${total}</tbody></table></div>`;
}

function teamBox(t, leagueId) {
  if (leagueId === 'nba') {
    const g = t.groups[0];
    if (!g) return '<div class="empty">暂无数据</div>';
    const played = g.players.filter((p) => !p.dnp);
    const dnp = g.players.filter((p) => p.dnp);
    return (
      statTable(g.labels, g.descriptions, played, g.totals, NBA_LABELS) +
      (dnp.length ? `<div class="dnp">未上场：${dnp.map((p) => `${esc(p.short)}${p.reason ? `（${esc(p.reason.toLowerCase())}）` : ''}`).join('、')}</div>` : '')
    );
  }
  const groups = Object.keys(FB_GROUPS)
    .map((key) => t.groups.find((g) => g.key === key))
    .filter((g) => g?.players.length);
  if (!groups.length) return '<div class="empty">暂无数据</div>';
  return groups
    .map((g) => {
      // ESPN sorts defenders by tackles; the long tail is noise.
      const players = g.key === 'defensive' ? g.players.slice(0, 8) : g.players;
      const title = g.key === 'defensive' && g.players.length > 8 ? `${FB_GROUPS[g.key]} <span class="sub">（擒抱前 8）</span>` : FB_GROUPS[g.key];
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
      const kind = x.ownGoal ? '<span class="gk">乌龙</span>' : x.penalty ? '<span class="gk">点球</span>' : '';
      return `<tr><td class="min">${esc(x.minute)}</td>
        <td class="gt">${t ? `<img src="${esc(t.logo)}" alt="" />${esc(teamName(t, g.league.id))}` : ''}</td>
        <td class="gs">⚽ ${esc(x.scorer)}${kind}</td>
        <td class="ga">${x.assist ? `助攻 ${esc(x.assist)}` : ''}</td></tr>`;
    })
    .join('');
  const so = data.shootout
    ? `<div class="so">点球大战 ${esc(teamName(g.away, g.league.id))} ${esc(data.shootout[g.away.id] ?? '-')} : ${esc(data.shootout[g.home.id] ?? '-')} ${esc(teamName(g.home, g.league.id))}</div>`
    : '';
  return `${rows ? `<table class="goals"><tbody>${rows}</tbody></table>` : '<div class="empty">本场没有进球</div>'}${so}
    ${g.link ? `<div class="box-foot"><a class="ext" href="${esc(g.link)}" target="_blank" rel="noopener">ESPN ↗</a></div>` : ''}`;
}

const boxCache = new Map();
async function toggleBox(tr, boxRow, g) {
  const box = boxRow.querySelector('.box');
  const open = boxRow.hidden;
  boxRow.hidden = !open;
  tr.setAttribute('aria-expanded', String(open));
  if (!open || box.dataset.loaded) return;
  box.innerHTML = '<div class="loading">加载技术统计…</div>';
  try {
    const key = `${g.league.id}:${g.id}`;
    if (!boxCache.has(key)) boxCache.set(key, api(`boxscore/${g.league.id}/${g.league.comp ?? '_'}/${g.id}`));
    const data = await boxCache.get(key);
    if (data.goals) {
      box.innerHTML = goalsBox(data, g);
      box.dataset.loaded = '1';
      return;
    }
    // Away first, matching the row; default tab = followed team when there is one.
    const teams = [g.away, g.home].map((s) => data.teams.find((t) => t.team.id === s.id)).filter(Boolean);
    if (!teams.length) throw new Error('暂无技术统计');
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
    box.innerHTML = `<div class="error">技术统计加载失败：${esc(err.message)}</div>`;
    boxCache.delete(`${g.league.id}:${g.id}`);
  }
}

async function renderResults() {
  const el = $('#results-card');
  try {
    const d = await api('results');
    $('#res-sub').textContent = `过去 ${d.daysBack} 天 · 点开看球员数据`;
    const rows = d.games.map(resultCells);
    // Followed teams' W-L over the window, shown like the schedule card's record chips.
    const wl = new Map();
    for (const g of d.games) {
      for (const t of [g.away, g.home].filter((x) => g.focusIds.includes(x.id))) {
        const r = wl.get(t.id) ?? { w: 0, l: 0, t: 0 };
        if (g.away.score === g.home.score) r.t++;
        else if (t.winner) r.w++;
        else r.l++;
        wl.set(t.id, r);
      }
    }
    const fmt = (t) => {
      const r = wl.get(t.id) ?? { w: 0, l: 0, t: 0 };
      return `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
    };
    el.innerHTML = `
      ${teamChips(d.teams, fmt)}
      ${errorsHtml(d.errors)}
      ${rows.length ? gameTable(rows, () => '<tr class="box-row" hidden><td colspan="7"><div class="box"></div></td></tr>') : `<div class="empty">过去 ${d.daysBack} 天没有比赛</div>`}
      <div class="foot-note">数据更新于 ${esc(new Date(d.builtAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false }))}</div>`;
    el.querySelectorAll('tr.row').forEach((tr) => {
      const g = rows[Number(tr.dataset.i)].g;
      tr.addEventListener('click', () => toggleBox(tr, tr.nextElementSibling, g));
    });
  } catch (err) {
    el.innerHTML = `<div class="error">战绩加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- news ----------
async function renderNews() {
  const el = $('#news-list');
  try {
    const { enabled, articles } = await api('news');
    $('#news').hidden = !enabled;
    $('#nav-news').hidden = !enabled;
    if (!enabled) return;
    const item = (a) => `<div class="news-item">
      <a href="${esc(a.link)}" target="_blank" rel="noopener">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" />` : '<div class="noimg"></div>'}</a>
      <div>
        <a href="${esc(a.link)}" target="_blank" rel="noopener"><h4>${esc(a.headline)}</h4></a>
        <p>${esc(a.description)}</p>
        <div class="nmeta">${badge(a.league)}<span class="badge ${esc(a.type)}">${esc(NEWS_TYPE[a.type] ?? a.type)}</span>${esc(timeAgo(a.published))}${a.byline ? ` · ${esc(a.byline)}` : ''}</div>
      </div></div>`;
    const PAGE = 8;
    let shown = PAGE;
    const draw = () => {
      el.innerHTML =
        (articles.length ? articles.slice(0, shown).map(item).join('') : '<div class="empty">暂无新闻</div>') +
        (shown < articles.length ? '<div class="news-more"><button>加载更多</button></div>' : '');
      el.querySelector('.news-more button')?.addEventListener('click', () => { shown += PAGE; draw(); });
    };
    draw();
  } catch (err) {
    el.innerHTML = `<div class="error">新闻加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- highlights ----------
async function renderHighlights() {
  const el = $('#hl-wrap');
  try {
    const { games, daysBack, roundups = [] } = await api('highlights');
    $('#hl-sub').textContent = `最近 ${daysBack} 天`;
    const gameCards = games
      .map(({ game: g, videos }) => {
        const lg = g.league.id;
        const focus = [g.home, g.away].find((t) => g.focusIds.includes(t.id)) ?? g.home;
        const opp = focus === g.home ? g.away : g.home;
        const res = focus.winner === true ? 'W' : focus.winner === false && opp.winner === true ? 'L' : 'T';
        const v = videos[0];
        const d = new Date(g.date);
        return `<div class="hl">
          ${v
            ? `<a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /></a>`
            : '<div class="thumb none">集锦暂未上线</div>'}
          <div class="body">
            <div class="line1">${badge(g.league)}
              <img src="${esc(focus.logo)}" alt="" />${esc(teamName(focus, lg))}
              <span class="vs">${focus === g.away ? '@' : 'vs'}</span>
              <img src="${esc(opp.logo)}" alt="" />${esc(teamName(opp, lg))}</div>
            <div class="line2">
              <span>${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}${v?.extended ? ' · 加长版' : ''}</span>
              <span class="res ${res}">${{ W: '胜', L: '负', T: '平' }[res]} ${esc(focus.score)}-${esc(opp.score)}</span>
            </div>
            ${videos.length > 1 ? `<div class="alt">其他版本：${videos.slice(1).map((x, i) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}">${x.extended ? '加长版' : `版本${i + 2}`} ↗</a>`).join('')}</div>` : ''}
          </div></div>`;
      })
      .join('');
    // League-wide compilations: NBA nightly recap / top plays, NFL top 15 of the week.
    const roundupCards = roundups
      .map((r) => {
        const v = r.video;
        const when = r.period.week
          ? `第 ${r.period.week} 周`
          : new Date(r.period.sortDate).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'America/New_York' });
        return `<div class="hl">
          <a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /></a>
          <div class="body">
            <div class="line1">${badge(r.league)}${esc(r.label)}</div>
            <div class="line2"><span>${esc(when)}</span></div>
          </div></div>`;
      })
      .join('');
    el.innerHTML = `
      <div class="hl-group">关注球队</div>
      ${gameCards ? `<div class="hl-grid">${gameCards}</div>` : `<div class="empty">最近 ${daysBack} 天关注球队没有比赛</div>`}
      ${roundupCards ? `<div class="hl-group">精选 <small>每日回顾 · 每晚十佳球 · NFL 每周 15 佳球</small></div><div class="hl-grid">${roundupCards}</div>` : ''}`;
  } catch (err) {
    el.innerHTML = `<div class="error">集锦加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- app ----------
async function loadAll() {
  await Promise.all([renderSchedule(), renderResults(), renderNews(), renderHighlights()]);
  const built = await api('results').then((d) => d.builtAt).catch(() => null);
  $('#updated').textContent = built ? `数据更新于 ${new Date(built).toLocaleString('zh-CN', { hour12: false })}` : '';
}
loadAll();
