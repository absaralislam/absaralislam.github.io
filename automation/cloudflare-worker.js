// Cloudflare Worker مجاني: يشغّل مزامنة الموقع على GitHub فور نشر جديد في قنوات تليجرام.
// يعمل بطريقتين (تكفي إحداهما):
//   ١) webhook: تليجرام يرسل كل منشور جديد إلى رابط الـ Worker فوراً.
//   ٢) احتياطي كل دقيقة (Cron Trigger): الـ Worker يسأل تليجرام عن المنشورات الجديدة،
//      فلا يحتاج تليجرام أن يصل إلى الـ Worker (مفيد إن تعذّر ضبط الـ webhook).
//
// متغيرات (Settings → Variables and Secrets)، كلها من نوع Secret:
//   GITHUB_TOKEN : مفتاح GitHub مقصور على مستودع absaralislam.github.io (Contents: Read and write)
//   TG_SECRET    : نص سري يُمرَّر لتليجرام عند ضبط الـ webhook (للطريقة ١)
//   BOT_TOKEN    : مفتاح البوت من BotFather (للطريقة ٢ فقط)

const REPO = "absaralislam/absaralislam.github.io";

async function triggerSync(env, channel) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "absar-library-sync",
    },
    body: JSON.stringify({ event_type: "telegram", client_payload: { channel: channel || "" } }),
  });
  if (!res.ok) console.log("GitHub", res.status, await res.text());
  return res.ok;
}

export default {
  // الطريقة ١: webhook من تليجرام
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("مزامنة مكتبة أبصار الإسلام تعمل");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json().catch(() => ({}));
    const post = update.channel_post || update.edited_channel_post;
    if (post) await triggerSync(env, post.chat?.username);
    return new Response("ok"); // 200 دائماً حتى لا يعيد تليجرام الإرسال
  },

  // الطريقة ٢: كل دقيقة نسأل تليجرام عن الجديد (تعمل فقط إن لم يكن هناك webhook مضبوط)
  async scheduled(_event, env) {
    if (!env.BOT_TOKEN) return;
    const api = `https://api.telegram.org/bot${env.BOT_TOKEN}`;
    const r = await fetch(`${api}/getUpdates?timeout=0&allowed_updates=${encodeURIComponent('["channel_post","edited_channel_post"]')}`);
    const d = await r.json().catch(() => ({}));
    if (!d.ok) { console.log("Telegram", JSON.stringify(d)); return; }
    if (!d.result?.length) return;
    const last = d.result[d.result.length - 1].update_id;
    const posts = d.result.map((u) => u.channel_post || u.edited_channel_post).filter(Boolean);
    if (posts.length && !(await triggerSync(env, posts[0].chat?.username))) return; // نعيد المحاولة في الدقيقة التالية
    await fetch(`${api}/getUpdates?offset=${last + 1}&timeout=0`); // تأكيد الاستلام حتى لا تتكرر
  },
};
