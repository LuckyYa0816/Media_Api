const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// AniList 查询，加入 idMal 字段
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
      idMal
      title {
        romaji
        english
        native
      }
      coverImage {
        large
        medium
        color
      }
      bannerImage
      averageScore
      popularity
      favourites
      trending
      genres
      episodes
      duration
      status
      season
      seasonYear
      startDate { year month day }
      studios(isMain: true) {
        nodes { name }
      }
      nextAiringEpisode {
        episode
        airingAt
        timeUntilAiring
      }
      description(asHtml: false)
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

// 通过 MAL ID 查询 TMDB ID
async function getTmdbId(malId) {
  if (!malId || !TMDB_API_KEY) return null;

  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/find/${malId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          external_source: 'myanimelist_id',
        },
        timeout: 8000,
      }
    );

    // TMDB 返回 tv_results 和 movie_results
    const tvResults = res.data.tv_results || [];
    const movieResults = res.data.movie_results || [];

    if (tvResults.length > 0) {
      return { tmdb_id: tvResults[0].id, tmdb_type: 'tv', tmdb_name: tvResults[0].name };
    }
    if (movieResults.length > 0) {
      return { tmdb_id: movieResults[0].id, tmdb_type: 'movie', tmdb_name: movieResults[0].title };
    }
    return null;
  } catch (err) {
    console.warn(`  ⚠️  MAL ID ${malId} 查 TMDB 失败: ${err.message}`);
    return null;
  }
}

// 控制并发，避免触发 TMDB 速率限制（40次/10秒）
async function runWithConcurrency(tasks, limit = 5) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
      // 每批之间稍作等待
      await new Promise(r => setTimeout(r, 250));
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  if (!TMDB_API_KEY) {
    console.warn('⚠️  未设置 TMDB_API_KEY，tmdb 字段将为 null');
  }

  const { season, year } = getCurrentSeason();
  console.log(`📅 当前季度: ${year} ${season}`);

  // 1. 从 AniList 获取番剧列表
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

  const rawList = response.data.data.Page.media;
  console.log(`✅ AniList 返回 ${rawList.length} 部番剧，开始查询 TMDB ID...`);

  // 2. 并发查询 TMDB ID
  const tmdbTasks = rawList.map((item, i) => async () => {
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${rawList.length}] ${item.title.romaji} ... `);
    const tmdb = await getTmdbId(item.idMal);
    console.log(tmdb ? `TMDB: ${tmdb.tmdb_type}/${tmdb.tmdb_id}` : 'not found');
    return tmdb;
  });

  const tmdbResults = await runWithConcurrency(tmdbTasks, 5);

  // 3. 整合数据
  const list = rawList.map((item, i) => ({
    rank: i + 1,
    anilist_id: item.id,
    mal_id: item.idMal || null,
    tmdb: tmdbResults[i] || null,   // { tmdb_id, tmdb_type, tmdb_name } 或 null
    title: {
      native: item.title.native || null,
      romaji: item.title.romaji || null,
      english: item.title.english || null,
    },
    cover: item.coverImage.large,
    cover_medium: item.coverImage.medium,
    theme_color: item.coverImage.color || null,
    banner: item.bannerImage || null,
    score: item.averageScore || null,
    popularity: item.popularity,
    favourites: item.favourites,
    trending: item.trending,
    genres: item.genres,
    studio: item.studios.nodes[0]?.name || null,
    episodes: item.episodes || null,
    duration: item.duration || null,
    status: item.status,
    season: item.season,
    season_year: item.seasonYear,
    start_date: item.startDate || null,
    next_episode: item.nextAiringEpisode
      ? {
          episode: item.nextAiringEpisode.episode,
          airing_at: item.nextAiringEpisode.airingAt,
          countdown_seconds: item.nextAiringEpisode.timeUntilAiring,
        }
      : null,
    description: item.description
      ? item.description.replace(/<[^>]+>/g, '').trim().slice(0, 300)
      : null,
    url: item.siteUrl,
  }));

  const output = {
    season,
    season_year: year,
    updated_at: new Date().toISOString(),
    total: list.length,
    list,
  };

  // 4. 写入 JSON 文件（覆盖）
  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'anime-hot.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 已写入: ${outPath}`);
  console.log(`📊 统计: ${list.filter(x => x.tmdb).length}/${list.length} 部找到 TMDB ID`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
