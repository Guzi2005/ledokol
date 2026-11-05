const names = { en: "英语", ja: "日语", ru: "俄语" };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function meaning(word) {
  return (word.gloss || []).find((item) => String(item).trim()) || "暂无释义";
}

function choicesFor(word, words) {
  const correct = meaning(word);
  const others = [...new Set(words.filter((item) => item.hash !== word.hash).map(meaning).filter((value) => value !== correct && value !== "暂无释义"))];
  const seed = [...word.hash].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  others.sort((a, b) => (a.length * 31 + seed) % 47 - (b.length * 31 + seed) % 47 || a.localeCompare(b));
  const ordered = [correct, ...others.slice(0, 3)];
  while (ordered.length < 4) ordered.push("—");
  return [...ordered.slice(seed % 4), ...ordered.slice(0, seed % 4)];
}

export async function viewIceGame(id, view, sfx, request) {
  view.replaceChildren(node("p", "muted", "正在铺冰面…"));
  let page;
  try { page = await request(`/api/page/${encodeURIComponent(id)}`); }
  catch (error) { view.replaceChildren(node("p", "game-error", error.message)); return; }

  const results = { ...(page.results || {}) };
  const heights = { ...(page.heights || {}) };
  let layerIndex = 0;
  let combo = 0;
  let busy = false;
  const shell = node("section", "game-shell");
  const heading = node("div", "game-top");
  const board = node("div", "game-board-wrap");
  const status = node("div", "game-status");
  const quiz = node("div", "game-quiz");
  quiz.setAttribute("aria-live", "polite");
  const preview = node("div", "word-preview");
  preview.setAttribute("aria-live", "polite");
  preview.hidden = true;
  const hud = node("div", "ice-hud");
  hud.hidden = true;
  shell.append(heading, board, status, quiz, preview, hud);
  view.replaceChildren(shell);

  const allWords = page.layers.flatMap((layer) => layer.words);
  const marked = (word) => Object.hasOwn(results, word.hash);
  const completed = (layer) => layer.words.every(marked);
  const total = allWords.length;

  function stats() {
    const answered = Object.keys(results).length;
    const known = Object.values(results).filter(Boolean).length;
    status.textContent = `${answered} / ${total} 块已处理 · 敲掉 ${known} · 加厚 ${answered-known}`;
  }

  function renderHeading() {
    heading.replaceChildren();
    const title = node("div", "game-title", `${id} · 敲冰背词`);
    const exit = node("a", "game-exit", "退出");
    exit.href = "#/";
    exit.setAttribute("aria-label", "退出游戏，返回主页面");
    const subtitle = node("p", "game-help", "悬停看词义 · 左键敲掉 · 右键加厚 · 长按拖向释义" );
    const tabs = node("div", "game-layers");
    page.layers.forEach((layer, index) => {
      const tab = node("button", `game-layer ${index === layerIndex ? "active" : ""} ${completed(layer) ? "complete" : ""}`, `${names[layer.lang] || layer.lang} ${layer.words.filter(marked).length}/${layer.words.length}`);
      tab.type = "button";
      tab.disabled = index > layerIndex && !completed(page.layers[layerIndex]);
      tab.addEventListener("click", () => { if (busy) return; layerIndex = index; render(); });
      tabs.append(tab);
    });
    heading.append(exit, title, subtitle, tabs);
  }

  function renderBoard() {
    board.replaceChildren();
    const layer = page.layers[layerIndex];
    const field = node("div", "hex-field");
    const radius = layer.words.length > 36 ? 4 : 3;
    field.classList.add(`radius-${radius}`);
    const boardColumns = 1 + 1.5 * radius;
    const boardRows = 2 * radius + 1;
    const cells = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        cells.push({ q, r });
      }
    }
    const slots = cells.filter(({ q, r }) => q !== 0 || r !== 0);
    layer.words.forEach((word, index) => { slots[(index * 11) % slots.length].word = word; });
    for (const { q, r, word } of cells) {
        const tile = node("button", `hex-tile ${word ? "word-tile" : "decorative"} ${q === 0 && r === 0 ? "center-ice" : ""}`);
        tile.type = "button";
        tile.style.left = `${50 + (0.75 * q / boardColumns) * 100}%`;
        tile.style.top = `${50 + ((r + q / 2) / boardRows) * 100}%`;
        if (word) {
          tile.textContent = word.head;
          tile.dataset.hash = word.hash;
          tile.setAttribute("aria-label", `${word.head}，${meaning(word)}。左键敲掉，右键加厚`);
          if (results[word.hash] === true) {
            tile.classList.add("melted");
            tile.disabled = true;
          } else {
            if (results[word.hash] === false) tile.classList.add("raised");
            tile.style.setProperty("--height", String(heights[word.hash] || (results[word.hash] === false ? 1 : 0)));
            if (results[word.hash] === false) tile.append(node("span", "height-badge", String(heights[word.hash] || 1)));
            tile.addEventListener("mouseenter", () => showPreview(word, false));
            tile.addEventListener("mouseleave", () => { if (!matchMedia("(hover: none)").matches) hidePreview(); });
            tile.addEventListener("focus", () => showPreview(word, false));
            tile.addEventListener("blur", () => { if (!matchMedia("(hover: none)").matches) hidePreview(); });
            let pressTimer;
            let dragging = false;
            let suppressClick = false;
            tile.addEventListener("pointerdown", (event) => {
              if (event.button !== 0 || busy) return;
              pressTimer = setTimeout(() => { dragging = true; suppressClick = true; tile.setPointerCapture(event.pointerId); showHud(word, tile); }, 380);
            });
            tile.addEventListener("pointermove", (event) => { if (dragging) aimHud(event.clientX, event.clientY); });
            tile.addEventListener("pointerup", (event) => {
              clearTimeout(pressTimer);
              if (dragging) { dragging = false; chooseHud(event.clientX, event.clientY); }
            });
            tile.addEventListener("pointercancel", () => { clearTimeout(pressTimer); dragging = false; hideHud(); });
            tile.addEventListener("click", () => {
              if (suppressClick) { suppressClick = false; return; }
              matchMedia("(hover: none)").matches ? showPreview(word, true) : knock(word);
            });
            tile.addEventListener("contextmenu", (event) => { event.preventDefault(); raise(word); });
            tile.addEventListener("keydown", (event) => { if (event.key === "ArrowUp") { event.preventDefault(); raise(word); } });
          }
        } else {
          tile.disabled = true;
          tile.setAttribute("aria-hidden", "true");
        }
        field.append(tile);
    }
    const penguin = node("div", "board-penguin", "🐧");
    penguin.setAttribute("aria-hidden", "true");
    field.append(penguin);
    board.append(field);
    const caption = node("p", "board-caption", `${names[layer.lang] || layer.lang}冰层 · ${layer.words.length} 个词`);
    board.append(caption);
  }

  let hudWord = null;
  let hudCenter = null;
  let hudDirection = null;
  const directions = ["up", "right", "down", "left"];
  function showHud(word, tile) {
    hidePreview();
    hudWord = word;
    const rect = tile.getBoundingClientRect();
    const side = Math.min(170, innerWidth / 2);
    hudCenter = { x: Math.max(side, Math.min(innerWidth - side, rect.left + rect.width / 2)), y: Math.max(110, Math.min(innerHeight - 110, rect.top + rect.height / 2)) };
    hud.style.left = `${hudCenter.x}px`;
    hud.style.top = `${hudCenter.y}px`;
    hud.replaceChildren(node("div", "hud-arrow", "➤"));
    choicesFor(word, page.layers[layerIndex].words).forEach((choice, index) => {
      const option = node("div", `hud-choice ${directions[index]}`, choice);
      option.dataset.direction = directions[index];
      hud.append(option);
    });
    hud.hidden = false;
  }
  function aimHud(x, y) {
    if (!hudCenter || hud.hidden) return;
    const dx = x - hudCenter.x, dy = y - hudCenter.y;
    hudDirection = Math.hypot(dx, dy) > 30 ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")) : null;
    hud.querySelectorAll(".hud-choice").forEach((item) => item.classList.toggle("aimed", item.dataset.direction === hudDirection));
    hud.querySelector(".hud-arrow").style.transform = `translate(-50%, -50%) rotate(${hudDirection ? {up:-90,right:0,down:90,left:180}[hudDirection] : 0}deg)`;
  }
  function chooseHud(x, y) {
    aimHud(x, y);
    const choice = hud.querySelector(`.hud-choice.${hudDirection}`)?.textContent;
    const word = hudWord;
    hideHud();
    if (choice && choice !== "—") choice === meaning(word) ? knock(word) : raise(word);
  }
  function hideHud() { hud.hidden = true; hudWord = null; hudCenter = null; hudDirection = null; }

  function showPreview(word, touch) {
    if (busy || results[word.hash] === true) return;
    preview.replaceChildren();
    preview.classList.toggle("touch", touch);
    preview.append(node("strong", "peek-head", word.head));
    if (word.reading || word.phonetic) preview.append(node("span", "peek-reading", [word.reading, word.phonetic].filter(Boolean).join(" · ")));
    preview.append(node("span", "peek-meaning", (word.gloss || []).join("；") || "暂无释义"));
    if (results[word.hash] === false) preview.append(node("span", "peek-height", `已加厚 ${heights[word.hash] || 1} 层`));
    if (touch) {
      const actions = node("div", "peek-actions");
      const hit = node("button", "btn primary", "敲掉"); hit.type = "button";
      const lift = node("button", "btn", "加厚"); lift.type = "button";
      hit.addEventListener("click", () => knock(word));
      lift.addEventListener("click", () => raise(word));
      actions.append(hit, lift); preview.append(actions);
    }
    preview.hidden = false;
  }
  function hidePreview() { preview.hidden = true; }

  async function act(word, action) {
    if (busy || results[word.hash] === true || page.status === "done") return;
    busy = true;
    try {
      if (action === "knock") {
        const result = await request(`/api/page/${encodeURIComponent(id)}/mark`, { hash: word.hash, known: true });
        Object.assign(results, result.results);
        sfx.iceTap();
      } else {
        const result = await request(`/api/page/${encodeURIComponent(id)}/raise`, { hash: word.hash });
        Object.assign(results, result.results);
        heights[word.hash] = result.height;
        sfx.iceLift();
      }
      hidePreview(); hideHud();
      renderHeading(); renderBoard(); stats();
      if (action === "knock" && completed(page.layers[layerIndex])) {
        if (layerIndex < page.layers.length - 1) { layerIndex++; render(); }
        else { busy = false; await finish(); }
      }
    } catch (error) {
      preview.replaceChildren(node("span", "game-error", `保存失败：${error.message}`));
      preview.hidden = false;
    } finally { busy = false; }
  }
  const knock = (word) => act(word, "knock");
  const raise = (word) => act(word, "raise");

  async function finish() {
    if (busy) return;
    busy = true;
    quiz.replaceChildren(node("p", "muted", "正在结算…"));
    try {
      const result = await request(`/api/page/${encodeURIComponent(id)}/finish`, {});
      page.status = "done";
      board.replaceChildren(); heading.replaceChildren(node("h1", "game-title", "本次破冰完成！"));
      status.textContent = `答对 ${result.known} / ${result.total} · 待复习 ${result.unknown.length}`;
      quiz.classList.add("open"); quiz.replaceChildren();
      const list = node("div", "result-list");
      result.unknown.forEach((word) => list.append(node("p", "result-word", `${word.head} · ${(word.gloss || []).slice(0, 2).join("；")}`)));
      quiz.append(node("h2", "", "裂纹词回顾"), list);
      if (result.story) quiz.append(node("p", "story", result.story));
      const prompt = `请用这些不会的词写一段 80～150 字的中文记忆故事。外语词保持原形，后面标注中文释义：\n${result.unknown.map((word) => `${word.lang}: ${word.head}（${(word.gloss || []).join("；")}）`).join("\n")}`;
      const copy = node("button", "btn ghost", "复制本地 AI 故事提示词");
      copy.type = "button";
      copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(prompt); copy.textContent = "已复制，请发给你自己的本地 AI"; } catch { copy.textContent = "复制失败，请检查浏览器权限"; } });
      const storyInput = node("textarea", "story-input");
      storyInput.placeholder = "把本地 AI 写的故事粘贴在这里；内容只保存在这个浏览器";
      storyInput.value = result.story || "";
      const saveStory = node("button", "btn", "保存故事到本地");
      saveStory.type = "button";
      saveStory.addEventListener("click", async () => { try { await request(`/api/page/${encodeURIComponent(id)}/story`, {text:storyInput.value}); saveStory.textContent = "已保存在本地"; } catch(error) { saveStory.textContent = `保存失败：${error.message}`; } });
      quiz.append(node("h2", "", "和本地 AI 约定"), node("p", "muted", "复制提示词到你自己的本地 AI，生成故事后粘贴回来。网页不会向 AI 发送任何内容。"), copy, storyInput, saveStory);
      const home = node("a", "btn primary", "回主页面"); home.href = "#/";
      quiz.append(home);
    } catch (error) { quiz.replaceChildren(node("p", "game-error", `结算失败：${error.message}`)); }
    finally { busy = false; }
  }

  function render() { renderHeading(); renderBoard(); stats(); hidePreview(); hideHud(); quiz.classList.remove("open"); quiz.replaceChildren(); }
  if (page.status === "done" || page.layers.every(completed)) await finish();
  else {
    layerIndex = Math.max(0, page.layers.findIndex((layer) => !completed(layer)));
    render();
  }
}
