/* مكتبة الشيخ أبصار الإسلام — تطبيق ويب تقدّمي بلا أدوات بناء */
"use strict";

const PAGE = 20;
const S = {
  site: {}, programs: [], manual: [],
  tg: { shard: 500, channels: {}, books: [], videos: [] },
  yt: { playlists: [], items: [], sources: {} },
  byId: new Map(), shards: new Map(),
};

/* ================= أدوات ================= */
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const okUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const enc = encodeURIComponent;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const TZ = "Asia/Riyadh";
const gDate = new Intl.DateTimeFormat("ar", { year: "numeric", month: "long", day: "numeric", timeZone: TZ });
const hDate = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { year: "numeric", month: "long", day: "numeric", timeZone: TZ });
const fmtDate = (d) => { const t = Date.parse(d); return isNaN(t) ? "" : gDate.format(t); };
const fmtHijri = (d) => { const t = Date.parse(d); try { return isNaN(t) ? "" : hDate.format(t); } catch { return ""; } };
const num = (n) => Number(n || 0).toLocaleString("ar");

// توحيد النص العربي للبحث
function norm(s) {
  return String(s || "")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .toLowerCase();
}
const searchText = (it) => (it._s ??= norm([it.title, it.text, it.summary, it.excerpt, (it.tags || []).join(" ")].join(" ")));

function excerpt(t, n = 170) {
  t = String(t || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

// تنسيق نص المنشور: روابط، وآيات بين {} أو ﴿﴾، وأحاديث بين «»
function fmt(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,،؛:!?)\]»])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(\{[^{}<]{2,900}?\}|﴿[^﴾<]{2,900}?﴾)/g, '<span class="ayah">$1</span>')
    .replace(/(«[^«»<]{2,1500}?»)/g, '<span class="hadith">$1</span>');
}

function hl(text, q) {
  const s = esc(text);
  const words = (q || "").trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return words.length ? s.replace(new RegExp(`(${words.join("|")})`, "g"), "<mark>$1</mark>") : s;
}

