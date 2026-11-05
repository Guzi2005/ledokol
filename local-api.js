// All user data stays in this origin's IndexedDB. No application API requests leave the browser.
const STORE = "ledokol";
const defaults = {
  settings: { layerOrder: ["en", "ja", "ru"], wordsPerPage: { en: 8, ja: 8, ru: 8 }, sourceTags: { en: ["starter"], ja: ["starter"], ru: ["starter"] }, pendingThrottle: 1 },
  mastery: {}, queue: [], seq: 0
};
const starter = {
  en: [["ice","冰"],["boat","船"],["sun","太阳"],["moon","月亮"],["book","书"],["water","水"],["friend","朋友"],["winter","冬天"],["snow","雪"],["star","星星"],["house","房子"],["tree","树"]],
  ja: [["氷","冰","こおり"],["船","船","ふね"],["太陽","太阳","たいよう"],["月","月亮","つき"],["本","书","ほん"],["水","水","みず"],["友達","朋友","ともだち"],["冬","冬天","ふゆ"],["雪","雪","ゆき"],["星","星星","ほし"],["家","房子","いえ"],["木","树","き"]],
  ru: [["лёд","冰"],["лодка","船"],["солнце","太阳"],["луна","月亮"],["книга","书"],["вода","水"],["друг","朋友"],["зима","冬天"],["снег","雪"],["звезда","星星"],["дом","房子"],["дерево","树"]]
};
const sample = Object.entries(starter).flatMap(([lang, rows]) => rows.map(([head, gloss, reading]) => ({ hash: `${lang}:${head}`, lang, head, gloss: [gloss], reading: reading || null, phonetic: null, tags: ["starter"], examples: [] })));

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ledokol-local-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function write(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
async function snapshot() {
  const state = await read("state") || structuredClone(defaults);
  const lexicon = await read("lexicon") || structuredClone(sample);
  return { state, lexicon };
}
function detail(word) { return { hash: word.hash, lang: word.lang, head: word.head, gloss: word.gloss, examples: word.examples || [] }; }
function pageView(page, lexicon) {
  const byHash = new Map(lexicon.map((word) => [word.hash, word]));
  return { ...page, layers: page.layers.map((layer) => ({ lang: layer.lang, words: layer.words.map((hash) => byHash.get(hash) || { hash, head: "(已移除)", gloss: [], tags: [] }) })) };
}
function queueView(state) {
  const pages = state.queue.map((page) => ({ id: page.id, createdAt: page.createdAt, status: page.status, finishedAt: page.finishedAt, hasStory: Boolean(page.story), layers: page.layers.map((layer) => ({ lang: layer.lang, count: layer.words.length })) }));
  return { pages, pending: pages.filter((page) => page.status === "pending") };
}
function choose(state, lexicon, lang, count, exclude) {
  const tags = state.settings.sourceTags[lang] || [];
  const pool = lexicon.filter((word) => word.lang === lang && word.gloss?.length && word.head && word.hash && (!tags.length || word.tags?.some((tag) => tags.includes(tag))) && !exclude.has(word.hash));
  pool.sort((a, b) => { const ma = state.mastery[a.hash] || { k: 0, u: 0 }; const mb = state.mastery[b.hash] || { k: 0, u: 0 }; return (mb.u * 2 - mb.k) - (ma.u * 2 - ma.k) || a.head.localeCompare(b.head); });
  return pool.slice(0, count).map((word) => word.hash);
}
export async function localRequest(path, body, method = "GET") {
  const { state, lexicon } = await snapshot();
  const url = new URL(path, location.origin);
  if (url.pathname === "/api/state") {
    const byLang = {};
    lexicon.forEach((word) => byLang[word.lang] = (byLang[word.lang] || 0) + 1);
    return { settings: state.settings, lexicon: { empty: !lexicon.length, byLang }, queue: { pending: state.queue.filter((page) => page.status === "pending").length, total: state.queue.length, throttle: state.settings.pendingThrottle } };
  }
  if (url.pathname === "/api/queue") return queueView(state);
  if (url.pathname === "/api/settings") {
    if (method === "PUT") { state.settings = { ...state.settings, ...body }; await write("state", state); }
    return state.settings;
  }
  if (url.pathname === "/api/book") {
    const lang = url.searchParams.get("lang") || "en", q = (url.searchParams.get("q") || "").toLowerCase();
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0), limit = Math.min(200, Number(url.searchParams.get("limit")) || 200);
    const words = lexicon.filter((word) => word.lang === lang && (!q || word.head.toLowerCase().includes(q) || String(word.reading || "").includes(q))).sort((a,b) => a.head.localeCompare(b.head));
    const groups = new Map();
    words.slice(offset, offset + limit).forEach((word) => { const tag = word.tags?.[0] || "个人词本"; if (!groups.has(tag)) groups.set(tag, { tag, words: [] }); groups.get(tag).words.push({ ...word, mastery: state.mastery[word.hash] || { k: 0, u: 0, last: null } }); });
    return { lang, total: words.length, offset, limit, groups: [...groups.values()] };
  }
  if (url.pathname === "/api/enqueue") {
    const pending = state.queue.filter((page) => page.status === "pending").length;
    if (pending >= state.settings.pendingThrottle) return { silent: true, pending, throttle: state.settings.pendingThrottle };
    const exclude = new Set(state.queue.filter((page) => page.status === "pending").flatMap((page) => page.layers.flatMap((layer) => layer.words)));
    const layers = state.settings.layerOrder.map((lang) => ({ lang, words: choose(state, lexicon, lang, Number(state.settings.wordsPerPage[lang]) || 0, exclude) })).filter((layer) => layer.words.length);
    if (!layers.length) return { empty: true, silent: false };
    const page = { id: `LDK-${String(++state.seq).padStart(4,"0")}`, createdAt: new Date().toISOString(), status: "pending", layers, results: {}, story: null, finishedAt: null };
    state.queue.push(page); await write("state", state); return { silent: false, page };
  }
  const match = url.pathname.match(/^\/api\/page\/([^/]+)(?:\/(mark|finish|story))?$/);
  if (match) {
    const page = state.queue.find((item) => item.id === decodeURIComponent(match[1]));
    if (!page) throw new Error("没有这页冰层");
    if (!match[2]) return pageView(page, lexicon);
    if (match[2] === "mark") {
      if (!page.layers.some((layer) => layer.words.includes(body.hash))) throw new Error("词不在本页");
      if (!Object.hasOwn(page.results, body.hash)) { page.results[body.hash] = Boolean(body.known); const m = state.mastery[body.hash] || { k:0,u:0,last:null }; if (body.known) { m.k++; m.u = Math.max(0,m.u-1); } else { m.u++; m.k = Math.max(0,m.k-1); } m.last = new Date().toISOString(); state.mastery[body.hash] = m; await write("state",state); }
      return { ok: true, results: page.results };
    }
    if (match[2] === "finish") {
      if (page.layers.some((layer) => layer.words.some((hash) => !Object.hasOwn(page.results,hash)))) throw new Error("请先敲完所有冰块");
      page.status = "done"; page.finishedAt ||= new Date().toISOString(); await write("state",state);
      return { ok:true, total:page.layers.reduce((n,layer)=>n+layer.words.length,0), known:Object.values(page.results).filter(Boolean).length, unknown:page.layers.flatMap((layer)=>layer.words.filter((hash)=>page.results[hash]===false).map((hash)=>detail(lexicon.find((word)=>word.hash===hash) || {hash,lang:layer.lang,head:hash,gloss:[]}))), story:page.story };
    }
    if (match[2] === "story") { page.story = String(body.text || "").trim(); await write("state",state); return { ok:true, story:page.story }; }
  }
  throw new Error(`不支持的操作：${url.pathname}`);
}
export async function exportBackup() { return snapshot(); }
export async function importBackup(payload) {
  if (payload?.settings && Array.isArray(payload.queue)) {
    await write("state", payload);
    return "旧版学习记录已导入；还需导入原来的 lexemes.jsonl 词表";
  }
  if (!payload || !Array.isArray(payload.lexicon) || !payload.state?.settings || !Array.isArray(payload.state.queue)) throw new Error("备份格式不正确");
  await write("lexicon", payload.lexicon); await write("state", payload.state);
  return "完整备份已导入";
}
export async function importWords(text, filename = "") {
  const existing = await read("lexicon") || structuredClone(sample);
  let rows;
  if (filename.endsWith(".json")) { const parsed = JSON.parse(text); rows = Array.isArray(parsed) ? parsed : parsed.lexicon; }
  else if (filename.endsWith(".jsonl")) rows = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  else rows = text.split(/\r?\n/).filter(Boolean).map((line) => { const [lang,head,gloss,reading] = line.split("\t"); return { lang,head,gloss:[gloss],reading,tags:["个人词本"] }; });
  if (!Array.isArray(rows)) throw new Error("词表格式不正确");
  const normalized = rows.filter((word) => ["en","ja","ru"].includes(word.lang) && word.head && (Array.isArray(word.gloss) ? word.gloss.length : word.gloss)).map((word) => ({ ...word, hash:word.hash || `${word.lang}:${word.head}`, gloss:Array.isArray(word.gloss) ? word.gloss : [String(word.gloss)], tags:word.tags?.length ? word.tags : ["个人词本"] }));
  const merged = new Map(existing.map((word)=>[word.hash,word])); normalized.forEach((word)=>merged.set(word.hash,word));
  await write("lexicon",[...merged.values()]);
  const state = await read("state") || structuredClone(defaults);
  for (const lang of ["en","ja","ru"]) if (normalized.some((word)=>word.lang===lang) && !state.settings.sourceTags[lang].includes("个人词本")) state.settings.sourceTags[lang].push("个人词本");
  await write("state",state); return normalized.length;
}
