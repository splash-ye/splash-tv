// Chinese news from 直播吧 (zhibo8.com): one public JSON feed with every NBA / soccer story
// of the last 24 hours (~1200 items), tagged by team. Unofficial and keyless, like the ESPN API.
import { cached, fetchJson } from './util.js';

const FEED = 'https://m.zhibo8.com/json/hot/24hours.htm';
const MIN = 60 * 1000;
// League-wide pieces (power rankings, betting previews) carry a tag for every team; skip them.
const MAX_TAGS = 6;

const getFeed = () => cached('zhibo8:24h', 10 * MIN, async () => (await fetchJson(FEED)).news ?? []);

// "2026-11-10 08:45:24" is Beijing time.
const parseTime = (s) => new Date(`${s.replace(' ', 'T')}+08:00`).toISOString();

// type: 'nba' | 'zuqiu'. tags: zhibo8 team tags, e.g. ['勇士'] or ['曼城', '皇家马德里', ...].
// Keeps the `perTag` most-read stories (PC page views) for each tag; a story shared by two tags counts once.
export async function getZhibo8News(type, tags, perTag) {
  const items = (await getFeed())
    .filter((x) => x.type === type && x.url && x.model === 'news')
    .map((x) => ({ x, tags: (x.label ?? x.lable ?? '').split(',') }))
    .filter((e) => e.tags.length <= MAX_TAGS)
    .sort((a, b) => (Number(b.x.pc_uv_count) || 0) - (Number(a.x.pc_uv_count) || 0) || (a.x.createtime < b.x.createtime ? 1 : -1));
  const picked = new Map();
  for (const tag of tags) {
    let n = 0;
    for (const { x, tags: t } of items) {
      if (n >= perTag) break;
      if (!t.includes(tag) || picked.has(x.filename)) continue;
      picked.set(x.filename, { x, tag });
      n++;
    }
  }
  return [...picked.values()].map(({ x, tag }) => ({
    id: `zb8:${x.filename}`,
    type: null,
    headline: x.title,
    description: '',
    published: parseTime(x.createtime),
    byline: x.from_name && x.from_name !== '直播吧' ? `直播吧 · ${x.from_name}` : '直播吧',
    image: x.thumbnail ? x.thumbnail.replace(/^http:/, 'https:') : null,
    link: `https://news.zhibo8.com${x.url}`,
    premium: false,
    tag,
  }));
}
