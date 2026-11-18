// Cloudflare Worker مجاني: يستقبل كل منشور جديد في قنوات تليجرام (عبر بوت مشرف فيها)
// ويشغّل مزامنة الموقع على GitHub فوراً، فيظهر المنشور في التطبيق خلال دقيقتين تقريباً.
//
// متغيرات يضعها صاحب الحساب في إعدادات الـ Worker (Settings → Variables and Secrets):
//   GITHUB_TOKEN : مفتاح GitHub مقصور على مستودع absaralislam.github.io بصلاحية Contents: Read and write
//   TG_SECRET    : نص سري عشوائي يُمرَّر أيضاً لتليجرام عند ضبط الـ webhook، حتى لا يستعمل الرابطَ غيرُه

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("مزامنة مكتبة أبصار الإسلام تعمل");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json().catch(() => ({}));
    const post = update.channel_post || update.edited_channel_post;
    if (post) {
      const res = await fetch("https://api.github.com/repos/absaralislam/absaralislam.github.io/dispatches", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "absar-library-sync",
        },
        body: JSON.stringify({ event_type: "telegram", client_payload: { channel: post.chat?.username || "" } }),
      });
      if (!res.ok) console.log("GitHub", res.status, await res.text());
    }
    // نردّ دائماً بـ 200 حتى لا يعيد تليجرام إرسال التحديث نفسه
    return new Response("ok");
  },
};
