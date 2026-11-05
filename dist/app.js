import { sfx } from "./sfx.js";
import { viewIceGame } from "./game.js";
import { localRequest, exportBackup, importBackup, importWords } from "./local-api.js";

const view = document.getElementById("view");
const card = document.getElementById("gloss-card");

const LANG_NAME = { en: "英语", ja: "日语", ru: "俄语" };

const api = { get: (p) => localRequest(p), post: (p, body) => localRequest(p, body || {}, "POST"), put: (p, body) => localRequest(p, body, "PUT") };

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

let toastTimer;
function toast(msg) {
  document.getElementById("toast")?.remove();
  const node = el("div", { id: "toast" }, msg);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 4200);
}

function panel(title, ...body) {
  return el("section", { class: "panel" }, el("h2", {}, title), ...body);
}

/* ---------- gloss card ---------- */
let hoverTimer;
function bindGloss(node, word) {
  node.addEventListener("mouseenter", (ev) => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showGloss(ev, word), 160);
  });
  node.addEventListener("mouseleave", hideGloss);
}
function showGloss(ev, w) {
  card.textContent = "";
  const kids = [
    el("h3", {}, w.head),
    w.phonetic || w.reading ? el("div", { class: "ph" }, [w.phonetic, w.reading].filter(Boolean).join(" · ")) : null,
    el(
      "ol",
      {},
      (w.gloss || []).map((g) => el("li", {}, g))
    ),
    ...(w.examples || []).slice(0, 2).map((x) =>
      el("div", { class: "ex" }, [x.t, x.cn ? el("span", {}, x.cn) : null].filter(Boolean))
    ),
    (w.phrases || []).length
      ? el("div", { class: "ex" }, `短语：${w.phrases.map((p) => `${p.t}${p.cn ? `（${p.cn}）` : ""}`).join("；")}`)
      : null,
    w.memory ? el("div", { class: "ex" }, `记忆：${w.memory}`) : null
  ].flat(2);
  card.append(...kids.filter((k) => k !== null && k !== undefined));
  card.hidden = false;
  const pad = 16;
  const box = card.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + box.width > innerWidth - 8) x = ev.clientX - box.width - pad;
  if (y + box.height > innerHeight - 8) y = Math.max(8, ev.clientY - box.height - pad);
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}
function hideGloss() {
  clearTimeout(hoverTimer);
  card.hidden = true;
}

/* ---------- 驾驶舱 ---------- */
async function viewHome() {
  const [st, q] = await Promise.all([api.get("/api/state"), api.get("/api/queue")]);
  const counts = st.lexicon.byLang || {};
  const pending = q.pending || [];

  const actions = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  const goBtn = el("a", { class: "btn primary", href: pending[0] ? `#/page/${pending[0].id}` : "#/" }, pending.length ? "开始敲冰" : "去出航");
  if (!pending[0]) goBtn.addEventListener("click", sail);
  actions.append(
    goBtn,
    el(
      "button",
      {
        class: "btn",
        onclick: async () => {
          const res = await api.post("/api/enqueue", {});
          if (res.silent) toast(`积压 ${res.pending} 页 ≥ 上限 ${res.throttle}：只静默唤醒，不生成新页`);
          else if (res.empty) toast("词库没有可用词条：请导入自己的词表");
          else location.hash = `#/page/${res.page.id}`;
        }
      },
      "生成新的一页"
    ),
    el("a", { class: "btn ghost", href: "#/settings" }, "设置")
  );

  view.textContent = "";
  view.append(
    panel(
      "今天出航几次",
      el("div", { class: "kv" }, [
        el("span", { class: "muted" }, "词库规模"),
        el("span", {}, Object.entries(counts).map(([l, n]) => `${LANG_NAME[l] || l} ${n}`).join(" · ") || "空"),
        el("span", { class: "muted" }, "待办页面"),
        el("span", {}, `${pending.length} / 节流上限 ${st.queue.throttle}`),
        el("span", { class: "muted" }, "驾驶员"),
        el("span", {}, "本机浏览器 · 本地 AI 可自行约定"),
        el("span", { class: "muted" }, "每页冰层"),
        el("span", {}, st.settings.layerOrder.map((l) => `${LANG_NAME[l]} ${st.settings.wordsPerPage[l]}`).join(" / "))
      ]),
      st.lexicon.empty ? el("p", { class: "muted" }, "词库为空：到设置中导入自己的词表") : null,
      el("div", { style: "margin-top:12px" }, actions)
    ),
    panel(
      "队列",
      el(
        "div",
        { class: "rows" },
        q.pages.slice(-12).reverse().map((p) =>
          el("div", { class: "row" }, [
            el("span", { class: "head" }, el("a", { href: `#/page/${p.id}` }, p.id)),
            el("span", { class: "chip" }, p.status === "pending" ? "待敲" : "已过"),
            el("span", {}, p.layers.map((l) => `${LANG_NAME[l.lang]} ${l.count}`).join(" · ")),
            el("span", { class: "muted" }, p.hasStory ? "故事已带回" : p.status === "done" ? "故事待生成" : ""),
            el("span", { class: "muted" }, new Date(p.createdAt).toLocaleString())
          ])
        )
      )
    )
  );
}

