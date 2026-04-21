const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 直接使用骨朵已经维护好的 JSON 数据源
const GUDUO_URL = 'https://raw.githubusercontent.com/MakkaPakka518/List/refs/heads/main/data/guduo-hot.json';

// 骨朵分类到 tmdb_type 的映射
const CATEGORY_TYPE_MAP = {
  '剧集': 'tv',
  '动漫': 'tv',
  '综艺': 'tv',
  '电影': 'movie',
};

async function main() {
  console.log('📥 获取骨朵热度榜数据...');

  const res = await axios.get(GUDUO_URL, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
  });

  let data;
  if (typeof res.data === 'string') {
    data = JSON.parse(res.data);
  } else {
    data = res.data;
  }

  if (!data?.categories) {
    throw new Error('骨朵数据结构异常，缺少 categories 字段');
  }

  const output = {
    remark: {
      description: '骨朵热度指数榜，按各大平台全网热度排序，覆盖剧集、国漫、综艺、电影',
      sources: [
        {
          platform: '骨朵数据',
          url: 'https://www.gududata.com',
          note: '通过 MakkaPakka518 维护的骨朵 JSON 数据源获取，数据自带 TMDB ID',
        },
      ],
      categories: Object.keys(CATEGORY_TYPE_MAP),
      update_cron: '30 23/30 8 * * *',
      update_frequency: '每天 07:30 和 16:30（北京时间）各更新一次',
    },
    platform: 'guduo',
    updated_at: new Date().toISOString(),
    categories: {},
  };

  for (const [category, tmdbType] of Object.entries(CATEGORY_TYPE_MAP)) {
    const items = data.categories[category] || [];

    const list = items
      .filter(item => item.tmdbId) // 过滤掉没有 TMDB ID 的条目
      .map((item, i) => {
        const title = item.tmdbTitle || item.title;
        console.log(`  [${category}][${String(i + 1).padStart(2, '0')}] ${title} → TMDB/${item.tmdbId}`);
        return {
          tmdb_id: item.tmdbId,
          tmdb_type: tmdbType,
          title,
          sort: item.rank || i + 1,
        };
      });

    output.categories[category] = {
      total: list.length,
      list,
    };

    console.log(`✅ ${category}: ${list.length}/${items.length} 条有效数据`);
  }

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'guduo.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
