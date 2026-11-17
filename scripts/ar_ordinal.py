"""تحويل الأعداد الترتيبية العربية المكتوبة إلى أرقام: «السابع والتسعين» ← 97، «الحادي عشر» ← 11."""
import re

ONES = {"الاول": 1, "الحادي": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
        "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10}
TENS = {"العشر": 20, "الثلاث": 30, "الاربع": 40, "الخمس": 50, "الست": 60,
        "السبع": 70, "الثمان": 80, "التسع": 90}
HUNDRED = {"الماييه", "المايه", "المييه", "المئه", "الميه"}


def _n(s):
    s = re.sub(r"[ً-ٰٟـ]", "", s)
    return s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي").replace("ئ", "يي").replace("ء", "")


def ordinal(words):
    """يقرأ الكلمات من البداية ما دامت أعداداً، ويعيد المجموع (أو None)."""
    total, seen = 0, False
    for w in words:
        w = _n(w)
        if w.startswith("و") and len(w) > 3:
            w = w[1:]
        if w in ("بعد",):
            continue
        if w == "عشر":
            total += 10
        elif w in ONES:
            total += ONES[w]
        elif re.sub(r"(ون|ين)$", "", w) in TENS:
            total += TENS[re.sub(r"(ون|ين)$", "", w)]
        elif w in HUNDRED:
            total += 100
        else:
            if seen:
                break
            continue
        seen = True
    return total or None


def week_number(title):
    """«مقرر الحفظ للأسبوع السابع والتسعين» ← 97"""
    m = re.search(r"(?:لل|ال)[اأإ][سص][بي]وع\s+(.+)", title or "")
    return ordinal(m.group(1).split()) if m else None


if __name__ == "__main__":
    for t in ["مقرر الحفظ للأسبوع السابع والتسعين", "الأسبوع التسعون", "الاسبوع الخامس والثمانون",
              "الأسبوع الثالث والسبعون من المفصل", "اختبار الأسبوع الحادي عشر", "مقرر الأسبوع الأول", "الأسبوع المائة"]:
        print(t, "→", week_number(t))