async function sail() {
  sfx.unlock();
  sfx.voyage();
  const res = await api.post("/api/enqueue", {});
  if (res.silent) return toast(`积压 ${res.pending} 页 ≥ 上限 ${res.throttle}：静默唤醒`);
  if (res.empty) return toast("词库没有可用词条");
  location.hash = `#/page/${res.page.id}`;
}

/* ---------- 册子 ---------- */
async function viewBook(params) {
  let lang = params.get("lang") || "en";
  let q = params.get("q") || "";
  let offset = 0;
  view.textContent = "";
  const box = el("div", {});
  const search = el("input", { type: "search", placeholder: "搜索词形…", value: q, style: "padding:8px 12px;border:2px solid var(--wood);border-radius:12px;width:260px" });
  const tabs = el("div", { style: "display:flex;gap:8px;margin-bottom:14px" }, ...Object.keys(LANG_NAME).map((l) => el("button", { class: `btn ${l === lang ? "primary" : ""}`, onclick: () => { lang = l; offset = 0; load(); } }, LANG_NAME[l])));
  view.append(panel("词汇册子", tabs, el("div", { style: "margin-bottom:12px" }, search), box));

  async function load(append = false) {
    const data = await api.get(`/api/book?lang=${lang}&q=${encodeURIComponent(q)}&offset=${offset}&limit=200`);
    if (!append) box.textContent = "";
    box.append(el("p", { class: "muted" }, `${data.total} 条`));
    for (const g of data.groups) {
      box.append(
        el("h2", { style: "font-size:15px;margin:16px 0 6px" }, g.tag),
        el(
          "div",
          { class: "rows" },
          g.words.map((w) => {
            const m = w.mastery;
            const cls = m.u > 0 ? "bad" : m.k >= 3 ? "ok" : "fresh";
            const label = m.u > 0 ? `不会 ${m.u}` : m.k ? `会 ${m.k}` : "未学";
            const row = el("div", { class: "row" }, [
              el("span", { class: "head" }, w.head),
              el("span", { class: "muted" }, [w.phonetic, w.reading].filter(Boolean).join(" · ")),
              el("span", {}, (w.gloss || []).slice(0, 2).join("；")),
              el("span", { class: `mastery ${cls}` }, label)
            ]);
            bindGloss(row, w);
            return row;
          })
        )
      );
    }
    if (data.offset + data.limit < data.total) {
      const more = el("button", { class: "btn ghost", style: "margin-top:14px", onclick: () => { offset += data.limit; load(true); } }, "继续往下翻");
      box.append(more);
    }
  }
  search.addEventListener("input", () => {
    q = search.value.trim();
    offset = 0;
    load();
  });
  load();
}

