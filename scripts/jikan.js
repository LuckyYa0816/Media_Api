const axios = require('axios');
const fs = require('fs');
const path = require('path');

const JIKAN_API = 'https://api.jikan.moe/v4';
const FRIBB_LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function fetchCurrentSeason(page = 1) {
  const res = await axios.get(`${JIKAN_API}/seasons/now`, {
    params: { page, limit: 25 },
    timeout: 15000,
  });
  return res.data.data || [];
}

async function buildTmdbMap() {
  console.log('📥 下载 Fribb 对照表...');
  const res = await axios.get(FRIBB_LIST_URL, { timeout: 30000 });
  const map = new Map();
  for (const entry of res.data) {
    if (!entry.mal_id) continue;
    map.set(entry.mal_id, {
      tmdb_id: entry.themoviedb_id || null,
      tmdb_type: entry.type === 'movie' ? 'movie' : 'tv',
    });
  }
  console.log(`✅ 对照表加载完毕（按 MAL ID），共 ${map.size} 条记录`);
  return map;
}

async function fetchZhTitle(tmdbId, tmdbType) {
  if (!TMDB_API_KEY) return null;
  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}`,
      {
        params: { api_key: TMDB_API_KEY, language: 'zh-CN' },
        timeout: 8000,
      }
    );
    return tmdbType === 'tv' ? (res.data.name || null) : (res.data.title || null);
  } catch {
    return null;
  }
}

async function runWithConcurrency(tasks, limit = 5) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
      await new Promise(r => setTimeout(r, 250));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('📥 获取 Jikan 当季在播番剧...');

  const page1 = await fetchCurrentSeason(1);
  await delay(400);
  const page2 = await fetchCurrentSeason(2);

  const rawList = [...page1, ...page2]
    .filter(item => item.type === 'TV')
    .filter(item => !item.explicit)
    .sort((a, b) => (b.members || 0) - (a.members || 0))
    .slice(0, 30);

  console.log(`✅ 过滤后共 ${rawList.length} 部番剧`);

  const tmdbMap = await buildTmdbMap();

  const validItems = rawList.filter(item => tmdbMap.get(item.mal_id)?.tmdb_id);

  const tasks = validItems.map((item, i) => async () => {
    const mapping = tmdbMap.get(item.mal_id);

    const zhTitle = await fetchZhTitle(mapping.tmdb_id, mapping.tmdb_type);
    const fallbackTitle = item.title_english || item.title || item.title_japanese;
    const title = zhTitle || fallbackTitle;

    console.log(`  [${String(i + 1).padStart(2, '0')}] ${title} → TMDB ${mapping.tmdb_type}/${mapping.tmdb_id}`);

    return {
      tmdb_id: mapping.tmdb_id,
      tmdb_type: mapping.tmdb_type,
      title,
      sort: i + 1,
    };
  });

  const list = await runWithConcurrency(tasks, 5);

  const output = {
    remark: {
      description: 'Jikan（MyAnimeList）当季在播番剧，按收藏人数排序',
      sources: [
        { platform: 'Jikan', url: 'https://jikan.moe', note: 'MyAnimeList 非官方 REST API，提供当季在播番剧数据' },
        { platform: 'Fribb anime-lists', url: 'https://github.com/Fribb/anime-lists', note: '提供 MAL ID 到 TMDB ID 的对照映射' },
      ],
      update_cron: '30 23/30 8 * * *',
      update_frequency: '每天 07:30 和 16:30（北京时间）各更新一次',
    },
    platform: 'jikan',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jikan.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 已写入: ${outPath}`);
  console.log(`📊 TMDB 命中率: ${list.length}/${rawList.length}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
