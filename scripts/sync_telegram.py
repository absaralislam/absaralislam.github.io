#!/usr/bin/env python3
"""
مزامنة منشورات قنوات تليجرام العامة إلى data/tg/

يقرأ الصفحة العامة https://t.me/s/<username> (لا يحتاج حساباً ولا مفاتيح).
  --full   : يجلب أرشيف القناة كاملاً منذ أول منشور (للمرة الأولى)
  (افتراضي): يجلب الجديد ويعيد فحص آخر المنشورات لالتقاط التعديلات
  --only u : يقصر المزامنة على قناة واحدة

التخزين (حتى يبقى التطبيق خفيفاً على الجوال):
  data/tg/index.json        فهرس: لكل قناة عدد منشوراتها وأحدثها ووسومها، مع قائمة الكتب (PDF) والمرئيات
  data/tg/<قناة>/<k>.json   المنشورات مقسّمة: الملف k يضم المنشورات من k*500 إلى k*500+499
"""
import argparse, glob, html, json, os, re, sys, time
from collections import Counter
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ar_ordinal import week_number

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "data", "sources.json")
OUTDIR = os.path.join(ROOT, "data", "tg")
SHARD = 500
UA = "Mozilla/5.0 (compatible; library-sync/1.0)"
DELAY = 1.5      # ثوانٍ بين الطلبات حتى لا نُثقل على تليجرام
RECHECK = 40     # في الوضع التدريجي نعيد فحص آخر N منشور لالتقاط التعديلات
# ملفات البرامج الأسبوعية (تفسير مقطع، معاني كلمات، مقرر الحفظ…) تُفصل عن الكتب
FILE_RE = re.compile(r"سورة\s+\S+.*?[\d٠-٩]+\s*[-–]\s*[\d٠-٩]+|مقرر\s+الحفظ|ال[أا]سبوع"
                     r"|^(?:فوائد|العمل\s+ب|معاني\s+كلمات|الوقف\s+والابتداء|تفريغ|جدول|اختبار|تفسير\s+سورة)\s*\S*\s*(?:سورة|آيات|الجزء|جزء|درس)?")
SERIES_RE = [  # سلاسل الكتب: «لمحة تجويدية - …»، «الجزء العاشر من تفسير السعدي»
    (re.compile(r"^(?!ملف)(?:.*(?:لمحة|لمحات)\s+تجويدية|.*التجويد|مخارج\s+الحروف|(?:صفة|صفات)\s+(?:الحروف|الاستفال)|أحكام\s+(?:الميم|النون|الراء|البسملة)|اللحن|الأحرف\s+السبعة)"), "دروس التجويد (لمحة تجويدية)"),
    (re.compile(r"لطائف"), "لطائف السور"),
    (re.compile(r"من\s+تفسير\s+السعدي"), "تفسير السعدي (أجزاء)"),
    (re.compile(r"^(.{6,60}?)\s+[-ـ–]\s+"), None),
]


def series_of(title):
    for rx, name in SERIES_RE:
        m = rx.search(title)
        if m:
            return name or m.group(1).strip()
    return ""
WEEK_START = re.compile(r"^مقرر\s+(?:الحفظ\s+)?(?:لل|ال)[أا]سبوع")
WEEK_END = re.compile(r"^اختبار\s+(?:لل|ال)[أا]سبوع")
PASSAGE_RE = re.compile(r"سورة\s+(\S+(?:\s+\S+)?)\s+([\d٠-٩]+\s*[-–]\s*[\d٠-٩]+)")
YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})")


