const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TRAKT_API = 'https://api.trakt.tv';
const CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.TRAKT_REFRESH_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY; // Actions 自动注入，格式：owner/repo

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('❌ 缺少 TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET / TRAKT_REFRESH_TOKEN');
  process.exit(1);
}

// 将新 Refresh Token 写回 GitHub Secrets（自动续期）
async function updateGithubSecret(secretName, secretValue) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn('⚠️  缺少 GITHUB_TOKEN 或 GITHUB_REPOSITORY，跳过 Secret 更新');
    return;
  }

  try {
    const sodium = require('tweetsodium');

    // 获取仓库公钥
    const keyRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    const { key, key_id } = keyRes.data;

    // 加密新 Token
    const messageBytes = Buffer.from(secretValue);
    const keyBytes = Buffer.from(key, 'base64');
    const encryptedBytes = sodium.seal(messageBytes, keyBytes);
    const encryptedValue = Buffer.from(encryptedBytes).toString('base64');

    // 写入 Secret
    await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/secrets/${secretName}`,
      { encrypted_value: encryptedValue, key_id },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    console.log(`✅ ${secretName} 已自动更新`);
  } catch (err) {
    console.warn(`⚠️  更新 Secret 失败: ${err.message}`);
  }
}

// 用 Refresh Token 换取 Access Token，同时自动续期
async function getAccessToken() {
  const res = await axios.post(`${TRAKT_API}/oauth/token`, {
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    grant_type: 'refresh_token',
  }, { timeout: 10000 });

  const newRefreshToken = res.data.refresh_token;

  // 如果返回了新的 Refresh Token，写回 Secrets
  if (newRefreshToken && newRefreshToken !== REFRESH_TOKEN) {
    console.log('🔄 Refresh Token 已轮换，正在写回 Secrets...');
    await updateGithubSecret('TRAKT_REFRESH_TOKEN', newRefreshToken);
  }

  return res.data.access_token;
}

// 获取用户 Watchlist
async function fetchWatchlist(accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': CLIENT_ID,
    'Authorization': `Bearer ${accessToken}`,
  };

  const [showsRes, moviesRes] = await Promise.all([
    axios.get(`${TRAKT_API}/sync/watchlist/shows/added`, { headers, timeout: 10000 }),
    axios.get(`${TRAKT_API}/sync/watchlist/movies/added`, { headers, timeout: 10000 }),
  ]);

  return {
    shows: showsRes.data || [],
    movies: moviesRes.data || [],
  };
}

async function main() {
  console.log('🔑 获取 Trakt Access Token...');
  const accessToken = await getAccessToken();
  console.log('✅ 授权成功');

  console.log('📥 获取 Trakt Watchlist...');
  const { shows, movies } = await fetchWatchlist(accessToken);
  console.log(`✅ 剧集: ${shows.length} 部，电影: ${movies.length} 部`);

  // Trakt 数据本身带 ids.tmdb，无需额外匹配
  const showItems = shows
    .filter(item => item.show?.ids?.tmdb)
    .map((item, i) => {
      console.log(`  [TV] ${item.show.title} → TMDB/${item.show.ids.tmdb}`);
      return {
        tmdb_id: item.show.ids.tmdb,
        tmdb_type: 'tv',
        title: item.show.title,
        sort: i + 1,
      };
    });

  const movieItems = movies
    .filter(item => item.movie?.ids?.tmdb)
    .map((item, i) => {
      console.log(`  [Movie] ${item.movie.title} → TMDB/${item.movie.ids.tmdb}`);
      return {
        tmdb_id: item.movie.ids.tmdb,
        tmdb_type: 'movie',
        title: item.movie.title,
        sort: showItems.length + i + 1,
      };
    });

  const list = [...showItems, ...movieItems];
  console.log(`\n📊 共 ${list.length} 部有效条目`);

  const output = {
    remark: {
      description: '我的 Trakt Watchlist，剧集在前、电影在后，按加入时间倒序排列',
      sources: [
        {
          platform: 'Trakt',
          url: 'https://trakt.tv',
          note: '通过 OAuth 授权获取用户个人 Watchlist，数据自带 TMDB ID，无需额外匹配',
        },
      ],
      update_cron: '0 2 * * 1',
      update_frequency: '每周一 UTC 02:00 更新一次',
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