/* ---------- 设置 ---------- */
async function viewSettings() {
  const s = await api.get("/api/settings");
  const num = (lang) => el("input", { type: "number", min: "0", max: "60", value: String(s.wordsPerPage[lang] ?? 0), dataset: { lang, field: "wordsPerPage" } });
  view.textContent = "";
  const form = el("div", { class: "kv" }, [
    ...Object.keys(LANG_NAME).flatMap((l) => [el("span", { class: "muted" }, `${LANG_NAME[l]} · 每页词数`), num(l)]),
    el("span", { class: "muted" }, "冰层顺序"),
    el("input", { value: s.layerOrder.join(","), id: "layerOrder" }),
    el("span", { class: "muted" }, "积压上限（超过则静默）"),
    el("input", { type: "number", min: "1", max: "10", value: String(s.pendingThrottle), id: "throttle" }),
    ...Object.keys(LANG_NAME).flatMap((l) => [
      el("span", { class: "muted" }, `${LANG_NAME[l]} · 词库标签`),
      el("input", { value: (s.sourceTags[l] || []).join(","), dataset: { lang: l, field: "sourceTags" } })
    ])
  ]);
  view.append(
    panel(
      "设置",
      form,
      el(
        "div",
        { style: "display:flex;gap:10px;margin-top:16px;flex-wrap:wrap" },
        el(
          "button",
          {
            class: "btn primary",
            onclick: async () => {
              const next = structuredClone(s);
              for (const node of form.querySelectorAll("[data-field]")) {
                const { field, lang } = node.dataset;
                if (field === "wordsPerPage") next.wordsPerPage[lang] = Number(node.value);
                if (field === "sourceTags") next.sourceTags[lang] = node.value.split(/[,\s]+/).filter(Boolean);
              }
              next.layerOrder = document.getElementById("layerOrder").value.split(/[,\s]+/).filter(Boolean);
              next.pendingThrottle = Number(document.getElementById("throttle").value);
              await api.put("/api/settings", next);
              toast("设置已存入这个浏览器");
            }
          },
          "保存"
        ),
        el("button", { class: "btn ghost", onclick: async () => { const data = await exportBackup(); const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ledokol-backup.json"; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); } }, "导出备份 JSON"),
        el(
          "button",
          {
            class: "btn ghost",
            onclick: async () => {
              const r = await api.get("/api/state");
              toast(`本地词库：${Object.entries(r.lexicon.byLang).map(([l, n]) => `${LANG_NAME[l] || l} ${n}`).join(" · ")}`);
            }
          },
          "查看词库"
        ),
        el(
          "label",
          { class: "btn ghost" },
          "导入备份",
          el("input", {
            type: "file",
            accept: "application/json",
            style: "display:none",
            onchange: async (ev) => {
              const text = await ev.target.files[0].text();
              try { const message = await importBackup(JSON.parse(text)); toast(`${message}，请刷新页面`); } catch(error) { toast(error.message); }
            }
          })
        ),
        el("label", { class: "btn ghost" }, "导入词表（JSON / JSONL / TSV）", el("input", { type:"file", accept:".json,.jsonl,.tsv", style:"display:none", onchange: async (ev) => { const file=ev.target.files?.[0]; if(!file) return; try { const count=await importWords(await file.text(),file.name); toast(`已导入 ${count} 个词，请刷新页面`); } catch(error) { toast(error.message); } } }))
      ),
      el("p", { class: "muted" }, "单词本、学习记录和设置只存在当前浏览器。清除网站数据会删除它们，请定期导出备份。词表 TSV 每行格式：语言代码、词形、中文释义、读音（以 Tab 分隔）；语言代码为 en / ja / ru。")
    )
  );
}

/* ---------- router ---------- */
function route() {
  hideGloss();
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return viewHome();
  if (parts[0] === "page") return viewIceGame(parts[1], view, sfx, localRequest);
  if (parts[0] === "book") return viewBook(params);
  if (parts[0] === "settings") return viewSettings();
  return viewHome();
}

window.addEventListener("hashchange", route);
window.addEventListener("pointerdown", () => sfx.unlock(), { once: true });
route();