def fetch(url, tries=6):
    for i in range(tries):
        try:
            with urlopen(Request(url, headers={"User-Agent": UA, "Accept-Language": "ar,en"}), timeout=40) as r:
                return r.read().decode("utf-8", "replace"), r.geturl()
        except (HTTPError, URLError, OSError) as e:  # يشمل انقطاع الاتصال وانتهاء المهلة
            if i == tries - 1:
                raise
            wait = 30 * (i + 1) if getattr(e, "code", 0) == 429 else 5 * (i + 1)
            print(f"  retry in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)


class PageParser(HTMLParser):
    """يستخرج المنشورات من صفحة t.me/s — يتتبع عمق وسوم div فقط لأنها دائماً مغلقة."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.msgs, self.cur = [], None
        self.depth = 0
        self.msg_depth = self.text_depth = None
        self.cap = None          # (field, depth) لالتقاط نص عنصر بسيط
        self.buf, self.cbuf = [], []
        self.link = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if tag == "div":
            self.depth += 1
            if "tgme_widget_message" in cls and a.get("data-post") and self.cur is None:
                self.cur = {"post": a["data-post"], "photos": [], "media": set()}
                self.msg_depth = self.depth
            elif self.cur is not None:
                if "js-message_text" in cls and self.text_depth is None and "text" not in self.cur:
                    self.text_depth, self.buf = self.depth, []
                elif "tgme_widget_message_document_title" in cls:
                    self.cap, self.cbuf = ("doc", self.depth), []
                elif "tgme_widget_message_document_extra" in cls:
                    self.cap, self.cbuf = ("size", self.depth), []
            return
        if self.cur is None:
            return
        if self.text_depth is not None:
            if tag == "br":
                self.buf.append("\n")
            elif tag == "a" and a.get("href"):
                self.link = (a["href"], len(self.buf))
        style = a.get("style") or ""
        bg = re.search(r"background-image:url\('([^']+)'\)", style)
        if bg and ("tgme_widget_message_photo_wrap" in cls or "tgme_widget_message_video_thumb" in cls):
            self.cur["photos"].append(bg.group(1))
        if "tgme_widget_message_video_player" in cls:
            self.cur["media"].add("video")
        if "tgme_widget_message_voice" in cls or tag == "audio":
            self.cur["media"].add("audio")
        if tag == "time" and a.get("datetime") and "date" not in self.cur:
            self.cur["date"] = a["datetime"]

    def handle_endtag(self, tag):
        if self.cur is not None and self.text_depth is not None and tag == "a" and self.link:
            href, start = self.link
            label = "".join(self.buf[start:]).strip()
            if href.startswith("http") and label and label not in href and href not in label:
                self.buf.append(f" ({href})")
            self.link = None
        if tag != "div":
            return
        if self.text_depth is not None and self.depth == self.text_depth:
            self.cur["text"], self.text_depth = "".join(self.buf), None
        if self.cap and self.depth == self.cap[1]:
            self.cur[self.cap[0]], self.cap = "".join(self.cbuf).strip(), None
        if self.cur is not None and self.depth == self.msg_depth:
            self.msgs.append(self.cur)
            self.cur = self.msg_depth = None
        self.depth -= 1

    def handle_data(self, data):
        if self.text_depth is not None:
            self.buf.append(data)
        if self.cap:
            self.cbuf.append(data)


def parse_page(page):
    p = PageParser()
    p.feed(page)
    return p.msgs


def clean(text):
    text = html.unescape(text or "").replace("\r", "").replace(" ", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


DECOR = " \t*_-—–•▪▫◈○●◆◇¤←⬅➖✅☑🔹🔸🔷🔶📌📍💎💡🌿🌸✨⭐️❖✿❀|:：،."


def make_title(text, fallback):
    for line in text.split("\n"):
        line = re.sub(r"https?://\S+", "", line).strip(DECOR)
        line = re.sub(r"#[\w_]+", "", line).strip(DECOR)
        if len(line) >= 3:
            return line[:100] + ("…" if len(line) > 100 else "")
    return fallback


def to_item(m, username):
    channel, _, num = m["post"].partition("/")
    if not num.isdigit():
        return None
    text, doc = clean(m.get("text", "")), m.get("doc", "")
    if not text and not doc and not m["photos"] and not m["media"]:
        return None  # منشور خدمي فارغ
    item = {"id": f"tg:{username}/{num}", "n": int(num), "type": "article", "text": text,
            "date": m.get("date", ""), "url": f"https://t.me/{channel}/{num}", "source": f"tg:{username}"}
    yt = YT_RE.search(text)
    stripped = YT_RE.sub("", re.sub(r"https?://\S+", lambda x: x.group(0) if YT_RE.search(x.group(0)) else "", text))
    if doc.lower().endswith(".pdf"):
        item["type"] = "book"
        name = re.sub(r"[_]+", " ", doc[:-4]).strip()
        item["title"] = make_title(re.sub(r"^\s*كتاب\s*:\s*", "", text), name)
    elif yt and len(re.sub(r"https?://\S+|\s", "", text)) < 60:
        item["type"], item["youtube"] = "video", yt.group(1)
        item["thumb"] = f"https://i.ytimg.com/vi/{yt.group(1)}/hqdefault.jpg"
        item["title"] = make_title(text, "مقطع مرئي")
    elif ("audio" in m["media"] or doc.lower().endswith((".mp3", ".m4a", ".ogg", ".opus"))) and len(text) < 300:
        item["type"] = "audio"
    elif "video" in m["media"] and len(text) < 300:
        item["type"] = "video"
    if "title" not in item:
        fallback = doc or {"video": "مقطع مرئي", "audio": "مقطع صوتي"}.get(item["type"], "صورة")
        item["title"] = make_title(text, fallback)
    if item["title"] == "مقطع مرئي" and "youtube" in item:
        item["title"] = "مقطع مرئي من يوتيوب"
    if m["photos"]:
        item["photo"] = m["photos"][0]
    if doc:
        item["doc"] = doc
    if m.get("size"):
        item["size"] = m["size"]
    tags = sorted(set(t[1:] for t in re.findall(r"#[\w_]{2,}", text)))
    if tags:
        item["tags"] = tags
    classify(item)
    return item


_AUTH = None


def authored(it):
    """هل الكتاب من تأليف الشيخ؟ حسب قائمة authored في sources.json."""
    global _AUTH
    if _AUTH is None:
        with open(SOURCES, encoding="utf-8") as f:
            a = json.load(f).get("authored", {})
        _AUTH = (set(a.get("ids", [])), [re.compile(p) for p in a.get("patterns", [])], a.get("markers", []))
    ids, pats, marks = _AUTH
    hay = it.get("text", "") + " " + it.get("doc", "").replace("_", " ")
    return it["id"] in ids or any(p.search(it["title"]) for p in pats) or any(m in hay for m in marks)


def classify(it):
    if it.get("doc", "").lower().endswith(".pdf"):
        it["type"] = "file" if FILE_RE.search(it["title"]) or FILE_RE.search(it["doc"].replace("_", " ")) else "book"
        if it["type"] == "book" and not authored(it):
            it["type"] = "file"   # كتاب لغير الشيخ نشره للفائدة: يبقى في ملفات البرنامج لا في قسم الكتب


def organize(items, weeks_on):
    """يعيد تصنيف ملفات PDF، ويربط منشورات البرنامج الأسبوعي بأسابيعها:
    الأسبوع يبدأ بمنشور «مقرر الأسبوع N» وينتهي بـ«اختبار الأسبوع N» (أو بعد 3 أسابيع على الأكثر)."""
    cur = start = None
    for n in sorted(items):
        it = items[n]
        classify(it)
        it.pop("week", None)
        if not weeks_on:
            continue
        title = it.get("title", "")
        if WEEK_START.search(title) and week_number(title):
            if week_number(title) != cur:
                cur, start = week_number(title), it.get("date", "")
        elif cur and start and it.get("date", "")[:10] > shift(start, 21):
            cur = None
        if cur:
            it["week"] = cur
            if WEEK_END.search(title) and week_number(title) == cur:
                cur = None


def shift(iso, days):
    import datetime as dt
    try:
        return (dt.date.fromisoformat(iso[:10]) + dt.timedelta(days=days)).isoformat()
    except ValueError:
        return "9999"


TITLES = os.path.join(OUTDIR, "yt_titles.json")


def youtube_titles(items):
    """منشورات فيها رابط يوتيوب فقط بلا عنوان: نجلب عنوان المقطع من واجهة oEmbed الرسمية العامة.
    النتائج تُحفظ في yt_titles.json فلا يُطلب العنوان نفسه مرتين."""
    try:
        with open(TITLES, encoding="utf-8") as f:
            cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}
    asked = 0
    for it in items.values():
        vid = it.get("youtube")
        if not vid or not it["title"].startswith("مقطع مرئي"):
            continue
        if vid not in cache and asked < 400:
            asked += 1
            try:
                with urlopen(Request("https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=" + vid,
                                     headers={"User-Agent": UA}), timeout=20) as r:
                    cache[vid] = json.loads(r.read()).get("title", "")
            except Exception:
                cache[vid] = ""   # محذوف أو خاص
            time.sleep(0.3)
        if cache.get(vid):
            it["title"] = cache[vid]
    if asked:
        write_json(TITLES, cache)


def build_weeks(items):
    weeks = {}
    for it in sorted(items, key=lambda i: i["n"]):
        w = it.get("week")
        if not w:
            continue
        wk = weeks.setdefault(w, {"no": w, "label": "", "passage": "", "from": it["n"], "to": it["n"],
                                  "start": it["date"], "end": it["date"], "count": 0, "files": [], "videos": []})
        wk["to"], wk["end"], wk["count"] = it["n"], it["date"], wk["count"] + 1
        if not wk["label"] and WEEK_START.search(it["title"]):
            wk["label"] = re.sub(r"^مقرر\s+(?:الحفظ\s+)?(?:لل|ال)", "ال", it["title"]).replace("للأسبوع", "الأسبوع")
        m = PASSAGE_RE.search(it["title"])
        if m:  # المقطع الأكثر وروداً في ملفات الأسبوع (قد يتأخر ملف من الأسبوع السابق)
            wk.setdefault("_p", Counter())[f"سورة {m.group(1)} " + re.sub(r"\s*[-–]\s*", " - ", m.group(2))] += 1
        if it["type"] == "file":
            wk["files"].append({k: it[k] for k in ("id", "title", "url", "size", "date") if it.get(k)})
        elif it.get("youtube"):
            wk["videos"].append({"id": it["id"], "youtube": it["youtube"], "date": it["date"]})
    for wk in weeks.values():
        if wk.get("_p"):
            wk["passage"] = wk.pop("_p").most_common(1)[0][0]
    return sorted(weeks.values(), key=lambda w: w["no"], reverse=True)


# ---------------- التخزين ----------------
def load_channel(username):
    items = {}
    for f in glob.glob(os.path.join(OUTDIR, username, "*.json")):
        with open(f, encoding="utf-8") as fh:
            for it in json.load(fh).get("items", []):
                items[it["n"]] = it
    return items


def save_channel(username, items):
    d = os.path.join(OUTDIR, username)
    os.makedirs(d, exist_ok=True)
    shards = {}
    for it in items.values():
        shards.setdefault(it["n"] // SHARD, []).append(it)
    for f in glob.glob(os.path.join(d, "*.json")):
        if int(os.path.basename(f)[:-5]) not in shards:
            os.remove(f)
    for k, lst in shards.items():
        lst.sort(key=lambda i: i["n"], reverse=True)
        write_json(os.path.join(d, f"{k}.json"), {"items": lst})
    return sorted(shards, reverse=True)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def compact(it, n=180):
    t = re.sub(r"\s+", " ", it.get("text", "")).strip()
    c = {k: it[k] for k in ("id", "type", "title", "date", "source", "url", "youtube", "thumb", "doc", "size") if it.get(k)}
    c["excerpt"] = t[:n] + ("…" if len(t) > n else "")
    return c


# ---------------- المزامنة ----------------
STATE = os.path.join(OUTDIR, "state.json")


def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def crawl(username, known, start, stop_at, label):
    """يقرأ الصفحات نزولاً من start حتى stop_at. يعيد True إن بلغ أول منشور في القناة."""
    url = f"https://t.me/s/{username}" + (f"?before={start}" if start else "")
    pages = 0
    while True:
        page, final_url = fetch(url)
        if "/s/" not in final_url:
            raise RuntimeError("القناة ليست عامة أو لا تسمح بالمعاينة")
        msgs = parse_page(page)
        pages += 1
        for it in filter(None, (to_item(m, username) for m in msgs)):
            known[it["n"]] = it
        nums = [int(m["post"].split("/")[-1]) for m in msgs if m["post"].split("/")[-1].isdigit()]
        if not nums:
            return True
        oldest = min(nums)
        if oldest <= 1:
            return True
        if oldest <= stop_at:
            return False
        url = f"https://t.me/s/{username}?before={oldest}"
        if pages % 25 == 0:
            print(f"  … @{username} ({label}): {pages} صفحة، {len(known)} منشور (وصلنا إلى #{oldest})", flush=True)
            save_channel(username, known)  # حفظ دوري حتى لا يضيع التقدّم
        time.sleep(DELAY)


def sync_channel(username, full, state, weeks_on=False):
    """مرحلتان: (1) الجديد من الأعلى حتى ما سبق جلبه، (2) استكمال الأرشيف القديم إن لم يكتمل بعد —
    فلو انقطع الجلب في منتصفه، تكمل المزامنة التالية من حيث توقّف."""
    known = load_channel(username)
    before = len(known)
    st = state.setdefault(username, {})
    if full:
        st["complete"] = False
    try:
        if known:
            crawl(username, known, 0, max(0, max(known) - RECHECK), "الجديد")
        if not st.get("complete"):
            start = min(known) if known else 0
            st["complete"] = crawl(username, known, start, 0, "الأرشيف")
    finally:
        organize(known, weeks_on)
        save_channel(username, known)
        print(f"@{username}: {len(known) - before} جديد، المجموع {len(known)}"
              f"{'' if st.get('complete') else ' (الأرشيف لم يكتمل بعد)'}", flush=True)


def build_index(sources):
    channels, books, videos = {}, {}, []
    for s in sources:
        u = s["username"]
        known = load_channel(u)
        if not known:
            continue
        organize(known, s.get("weeks", False))
        youtube_titles(known)
        save_channel(u, known)
        items = sorted(known.values(), key=lambda i: i["n"], reverse=True)
        tags = Counter(t for it in items for t in it.get("tags", []))
        types = Counter(it["type"] for it in items)
        channels[u] = {
            "label": s.get("label") or u, "program": s.get("program"), "count": len(items),
            "types": dict(types), "max": items[0]["n"],
            "shards": sorted({it["n"] // SHARD for it in items}, reverse=True),
            "latest": [compact(it) for it in items[:8] if it["type"] == "article"][:6],
            "tags": [[t, c] for t, c in tags.most_common(40) if c >= 3],
        }
        if s.get("weeks"):
            channels[u]["weeks"] = build_weeks(items)
        for it in items:
            if it["type"] == "book":
                key = re.sub(r"\W+", "", it.get("doc", it["title"]).lower())
                # الكتاب نفسه يُنشر في عدة قنوات: نبقي أقدم نشر له
                if key not in books or it["date"] < books[key]["date"]:
                    books[key] = compact(it, 400)
                    books[key]["series"] = series_of(it["title"])
            elif it["type"] == "video" and it.get("youtube"):
                videos.append(compact(it))
    # السلسلة تُعتمد إن كان فيها 3 كتب فأكثر، وإلا يبقى الكتاب مفرداً
    counts = Counter(b["series"] for b in books.values() if b["series"])
    for b in books.values():
        if counts.get(b["series"], 0) < 3:
            b.pop("series", None)
    write_json(os.path.join(OUTDIR, "index.json"), {
        "_generated": "يُولَّد تلقائياً بواسطة scripts/sync_telegram.py — لا تعدّله يدوياً",
        "shard": SHARD,
        "channels": channels,
        "books": sorted(books.values(), key=lambda b: b["date"], reverse=True),
        "videos": sorted(videos, key=lambda v: v["date"], reverse=True),
    })
    return channels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="جلب الأرشيف كاملاً")
    ap.add_argument("--only", help="قناة واحدة فقط")
    args = ap.parse_args()

    with open(SOURCES, encoding="utf-8") as f:
        sources = [s for s in json.load(f).get("telegram", []) if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,}", s.get("username", ""))]
    if not sources:
        print("لا توجد قنوات تليجرام مضبوطة في data/sources.json — تخطٍّ")
        return
    os.makedirs(OUTDIR, exist_ok=True)
    state = load_state()
    for s in sources:
        if args.only and s["username"] != args.only:
            continue
        try:
            sync_channel(s["username"], args.full, state, s.get("weeks", False))
        except Exception as e:  # خطأ مؤقت في قناة لا يوقف البقية ولا يمسح بياناتها
            print(f"  ! @{s['username']}: {e}", file=sys.stderr)
        write_json(STATE, state)
    ch = build_index(sources)
    print("الفهرس:", ", ".join(f"{u}={c['count']}" for u, c in ch.items()))


if __name__ == "__main__":
    main()
