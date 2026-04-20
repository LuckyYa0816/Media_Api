const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';
const FRIBB_LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

// 查询国产动漫，不限季度，按人气排序
const QUERY = `
query ($page: Int) {
  Page(page: $page, perPage: 30) {
    media(
      type: ANIME
      countryOfOrigin: "CN"
      sort: [POPULARITY_DESC]
      isAdult: false
    ) {
      id
      title {
        romaji
        english
        native
      }
    }
  }
}
`;

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

async function main() {
  console.log('📥 获取 AniList 国产动漫...');

  const [anilistRes, tmdbMap] = await Promise.all([
    axios.post(
      ANILIST_API,
      { query: QUERY, variables: { page: 1 } },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 }
    ),
    buildTmdbMap(),
  ]);

  if (anilistRes.data.errors) throw new Error(JSON.stringify(anilistRes.data.errors));

  const rawList = anilistRes.data.data.Page.media;
  console.log(`✅ AniList 返回 ${rawList.length} 部国产动漫`);

  const list = rawList
    .filter(item => tmdbMap.get(item.id)?.tmdb_id)
    .map((item, i) => {
      const mapping = tmdbMap.get(item.id);
      const title = item.title.english || item.title.romaji || item.title.native;
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
      description: 'AniList 国产动漫，按人气排序',
      sources: [
        { platform: 'AniList', url: 'https://graphql.anilist.co', note: '通过 countryOfOrigin: CN 筛选国产动漫' },
        { platform: 'Fribb anime-lists', url: 'https://github.com/Fribb/anime-lists', note: '提供 AniList ID 到 TMDB ID 的对照映射' },
      ],
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
    },
    platform: 'anilist',
    category: 'anime_cn',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'anilist-anime-cn.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 已写入: ${outPath}`);
  console.log(`📊 TMDB 命中率: ${list.length}/${rawList.length}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
