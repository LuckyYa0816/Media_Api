const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY;

const DOUBAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://movie.douban.com/',
  'Accept': 'application/json, text/plain, */*',
};

async function fetchHotMovies() {
  const res = await axios.get('https://movie.douban.com/j/search_subjects', {
    params: { type: 'movie', tag: '热门', sort: 'recommend', page_limit: 20, page_start: 0 },
    headers: DOUBAN_HEADERS,
    timeout: 15000,
  });
  const subjects = res.data.subjects || [];
  if (subjects.length === 0) throw new Error('豆瓣接口返回空数据，可能触发反爬');
  return subjects;
}

async function getDoubanDetail(doubanId) {
  try {
    const res = await axios.get(`https://movie.douban.com/subject/${doubanId}/`, {
      headers: DOUBAN_HEADERS,
      timeout: 10000,
    });
    const html = res.data;
    const imdbMatch = html.match(/IMDb[^t]*?(tt\d{7,})/);
    const yearMatch = html.match(/<span class="year">\((\d{4})\)<\/span>/);
    return {
      imdbId: imdbMatch ? imdbMatch[1] : null,
      year: yearMatch ? parseInt(yearMatch[1]) : null,
    };
  } catch {
    return { imdbId: null, year: null };
  }
}

async function getTmdbByImdb(imdbId) {
  if (!imdbId || !API_KEY) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      params: { api_key: API_KEY, external_source: 'imdb_id' },
      timeout: 8000,
    });
    const movies = res.data.movie_results || [];
    if (movies.length > 0) return { tmdb_id: movies[0].id, match_method: 'imdb_id' };
    return null;
  } catch {
    return null;
  }
}

async function searchTmdbByTitleYear(title, year) {
  if (!title || !API_KEY) return null;
  try {
    const params = { api_key: API_KEY, query: title, language: 'zh-CN' };
    if (year) params.primary_release_year = year;

    const res = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 8000 });
    const results = res.data.results || [];
    if (results.length === 0) return null;

    if (year) {
      const exact = results.find(r => r.title === title || r.original_title === title);
      if (exact) return { tmdb_id: exact.id, match_method: 'title_year' };
      return null;
    }
    return { tmdb_id: results[0].id, match_method: 'title_only' };
  } catch {
    return null;
  }
}

async function runWithConcurrency(tasks, limit = 3) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
      await new Promise(r => setTimeout(r, 300));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  console.log('📥 获取豆瓣综合热门电影...');

  const subjects = await fetchHotMovies();
  console.log(`✅ 获取 ${subjects.length} 部热门电影，开始匹配 TMDB ID...`);

  const tasks = subjects.map((item, i) => async () => {
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}] ${item.title} ... `);
    const { imdbId, year } = await getDoubanDetail(item.id);
    let tmdb = await getTmdbByImdb(imdbId);
    if (!tmdb) tmdb = await searchTmdbByTitleYear(item.title, year);
    console.log(tmdb ? `${tmdb.match_method} → TMDB/${tmdb.tmdb_id}` : 'not found');
    return {
      tmdb_id: tmdb?.tmdb_id || null,
      tmdb_type: 'movie',
      title: item.title,
      sort: i + 1,
    };
  });

  const rawList = await runWithConcurrency(tasks, 3);

  // 过滤掉没有匹配到 TMDB ID 的条目
  const list = rawList.filter(x => x.tmdb_id !== null);

  console.log(`\n📊 TMDB 命中率: ${list.length}/${rawList.length}`);

  const output = {
    remark: {
      description: '豆瓣综合热门电影，按豆瓣推荐排序，通过 IMDB ID 或标题+年份精准匹配 TMDB ID，匹配失败则跳过',
      sources: [
        { platform: '豆瓣', url: 'https://movie.douban.com', note: '通过豆瓣热门标签接口获取热门电影数据' },
        { platform: 'TMDB', url: 'https://www.themoviedb.org', note: '通过 IMDB ID 或标题+年份匹配 TMDB ID' },
      ],
      match_strategy: 'IMDB ID 精准匹配 → 标题+上映年份精确匹配 → 匹配失败则跳过不收录',
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
    },
    platform: 'douban',
    category: 'movie',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'douban-movie.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
