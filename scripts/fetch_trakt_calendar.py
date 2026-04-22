import os
import requests
from datetime import date, datetime, timezone, timedelta

# ── 配置 ──────────────────────────────────────────────
TRAKT_BASE   = "https://api.trakt.tv"
TMDB_BASE    = "https://api.themoviedb.org/3"
CLIENT_ID    = os.environ["TRAKT_CLIENT_ID"]
ACCESS_TOKEN = os.environ["TRAKT_ACCESS_TOKEN"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT      = os.environ["TELEGRAM_CHAT_ID"]
TMDB_KEY     = os.environ.get("TMDB_API_KEY", "")

CST = timezone(timedelta(hours=8))   # 北京时间

TRAKT_HEADERS = {
    "Content-Type":      "application/json",
    "trakt-api-version": "2",
    "trakt-api-key":     CLIENT_ID,
    "Authorization":     f"Bearer {ACCESS_TOKEN}",
}


# ── Trakt API ─────────────────────────────────────────
def fetch_my_shows(start: str, days: int = 1) -> list:
    url  = f"{TRAKT_BASE}/calendars/my/shows/{start}/{days}"
    resp = requests.get(url, headers=TRAKT_HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


# ── TMDB 中文名缓存 ───────────────────────────────────
_tmdb_cache: dict[int, str] = {}

def get_chinese_title(tmdb_id: int, fallback: str) -> str:
    if not TMDB_KEY or not tmdb_id:
        return fallback
    if tmdb_id in _tmdb_cache:
        return _tmdb_cache[tmdb_id]
    try:
        resp = requests.get(
            f"{TMDB_BASE}/tv/{tmdb_id}",
            params={"api_key": TMDB_KEY, "language": "zh-CN"},
            timeout=10,
        )
        title = resp.json().get("name") or fallback if resp.ok else fallback
    except Exception:
        title = fallback
    _tmdb_cache[tmdb_id] = title
    return title


# ── 时间格式化（UTC → 北京时间）─────────────────────────
def fmt_time(iso: str) -> str:
    """将 Trakt 返回的 UTC ISO 时间转换为北京时间 HH:MM"""
    if not iso:
        return ""
    try:
        dt_utc = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        dt_cst = dt_utc.astimezone(CST)
        return dt_cst.strftime("%H:%M")
    except Exception:
        return ""


# ── 链接生成 ──────────────────────────────────────────
def show_link(ids: dict) -> str:
    """优先 TMDB，fallback Trakt"""
    tmdb_id    = ids.get("tmdb")
    trakt_slug = ids.get("slug")
    if tmdb_id:
        return f"https://www.themoviedb.org/tv/{tmdb_id}"
    if trakt_slug:
        return f"https://trakt.tv/shows/{trakt_slug}"
    return ""


# ── 数据解析 ──────────────────────────────────────────
def parse_shows(raw: list) -> list[dict]:
    items = []
    for entry in raw:
        show   = entry.get("show", {})
        ep     = entry.get("episode", {})
        ids    = show.get("ids", {})
        aired  = entry.get("first_aired") or ""

        items.append({
            "date":    aired[:10],
            "time":    fmt_time(aired),
            "title":   get_chinese_title(ids.get("tmdb"), show.get("title", "Unknown")),
            "season":  ep.get("season", 0),
            "episode": ep.get("number", 0),
            "ep_name": ep.get("title", ""),
            "link":    show_link(ids),
        })
    return sorted(items, key=lambda x: (x["date"], x["time"]))


# ── 消息格式化 ────────────────────────────────────────
def build_message(shows: list[dict]) -> str:
    today_cst = datetime.now(CST).strftime("%Y-%m-%d")
    lines = [f"📺 *Trakt 今日播出* — `{today_cst}`\n"]

    if not shows:
        lines.append("_今天暂无剧集更新_")
        return "\n".join(lines)

    for s in shows:
        ep_tag  = f"S{s['season']:02d}E{s['episode']:02d}"
        ep_name = f" · _{s['ep_name']}_" if s["ep_name"] else ""
        time    = f"`{s['time']} 北京` " if s["time"] else ""
        link    = f" [↗]({s['link']})" if s["link"] else ""
        lines.append(f"{time}• *{s['title']}* {ep_tag}{ep_name}{link}")

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
        print(f"❌ 推送失败: {resp.status_code} {resp.text}")


# ── 主流程 ────────────────────────────────────────────
def main():
    # 以北京时间为准获取"今天"日期
    today_cst = datetime.now(CST).strftime("%Y-%m-%d")
    print(f"📡 Fetching today's shows (北京时间): {today_cst}")

    raw   = fetch_my_shows(today_cst, days=1)
    shows = parse_shows(raw)
    print(f"共 {len(shows)} 集")

    msg = build_message(shows)
    print("\n" + msg + "\n")
    send_telegram(msg)


if __name__ == "__main__":
    main()
