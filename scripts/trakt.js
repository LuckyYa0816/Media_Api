const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TRAKT_API = 'https://api.trakt.tv';
const CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const ACCESS_TOKEN = process.env.TRAKT_ACCESS_TOKEN;

if (!CLIENT_ID || !ACCESS_TOKEN) {
  console.error('❌ 缺少 TRAKT_CLIENT_ID 或 TRAKT_ACCESS_TOKEN');
  process.exit(1);
}

const TRAKT_HEADERS = {
  'Content-Type': 'application/json',
  'trakt-api-version': '2',
  'trakt-api-key': CLIENT_ID,
  'Authorization': `Bearer ${ACCESS_TOKEN}`,
};

async function fetchContinueWatching() {
  const [showsRes, moviesRes] = await Promise.all([
    axios.get(`${TRAKT_API}/sync/progress/watched/shows`, {
      headers: TRAKT_HEADERS,
      params: { limit: 30 },
      timeout: 10000,
    }),
    axios.get(`${TRAKT_API}/sync/progress/watched/movies`, {
      headers: TRAKT_HEADERS,
      params: { limit: 30 },
      timeout: 10000,
    }),
  ]);

  return {
    shows: showsRes.data || [],
    movies: moviesRes.data || [],
  };
}

async function main() {
  console.log('📥 获取 Trakt Continue Watching...');
  const { shows, movies } = await fetchContinueWatching();
  console.log(`✅ 剧集: ${shows.length} 部，电影: ${movies.length} 部`);

  const showItems = shows
    .filter(item => item.show?.ids?.tmdb)
    .map((item, i) => {
      console.log(`  [TV] ${item.show.title} → TMDB/${item.show.ids.tmdb}`);
      return {
        tmdb_id: item.show.ids.tmdb,
        tmdb_type: 'tv',
        title: item.show.title,
        sort: i + 1,
      };
    });

  const movieItems = movies
    .filter(item => item.movie?.ids?.tmdb)
    .map((item, i) => {
      console.log(`  [Movie] ${item.movie.title} → TMDB/${item.movie.ids.tmdb}`);
      return {
        tmdb_id: item.movie.ids.tmdb,
        tmdb_type: 'movie',
        title: item.movie.title,
        sort: showItems.length + i + 1,
      };
    });

  const list = [...showItems, ...movieItems];
  console.log(`\n📊 共 ${list.length} 部正在观看的内容`);

  const output = {
    remark: {
      description: '我正在看的影视，包含有观看进度但未完成的剧集和电影',
      sources: [
        {
          platform: 'Trakt',
          url: 'https://trakt.tv',
          note: '通过 Continue Watching 接口获取有观看进度的内容，数据自带 TMDB ID，无需额外匹配',
        },
      ],
      update_cron: '30 23/30 8 * * *',
      update_frequency: '每天 07:30 和 16:30（北京时间）各更新一次',
    },
    platform: 'trakt',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'trakt.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
