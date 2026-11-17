#!/usr/bin/env python3
"""
حفظ صور منشورات تليجرام داخل المستودع (data/img/<قناة>/<رقم>.jpg)
لأن روابط صور تليجرام المؤقتة تنتهي صلاحيتها مع الوقت.

- يحمّل فقط الصور التي لم تُحفظ بعد، ثم يكتب في المنشور الحقل img بالمسار المحلي.
- يصغّر الصورة (أقصى بُعد 900 بكسل، جودة 60) لتقليل حجم المستودع:
  عبر Pillow إن وُجدت (كما في GitHub Actions)، أو أداة sips في ماك، وإلا تُحفظ كما هي.

الاستخدام:  python3 scripts/sync_images.py [--limit 3000]
"""
import argparse, glob, json, os, shutil, subprocess, sys, time
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_telegram import load_channel, save_channel, OUTDIR, UA, fetch, parse_page

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGDIR = os.path.join(ROOT, "data", "img")
MAX, QUALITY = 900, 60

try:
    from PIL import Image
except ImportError:
    Image = None
SIPS = shutil.which("sips")


def shrink(path):
    """يصغّر الصورة، ويُبقي الأصل إن لم يكن الناتج أصغر."""
    tmp = path + ".small.jpg"
    try:
        if Image:
            im = Image.open(path)
            im.thumbnail((MAX, MAX))
            im.convert("RGB").save(tmp, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        elif SIPS:
            subprocess.run([SIPS, "-Z", str(MAX), "-s", "format", "jpeg", "-s", "formatOptions", "low", path, "--out", tmp],
                           check=True, capture_output=True)
        else:
            return
        if os.path.getsize(tmp) < os.path.getsize(path):
            os.replace(tmp, path)
    except Exception as e:
        print(f"  ! تصغير {path}: {e}", file=sys.stderr)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def download(url):
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read()


def refresh(u, n, items):
    """روابط صور المنشورات القديمة تنتهي: نعيد قراءة صفحة المنشور لنأخذ رابطاً جديداً (الصفحة تحدّث 20 منشوراً معاً)."""
    page, _ = fetch(f"https://t.me/s/{u}?before={n + 1}")
    for m in parse_page(page):
        k = m["post"].split("/")[-1]
        if k.isdigit() and int(k) in items and m["photos"]:
            items[int(k)]["photo"] = m["photos"][0]
    time.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=3000, help="أقصى عدد صور في التشغيل الواحد")
    args = ap.parse_args()
    budget = args.limit
    total = 0
    for d in sorted(glob.glob(os.path.join(OUTDIR, "*/"))):
        u = os.path.basename(d.rstrip("/"))
        items = load_channel(u)
        changed = 0
        for n, it in sorted(items.items(), reverse=True):  # الأحدث أولاً: روابطه ما زالت صالحة غالباً
            if not it.get("photo") or it.get("img"):
                continue
            rel = f"data/img/{u}/{n}.jpg"
            path = os.path.join(ROOT, rel)
            if not os.path.exists(path):
                if budget <= 0:
                    break
                budget -= 1
                try:
                    data = download(it["photo"])
                except Exception:
                    try:  # رابط منتهٍ: نجلب رابطاً جديداً من صفحة المنشور ونعيد المحاولة
                        refresh(u, n, items)
                        data = download(it["photo"])
                    except Exception as e:
                        print(f"  ! {u}/{n}: {e}", file=sys.stderr)
                        continue
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(data)
                shrink(path)
                time.sleep(0.25)
            it["img"] = rel
            changed += 1
        if changed:
            save_channel(u, items)
            total += changed
            print(f"@{u}: {changed} صورة")
    print(f"المجموع: {total} صورة محفوظة محلياً")


if __name__ == "__main__":
    main()
