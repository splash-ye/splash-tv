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
const NBA_LABELS = {
  MIN: '时间', PTS: '得分', FG: '投篮', '3PT': '三分', FT: '罚球', REB: '篮板', AST: '助攻', TO: '失误',
  STL: '抢断', BLK: '盖帽', OREB: '前板', DREB: '后板', PF: '犯规',
};
const FB_GROUPS = { passing: '传球', rushing: '冲球', receiving: '接球', defensive: '防守', interceptions: '抄截', kicking: '踢球' };

const teamName = (t, lg) => ZH[lg]?.[t.abbr] ?? t.short ?? t.name;
const badge = (league) => `<span class="lg lg-${esc(league.id)}">${esc(league.name)}</span>`;

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
const errorsHtml = (errs) => (errs?.length ? `<div class="error">部分数据加载失败：${errs.map(esc).join('；')}</div>` : '');

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
      return new Set(JSON.parse(localStorage.getItem('hiddenGames') || '[]'));
    } catch {
      return new Set();
    }
  },
  save(set) {
    try {
      localStorage.setItem('hiddenGames', JSON.stringify([...set]));
    } catch {}
  },
};

async function renderSchedule() {
  const el = $('#schedule-card');
  clearTimeout(scheduleTimer);
  try {
    const d = await api('schedule');
    // Forget removed games that have left the schedule so the list doesn't grow forever.
    const hidden = hiddenGames.load();
    const upcoming = new Set(d.games.map(gameKey));
    const kept = new Set([...hidden].filter((k) => upcoming.has(k)));
    if (kept.size !== hidden.size) hiddenGames.save(kept);
    d.games = d.games.filter((g) => !kept.has(gameKey(g)));
    // Re-render right after the next kickoff so the game flips to 进行中 while the page stays open.
    const next = d.games.filter((g) => g.timeValid).map((g) => new Date(g.date).getTime()).find((t) => t > Date.now());
    if (next) scheduleTimer = setTimeout(renderSchedule, Math.min(next - Date.now() + 5000, 2 ** 31 - 1));
    $('#sched-sub').textContent = `未来 ${d.daysAhead} 天 · 每天更新`;
    const rows = d.games.map((g) => ({
      g,
      lead: started(g) ? `<span class="live" title="${esc(hm(new Date(g.date)))} 开赛">进行中</span>` : g.timeValid ? esc(hm(new Date(g.date))) : '待定',
      mid: '<span class="at">@</span>',
      end: `<div class="endx"><div class="bcs">${g.broadcasts.map((b) => `<span class="bc">${esc(b)}</span>`).join('')}</div>
        <button class="rm" title="移除这场比赛" aria-label="移除这场比赛">×</button></div>`,
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
      <div class="foot-note">${kept.size ? `已移除 ${kept.size} 场 · <button class="restore">恢复</button> · ` : ''}生成于 ${esc(new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }))}</div>`;
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

// ---------- results card: tabs (results | NBA standings | NFL standings) ----------
const CONF_ZH = { 'Eastern Conference': '东部', 'Western Conference': '西部' };
const DIR_ZH = { East: '东区', West: '西区', North: '北区', South: '南区' };
const groupZh = (name) => CONF_ZH[name] ?? name.replace(/^(AFC|NFC)\s+(East|West|North|South)$/, (_, c, d) => `${c}${DIR_ZH[d]}`);
const pct = (x) => x.toFixed(3).replace(/^0/, '');
const streakZh = (s) => (s?.match(/^([WL])(\d+)$/) ? `${s.slice(1)}连${s[0] === 'W' ? '胜' : '败'}` : s ?? '');

function standingsHtml(lg) {
  const conf = lg.kind === 'conference';
  const head = conf
    ? '<th class="n">#</th><th class="tm">球队</th><th>胜</th><th>负</th><th>胜率</th><th>胜差</th><th class="opt">近10场</th><th class="opt">连胜/败</th>'
    : '<th class="tm">球队</th><th>胜</th><th>负</th><th>平</th><th>胜率</th><th>净胜分</th><th class="opt">连胜/败</th>';
  const row = (t, i) => {
    // NBA: 1-6 direct playoff spots, 7-10 play-in; draw a line under 6 and 10.
    const cut = conf && (i === 5 || i === 9) ? ' cut' : '';
    const team = `<td class="tm"><img src="${esc(t.logo)}" alt="" loading="lazy" />${esc(teamName(t, lg.id))}</td>`;
    const cells = conf
      ? `<td class="n">${t.seed < 99 ? t.seed : i + 1}</td>${team}<td>${t.wins}</td><td>${t.losses}</td><td>${pct(t.winPercent)}</td><td>${esc(t.gamesBehind)}</td><td class="opt">${esc(t.last10)}</td><td class="opt">${esc(streakZh(t.streak))}</td>`
      : `${team}<td>${t.wins}</td><td>${t.losses}</td><td>${t.ties}</td><td>${pct(t.winPercent)}</td><td>${esc(t.diff)}</td><td class="opt">${esc(streakZh(t.streak))}</td>`;
    return `<tr class="${t.followed ? 'mine' : ''}${cut}">${cells}</tr>`;
  };
  return `<div class="stand-groups ${lg.kind}">${lg.groups
    .map((g) => `<div class="stand-group"><div class="grp">${esc(groupZh(g.name))}</div>
      <table class="stand"><thead><tr>${head}</tr></thead><tbody>${g.teams.map(row).join('')}</tbody></table></div>`)
    .join('')}</div>${conf ? '<div class="foot-note left">1–6 名直接进季后赛，7–10 名打附加赛</div>' : ''}`;
}

let resultsTab = (() => {
  try {
    return localStorage.getItem('resultsTab') || 'results';
  } catch {
    return 'results';
  }
})();

async function renderResults() {
  const el = $('#results-card');
  const [d, st] = await Promise.all([api('results').catch((err) => ({ err })), api('standings').catch(() => ({ leagues: [] }))]);
  const tabs = [{ key: 'results', label: '战绩' }, ...st.leagues.map((l) => ({ key: l.id, label: `${l.name} 排名` }))];
  if (!tabs.some((t) => t.key === resultsTab)) resultsTab = 'results';

  const draw = () => {
    const seg = `<div class="seg card-tabs">${tabs
      .map((t) => `<button data-k="${t.key}" class="${t.key === resultsTab ? 'active' : ''}">${esc(t.label)}</button>`)
      .join('')}</div>`;
    if (resultsTab === 'results') {
      $('#res-sub').textContent = d.err ? '' : `过去 ${d.daysBack} 天 · 点开看球员数据`;
      if (d.err) {
        el.innerHTML = `${seg}<div class="error">战绩加载失败：${esc(d.err.message)}</div>`;
      } else {
        const rows = d.games.map(resultCells);
        el.innerHTML = `${seg}
          ${errorsHtml(d.errors)}
          ${rows.length ? gameTable(rows, () => '<tr class="box-row" hidden><td colspan="6"><div class="box"></div></td></tr>') : `<div class="empty">过去 ${d.daysBack} 天没有比赛</div>`}
          <div class="foot-note">数据更新于 ${esc(new Date(d.builtAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false }))}</div>`;
        el.querySelectorAll('tr.row').forEach((tr) => {
          const g = rows[Number(tr.dataset.i)].g;
          tr.addEventListener('click', () => toggleBox(tr, tr.nextElementSibling, g));
        });
      }
    } else {
      const lg = st.leagues.find((l) => l.id === resultsTab);
      $('#res-sub').textContent = `${lg.name} ${lg.kind === 'conference' ? '东西部' : '分区'}排名`;
      el.innerHTML = `${seg}${standingsHtml(lg)}
        <div class="foot-note">数据更新于 ${esc(new Date(st.builtAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false }))}</div>`;
    }
    el.querySelectorAll('.card-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        resultsTab = b.dataset.k;
        try {
          localStorage.setItem('resultsTab', resultsTab);
        } catch {}
        draw();
      }),
    );
  };
  draw();
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
            : '<div class="thumb none">集锦暂未上线</div>'}
          <div class="body">
            <div class="line1">${badge(g.league)}
              <img src="${esc(first.logo)}" alt="" />${esc(teamName(first, lg))}
              <span class="vs">${first === g.away ? '@' : 'vs'}</span>
              <img src="${esc(second.logo)}" alt="" />${esc(teamName(second, lg))}</div>
            <div class="line2">
              <span>${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}${v?.extended ? ' · 加长版' : ''}</span>
              ${res ? `<span class="res ${res}">${{ W: '胜', L: '负', T: '平' }[res]} ${esc(first.score)}-${esc(second.score)}</span>` : `<span class="score">${esc(first.score)}-${esc(second.score)}</span>`}
            </div>
            ${videos.length > 1 ? `<div class="alt">其他版本：${videos.slice(1).map((x, i) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}">${x.extended ? '加长版' : `版本${i + 2}`} ↗</a>`).join('')}</div>` : ''}
          </div></div>`;
      })() }));
    // League-wide compilations: NBA nightly recap / top plays, NFL top 15 of the week.
    const roundupCards = roundups.map((r) => {
        const v = r.video;
        const k = r.period.key;
        const when = r.period.week
          ? `第 ${r.period.week} 周`
          : new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
        return { sort: r.period.sortDate, html: `<div class="hl">
          <a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /></a>
          <div class="body">
            <div class="line1">${badge(r.league)}${esc(r.label)}</div>
            <div class="line2"><span>${esc(when)}</span></div>
          </div></div>` };
      });
    // Followed-team games and league roundups in one grid, newest first.
    const cards = [...gameCards, ...roundupCards].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
    el.innerHTML = cards.length ? `<div class="hl-grid">${cards.map((c) => c.html).join('')}</div>` : `<div class="empty">最近 ${daysBack} 天没有集锦</div>`;
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
