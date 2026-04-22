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

CST = timezone(timedelta(hours=8))

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


# ── 链接生成 ──────────────────────────────────────────
def show_link(ids: dict) -> str:
    tmdb_id    = ids.get("tmdb")
    trakt_slug = ids.get("slug")
    if tmdb_id:
        return f"https://www.themoviedb.org/tv/{tmdb_id}"
    if trakt_slug:
        return f"https://trakt.tv/shows/{trakt_slug}"
    return ""


# ── 数据解析 ──────────────────────────────────────────
def parse_shows(raw: list, target_date_cst: str) -> list[dict]:
    """
    raw: Trakt 返回的原始列表
    target_date_cst: 北京时间"今天"日期字符串，格式 YYYY-MM-DD
    只保留 first_aired 转换为北京时间后日期等于 target_date_cst 的集数
    """
    items = []
    for entry in raw:
        show      = entry.get("show", {})
        ep        = entry.get("episode", {})
        ids       = show.get("ids", {})
        aired_iso = entry.get("first_aired") or ""

        if not aired_iso:
            continue

        # 解析 UTC 时间，转换为北京时间
        try:
            dt_utc = datetime.fromisoformat(aired_iso.replace("Z", "+00:00"))
            dt_cst = dt_utc.astimezone(CST)
        except Exception:
            continue

        # 只保留北京时间"今天"的集数
        if dt_cst.strftime("%Y-%m-%d") != target_date_cst:
            continue

        items.append({
            "dt_cst":  dt_cst,                  # 用于排序
            "time":    dt_cst.strftime("%H:%M"),  # 北京时间 HH:MM
            "title":   get_chinese_title(ids.get("tmdb"), show.get("title", "Unknown")),
            "season":  ep.get("season", 0),
            "episode": ep.get("number", 0),
            "ep_name": ep.get("title", ""),
            "link":    show_link(ids),
        })

    # 按北京时间升序排列
    return sorted(items, key=lambda x: x["dt_cst"])


# ── 消息格式化 ────────────────────────────────────────
def build_message(shows: list[dict], today_cst: str) -> str:
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
    now_cst     = datetime.now(CST)
    today_cst   = now_cst.strftime("%Y-%m-%d")

    # Trakt 按 UTC 日期分组，北京时间"今天"可能横跨两个 UTC 日期
    # 取 UTC 昨天起 3 天，客户端再按北京时间过滤，确保不漏
    utc_start   = (now_cst - timedelta(days=1)).astimezone(timezone.utc).strftime("%Y-%m-%d")

    print(f"📡 北京时间今日: {today_cst}，Trakt 查询起始(UTC): {utc_start}")

    raw   = fetch_my_shows(utc_start, days=3)
    shows = parse_shows(raw, today_cst)
    print(f"共 {len(shows)} 集")

    msg = build_message(shows, today_cst)
    print("\n" + msg + "\n")
    send_telegram(msg)


if __name__ == "__main__":
    main()
