const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY;

if (!API_KEY) {
  console.error('❌ 缺少 TMDB_API_KEY 环境变量');
  process.exit(1);
}

// 需要获取的流媒体平台 watch_provider id
// 常见平台：8=Netflix 9=Amazon 337=Disney+ 15=Hulu 384=HBO Max 2=Apple TV+
const STREAMING_PROVIDER_IDS = [8, 9, 337, 15, 384, 2];
const STREAMING_PROVIDER_NAMES = {
  8: 'Netflix',
  9: 'Amazon Prime Video',
  337: 'Disney+',
  15: 'Hulu',
  384: 'Max',
  2: 'Apple TV+',
};

// 获取 TMDB 全球热门电视剧（Trending，按周）
async function fetchTrending(page = 1) {
  const res = await axios.get(`${TMDB_BASE}/trending/tv/week`, {
    params: { api_key: API_KEY, language: 'zh-CN', page },
    timeout: 10000,
  });
  return res.data.results || [];
}

// 获取某部剧的流媒体平台信息（仅取 US 区）
async function fetchWatchProviders(tvId) {
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tvId}/watch/providers`, {
      params: { api_key: API_KEY },
      timeout: 8000,
    });
    const us = res.data.results?.US || {};
    const flatrate = (us.flatrate || []).map(p => ({
      provider_id: p.provider_id,
      provider_name: p.provider_name,
      logo: `https://image.tmdb.org/t/p/original${p.logo_path}`,
    }));
    return flatrate;
  } catch {
    return [];
  }
}

// 获取某部剧的详情（补充 genres、首播年份等）
async function fetchTvDetail(tvId) {
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tvId}`, {
      params: { api_key: API_KEY, language: 'zh-CN' },
      timeout: 8000,
    });
    return res.data;
  } catch {
    return null;
  }
}

// 控制并发
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
  console.log('📥 获取 TMDB 本周热门电视剧...');

  // 获取前两页，共 40 部，过滤后取 30
  const [page1, page2] = await Promise.all([
    fetchTrending(1),
    fetchTrending(2),
  ]);
  const rawList = [...page1, ...page2].slice(0, 40);
  console.log(`✅ 共获取 ${rawList.length} 部候选剧集`);

  // 并发获取详情 + 流媒体信息
  const detailTasks = rawList.map((item, i) => async () => {
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${rawList.length}] ${item.name} ... `);
    const [detail, providers] = await Promise.all([
      fetchTvDetail(item.id),
      fetchWatchProviders(item.id),
    ]);

    // 只保留在主流流媒体平台上线的剧集
    const streamingProviders = providers.filter(p =>
      STREAMING_PROVIDER_IDS.includes(p.provider_id)
    );

    console.log(
      streamingProviders.length > 0
        ? streamingProviders.map(p => p.provider_name).join(', ')
        : 'no streaming'
    );

    return { item, detail, providers: streamingProviders };
  });

  const detailResults = await runWithConcurrency(detailTasks, 5);

  // 过滤：只保留有流媒体平台的剧集，取前 30
  const filtered = detailResults
    .filter(r => r.providers.length > 0)
    .slice(0, 30);

  console.log(`\n📊 有流媒体平台的剧集: ${filtered.length} 部`);

  const list = filtered.map(({ item, detail, providers }, i) => ({
    rank: i + 1,
    tmdb_id: item.id,
    tmdb_type: 'tv',
    title: {
      zh: item.name || null,
      original: item.original_name || null,
    },
    cover: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : null,
    backdrop: item.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : null,
    score: item.vote_average ? Math.round(item.vote_average * 10) / 10 : null,
    vote_count: item.vote_count || 0,
    popularity: item.popularity || 0,
    genres: detail?.genres?.map(g => g.name) || [],
    status: detail?.status || null,
    first_air_date: item.first_air_date || null,
    episode_runtime: detail?.episode_run_time?.[0] || null,
    seasons: detail?.number_of_seasons || null,
    origin_country: item.origin_country || [],
    original_language: item.original_language || null,
    overview: item.overview?.slice(0, 300) || null,
    streaming_providers: providers,
    url: `https://www.themoviedb.org/tv/${item.id}`,
  }));

  const output = {
    remark: {
      description: 'TMDB 本周全球热门流媒体电视剧，按热度排序，仅保留在主流流媒体平台上线的剧集',
      sources: [
        {
          platform: 'TMDB',
          url: 'https://www.themoviedb.org',
          note: '提供全球热门影视数据及流媒体平台信息（Watch Providers）',
        },
      ],
      streaming_platforms: STREAMING_PROVIDER_NAMES,
      region: 'US',
      update_cron: '0 */6 * * *',
      update_frequency: '每6小时更新一次',
    },
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'tmdb.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
