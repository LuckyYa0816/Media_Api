const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';
const FRIBB_LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

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

async function buildTmdbMap() {
  console.log('📥 下载 Fribb 对照表...');
  const res = await axios.get(FRIBB_LIST_URL, { timeout: 30000 });
  const entries = res.data;

  const map = new Map();
  for (const entry of entries) {
    if (!entry.anilist_id) continue;
    map.set(entry.anilist_id, {
      tmdb_id: entry.themoviedb_id || null,
      tmdb_type: entry.type === 'movie' ? 'movie' : 'tv',
      thetvdb_id: entry.thetvdb_id || null,
      mal_id: entry.mal_id || null,
    });
  }

  console.log(`✅ 对照表加载完毕，共 ${map.size} 条记录`);
  return map;
}

async function main() {
  const { season, year } = getCurrentSeason();
  console.log(`📅 当前季度: ${year} ${season}`);

  const [anilistRes, tmdbMap] = await Promise.all([
    axios.post(
      ANILIST_API,
      { query: QUERY, variables: { season, seasonYear: year } },
      {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 15000,
      }
    ),
    buildTmdbMap(),
  ]);

  if (anilistRes.data.errors) {
    throw new Error(JSON.stringify(anilistRes.data.errors));
  }

  const rawList = anilistRes.data.data.Page.media;
  console.log(`✅ AniList 返回 ${rawList.length} 部番剧`);

  const list = rawList.map((item, i) => {
    const mapping = tmdbMap.get(item.id) || null;
    const tmdb = mapping?.tmdb_id
      ? {
          tmdb_id: mapping.tmdb_id,
          tmdb_type: mapping.tmdb_type,
          thetvdb_id: mapping.thetvdb_id,
        }
      : null;

    if (tmdb) {
      console.log(`  [${String(i + 1).padStart(2, '0')}] ${item.title.romaji} → TMDB ${tmdb.tmdb_type}/${tmdb.tmdb_id}`);
    } else {
      console.log(`  [${String(i + 1).padStart(2, '0')}] ${item.title.romaji} → not found`);
    }

    return {
      rank: i + 1,
      anilist_id: item.id,
      mal_id: item.idMal || null,
      tmdb,
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
    };
  });

  const output = {
    remark: {
      description: 'AniList 当季热播番剧，按人气排序',
      sources: [
        {
          platform: 'AniList',
          url: 'https://graphql.anilist.co',
          note: '提供番剧基础数据及人气排名',
        },
        {
          platform: 'Fribb anime-lists',
          url: 'https://github.com/Fribb/anime-lists',
          note: '提供 AniList ID 到 TMDB / TheTVDB 的 ID 对照映射',
        },
      ],
      update_cron: '0 */6 * * *',
      update_frequency: '每6小时更新一次',
    },
    season,
    season_year: year,
    updated_at: new Date().toISOString(),
    total: list.length,
    tmdb_matched: list.filter(x => x.tmdb).length,
    list,
  };

  const outDir = path.join(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'anilist.json');   // ← 按平台命名
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 已写入: ${outPath}`);
  console.log(`📊 TMDB 命中率: ${output.tmdb_matched}/${output.total}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
