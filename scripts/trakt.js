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

// /sync/playback 返回所有有进度但未完成的内容（电影 + 剧集混合）
async function fetchPlayback() {
  const res = await axios.get(`${TRAKT_API}/sync/playback`, {
    headers: TRAKT_HEADERS,
    params: { limit: 50 },
    timeout: 10000,
  });
  return res.data || [];
}

async function main() {
  console.log('📥 获取 Trakt Continue Watching...');
  const playbackList = await fetchPlayback();
  console.log(`✅ 共获取 ${playbackList.length} 条播放进度记录`);

  const seen = new Set();
  const list = [];

  for (const item of playbackList) {
    // type 为 'movie' 或 'episode'（剧集取 show 信息）
    const isMovie = item.type === 'movie';
    const media = isMovie ? item.movie : item.show;

    if (!media?.ids?.tmdb) continue;

    const tmdbId = media.ids.tmdb;
    const tmdbType = isMovie ? 'movie' : 'tv';
    const key = `${tmdbType}:${tmdbId}`;

    // 同一部剧可能有多集进度，去重只保留一条
    if (seen.has(key)) continue;
    seen.add(key);

    console.log(`  [${tmdbType.toUpperCase()}] ${media.title} → TMDB/${tmdbId}`);
    list.push({
      tmdb_id: tmdbId,
      tmdb_type: tmdbType,
      title: media.title,
      sort: list.length + 1,
    });
  }

  console.log(`\n📊 共 ${list.length} 部正在观看的内容`);

  const output = {
    remark: {
      description: '我正在看的影视，包含有播放进度但未完成的剧集和电影',
      sources: [
        {
          platform: 'Trakt',
          url: 'https://trakt.tv',
          note: '通过 /sync/playback 接口获取播放进度数据，数据自带 TMDB ID，无需额外匹配',
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
