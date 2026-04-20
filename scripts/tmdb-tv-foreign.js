const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY;

if (!API_KEY) {
  console.error('❌ 缺少 TMDB_API_KEY 环境变量');
  process.exit(1);
}

const EXCLUDE_LANGUAGES = ['zh', 'ja', 'ko'];

const STREAMING_PROVIDER_IDS = [8, 9, 337, 15, 384, 2];
const STREAMING_PROVIDER_NAMES = {
  8: 'Netflix', 9: 'Amazon Prime Video', 337: 'Disney+',
  15: 'Hulu', 384: 'Max', 2: 'Apple TV+',
};

async function fetchTrending(page = 1) {
  const res = await axios.get(`${TMDB_BASE}/trending/tv/week`, {
    params: { api_key: API_KEY, language: 'zh-CN', page },
    timeout: 10000,
  });
  return res.data.results || [];
}

async function fetchWatchProviders(tvId) {
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tvId}/watch/providers`, {
      params: { api_key: API_KEY },
      timeout: 8000,
    });
    return ((res.data.results?.US?.flatrate) || [])
      .filter(p => STREAMING_PROVIDER_IDS.includes(p.provider_id))
      .map(p => ({
        provider_id: p.provider_id,
        provider_name: p.provider_name,
      }));
  } catch {
    return [];
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
  console.log('📥 获取 TMDB 本周热门外语剧...');

  const [page1, page2, page3] = await Promise.all([
    fetchTrending(1), fetchTrending(2), fetchTrending(3),
  ]);
  const rawList = [...page1, ...page2, ...page3]
    .filter(item => !EXCLUDE_LANGUAGES.includes(item.original_language));

  console.log(`✅ 过滤后候选外语剧: ${rawList.length} 部`);

  const tasks = rawList.map((item, i) => async () => {
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${rawList.length}] ${item.name} ... `);
    const providers = await fetchWatchProviders(item.id);
    console.log(providers.length > 0 ? providers.map(p => p.provider_name).join(', ') : 'no streaming');
    return { item, providers };
  });

  const results = await runWithConcurrency(tasks, 5);
  const filtered = results.filter(r => r.providers.length > 0).slice(0, 30);
  console.log(`\n📊 有流媒体平台的外语剧: ${filtered.length} 部`);

  const list = filtered.map(({ item }, i) => ({
    tmdb_id: item.id,
    tmdb_type: 'tv',
    title: item.name || item.original_name || null,
    sort: i + 1,
  }));

  const output = {
    remark: {
      description: 'TMDB 本周热门外语电视剧（排除中日韩），按热度排序，仅保留在主流流媒体平台上线的剧集',
      sources: [
        { platform: 'TMDB', url: 'https://www.themoviedb.org', note: '提供全球热门影视数据及流媒体平台信息' },
      ],
      streaming_platforms: STREAMING_PROVIDER_NAMES,
      excluded_languages: EXCLUDE_LANGUAGES,
      region: 'US',
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
    },
    platform: 'tmdb',
    category: 'tv_foreign',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'tmdb-tv-foreign.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
