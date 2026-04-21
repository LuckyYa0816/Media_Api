const axios = require('axios');
const fs = require('fs');
const path = require('path');

const JIKAN_API = 'https://api.jikan.moe/v4';
const FRIBB_LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

// Jikan 有速率限制：3次/秒，60次/分钟，免费无需 Key
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
    // Fribb 表里有 mal_id 字段，Jikan 返回的是 MAL ID
    if (!entry.mal_id) continue;
    map.set(entry.mal_id, {
      tmdb_id: entry.themoviedb_id || null,
      tmdb_type: entry.type === 'movie' ? 'movie' : 'tv',
      anilist_id: entry.anilist_id || null,
    });
  }
  console.log(`✅ 对照表加载完毕（按 MAL ID），共 ${map.size} 条记录`);
  return map;
}

// Jikan 速率限制较严，请求之间需要间隔
async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('📥 获取 Jikan 当季在播番剧...');

  // 拉取前两页，共最多 50 部
  const [page1] = await Promise.all([fetchCurrentSeason(1)]);
  await delay(400);
  const page2 = await fetchCurrentSeason(2);

  const rawList = [...page1, ...page2]
    .filter(item => item.type === 'TV')           // 只保留 TV 类型
    .filter(item => !item.explicit)               // 过滤成人内容
    .sort((a, b) => (b.members || 0) - (a.members || 0))  // 按收藏人数排序
    .slice(0, 30);

  console.log(`✅ 过滤后共 ${rawList.length} 部番剧，开始匹配 TMDB ID...`);

  const tmdbMap = await buildTmdbMap();

  const list = rawList
    .filter(item => {
      const mapping = tmdbMap.get(item.mal_id);
      return mapping?.tmdb_id;
    })
    .map((item, i) => {
      const mapping = tmdbMap.get(item.mal_id);
      const title = item.title_english || item.title || item.title_japanese;
      console.log(`  [${String(i + 1).padStart(2, '0')}] ${title} → TMDB ${mapping.tmdb_type}/${mapping.tmdb_id}`);
      return {
        tmdb_id: mapping.tmdb_id,
        tmdb_type: mapping.tmdb_type,
        title,
        sort: i + 1,
      };
    });

  const output = {
    remark: {
      description: 'Jikan（MyAnimeList）当季在播番剧，按收藏人数排序',
      sources: [
        { platform: 'Jikan', url: 'https://jikan.moe', note: 'MyAnimeList 非官方 REST API，提供当季在播番剧数据' },
        { platform: 'Fribb anime-lists', url: 'https://github.com/Fribb/anime-lists', note: '提供 MAL ID 到 TMDB ID 的对照映射' },
      ],
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
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
