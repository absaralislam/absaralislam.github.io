#!/usr/bin/env python3
"""
نسخ ملفات المنشورات (الكتب والملفات والصوتيات) من تليجرام إلى Cloudflare R2،
ليفتحها الموقع والتطبيق دون تليجرام (المحجوب في بعض الدول).

الطريقة (Bot API عبر البوت المشرف في القنوات):
  ١) يعيد البوت توجيه المنشور إلى محادثة التخزين (TG_STORAGE_CHAT_ID) بلا تنبيه،
     فيحصل على معرّف الملف — لأن Bot API لا يتيح طلب منشور قديم برقمه.
  ٢) يحذف الرسالة المعاد توجيهها فوراً، وينزّل الملف (حد Bot API: ٢٠ ميجابايت).
  ٣) يرفعه إلى R2 باسم مبني على بصمة محتواه (f/<sha256>.<امتداد>)، فالملف المنشور
     في عدة قنوات يُحفظ مرة واحدة.
الملفات الأكبر من حد البوت تُسجَّل بحالة too_big مع اسم مقترح، فتُرفع يدوياً من لوحة R2
ثم تُضاف إلى files.manual في data/sources.json.

الحالة: data/tg/files.json — لا يُعاد تنزيل أو رفع ما سبق، ويكمل من حيث توقف.
المفاتيح من متغيرات البيئة فقط (GitHub Secrets):
  TG_BOT_TOKEN, TG_STORAGE_CHAT_ID, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

الاستخدام:
  python3 scripts/sync_files.py               # الجديد فقط (حتى 60 ملفاً)
  python3 scripts/sync_files.py --limit 5000  # نسخ الأرشيف كاملاً
  python3 scripts/sync_files.py --dry-run     # عرض ما سيُنسخ دون تنفيذ
"""
import argparse, hashlib, json, mimetypes, os, re, sys, tempfile, time
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_telegram import load_channel, write_json, load_json, build_index, OUTDIR, SOURCES

