const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DOUBAN_URL = 'https://movie.douban.com/j/search_subjects';

async function main() {
  console.log('📥 获取豆瓣热播国产剧...');

  const res = await axios.get(DOUBAN_URL, {
    params: {
      type: 'tv',
      tag: '国产剧',
      sort: 'recommend',
      page_limit: 20,
      page_start: 0,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://movie.douban.com/',
      'Accept': 'application/json, text/plain, */*',
    },
    timeout: 15000,
  });

  const subjects = res.data.subjects || [];
  if (subjects.length === 0) {
    throw new Error('豆瓣接口返回空数据，可能触发反爬');
  }

  console.log(`✅ 获取 ${subjects.length} 部热播国产剧`);

  const list = subjects.map((item, i) => {
    console.log(`  [${String(i + 1).padStart(2, '0')}] ${item.title}`);
    return {
      tmdb_id: null,      // 豆瓣无直接 TMDB ID
      tmdb_type: 'tv',
      title: item.title,
      sort: i + 1,
      douban_id: item.id,
    };
  });

  const output = {
    remark: {
      description: '豆瓣热播国产剧，按豆瓣推荐排序',
      sources: [
        {
          platform: '豆瓣',
          url: 'https://movie.douban.com',
          note: '通过豆瓣国产剧标签接口获取热播数据',
        },
      ],
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
    },
    platform: 'douban',
    category: 'tv_cn',
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
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