const I = {
  book: '<svg class="i" viewBox="0 0 24 24"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
  video: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
  audio: '<svg class="i" viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/></svg>',
  file: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/></svg>',
  article: '<svg class="i" viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M8 11h8M8 15h8M8 7h5"/></svg>',
  save: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  share: '<svg class="i" viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  tg: '<svg class="i" viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l12-9"/></svg>',
  yt: '<svg class="i" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};
const STAR = '<svg viewBox="0 0 100 100"><path d="M50 4l11 23 25-6-6 25 16 4-16 4 6 25-25-6-11 23-11-23-25 6 6-25L3 50l16-4-6-25 25 6z"/></svg>';
const orn = `<div class="orn">${STAR}</div>`;
const TYPE = { article: "فائدة", video: "مرئي", audio: "صوتي", book: "كتاب", file: "ملف" };

/* ================= البيانات ================= */
const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

async function boot() {
  const [lib, tg, yt] = await Promise.all([getJSON("data/library.json"), getJSON("data/tg/index.json"), getJSON("data/youtube.json")]);
  S.site = lib.site || {};
  S.programs = lib.programs || [];
  S.manual = lib.items || [];
  S.tg = { shard: tg.shard || 500, channels: tg.channels || {}, books: tg.books || [], videos: tg.videos || [] };
  S.yt = { playlists: yt.playlists || [], items: yt.items || [], sources: yt.site?.sources || {} };
  for (const it of [...S.yt.items, ...S.tg.videos, ...S.tg.books]) tidy(it);
  for (const p of S.yt.playlists) p.title = p.title.replace(/^#\s*/, "").replace("الأسيوع", "الأسبوع");
  for (const it of [...S.manual, ...S.yt.items]) S.byId.set(it.id, it);
  S.ytByPl = new Map(S.yt.playlists.map((p) => [p.id, p]));
  S.ytByVid = new Map(S.yt.items.map((v) => [v.youtube, v]));
  S.tg.videos = S.tg.videos.filter((v) => !S.ytByVid.has(v.youtube));
  for (const v of S.tg.videos) enrich(v);
  renderFoot();
}

// حذف لاحقة «د. أبصار الإسلام» المكررة في عناوين يوتيوب
const tidy = (it) => { if (it?.title) it.title = it.title.replace(/\s*[|｜\-–—]?\s*(د\.|الدكتور|الشيخ)\s*أبصار الإسلام.*$/, "").trim() || it.title; return it; };

// منشور تليجرام فيه رابط فيديو من القناة: نأخذ عنوانه ووصفه من يوتيوب
function enrich(it) {
  const v = it.youtube && S.ytByVid?.get(it.youtube);
  if (v) Object.assign(it, { title: v.title, thumb: v.thumb, length: v.length, summary: v.summary });
  return it;
}

function shard(u, k) {
  const key = `${u}/${k}`;
  if (!S.shards.has(key)) {
    S.shards.set(key, getJSON(`data/tg/${u}/${k}.json`).then((d) => {
      const items = d.items || [];
      for (const it of items) S.byId.set(tidy(enrich(it)).id, it);
      return items;
    }));
  }
  return S.shards.get(key);
}

async function getItem(id) {
  if (S.byId.has(id)) return S.byId.get(id);
  const m = /^tg:([^/]+)\/(\d+)$/.exec(id);
  if (m && S.tg.channels[m[1]]) await shard(m[1], Math.floor(+m[2] / S.tg.shard));
  return S.byId.get(id);
}

const chOf = (it) => (it.source?.startsWith("tg:") ? it.source.slice(3) : null);
const programOf = (it) => S.programs.find((p) => p.id === (it.program || S.tg.channels[chOf(it)]?.program));
const sourceLabel = (it) => S.tg.channels[chOf(it)]?.label || S.yt.sources[it.source] || "";
const channelsOf = (pid) => Object.entries(S.tg.channels).filter(([, c]) => c.program === pid).map(([u]) => u);
const ytOf = (pid) => S.yt.items.filter((v) => v.program === pid);
const playlistsOf = (pid) => S.yt.playlists.filter((p) => p.program === pid && p.videos.length);

/* قارئ منشورات متدرّج: يدمج قناة أو أكثر حسب التاريخ ويحمّل الملفات عند الحاجة فقط */
class Feed {
  constructor(users, filter) {
    this.cur = users.filter((u) => S.tg.channels[u]).map((u) => ({ u, shards: [...S.tg.channels[u].shards], buf: [] }));
    this.filter = filter;
    this.done = false;
  }
  async fill(c) {
    while (!c.buf.length && c.shards.length) c.buf = (await shard(c.u, c.shards.shift())).slice();
  }
  async next(n) {
    const out = [];
    while (out.length < n) {
      await Promise.all(this.cur.map((c) => this.fill(c)));
      const live = this.cur.filter((c) => c.buf.length);
      if (!live.length) break;
      live.sort((a, b) => (b.buf[0].date || "").localeCompare(a.buf[0].date || ""));
      const it = live[0].buf.shift();
      if (!this.filter || this.filter(it)) out.push(it);
    }
    this.done = this.cur.every((c) => !c.buf.length && !c.shards.length);
    return out;
  }
}

/* ================= المحفوظات ================= */
let favs = store.get("favs", []);
const isFav = (id) => favs.some((f) => f.id === id);
function toggleFav(it) {
  favs = isFav(it.id) ? favs.filter((f) => f.id !== it.id)
    : [{ id: it.id, type: it.type, title: it.title, date: it.date, source: it.source, thumb: it.thumb, excerpt: excerpt(it.text || it.summary || it.excerpt), program: it.program }, ...favs];
  store.set("favs", favs);
}

/* ================= مكوّنات ================= */
const imgOf = (it) => (it.img && /^data\/img\/[\w/.-]+$/.test(it.img) ? it.img : okUrl(it.photo));

function thumb(it) {
  const book = it.type === "book";
  const src = okUrl(it.thumb) || imgOf(it);
  return `<div class="th${book ? " book" : ""}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : I[it.type] || I.article}${it.length ? `<span class="dur">${esc(it.length)}</span>` : ""}</div>`;
}

function row(it, q, showThumb = it.type !== "article" || (!it.text && !!imgOf(it))) {
  const p = programOf(it);
  const ex = excerpt(String(it.summary || it.excerpt || it.text || "").replace(/https?:\/\/\S+/g, ""));
  return `<a class="row" href="#/i/${enc(it.id)}">
    ${showThumb ? thumb(it) : ""}
    <div class="bd">
      <h3>${hl(it.title || ex.slice(0, 80), q)}</h3>
      ${ex && ex !== it.title ? `<div class="ex">${hl(ex, q)}</div>` : ""}
      <div class="meta">${it.type !== "article" ? `<span class="k">${TYPE[it.type] || ""}</span>` : ""}${p ? `<span>${esc(p.title)}</span>` : ""}${it.size ? `<span>${esc(it.size)}</span>` : ""}${it.date ? `<span>${fmtDate(it.date)}</span>` : ""}</div>
    </div>
  </a>`;
}

function programCard(p) {
  const posts = channelsOf(p.id).reduce((n, u) => n + S.tg.channels[u].count, 0);
  const vids = ytOf(p.id).length;
  return `<a class="pcard" href="#/p/${enc(p.id)}">
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.description || "")}</p>
    <div class="meta">${posts ? `<span>${num(posts)} منشور</span>` : ""}${vids ? `<span>${num(vids)} مرئي</span>` : ""}</div>
  </a>`;
}

function playlistCard(p) {
  const first = S.byId.get(p.videos[p.videos.length - 1]) || S.byId.get(p.videos[0]);
  return `<a class="plcard" href="#/pl/${enc(p.id)}">
    <div class="cv">${first?.thumb ? `<img src="${esc(first.thumb)}" alt="" loading="lazy">` : ""}<span><b>${num(p.videos.length)}</b>مقطع</span></div>
    <h3>${esc(p.title)}</h3>
  </a>`;
}

function groupPlaylists(prog, pls) {
  const groups = (prog?.playlistGroups || []).map((g) => ({ ...g, re: new RegExp(g.match), list: [] }));
  const other = { title: groups.length ? "سلاسل أخرى" : "", list: [] };
  const latest = (p) => p.videos.map((v) => S.byId.get(v)?.date || "").sort().pop() || "";
  for (const p of pls) (groups.find((g) => g.re.test(p.title)) || other).list.push(p);
  return [...groups, other].filter((g) => g.list.length).sort((a, b) => (a.pos ?? 9) - (b.pos ?? 9)).map((g) => ({ ...g,
    list: g.list.sort((a, b) => (g.weeks ? (b.week || 0) - (a.week || 0) : 0) || latest(b).localeCompare(latest(a))) }));
}

/* قائمة بزر «المزيد» — من مصفوفة جاهزة أو من Feed متدرّج */
const after = [];
function list(source, opts = {}) {
  const id = "l" + Math.random().toString(36).slice(2, 8);
  after.push(async (tok) => {
    const box = document.getElementById(id), btn = document.getElementById(id + "b");
    if (!box) return;
    let shown = 0;
    const isFeed = source instanceof Feed;
    const more = async () => {
      btn.disabled = true; btn.textContent = "جارٍ التحميل…";
      const items = isFeed ? await source.next(PAGE) : source.slice(shown, shown + PAGE);
      if (tok !== token) return;
      shown += items.length;
      box.insertAdjacentHTML("beforeend", items.map((i) => row(i, opts.q)).join(""));
      if (!shown) box.outerHTML = `<div class="empty">${opts.empty || "لا توجد مواد."}</div>`;
      btn.hidden = isFeed ? source.done : shown >= source.length;
      btn.disabled = false; btn.textContent = "عرض المزيد";
    };
    btn.addEventListener("click", more);
    await more();
  });
  return `<div class="rows${opts.two === false ? "" : " two"}" id="${id}"></div><button class="btn wide" id="${id}b" hidden>عرض المزيد</button>`;
}

/* ================= الصفحات ================= */
function viewHome() {
  const s = S.site;
  const posts = Object.values(S.tg.channels).reduce((n, c) => n + c.count, 0);
  const latest = Object.values(S.tg.channels).flatMap((c) => c.latest).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const vids = S.yt.items.slice(0, 4);
  const books = [...S.manual.filter((i) => i.type === "book"), ...S.tg.books].slice(0, 4);
  return `
  <section class="hero">
    <p class="pre">${esc(s.pre || "مكتبة الشيخ")}</p>
    <h1>${esc(s.sheikh || "")}</h1>
    <p class="lede">${esc(s.lede || "")}</p>
    <form class="field" action="#/search" data-search>${I.search}<input name="q" type="search" placeholder="ابحث في الفوائد والمرئيات والكتب…" autocomplete="off"></form>
    <div class="stats">
      <span><b>${num(S.programs.length)}</b>برامج</span>
      <span><b>${num(posts)}</b>منشور</span>
      <span><b>${num(S.yt.items.length + S.tg.videos.length)}</b>مرئي</span>
      <span><b>${num(S.tg.books.length + S.manual.filter((i) => i.type === "book").length)}</b>كتاب</span>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>البرامج</h2><a class="more" href="#/programs">كل البرامج ←</a></div>
    <div class="pgrid">${S.programs.map(programCard).join("")}</div>
  </section>

  ${latest.length ? `<section class="sec">
    <div class="sec-h"><h2>أحدث الفوائد</h2></div>
    <div class="rows two">${latest.map((i) => row(i)).join("")}</div>
  </section>` : ""}

  ${vids.length ? `<section class="sec">
    <div class="sec-h"><h2>أحدث المرئيات</h2><a class="more" href="#/videos">كل المرئيات ←</a></div>
    <div class="rows two">${vids.map((i) => row(i)).join("")}</div>
  </section>` : ""}

  ${books.length ? `<section class="sec">
    <div class="sec-h"><h2>الكتب</h2><a class="more" href="#/books">كل الكتب ←</a></div>
    <div class="rows two">${books.map((i) => row(i)).join("")}</div>
  </section>` : ""}`;
}

function viewPrograms() {
  return `<div class="page-h"><h1>البرامج</h1><p>البرامج العلمية والقنوات التي يشرف عليها الشيخ.</p></div>
    <div class="pgrid">${S.programs.map(programCard).join("")}</div>`;
}

function viewProgram(id, qs) {
  const p = S.programs.find((x) => x.id === id);
  if (!p) return notFound();
  const chans = channelsOf(id);
  const pls = playlistsOf(id), vids = ytOf(id);
  const weekCh = chans.find((u) => S.tg.channels[u].weeks?.length);
  const tabs = [];
  if (weekCh) tabs.push(["weeks", "الأسابيع"]);
  if (chans.length) tabs.push(["posts", "المنشورات"]);
  if (chans.some((u) => S.tg.channels[u].types?.file)) tabs.push(["files", "الملفات"]);
  if (vids.length) tabs.push(["videos", "المرئيات"]);
  const tab = qs.get("tab") || tabs[0]?.[0];
  const link = (o) => {
    const q = new URLSearchParams({ tab, ...o });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    return `#/p/${enc(id)}?${q}`;
  };

  let body = "";
  if (tab === "posts") {
    const ch = chans.includes(qs.get("ch")) ? qs.get("ch") : "";
    const tag = qs.get("tag") || "";
    const users = ch ? [ch] : chans;
    const tagCounts = {};
    for (const u of users) for (const [t, c] of S.tg.channels[u].tags || []) tagCounts[t] = (tagCounts[t] || 0) + c;
    const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    body += chans.length > 1 ? `<div class="chips">
        <a class="chip ${!ch ? "on" : ""}" href="${link({})}">الكل</a>
        ${chans.map((u) => `<a class="chip ${u === ch ? "on" : ""}" href="${link({ ch: u })}">${esc(S.tg.channels[u].label)}<small>${num(S.tg.channels[u].count)}</small></a>`).join("")}
      </div>` : "";
    body += tags.length ? `<div class="chips">
        <a class="chip ${!tag ? "on" : ""}" href="${link({ ch })}">كل المواضيع</a>
        ${tags.map(([t, c]) => `<a class="chip ${t === tag ? "on" : ""}" href="${link({ ch, tag: t })}">#${esc(t.replace(/_/g, " "))}<small>${num(c)}</small></a>`).join("")}
      </div>` : "";
    body += list(new Feed(users, tag ? (it) => it.tags?.includes(tag) : (it) => it.type !== "book" && it.type !== "file"), { empty: "لا توجد منشورات." });
  } else if (tab === "files") {
    body += `<p class="muted" style="margin:0 0 12px">ملفات البرنامج (PDF): التفسير، ومعاني الكلمات، والوقف والابتداء، والفوائد، والعمل بالآيات، والتفريغات، والجداول.</p>`
      + list(new Feed(chans, (it) => it.type === "file"), { empty: "لا توجد ملفات." });
  } else if (tab === "weeks") {
    body += `<p class="muted" style="margin:0 0 12px">كل أسبوع مقطعٌ من القرآن: مقرر الحفظ، ودروسه المرئية، وملفاته (التفسير، ومعاني الكلمات، والوقف والابتداء، والفوائد، والعمل بالآيات).</p>
      <div class="rows two">${S.tg.channels[weekCh].weeks.map((w) => weekCard(weekCh, w)).join("")}</div>`;
  } else if (tab === "videos") {
    const groups = groupPlaylists(p, pls);
    const gi = qs.get("g");
    if (gi !== null && groups[+gi]) {
      const g = groups[+gi];
      body += `<div class="chips"><a class="chip" href="${link({})}">كل المجموعات</a>${groups.map((x, i) => `<a class="chip ${i === +gi ? "on" : ""}" href="${link({ g: String(i) })}">${esc(x.title)}<small>${num(x.list.length)}</small></a>`).join("")}</div>
        <div class="plgrid">${g.list.map(playlistCard).join("")}</div>`;
    } else {
      body += groups.map((g, i) => `<div class="sec-h" style="margin-top:18px"><h2 style="font-size:22px">${esc(g.title)}</h2>${g.list.length > 8 ? `<a class="more" href="${link({ g: String(i) })}">الكل (${num(g.list.length)}) ←</a>` : ""}</div>
        <div class="plgrid">${g.list.slice(0, 8).map(playlistCard).join("")}</div>`).join("");
      body += `<h2 class="grp-h">أحدث المرئيات</h2>` + list(vids);
    }
  }

  const links = [
    ...chans.map((u) => `<a class="btn" href="https://t.me/${esc(u)}" target="_blank" rel="noopener">${I.tg} ${esc(S.tg.channels[u].label)}</a>`),
    ...(okUrl(p.youtube) ? [`<a class="btn" href="${esc(p.youtube)}" target="_blank" rel="noopener">${I.yt} قناة يوتيوب</a>`] : []),
  ];
  return `<div class="page-h">
      <div class="crumb"><a href="#/programs">البرامج</a> ‹</div>
      <h1>${esc(p.title)}</h1>
      <p>${esc(p.description || "")}</p>
      ${links.length ? `<div class="actions">${links.join("")}</div>` : ""}
    </div>
    ${tabs.length > 1 ? `<nav class="tabs">${tabs.map(([k, l]) => `<a class="${k === tab ? "on" : ""}" href="#/p/${enc(id)}?tab=${k}">${l}</a>`).join("")}</nav>` : ""}
    ${body}`;
}

const weekPls = (no) => S.yt.playlists.filter((p) => p.week === no);
const weekTitle = (w) => weekPls(w.no)[0]?.title || `الأسبوع ${num(w.no)}`;

function weekCard(u, w) {
  return `<a class="row" href="#/w/${enc(u)}/${w.no}">
    <div class="th" style="width:70px;aspect-ratio:1;flex-direction:column;font-family:var(--f-head)"><b style="font-size:26px;line-height:1">${num(w.no)}</b><small class="muted" style="font-size:12px">الأسبوع</small></div>
    <div class="bd">
      <h3>${esc(w.passage || weekTitle(w))}</h3>
      <div class="ex">${esc(weekTitle(w))}</div>
      <div class="meta">${w.videos.length ? `<span>${num(w.videos.length)} مقاطع</span>` : ""}${w.files.length ? `<span>${num(w.files.length)} ملفات</span>` : ""}<span>${fmtDate(w.start)}</span></div>
    </div>
  </a>`;
}

async function viewWeek(u, no) {
  const ch = S.tg.channels[u];
  const w = ch?.weeks?.find((x) => x.no === no);
  if (!w) return notFound();
  const p = S.programs.find((x) => x.id === ch.program);
  // منشورات الأسبوع بترتيبها الزمني
  const ks = new Set(); for (let n = w.from; n <= w.to; n += S.tg.shard) ks.add(Math.floor(n / S.tg.shard)); ks.add(Math.floor(w.to / S.tg.shard));
  const items = (await Promise.all([...ks].map((k) => shard(u, k)))).flat().filter((it) => it.week === no).sort((a, b) => a.n - b.n);
  const vids = items.filter((i) => i.type === "video");
  const files = items.filter((i) => i.type === "file");
  const posts = items.filter((i) => i.type === "article" || i.type === "audio");
  const pls = weekPls(no);
  const idx = ch.weeks.indexOf(w);
  const prev = ch.weeks[idx + 1], next = ch.weeks[idx - 1];
  const fileRow = (f) => `<a class="row" href="${esc(okUrl(f.url))}" target="_blank" rel="noopener">
      <div class="th book">${I.file}</div>
      <div class="bd"><h3>${esc(f.title)}</h3><div class="meta"><span class="k">PDF</span>${f.size ? `<span>${esc(f.size)}</span>` : ""}<span>تحميل من تليجرام ←</span></div></div></a>`;
  return `<div class="page-h">
      <div class="crumb">${p ? `<a href="#/p/${enc(p.id)}?tab=weeks">${esc(p.title)}</a> ‹ ` : ""}الأسابيع ‹</div>
      <h1>${esc(weekTitle(w))}</h1>
      ${w.passage ? `<p style="color:var(--acc);font-weight:700">${esc(w.passage)}</p>` : ""}
      <p class="muted">${fmtHijri(w.start)} — ${fmtHijri(w.end)}</p>
      ${pls.length ? `<div class="actions">${pls.map((pl) => `<a class="btn" href="#/pl/${enc(pl.id)}">${I.yt} ${esc(pl.title)}</a>`).join("")}</div>` : ""}
    </div>
    ${vids.length ? `<section class="sec" style="padding-top:0"><div class="sec-h"><h2>الدروس المرئية</h2></div><div class="rows two">${vids.map((i) => row(i)).join("")}</div></section>` : ""}
    ${files.length ? `<section class="sec"><div class="sec-h"><h2>ملفات الأسبوع</h2></div><div class="rows two">${files.map(fileRow).join("")}</div></section>` : ""}
    ${posts.length ? `<section class="sec"><div class="sec-h"><h2>منشورات الأسبوع</h2></div><div class="rows">${posts.map((i) => row(i, "", false)).join("")}</div></section>` : ""}
    <nav class="pager">${prev ? `<a href="#/w/${enc(u)}/${prev.no}">→ الأسبوع السابق<b>${esc(prev.passage || weekTitle(prev))}</b></a>` : "<span></span>"}${next ? `<a class="next" href="#/w/${enc(u)}/${next.no}">الأسبوع التالي ←<b>${esc(next.passage || weekTitle(next))}</b></a>` : ""}</nav>`;
}

function viewVideos() {
  const progs = S.programs.filter((p) => playlistsOf(p.id).length);
  return `<div class="page-h"><h1>المرئيات</h1><p>دروس البرامج على يوتيوب مرتّبةً في سلاسلها، والمقاطع المنشورة في القنوات.</p></div>
    ${progs.map((p) => groupPlaylists(p, playlistsOf(p.id)).map((g, gi) => `
      <section class="sec"><div class="sec-h"><h2>${esc(g.title || p.title)}</h2><a class="more" href="#/p/${enc(p.id)}?tab=videos&g=${gi}">الكل (${num(g.list.length)}) ←</a></div>
      <div class="plgrid">${g.list.slice(0, 8).map(playlistCard).join("")}</div></section>`).join("")).join("")}
    <section class="sec"><div class="sec-h"><h2>أحدث المرئيات</h2></div>${list(S.yt.items)}</section>
    ${S.tg.videos.length ? `<section class="sec"><div class="sec-h"><h2>مقاطع منشورة في القنوات</h2></div>${list(S.tg.videos)}</section>` : ""}`;
}

function viewPlaylist(id) {
  const p = S.ytByPl.get(id);
  if (!p) return notFound();
  const prog = S.programs.find((x) => x.id === p.program);
  const vids = p.videos.map((v) => S.byId.get(v)).filter(Boolean).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return `<div class="page-h">
      <div class="crumb">${prog ? `<a href="#/p/${enc(prog.id)}?tab=videos">${esc(prog.title)}</a> ‹` : `<a href="#/videos">المرئيات</a> ‹`}</div>
      <h1>${esc(p.title)}</h1>
      <p>${num(vids.length)} مقطع</p>
      <div class="actions"><a class="btn" href="https://www.youtube.com/playlist?list=${enc(id)}" target="_blank" rel="noopener">${I.yt} القائمة على يوتيوب</a></div>
    </div>${list(vids, { two: false })}`;
}

function viewBooks(qs) {
  const books = [...S.manual.filter((i) => i.type === "book"), ...S.tg.books];
  const series = {};
  for (const b of books) if (b.series) (series[b.series] ||= []).push(b);
  const sel = qs.get("s");
  if (sel && series[sel]) {
    const lst = series[sel].slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return `<div class="page-h"><div class="crumb"><a href="#/books">الكتب</a> ‹</div><h1>${esc(sel)}</h1><p>${num(lst.length)} رسالة، مرتبةً بتاريخ نشرها.</p></div>${list(lst)}`;
  }
  const singles = books.filter((b) => !b.series);
  const cards = Object.entries(series).sort((a, b) => b[1].length - a[1].length).map(([name, lst]) =>
    `<a class="pcard" href="#/books?s=${enc(name)}"><h3>${esc(name)}</h3>
      <p>${esc(lst.slice(-3).map((b) => b.title.replace(name, "").replace(/^\s*[-ـ–]\s*/, "")).join("، "))}…</p>
      <div class="meta"><span>${num(lst.length)} رسالة</span></div></a>`).join("");
  return `<div class="page-h"><h1>الكتب</h1><p>مؤلفات الشيخ وسلاسله العلمية، وما أُخرج من ثمرات برامجه، وكلها قابلة للتحميل.</p></div>
    ${cards ? `<section class="sec" style="padding-top:0"><div class="sec-h"><h2>السلاسل</h2></div><div class="pgrid">${cards}</div></section>` : ""}
    <section class="sec"><div class="sec-h"><h2>كتب ورسائل</h2></div>${list(singles, { empty: "لا توجد كتب بعد." })}</section>`;
}

async function viewItem(id) {
  const it = await getItem(id);
  if (!it) return notFound();
  const p = programOf(it);
  const u = chOf(it);
  let media = "";
  if (it.youtube) media = `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${enc(it.youtube)}?rel=0" title="${esc(it.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  else if (imgOf(it)) media = `<img class="photo" src="${esc(imgOf(it))}" alt="" loading="lazy" onerror="this.remove()">`;
  const text = it.text || it.summary || "";
  const btns = [];
  if ((it.type === "book" || it.type === "file") && okUrl(it.url)) btns.push(`<a class="btn pri" href="${esc(it.url)}" target="_blank" rel="noopener">${I.down} تحميل ${it.type === "book" ? "الكتاب" : "الملف"}${it.size ? ` (${esc(it.size)})` : ""}</a>`);
  else if (okUrl(it.file)) btns.push(`<a class="btn pri" href="${esc(it.file)}" target="_blank" rel="noopener">${I.down} تحميل</a>`);
  if (it.week && u) btns.push(`<a class="btn" href="#/w/${enc(u)}/${it.week}">الأسبوع ${num(it.week)}</a>`);
  if (okUrl(it.url) && it.type !== "book" && it.type !== "file") btns.push(`<a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">${u ? I.tg + " في تليجرام" : I.yt + " في يوتيوب"}</a>`);
  btns.push(`<button class="btn ${isFav(it.id) ? "on" : ""}" type="button" data-fav>${I.save} <span>${isFav(it.id) ? "محفوظ" : "حفظ"}</span></button>`);
  btns.push(`<button class="btn" type="button" data-share>${I.share} مشاركة</button>`);

  after.push((tok) => pager(it, tok));
  after.push(() => {
    const b = $app.querySelector("[data-fav]");
    b?.addEventListener("click", () => { toggleFav(it); b.classList.toggle("on", isFav(it.id)); b.querySelector("span").textContent = isFav(it.id) ? "محفوظ" : "حفظ"; });
  });
  const hij = fmtHijri(it.date);
  return `<article class="read">
    <header class="read-h">
      <div class="crumb">${p ? `<a href="#/p/${enc(p.id)}${it.youtube && !u ? "?tab=videos" : ""}">${esc(p.title)}</a>` : ""}${u && S.tg.channels[u] && channelsOf(p?.id).length > 1 ? ` ‹ <a href="#/p/${enc(p.id)}?tab=posts&ch=${enc(u)}">${esc(S.tg.channels[u].label)}</a>` : ""}</div>
      <h1>${esc(it.title)}</h1>
      <div class="meta"><span class="k">${TYPE[it.type] || ""}</span>${hij ? `<span>${hij}</span>` : ""}${it.date ? `<span>${fmtDate(it.date)}</span>` : ""}</div>
    </header>
    ${media}
    ${text ? `<div class="paper"><div class="prose">${fmt(text)}</div></div>` : ""}
    <div class="actions">${btns.join("")}
      ${text ? `<span class="fsz" style="margin-inline-start:auto"><button type="button" data-fs="-1" aria-label="تصغير الخط">أ−</button><button type="button" data-fs="1" aria-label="تكبير الخط">أ+</button></span>` : ""}
    </div>
    <nav class="pager" id="pager"></nav>
  </article>`;
}

// السابق/التالي داخل القناة نفسها، أو داخل قائمة التشغيل للمرئيات
async function pager(it, tok) {
  let older, newer;
  const u = chOf(it);
  if (u && S.tg.channels[u]) {
    const ch = S.tg.channels[u], k = Math.floor(it.n / S.tg.shard);
    const items = await shard(u, k);
    const i = items.findIndex((x) => x.id === it.id);
    newer = items[i - 1] || (ch.shards.includes(k + 1) ? (await shard(u, k + 1)).at(-1) : null);
    older = items[i + 1] || (ch.shards.includes(k - 1) ? (await shard(u, k - 1))[0] : null);
  } else if (it.playlists?.length) {
    const vids = S.ytByPl.get(it.playlists[0]).videos.map((v) => S.byId.get(v)).filter(Boolean).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const i = vids.findIndex((x) => x.id === it.id);
    older = vids[i - 1]; newer = vids[i + 1];
  }
  const el = document.getElementById("pager");
  if (tok !== token || !el) return;
  el.innerHTML = (older ? `<a href="#/i/${enc(older.id)}">→ السابق<b>${esc(older.title)}</b></a>` : "<span></span>")
    + (newer ? `<a class="next" href="#/i/${enc(newer.id)}">التالي ←<b>${esc(newer.title)}</b></a>` : "");
}

function viewSearch(qs) {
  const q = (qs.get("q") || "").trim();
  const pf = qs.get("p") || "";
  after.push((tok) => runSearch(q, pf, tok));
  return `<div class="page-h"><h1>البحث</h1></div>
    <form class="field" style="margin:0 0 12px;max-width:none" data-search>${I.search}<input name="q" type="search" value="${esc(q)}" placeholder="كلمة أو عبارة… (لا يلزم التشكيل)" autocomplete="off" ${q ? "" : "autofocus"}>${pf ? `<input type="hidden" name="p" value="${esc(pf)}">` : ""}</form>
    <div class="chips"><a class="chip ${!pf ? "on" : ""}" href="#/search?q=${enc(q)}">كل البرامج</a>${S.programs.map((p) => `<a class="chip ${p.id === pf ? "on" : ""}" href="#/search?q=${enc(q)}&p=${enc(p.id)}">${esc(p.title)}</a>`).join("")}</div>
    <div class="progress" id="sprog"></div>
    <div class="rows" id="sres"></div>
    <button class="btn wide" id="smore" hidden>عرض المزيد</button>`;
}

async function runSearch(q, pf, tok) {
  const prog = document.getElementById("sprog"), res = document.getElementById("sres"), moreBtn = document.getElementById("smore");
  if (!q) { prog.textContent = "ابحث في كل ما نُشر في القنوات، وفي عناوين المرئيات والكتب."; return; }
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const match = (it) => terms.every((t) => searchText(it).includes(t));
  const inProg = (it) => !pf || programOf(it)?.id === pf;
  const found = [], seen = new Set();
  let shown = PAGE;
  const add = (items) => { for (const it of items) if (!seen.has(it.id) && inProg(it) && match(it)) { seen.add(it.id); found.push(it); } };
  const paint = (doneN, total) => {
    // العناوين المطابقة أولاً، ثم الأحدث
    const t0 = norm(q);
    found.sort((a, b) => (norm(b.title).includes(t0) - norm(a.title).includes(t0)) || (b.date || "").localeCompare(a.date || ""));
    res.innerHTML = found.slice(0, shown).map((i) => row(i, q)).join("") || (doneN === total ? `<div class="empty">لا نتائج لـ «${esc(q)}».</div>` : "");
    moreBtn.hidden = found.length <= shown;
    prog.textContent = `${num(found.length)} نتيجة` + (doneN < total ? ` — جارٍ البحث في الأرشيف (${Math.round((doneN / total) * 100)}٪)…` : "");
  };
  moreBtn.onclick = () => { shown += PAGE; paint(1, 1); };
  add([...S.yt.items, ...S.manual, ...S.tg.books]);
  const jobs = Object.entries(S.tg.channels).filter(([, c]) => !pf || c.program === pf).flatMap(([u, c]) => c.shards.map((k) => [u, k]));
  paint(0, jobs.length || 1);
  let done = 0;
  for (const [u, k] of jobs) {
    add(await shard(u, k));
    if (tok !== token) return;
    paint(++done, jobs.length);
  }
  paint(1, 1);
}

function viewFavorites() {
  return `<div class="page-h"><h1>المحفوظات</h1><p>ما حفظته من فوائد ومرئيات وكتب، محفوظ على هذا الجهاز.</p></div>
    ${favs.length ? list(favs) : `<div class="empty">لم تحفظ شيئاً بعد. اضغط «حفظ» في أي مادة لتجدها هنا.</div>`}`;
}

const notFound = () => `<div class="empty">لم يُعثر على هذه الصفحة. <a href="#/" style="color:var(--acc)">العودة للرئيسية</a></div>`;

function renderFoot() {
  const s = S.site;
  const chans = Object.entries(S.tg.channels);
  document.getElementById("foot").innerHTML = `
    <div>${esc(s.name || "")} — ${esc(s.sheikh || "")}</div>
    <div class="links">${chans.map(([u, c]) => `<a href="https://t.me/${esc(u)}" target="_blank" rel="noopener">${esc(c.label)}</a>`).join("")}
    ${S.programs.filter((p) => okUrl(p.youtube)).map((p) => `<a href="${esc(p.youtube)}" target="_blank" rel="noopener">يوتيوب: ${esc(p.title)}</a>`).join("")}</div>
    ${okUrl(s.contact) ? `<div style="margin-top:6px">للتواصل والملاحظات: <a href="${esc(s.contact)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(s.contact.replace("https://t.me/", "@"))}</a></div>` : ""}`;
}

/* ================= الموجّه ================= */
let token = 0;
async function render() {
  const my = ++token;
  after.length = 0;
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, qstr] = hash.split("?");
  const qs = new URLSearchParams(qstr || "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  let nav = "";
  let out;
  switch (parts[0]) {
    case undefined: out = viewHome(); nav = "home"; break;
    case "programs": out = viewPrograms(); nav = "programs"; break;
    case "p": out = viewProgram(parts[1], qs); nav = "programs"; break;
    case "videos": out = viewVideos(); nav = "videos"; break;
    case "pl": out = viewPlaylist(parts[1]); nav = "videos"; break;
    case "w": out = viewWeek(parts[1], +parts[2]); nav = "programs"; break;
    case "books": out = viewBooks(qs); nav = "books"; break;
    case "i": out = viewItem(parts.slice(1).join("/")); break;
    case "search": out = viewSearch(qs); break;
    case "favorites": out = viewFavorites(); nav = "favorites"; break;
    default: out = notFound();
  }
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  if (out instanceof Promise) {
    $app.innerHTML = `<div class="loading">جارٍ التحميل…</div>`;
    out = await out;
  }
  if (my !== token) return;
  const jobs = after.splice(0);
  $app.innerHTML = out;
  window.scrollTo(0, 0);
  for (const j of jobs) j(my);
  const auto = $app.querySelector("[autofocus]");
  if (auto && matchMedia("(min-width: 900px)").matches) auto.focus();
}

/* ================= أحداث عامة ================= */
$app.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-search]");
  if (!f) return;
  e.preventDefault();
  const q = f.q.value.trim(), p = f.p?.value;
  location.hash = `#/search?q=${enc(q)}${p ? `&p=${enc(p)}` : ""}`;
});

$app.addEventListener("click", async (e) => {
  const fs = e.target.closest("[data-fs]");
  if (fs) {
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 19;
    const v = Math.min(30, Math.max(15, cur + 2 * +fs.dataset.fs));
    document.documentElement.style.setProperty("--fs", v + "px");
    store.set("fs", v);
    return;
  }
  if (e.target.closest("[data-share]")) {
    const title = $app.querySelector("h1")?.textContent || document.title;
    try {
      if (navigator.share) await navigator.share({ title, url: location.href });
      else { await navigator.clipboard.writeText(location.href); e.target.closest("[data-share]").lastChild.textContent = " نُسخ الرابط"; }
    } catch {}
  }
});

const root = document.documentElement;
document.getElementById("themeBtn").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  store.set("theme", root.dataset.theme);
});

window.addEventListener("hashchange", render);
boot().then(render);

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
