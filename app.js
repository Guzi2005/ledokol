import { sfx } from "./sfx.js";
import { viewIceGame } from "./game.js";
import { localRequest, exportBackup, importBackup, importWords } from "./local-api.js";
import { AI_DEFAULTS, aiConfig, listLocalModels } from "./ai.js";

const view = document.getElementById("view");
const card = document.getElementById("gloss-card");

const LANG_NAME = { en: "英语", ja: "日语", ru: "俄语" };
const gameView = () => sessionStorage.getItem("ledokol-game-view") || "mix";
const pageLink = (id, lang = gameView()) => `#/page/${id}?view=${encodeURIComponent(lang)}`;

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

/* ---------- 主页面 ---------- */
async function viewHome() {
  const [st, q] = await Promise.all([api.get("/api/state"), api.get("/api/queue")]);
  const pending = q.pending || [];
  const activeOrder = [...new Set((st.settings.layerOrder || []).filter((lang) => LANG_NAME[lang]))];
  const selected = activeOrder.includes(gameView()) ? gameView() : "mix";
  const bookmarkOrder = ["mix", ...activeOrder];
  const scene = el("section", { class: "home-scene" });
  const subtitle = el("p", { class: "home-subtitle" }, selected === "mix" ? "多语种混合冰面" : `${LANG_NAME[selected]}冰面 · 随时切换语种`);
  const bookmarks = el("nav", { class: "home-bookmarks", "aria-label": "切换冰面语种" },
    ...bookmarkOrder.map((lang) => el("button", { type: "button", class: `bookmark bookmark-${lang} ${lang === selected ? "active" : ""}`, "aria-pressed": lang === selected ? "true" : "false", onclick: () => {
      sessionStorage.setItem("ledokol-game-view", lang);
      for (const tab of bookmarks.querySelectorAll(".bookmark")) {
        const active = tab.dataset.lang === lang;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-pressed", String(active));
      }
      subtitle.textContent = lang === "mix" ? "多语种混合冰面" : `${LANG_NAME[lang]}冰面 · 随时切换语种`;
    }, dataset: { lang } }, lang === "mix" ? "混合" : LANG_NAME[lang])),
    el("a", { href: "#/settings", class: "home-settings", "aria-label": "设置", title: "设置" }, "⚙")
  );
  const hero = el("div", { class: "home-hero" },
    el("div", { class: "home-ice", "aria-hidden": "true" }, el("span", { class: "home-penguin-shadow" }), el("span", { class: "home-penguin-figure" }, "🐧")),
    el("p", { class: "home-kicker" }, "LEDOKOL"),
    el("h1", {}, "敲开冰面，记住世界"),
    subtitle,
    el("button", { class: "home-play", onclick: pending[0] ? () => location.hash = pageLink(pending[0].id) : sail }, pending.length ? "继续敲冰  ▶" : "开始敲冰  ▶"),
    el("p", { class: "home-progress" }, `本地词库 ${Object.values(st.lexicon.byLang || {}).reduce((a,b)=>a+b,0)} 词 · ${pending.length ? "有未完成冰层" : "准备好出发"}`)
  );
  scene.append(bookmarks, hero);
  view.replaceChildren(scene);
}
async function sail() {
  sfx.unlock();
  sfx.voyage();
  const res = await api.post("/api/enqueue", {});
  if (res.silent) return toast(`积压 ${res.pending} 页 ≥ 上限 ${res.throttle}：静默唤醒`);
  if (res.empty) return toast("词库没有可用词条");
  location.hash = pageLink(res.page.id);
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
async function viewSettings(params = new URLSearchParams()) {
  const s = await api.get("/api/settings");
  const num = (lang) => el("input", { type: "number", min: "0", max: "60", value: String(s.wordsPerPage[lang] ?? 0), dataset: { lang, field: "wordsPerPage" } });
  view.textContent = "";
  let languageOrder = [...new Set((s.layerOrder || []).filter((lang) => LANG_NAME[lang]))];
  const enabledLanguages = new Set(languageOrder);
  for (const lang of Object.keys(LANG_NAME)) if (!languageOrder.includes(lang)) languageOrder.push(lang);
  const orderList = el("div", { class: "language-order" });
  const renderOrder = () => {
    orderList.replaceChildren(...languageOrder.map((lang, index) => el("div", { class: "language-order-row" },
      el("input", { type: "checkbox", checked: enabledLanguages.has(lang) ? "" : null, "aria-label": `启用${LANG_NAME[lang]}`, onchange: (event) => {
        if (event.target.checked) enabledLanguages.add(lang); else enabledLanguages.delete(lang);
      } }),
      el("span", {}, `${index + 1}. ${LANG_NAME[lang]}`),
      el("button", { type: "button", class: "order-icon", "aria-label": `将${LANG_NAME[lang]}上移`, title: "上移", disabled: index === 0 ? "" : null,
        onclick: () => { [languageOrder[index - 1], languageOrder[index]] = [languageOrder[index], languageOrder[index - 1]]; renderOrder(); } }, "↑"),
      el("button", { type: "button", class: "order-icon", "aria-label": `将${LANG_NAME[lang]}下移`, title: "下移", disabled: index === languageOrder.length - 1 ? "" : null,
        onclick: () => { [languageOrder[index + 1], languageOrder[index]] = [languageOrder[index], languageOrder[index + 1]]; renderOrder(); } }, "↓"))));
  };
  renderOrder();
  const mixInput = el("input", { type: "checkbox", "aria-label": "把已启用语种放在同一片冰面", checked: s.mixLanguages ? "" : null });
  const savedAi = { ...AI_DEFAULTS, ...(s.ai || {}) };
  const provider = el("select", { class: "ai-select", "aria-label": "本机 AI 类型" },
    el("option", { value: "ollama" }, "Ollama"),
    el("option", { value: "lmstudio" }, "LM Studio"),
    el("option", { value: "custom" }, "其他 OpenAI 兼容服务"));
  provider.value = savedAi.endpoint.includes(":11434") ? "ollama" : savedAi.endpoint.includes(":1234") ? "lmstudio" : "custom";
  const endpointInput = el("input", { type: "url", class: "ai-input", value: savedAi.endpoint, placeholder: "http://127.0.0.1:11434/v1", "aria-label": "本机 AI 地址" });
  const modelInput = el("input", { class: "ai-input", value: savedAi.model, list: "local-ai-models", placeholder: "选择或输入已加载的模型", "aria-label": "模型名称" });
  const modelOptions = el("datalist", { id: "local-ai-models" });
  const aiMessage = el("p", { class: "ai-message", "aria-live": "polite" });
  const aiHint = el("p", { class: "muted ai-hint" });
  const updateAiHint = () => {
    aiHint.textContent = provider.value === "ollama"
      ? `Ollama：将 ${location.origin} 加入 OLLAMA_ORIGINS 后重启服务；浏览器可能要求允许访问本机网络。`
      : provider.value === "lmstudio"
        ? "LM Studio：启动本地服务并开启 CORS；浏览器可能要求允许访问本机网络。"
        : `本机服务需允许来自 ${location.origin} 的跨来源请求（CORS）。`;
  };
  updateAiHint();
  provider.addEventListener("change", () => {
    if (provider.value === "ollama") endpointInput.value = "http://127.0.0.1:11434/v1";
    if (provider.value === "lmstudio") endpointInput.value = "http://127.0.0.1:1234/v1";
    modelInput.value = "";
    updateAiHint();
  });
  const detectModels = el("button", { class: "btn ghost", type: "button", onclick: async () => {
    aiMessage.textContent = "正在检测本机模型…";
    try {
      const models = await listLocalModels(endpointInput.value);
      modelOptions.replaceChildren(...models.map((id) => el("option", { value: id })));
      if (!modelInput.value && models.length) modelInput.value = models[0];
      aiMessage.textContent = models.length ? `找到 ${models.length} 个本机模型，可在模型输入框中选择。` : "已连接，但没有找到已加载的模型。";
    } catch (error) { aiMessage.textContent = error.message; }
  } }, "检测本机模型");
  const saveAi = el("button", { class: "btn primary", type: "button", onclick: async () => {
    try {
      const nextAi = aiConfig({ endpoint: endpointInput.value, model: modelInput.value });
      await api.put("/api/settings", { ai: nextAi });
      s.ai = nextAi;
      aiMessage.textContent = "AI 配置已保存在这个浏览器。";
    } catch (error) { aiMessage.textContent = error.message; }
  } }, "保存 AI 配置");
  const returnRoute = params.get("return");
  const returnLink = /^page\/LDK-[A-Za-z0-9-]+$/.test(returnRoute || "")
    ? el("a", { class: "btn ghost", href: `#/${returnRoute}` }, "返回本次结算") : null;
  const form = el("div", { class: "kv" }, [
    ...Object.keys(LANG_NAME).flatMap((l) => [el("span", { class: "muted" }, `${LANG_NAME[l]} · 每页词数`), num(l)]),
    el("span", { class: "muted" }, "语种顺序"), orderList,
    el("span", { class: "muted" }, "冰面布局"),
    el("label", { class: "mix-setting" }, mixInput, "已启用语种混在同一片冰面"),
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
              next.layerOrder = languageOrder.filter((lang) => enabledLanguages.has(lang));
              next.mixLanguages = mixInput.checked;
              if (!next.layerOrder.length) { toast("请至少启用一个语种"); return; }
              if (next.mixLanguages && next.layerOrder.reduce((sum, lang) => sum + next.wordsPerPage[lang], 0) > 60) {
                toast("同一冰面最多 60 个词，请调低各语种词数"); return;
              }
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
    ),
    panel("配置 AI",
      el("p", { class: "muted" }, "连接你电脑上运行的 AI，选择已下载的模型。生成故事时只把本轮待复习词发给这个本机服务；服务自身的联网行为由你在该软件中设置。"),
      el("div", { class: "ai-config" },
        el("label", {}, "服务类型", provider),
        el("label", {}, "本机地址", endpointInput),
        el("label", {}, "模型名称", modelInput, modelOptions)),
      el("div", { class: "ai-actions" }, detectModels, saveAi, returnLink),
      aiMessage,
      aiHint)
  );
}

/* ---------- router ---------- */
function route() {
  hideGloss();
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);
  document.documentElement.classList.toggle("game-mode", parts[0] === "page");
  document.documentElement.classList.toggle("home-mode", !parts.length);
  if (!parts.length) return viewHome();
  if (parts[0] === "page") return viewIceGame(parts[1], view, sfx, localRequest, params.get("view") || gameView());
  if (parts[0] === "book") return viewBook(params);
  if (parts[0] === "settings") return viewSettings(params);
  return viewHome();
}

window.addEventListener("hashchange", route);
document.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("pointerdown", () => sfx.unlock(), { once: true });
route();
