// Static build for GitHub Pages: copies public/ to dist/ and writes every API response as JSON.
// Snapshots (weekly marquee lists, daily schedule, found highlights) live in data/ and are
// committed back to the repo by the workflow so they survive between runs.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, schedule, results, boxscore, news, highlights, refreshSnapshots } from './api.js';
import { flushHighlights } from './youtube.js';

const OUT = path.join(ROOT, 'dist');
const builtAt = new Date().toISOString();

async function writeJson(rel, data) {
  const file = path.join(OUT, 'api', rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

await rm(OUT, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await writeFile(path.join(OUT, '.nojekyll'), '');

await refreshSnapshots();
const [s, r, n, h] = await Promise.all([schedule(), results(), news(), highlights()]);
await writeJson('schedule.json', { ...s, builtAt });
await writeJson('results.json', { ...r, builtAt });
await writeJson('news.json', { ...n, builtAt });
await writeJson('highlights.json', { ...h, builtAt });

// Box scores can't be fetched on demand from a static site, so pre-render one per result.
let boxes = 0;
for (const g of r.games) {
  try {
    await writeJson(`boxscore/${g.league.id}/${g.league.comp ?? '_'}/${g.id}.json`, await boxscore(g.league.id, g.league.comp, g.id));
    boxes++;
  } catch (err) {
    console.warn(`[build] boxscore ${g.league.id} ${g.id}: ${err.message}`);
  }
}
await flushHighlights();

const found = h.games.filter((x) => x.videos.length).length;
console.log(`[build] ${s.games.length} upcoming, ${r.games.length} results (${boxes} box scores), ${n.articles.length} news, highlights ${found}/${h.games.length}`);
for (const e of [...(s.errors ?? []), ...(r.errors ?? [])]) console.warn(`[build] error: ${e}`);
