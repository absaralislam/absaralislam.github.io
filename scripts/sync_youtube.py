#!/usr/bin/env python3
"""
مزامنة قناة يوتيوب (الفيديوهات وقوائم التشغيل) إلى data/youtube.json

طريقتان رسميتان:
  1) YouTube Data API v3 — إن وُجد متغير البيئة YOUTUBE_API_KEY (مجاني من Google Cloud):
     يجلب كل فيديوهات القناة وكل قوائم التشغيل وترتيب الحلقات فيها.
  2) خلاصات RSS العامة — بلا مفتاح: آخر 15 فيديو للقناة، وآخر 15 لكل قائمة تشغيل
     مذكورة في data/sources.json (حقل playlists).
البيانات السابقة تُحفظ دائماً، فلا يضيع شيء جُلب من قبل.

الاستخدام:
  YOUTUBE_API_KEY=... python3 scripts/sync_youtube.py
  python3 scripts/sync_youtube.py
"""
import json, os, re, sys, time
import xml.etree.ElementTree as ET
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ar_ordinal import week_number

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "data", "sources.json")
OUT = os.path.join(ROOT, "data", "youtube.json")
KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "m": "http://search.yahoo.com/mrss/"}


def get(url):
    for i in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "library-sync/1.0"}), timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == 2:
                raise
            print(f"  retry: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))


def api(path, **q):
    q["key"] = KEY
    return json.loads(get(f"https://www.googleapis.com/youtube/v3/{path}?" + urlencode(q)))


def api_all(path, **q):
    token = ""
    while True:
        d = api(path, **q, **({"pageToken": token} if token else {}))
        yield from d.get("items", [])
        token = d.get("nextPageToken")
        if not token:
            return


# ---------- API ----------
def api_playlist(pid):
    out = []
    for it in api_all("playlistItems", part="snippet,contentDetails", playlistId=pid, maxResults=50):
        sn, cd = it["snippet"], it.get("contentDetails", {})
        vid = cd.get("videoId") or sn.get("resourceId", {}).get("videoId")
        if not vid or sn.get("title") in ("Private video", "Deleted video"):
            continue
        out.append({"id": vid, "title": sn.get("title", ""), "summary": sn.get("description", ""),
                    "date": cd.get("videoPublishedAt") or sn.get("publishedAt", "")})
    return out


def api_channel(cid):
    uploads = api_playlist("UU" + cid[2:])
    pls = [{"id": p["id"], "title": p["snippet"]["title"]}
           for p in api_all("playlists", part="snippet", channelId=cid, maxResults=50)]
    for p in pls:
        p["videos"] = api_playlist(p["id"])
    return uploads, pls


# ---------- RSS ----------
def rss(**q):
    root = ET.fromstring(get("https://www.youtube.com/feeds/videos.xml?" + urlencode(q)))
    vids = [{"id": e.findtext("yt:videoId", "", NS), "title": e.findtext("a:title", "", NS),
             "date": e.findtext("a:published", "", NS), "summary": e.findtext("m:group/m:description", "", NS)}
            for e in root.findall("a:entry", NS)]
    return root.findtext("a:title", "", NS), vids


def rss_channel(cid, playlist_ids):
    _, uploads = rss(channel_id=cid)
    pls = []
    for pid in playlist_ids:
        try:
            title, vids = rss(playlist_id=pid)
            pls.append({"id": pid, "title": title, "videos": vids, "partial": True})
            time.sleep(0.5)
        except Exception as e:
            print(f"  ! {pid}: {e}", file=sys.stderr)
    return uploads, pls


def main():
    with open(SOURCES, encoding="utf-8") as f:
        sources = [s for s in json.load(f).get("youtube", []) if re.fullmatch(r"UC[\w-]{22}", s.get("channel_id", ""))]
    if not sources:
        print("لا توجد قنوات يوتيوب مضبوطة في data/sources.json — تخطٍّ")
        return
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        old = {}
    items = {i["id"]: i for i in old.get("items", []) if not i.get("sample")}
    playlists = {p["id"]: p for p in old.get("playlists", [])}
    labels = {}

    for s in sources:
        cid, src, program = s["channel_id"], "yt:" + s["channel_id"], s.get("program")
        labels[src] = s.get("label") or "يوتيوب"
        try:
            uploads, pls = api_channel(cid) if KEY else rss_channel(cid, s.get("playlists", []))
        except Exception as e:
            print(f"  ! {src}: {e}", file=sys.stderr)
            continue
        print(f"{src}: {len(uploads)} فيديو، {len(pls)} قائمة عبر {'API' if KEY else 'RSS'}")

        def put(v):
            key = f"yt:{v['id']}"
            it = items.get(key, {})
            it.update({k: val for k, val in v.items() if val and k != "id"})
            it.update({"id": key, "type": "video", "youtube": v["id"], "source": src,
                       "thumb": f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg",
                       "url": f"https://www.youtube.com/watch?v={v['id']}"})
            if program:
                it["program"] = program
            items[key] = it
            return key

        for v in uploads:
            put(v)
        for p in pls:
            keys = [put(v) for v in p["videos"]]
            prev = playlists.get(p["id"], {})
            if p.get("partial") and prev.get("videos"):
                # RSS يعطي آخر 15 فقط: ندمجها مع ما سبق دون فقد الترتيب القديم
                keys = prev["videos"] + [k for k in keys if k not in prev["videos"]]
            playlists[p["id"]] = {"id": p["id"], "title": p["title"] or prev.get("title", ""), "source": src,
                                  "program": program, "videos": keys}
            wk = week_number(playlists[p["id"]]["title"])
            if wk:
                playlists[p["id"]]["week"] = wk

    for it in items.values():
        it.pop("playlists", None)
    for p in playlists.values():
        for vid in p["videos"]:
            if vid in items and p["id"] not in items[vid].setdefault("playlists", []):
                items[vid]["playlists"].append(p["id"])

    data = {
        "_generated": "يُولَّد تلقائياً بواسطة scripts/sync_youtube.py — لا تعدّله يدوياً",
        "site": {"sources": labels},
        "playlists": sorted(playlists.values(), key=lambda p: p["title"]),
        "items": sorted(items.values(), key=lambda i: i.get("date", ""), reverse=True),
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"كُتب {len(items)} فيديو و{len(playlists)} قائمة إلى data/youtube.json")


if __name__ == "__main__":
    main()
