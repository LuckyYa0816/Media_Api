const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';

const QUERY = `
query ($season: MediaSeason, $seasonYear: Int) {
  Page(page: 1, perPage: 30) {
    media(
      season: $season
      seasonYear: $seasonYear
      type: ANIME
      format_in: [TV, TV_SHORT]
      sort: [POPULARITY_DESC]
      isAdult: false
    ) {
      id
      title {
        romaji
        english
        native
      }
      averageScore
      popularity
      genres
      episodes
      status
      studios(isMain: true) {
        nodes { name }
      }
      nextAiringEpisode {
        episode
        airingAt
      }
      siteUrl
    }
  }
}
`;

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  let season;
  if (month <= 3) season = 'WINTER';
  else if (month <= 6) season = 'SPRING';
  else if (month <= 9) season = 'SUMMER';
  else season = 'FALL';
  return { season, year };
}

function formatTimestamp(unixTs) {
  if (!unixTs) return 'N/A';
  return new Date(unixTs * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function main() {
  const { season, year } = getCurrentSeason();
  console.log(`📅 Fetching: ${year} ${season}`);

  const response = await axios.post(
    ANILIST_API,
    { query: QUERY, variables: { season, seasonYear: year } },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  if (response.data.errors) {
    throw new Error(JSON.stringify(response.data.errors));
  }

  const list = response.data.data.Page.media;

  // 拼接 txt 内容
  const lines = [];
  lines.push(`AniList 热播番剧 - ${year} ${season}`);
  lines.push(`更新时间: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  lines.push(`共 ${list.length} 部`);
  lines.push('='.repeat(60));

  list.forEach((item, i) => {
    const title = item.title.romaji || item.title.english || item.title.native;
    const native = item.title.native || '';
    const score = item.averageScore ?? 'N/A';
    const pop = item.popularity ?? 'N/A';
    const studio = item.studios.nodes[0]?.name || 'N/A';
    const genres = item.genres.join(', ') || 'N/A';
    const eps = item.episodes ?? '?';
    const status = item.status;
    const nextEp = item.nextAiringEpisode
      ? `第${item.nextAiringEpisode.episode}集 @ ${formatTimestamp(item.nextAiringEpisode.airingAt)}`
      : 'N/A';

    lines.push('');
    lines.push(`#${String(i + 1).padStart(2, '0')} ${title}  ${native}`);
    lines.push(`    评分: ${score}/100  人气: ${pop}`);
    lines.push(`    制作: ${studio}  集数: ${eps}  状态: ${status}`);
    lines.push(`    类型: ${genres}`);
    lines.push(`    下集: ${nextEp}`);
    lines.push(`    链接: ${item.siteUrl}`);
  });

  lines.push('');
  lines.push('='.repeat(60));

  // 写入 txt，覆盖保存
  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'anime-hot.txt');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');

  console.log(`✅ 已写入: ${outPath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
