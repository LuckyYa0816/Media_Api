const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY;
const DOUBAN_URL = 'https://movie.douban.com/j/search_subjects';

const DOUBAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://movie.douban.com/',
  'Accept': 'application/json, text/plain, */*',
};

// 从豆瓣详情页提取 IMDB ID 和首播年份
async function getDoubanDetail(doubanId) {
  try {
    const res = await axios.get(`https://movie.douban.com/subject/${doubanId}/`, {
      headers: DOUBAN_HEADERS,
      timeout: 10000,
    });
    const html = res.data;

    // 提取 IMDB ID（格式：tt1234567）
    const imdbMatch = html.match(/IMDb[^t]*?(tt\d{7,})/);
    const imdbId = imdbMatch ? imdbMatch[1] : null;

    // 提取首播年份
    const yearMatch = html.match(/<span class="year">\((\d{4})\)<\/span>/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    return { imdbId, year };
  } catch {
    return { imdbId: null, year: null };
  }
}

// 通过 IMDB ID 查 TMDB（精准）
async function getTmdbByImdb(imdbId) {
  if (!imdbId || !API_KEY) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      params: { api_key: API_KEY, external_source: 'imdb_id' },
      timeout: 8000,
    });
    const tv = res.data.tv_results || [];
    if (tv.length > 0) return { tmdb_id: tv[0].id, match_method: 'imdb_id' };
    return null;
  } catch {
    return null;
  }
}

// 通过标题 + 年份搜索 TMDB（兜底，加年份降低误匹配率）
async function searchTmdbByTitleYear(title, year) {
  if (!title || !API_KEY) return null;
  try {
    const params = {
      api_key: API_KEY,
      query: title,
      language: 'zh-CN',
    };
    // 有年份时加上，严格限定
    if (year) params.first_air_date_year = year;

    const res = await axios.get(`${TMDB_BASE}/search/tv`, { params, timeout: 8000 });
    const results = res.data.results || [];

    if (results.length === 0) return null;

    // 有年份时：只接受名字完全一致的结果，避免误匹配
    if (year) {
      const exact = results.find(
        r => r.name === title || r.original_name === title
      );
      if (exact) return { tmdb_id: exact.id, match_method: 'title_year' };
      return null;   // 没有精确匹配则放弃，不用模糊结果
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
  console.log('📥 获取豆瓣热播国产剧...');

  const res = await axios.get(DOUBAN_URL, {
    params: { type: 'tv', tag: '国产剧', sort: 'recommend', page_limit: 20, page_start: 0 },
    headers: DOUBAN_HEADERS,
    timeout: 15000,
  });

  const subjects = res.data.subjects || [];
  if (subjects.length === 0) throw new Error('豆瓣接口返回空数据，可能触发反爬');
  console.log(`✅ 获取 ${subjects.length} 部热播国产剧，开始匹配 TMDB ID...`);

  const tasks = subjects.map((item, i) => async () => {
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}] ${item.title} ... `);

    // 第一步：获取豆瓣详情（IMDB ID + 年份）
    const { imdbId, year } = await getDoubanDetail(item.id);

    // 第二步：IMDB 精准匹配
    let tmdb = await getTmdbByImdb(imdbId);

    // 第三步：标题 + 年份搜索（兜底）
    if (!tmdb) {
      tmdb = await searchTmdbByTitleYear(item.title, year);
    }

    console.log(tmdb ? `${tmdb.match_method} → TMDB/${tmdb.tmdb_id}` : 'not found');

    return {
      tmdb_id: tmdb?.tmdb_id || null,
      tmdb_type: 'tv',
      title: item.title,
      sort: i + 1,
      douban_id: item.id,
      match_method: tmdb?.match_method || null,
    };
  });

  const list = await runWithConcurrency(tasks, 3);

  const matched = list.filter(x => x.tmdb_id).length;
  console.log(`\n📊 TMDB 命中率: ${matched}/${list.length}`);

  // 输出时去掉 match_method，保持和其他文件格式一致
  const cleanList = list.map(({ match_method, douban_id, ...rest }) => rest);

  const output = {
    remark: {
      description: '豆瓣热播国产剧，按豆瓣推荐排序，通过 IMDB ID 或标题+年份精准匹配 TMDB ID',
      sources: [
        { platform: '豆瓣', url: 'https://movie.douban.com', note: '通过豆瓣国产剧标签接口获取热播数据' },
        { platform: 'TMDB', url: 'https://www.themoviedb.org', note: '通过 IMDB ID 或标题+年份匹配 TMDB ID' },
      ],
      match_strategy: 'IMDB ID 精准匹配 → 标题+首播年份精确匹配 → 跳过',
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
    },
    platform: 'douban',
    category: 'tv_cn',
    updated_at: new Date().toISOString(),
    total: cleanList.length,
    list: cleanList,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'douban-tv-cn.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