STATE = os.path.join(OUTDIR, "files.json")
TYPES = ("file", "book", "audio")
BOT_MAX = 20 * 1024 * 1024
ENV = {k: os.environ.get(k, "").strip() for k in
       ("TG_BOT_TOKEN", "TG_STORAGE_CHAT_ID", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")}


class TooBig(Exception):
    pass


class TgError(Exception):
    pass


def size_bytes(s):
    """«2.9 MB» ← 3040870 تقريباً (الحجم المعروض في صفحة تليجرام العامة)."""
    m = re.match(r"([\d.]+)\s*(B|KB|MB|GB)", s or "")
    return int(float(m.group(1)) * {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}[m.group(2)]) if m else 0


def tg(method, **params):
    url = f"https://api.telegram.org/bot{ENV['TG_BOT_TOKEN']}/{method}"
    for attempt in range(5):
        try:
            req = Request(url, data=json.dumps(params).encode(), headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=60) as r:
                d = json.loads(r.read())
        except HTTPError as e:
            d = json.loads(e.read() or b"{}")
        except (URLError, OSError) as e:
            if attempt == 4:
                raise TgError(str(e))
            time.sleep(5 * (attempt + 1))
            continue
        if d.get("ok"):
            return d["result"]
        wait = (d.get("parameters") or {}).get("retry_after")
        if wait:  # تجاوز حد تليجرام: ننتظر المدة التي يطلبها
            time.sleep(wait + 1)
            continue
        desc = d.get("description", "")
        if "too big" in desc.lower():
            raise TooBig(desc)
        raise TgError(desc)
    raise TgError("retries exhausted")


def download(file_path, dest):
    """تنزيل الملف من خوادم تليجرام مع حساب بصمته."""
    h, n = hashlib.sha256(), 0
    with urlopen(f"https://api.telegram.org/file/bot{ENV['TG_BOT_TOKEN']}/{file_path}", timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            f.write(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def disposition(name):
    """inline حتى يُعرض الـ PDF والصوت في المتصفح، مع اسم الملف العربي عند التحميل."""
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "file"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


class R2:
    def __init__(self):
        import boto3  # يُثبَّت في GitHub Actions: pip install boto3
        from botocore.config import Config
        self.bucket = ENV["R2_BUCKET"]
        self.s3 = boto3.client(
            "s3", endpoint_url=f"https://{ENV['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=ENV["R2_ACCESS_KEY_ID"], aws_secret_access_key=ENV["R2_SECRET_ACCESS_KEY"],
            region_name="auto", config=Config(retries={"max_attempts": 5, "mode": "standard"}))

    def head(self, key):
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=key)
        except Exception:
            return None

    def put(self, key, path, mime, name):
        self.s3.upload_file(path, self.bucket, key, ExtraArgs={
            "ContentType": mime, "ContentDisposition": disposition(name),
            "CacheControl": "public, max-age=31536000, immutable"})


def items_to_copy(cfg):
    out = []
    for s in cfg.get("telegram", []):
        for it in load_channel(s["username"]).values():
            if it["type"] in TYPES:
                out.append(it)
    return sorted(out, key=lambda i: i.get("date", ""), reverse=True)  # الأحدث أولاً


def fingerprint(it):
    return f"{it.get('doc', '')}|{it.get('size', '')}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60, help="أقصى عدد ملفات تُنزَّل في هذا التشغيل")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_json(SOURCES, {})
    manual = {k: v for k, v in cfg.get("files", {}).get("manual", {}).items() if not k.startswith("_")}
    missing = [k for k, v in ENV.items() if not v]
    if missing and not args.dry_run:
        print("لم تُضبط مفاتيح النسخ بعد (" + ", ".join(missing) + ") — تخطٍّ")
        return

    state = load_json(STATE, {})
    objects, posts = state.setdefault("objects", {}), state.setdefault("posts", {})
    fpmap = {p["fp"]: p["key"] for p in posts.values() if p.get("key") and p.get("fp")}
    store = None if args.dry_run else R2()
    items = items_to_copy(cfg)
    done = fetched = 0
    changed = False

    def save():
        state["_generated"] = "يُولَّد تلقائياً بواسطة scripts/sync_files.py — لا تعدّله يدوياً"
        write_json(STATE, state)

    for it in items:
        pid, fp = it["id"], fingerprint(it)
        prev = posts.get(pid, {})
        if prev.get("key"):
            continue
        # ١) ملف رُفع يدوياً من لوحة R2 (للملفات الأكبر من حد البوت)
        if pid in manual:
            if args.dry_run:
                print("يدوي:", pid, "←", manual[pid]); continue
            h = store.head(manual[pid])
            if h:
                key = manual[pid]
                objects[key] = {"size": h["ContentLength"], "mime": h.get("ContentType", "application/octet-stream"),
                                "name": it.get("doc") or os.path.basename(key)}
                posts[pid] = {"key": key, "fp": fp, "manual": True}
                fpmap[fp] = key
                changed = True
            else:
                posts[pid] = {**prev, "status": "awaiting_manual", "fp": fp, "suggested_key": manual[pid]}
            continue
        # ٢) الملف نفسه منشور في قناة أخرى وسبق رفعه
        if fp in fpmap:
            posts[pid] = {"key": fpmap[fp], "fp": fp}
            changed = True
            continue
        if prev.get("status") == "too_big" or prev.get("tries", 0) >= 5:
            continue
        ch, n = pid[3:].split("/")
        ext = os.path.splitext(it.get("doc") or "")[1].lower()
        if size_bytes(it.get("size")) > BOT_MAX:
            posts[pid] = {"status": "too_big", "fp": fp, "size": it.get("size"), "suggested_key": f"f/manual/{ch}-{n}{ext}"}
            changed = True
            continue
        if fetched >= args.limit:
            break
        fetched += 1
        if args.dry_run:
            print("سيُنسخ:", pid, it.get("size", ""), it.get("doc", it["title"])[:60]); continue

        # ٣) التنزيل من تليجرام والرفع إلى R2
        try:
            msg = tg("forwardMessage", chat_id=ENV["TG_STORAGE_CHAT_ID"], from_chat_id="@" + ch,
                     message_id=int(n), disable_notification=True)
            try:
                media = msg.get("document") or msg.get("audio") or msg.get("voice") or msg.get("video")
                if not media:
                    raise TgError("المنشور بلا ملف")
                if media.get("file_size", 0) > BOT_MAX:
                    raise TooBig(str(media["file_size"]))
                name = media.get("file_name") or it.get("doc") or f"{ch}-{n}{ext}"
                mime = media.get("mime_type") or mimetypes.guess_type(name)[0] or "application/octet-stream"
                path = tg("getFile", file_id=media["file_id"])["file_path"]
                with tempfile.TemporaryDirectory() as tmp:
                    local = os.path.join(tmp, "f")
                    sha, size = download(path, local)
                    key = f"f/{sha[:24]}{os.path.splitext(name)[1].lower() or ext}"
                    if key not in objects and not store.head(key):
                        store.put(key, local, mime, name)
            finally:
                try:
                    tg("deleteMessage", chat_id=ENV["TG_STORAGE_CHAT_ID"], message_id=msg["message_id"])
                except Exception:
                    pass
            objects[key] = {"size": size, "mime": mime, "name": name, "sha256": sha}
            posts[pid] = {"key": key, "fp": fp}
            fpmap[fp] = key
            done += 1
            print(f"  ✓ {pid}  {size // 1024} KB  {name[:60]}", flush=True)
        except TooBig:
            posts[pid] = {"status": "too_big", "fp": fp, "size": it.get("size"), "suggested_key": f"f/manual/{ch}-{n}{ext}"}
        except Exception as e:
            posts[pid] = {"status": "error", "fp": fp, "error": str(e)[:200], "tries": prev.get("tries", 0) + 1}
            print(f"  ! {pid}: {e}", file=sys.stderr, flush=True)
        changed = True
        if fetched % 10 == 0:
            save()  # حفظ دوري حتى لا يضيع التقدّم إن انقطع التشغيل
        time.sleep(1.1)  # حد تليجرام: نحو رسالة في الثانية للمحادثة الواحدة

    if args.dry_run:
        print(f"المجموع: {len(items)} منشوراً، سيُنزَّل منها في هذا التشغيل {fetched}")
        return
    save()
    have = sum(1 for p in posts.values() if p.get("key"))
    big = {p.get("suggested_key"): p.get("size") for p in posts.values() if p.get("status") in ("too_big", "awaiting_manual")}
    print(f"نُسخ في هذا التشغيل: {done} — المتاح دون تليجرام: {have} من {len(items)} — ملفات فريدة في R2: {len(objects)}")
    if big:
        print("ملفات أكبر من حد البوت تحتاج رفعاً يدوياً من لوحة R2 (ثم تُضاف إلى files.manual):")
        for k, s in sorted(big.items()):
            print("   ", k, s)
    if changed:
        build_index(cfg.get("telegram", []))  # يضيف روابط الملفات إلى المنشورات والفهرس


if __name__ == "__main__":
    main()
