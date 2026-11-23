// Cloudflare Worker مجاني: يقدّم ملفات مكتبة أبصار الإسلام (كتب PDF وصوتيات) من حاوية R2
// على رابط ثابت مثل https://absar-files.<حسابك>.workers.dev/f/<اسم الملف>
//
// الربط المطلوب في إعدادات الـ Worker (Settings → Bindings → R2 bucket):
//   Variable name: FILES   ←   Bucket: absar-files
//
// يدعم: التحميل الجزئي (Range) لتشغيل الصوت والقفز فيه وتصفح PDF الكبير، والتخزين المؤقت
// في المتصفح والشبكة (الملف لا يتغير لأن اسمه بصمة محتواه)، والوصول من أي موقع أو تطبيق (CORS).

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                   "Access-Control-Allow-Headers": "Range, If-None-Match", "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });

    const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!key.startsWith("f/")) {
      return new Response("ملفات مكتبة الشيخ أبصار الإسلام — https://absaralislam.github.io", {
        status: key ? 404 : 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });
    }

    const obj = await env.FILES.get(key, { range: req.headers, onlyIf: req.headers });
    if (obj === null) return new Response("الملف غير موجود", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });

    const h = new Headers(cors);
    obj.writeHttpMetadata(h);          // Content-Type و Content-Disposition و Cache-Control المحفوظة مع الملف
    h.set("ETag", obj.httpEtag);
    h.set("Accept-Ranges", "bytes");
    if (!("body" in obj)) return new Response(null, { status: 304, headers: h }); // لم يتغير (If-None-Match)

    let status = 200;
    if (obj.range && req.headers.has("Range")) {
      const r = obj.range;
      const offset = "suffix" in r ? obj.size - r.suffix : (r.offset ?? 0);
      const length = "suffix" in r ? r.suffix : (r.length ?? obj.size - offset);
      h.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      h.set("Content-Length", String(length));
      status = 206;
    } else {
      h.set("Content-Length", String(obj.size));
    }
    return new Response(req.method === "HEAD" ? null : obj.body, { status, headers: h });
  },
};
