const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';
const FRIBB_LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const QUERY = `
query ($season: MediaSeason, $seasonYear: Int) {
  Page(page: 1, perPage: 30) {
    media(
      season: $season
      seasonYear: $seasonYear
      type: ANIME
      format_in: [TV, TV_SHORT]
      sort: [POPULARITY_DESC]
      isAdult: false
    ) {
      id
      idMal
      title {
        romaji
        english
        native
      }
    }
  }
}
`;

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  let season;
  if (month <= 3) season = 'WINTER';
  else if (month <= 6) season = 'SPRING';
  else if (month <= 9) season = 'SUMMER';
  else season = 'FALL';
  return { season, year };
}

async function buildTmdbMap() {
  console.log('📥 下载 Fribb 对照表...');
  const res = await axios.get(FRIBB_LIST_URL, { timeout: 30000 });
  const map = new Map();
  for (const entry of res.data) {
    if (!entry.anilist_id) continue;
    map.set(entry.anilist_id, {
      tmdb_id: entry.themoviedb_id || null,
      tmdb_type: entry.type === 'movie' ? 'movie' : 'tv',
    });
  }
  console.log(`✅ 对照表加载完毕，共 ${map.size} 条记录`);
  return map;
}

// 获取 TMDB 中文标题
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
      await new Promise(r => setTimeout(r, 200));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const { season, year } = getCurrentSeason();
  console.log(`📅 当前季度: ${year} ${season}`);

  const [anilistRes, tmdbMap] = await Promise.all([
    axios.post(
      ANILIST_API,
      { query: QUERY, variables: { season, seasonYear: year } },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 }
    ),
    buildTmdbMap(),
  ]);

  if (anilistRes.data.errors) throw new Error(JSON.stringify(anilistRes.data.errors));

  const rawList = anilistRes.data.data.Page.media;
  console.log(`✅ AniList 返回 ${rawList.length} 部番剧`);

  const validItems = rawList.filter(item => tmdbMap.get(item.id)?.tmdb_id);

  const tasks = validItems.map((item, i) => async () => {
    const mapping = tmdbMap.get(item.id);

    // 优先获取 TMDB 中文标题，失败则回退到英文/罗马音/日文
    const zhTitle = await fetchZhTitle(mapping.tmdb_id, mapping.tmdb_type);
    const fallbackTitle = item.title.english || item.title.romaji || item.title.native;
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
      description: 'AniList 当季热播番剧，按人气排序',
      sources: [
        { platform: 'AniList', url: 'https://graphql.anilist.co', note: '提供番剧基础数据及人气排名' },
        { platform: 'Fribb anime-lists', url: 'https://github.com/Fribb/anime-lists', note: '提供 AniList ID 到 TMDB ID 的对照映射' },
      ],
      update_cron: '30 23/30 8 * * *',
      update_frequency: '每天 07:30 和 16:30（北京时间）各更新一次',
    },
    platform: 'anilist',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'anilist.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 已写入: ${outPath}`);
  console.log(`📊 TMDB 命中率: ${list.length}/${rawList.length}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
