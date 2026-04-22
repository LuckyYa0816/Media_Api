import os
import requests
from datetime import date

# ── 配置 ──────────────────────────────────────────────
TRAKT_BASE   = "https://api.trakt.tv"
TMDB_BASE    = "https://api.themoviedb.org/3"
CLIENT_ID    = os.environ["TRAKT_CLIENT_ID"]
ACCESS_TOKEN = os.environ["TRAKT_ACCESS_TOKEN"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT      = os.environ["TELEGRAM_CHAT_ID"]
TMDB_KEY     = os.environ.get("TMDB_API_KEY", "")
FETCH_DAYS   = 7

TRAKT_HEADERS = {
    "Content-Type":      "application/json",
    "trakt-api-version": "2",
    "trakt-api-key":     CLIENT_ID,
    "Authorization":     f"Bearer {ACCESS_TOKEN}",
}


# ── Trakt API ─────────────────────────────────────────
def fetch_my_shows(start: str, days: int) -> list:
    url  = f"{TRAKT_BASE}/calendars/my/shows/{start}/{days}"
    resp = requests.get(url, headers=TRAKT_HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


# ── TMDB 中文名查询（带本地缓存，避免重复请求）────────────
_tmdb_cache: dict[int, str] = {}

def get_chinese_title(tmdb_id: int, fallback: str) -> str:
    """通过 TMDB ID 获取中文名，失败则返回原名"""
    if not TMDB_KEY or not tmdb_id:
        return fallback
    if tmdb_id in _tmdb_cache:
        return _tmdb_cache[tmdb_id]
    try:
        url  = f"{TMDB_BASE}/tv/{tmdb_id}"
        resp = requests.get(url, params={"api_key": TMDB_KEY, "language": "zh-CN"}, timeout=10)
        if resp.ok:
            data  = resp.json()
            title = data.get("name") or data.get("original_name") or fallback
        else:
            title = fallback
    except Exception:
        title = fallback
    _tmdb_cache[tmdb_id] = title
    return title


# ── 数据解析 ──────────────────────────────────────────
def parse_shows(raw: list) -> list[dict]:
    items = []
    for entry in raw:
        aired    = (entry.get("first_aired") or "")[:10]
        show     = entry.get("show", {})
        ep       = entry.get("episode", {})
        ids      = show.get("ids", {})
        tmdb_id  = ids.get("tmdb")
        en_title = show.get("title", "Unknown")

        items.append({
            "date":    aired,
            "title":   get_chinese_title(tmdb_id, en_title),
            "season":  ep.get("season", 0),
            "episode": ep.get("number", 0),
            "ep_name": ep.get("title", ""),
            "imdb_id": ids.get("imdb", ""),
        })
    return sorted(items, key=lambda x: x["date"])


# ── 消息格式化 ────────────────────────────────────────
def build_message(shows: list[dict]) -> str:
    today = date.today().isoformat()
    lines = [f"📺 *Trakt 播出提醒* — `{today}` 起 {FETCH_DAYS} 天\n"]

    if not shows:
        lines.append("_本周暂无剧集更新_")
        return "\n".join(lines)

    cur_date = ""
    for s in shows:
        if s["date"] != cur_date:
            cur_date = s["date"]
            lines.append(f"\n📅 `{cur_date}`")
        ep_tag  = f"S{s['season']:02d}E{s['episode']:02d}"
        ep_name = f" · _{s['ep_name']}_" if s["ep_name"] else ""
        imdb    = f" [↗](https://www.imdb.com/title/{s['imdb_id']})" if s["imdb_id"] else ""
        lines.append(f"  • *{s['title']}* {ep_tag}{ep_name}{imdb}")

    return "\n".join(lines)


# ── Telegram 推送 ─────────────────────────────────────
def send_telegram(text: str) -> None:
    url  = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    resp = requests.post(url, json={
        "chat_id":                  TG_CHAT,
        "text":                     text,
        "parse_mode":               "Markdown",
        "disable_web_page_preview": True,
    }, timeout=15)
    if resp.ok:
        print("✅ Telegram 推送成功")
    else:
        print(f"❌ Telegram 推送失败: {resp.status_code} {resp.text}")


# ── 主流程 ────────────────────────────────────────────
def main():
    today = date.today().isoformat()
    print(f"📡 Fetching my shows from {today} for {FETCH_DAYS} days...")

    raw   = fetch_my_shows(today, FETCH_DAYS)
    shows = parse_shows(raw)
    print(f"共 {len(shows)} 集")

    msg = build_message(shows)
    print("\n" + msg + "\n")
    send_telegram(msg)


if __name__ == "__main__":
    main()
