import { createVoiceGuide, voiceStyles } from "./voice.js";
import { generateMemoryStory } from "./ai.js";

const names = { en: "英语", ja: "日语", ru: "俄语", mix: "多语种" };

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
  const voiceGuide = createVoiceGuide();
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
  let previewTimer;
  let pronunciationTimer;
  let currentPreview = null;
  const onLeavePage = () => {
    if (location.hash !== `#/page/${id}`) {
      voiceGuide.stop();
      window.removeEventListener("hashchange", onLeavePage);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onOutsidePreview);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refreshVoiceMenu);
    }
  };
  const onResize = () => {
    if (!preview.hidden && currentPreview?.tile?.isConnected) {
      const { word, touch, tile } = currentPreview;
      showPreview(word, touch, tile);
    }
  };
  window.addEventListener("hashchange", onLeavePage);
  window.addEventListener("resize", onResize);
  const onOutsidePreview = (event) => {
    if (!preview.hidden && preview.classList.contains("touch") && !preview.contains(event.target) && !event.target.closest?.(".hex-tile")) hidePreview();
  };
  document.addEventListener("pointerdown", onOutsidePreview);
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
    const title = node("div", "game-title", "LEDOKOL");
    const exit = node("a", "game-exit game-icon", "↩");
    exit.href = "#/";
    exit.setAttribute("aria-label", "退出游戏，返回主页面");
    exit.title = "返回主页面";
    const subtitle = node("p", "game-help", "悬停看词义 · 左键敲掉 · 右键加厚 · 长按拖向释义" );
    const tabs = node("div", "game-layers");
    page.layers.forEach((layer, index) => {
      const tab = node("button", `game-layer ${index === layerIndex ? "active" : ""} ${completed(layer) ? "complete" : ""}`, `${names[layer.lang] || layer.lang} ${layer.words.filter(marked).length}/${layer.words.length}`);
      tab.type = "button";
      tab.disabled = index > layerIndex && !completed(page.layers[layerIndex]);
      tab.addEventListener("click", () => { if (busy) return; layerIndex = index; render(); });
      tabs.append(tab);
    });
    const controls = node("div", "game-voice-controls");
    const toggleVoice = node("button", "game-icon", voiceGuide.supported && voiceGuide.state.enabled ? "🔊" : "🔇");
    toggleVoice.type = "button";
    toggleVoice.disabled = !voiceGuide.supported;
    toggleVoice.title = !voiceGuide.supported ? "当前浏览器不支持本地发音" : voiceGuide.state.enabled ? "关闭自动发音" : "开启自动发音";
    toggleVoice.setAttribute("aria-label", toggleVoice.title);
    toggleVoice.addEventListener("click", () => {
      voiceGuide.setEnabled(!voiceGuide.state.enabled);
      toggleVoice.textContent = voiceGuide.state.enabled ? "🔊" : "🔇";
      toggleVoice.title = voiceGuide.state.enabled ? "关闭自动发音" : "开启自动发音";
      toggleVoice.setAttribute("aria-label", toggleVoice.title);
    });
    const chooseVoice = node("button", "game-icon", "🎙");
    chooseVoice.type = "button";
    chooseVoice.title = "选择音色";
    chooseVoice.setAttribute("aria-label", chooseVoice.title);
    const voicePanel = node("div", "voice-panel");
    voicePanel.hidden = true;
    chooseVoice.addEventListener("click", () => {
      voicePanel.hidden = !voicePanel.hidden;
      if (!voicePanel.hidden) fillVoicePanel(voicePanel);
    });
    controls.append(toggleVoice, chooseVoice);
    heading.append(exit, title, subtitle, tabs, controls, voicePanel);
  }

  function fillVoicePanel(panel) {
    panel.replaceChildren(node("strong", "voice-panel-title", `${names[page.layers[layerIndex].lang]}发音`));
    const styles = node("div", "voice-styles");
    voiceStyles.forEach((style) => {
      const button = node("button", `voice-style game-icon ${voiceGuide.state.style === style.id ? "active" : ""}`, style.icon);
      button.type = "button";
      button.title = style.label;
      button.setAttribute("aria-label", `${style.label}音色`);
      button.addEventListener("click", () => { voiceGuide.setStyle(style.id); fillVoicePanel(panel); });
      styles.append(button);
    });
    panel.append(styles);
    const lang = page.layers[layerIndex].lang;
    const available = lang === "mix" ? [] : voiceGuide.voices(lang);
    if (lang === "mix") panel.append(node("span", "voice-note", "混合冰面按每个词的语种自动选本地语音。"));
    else if (available.length) {
      const select = node("select", "voice-select");
      select.setAttribute("aria-label", "本地语音");
      available.forEach((voice) => {
        const option = node("option", "", voice.name);
        option.value = voice.voiceURI;
        select.append(option);
      });
      select.value = voiceGuide.chosen(lang)?.voiceURI || "";
      select.addEventListener("change", () => voiceGuide.setVoice(lang, select.value));
      panel.append(select);
    } else panel.append(node("span", "voice-note", voiceGuide.supported ? "当前浏览器没有这个语种的本地语音包" : "当前浏览器不支持语音朗读"));
    panel.append(node("span", "voice-note", "发音仅调用本机语音，不发送词本。"));
  }

  function refreshVoiceMenu() {
    const panel = heading.querySelector(".voice-panel");
    if (panel && !panel.hidden) fillVoicePanel(panel);
  }
  window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoiceMenu);

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
            tile.addEventListener("mouseenter", () => showPreview(word, false, tile, true));
            tile.addEventListener("mouseleave", () => { if (!matchMedia("(hover: none)").matches) scheduleHidePreview(); });
            tile.addEventListener("focus", () => showPreview(word, false, tile, true));
            tile.addEventListener("blur", () => { if (!matchMedia("(hover: none)").matches) scheduleHidePreview(); });
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
              matchMedia("(hover: none)").matches ? showPreview(word, true, tile) : knock(word);
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
    const penguin = node("div", "board-penguin");
    penguin.setAttribute("aria-hidden", "true");
    penguin.append(node("span", "penguin-shadow"), node("span", "penguin-figure", "🐧"));
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

  preview.addEventListener("mouseenter", () => clearTimeout(previewTimer));
  preview.addEventListener("mouseleave", () => { if (!preview.classList.contains("touch")) hidePreview(); });
  function scheduleHidePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(hidePreview, 160);
  }
  function showPreview(word, touch, tile, autoSpeak = false) {
    if (busy || results[word.hash] === true) return;
    currentPreview = { word, touch, tile };
    clearTimeout(previewTimer);
    clearTimeout(pronunciationTimer);
    if (tile) {
      const rect = tile.getBoundingClientRect();
      const bubbleWidth = Math.min(innerWidth * 0.88, 310);
      const halfWidth = bubbleWidth / 2;
      const tileCenter = rect.left + rect.width / 2;
      const centerX = Math.max(halfWidth + 8, Math.min(innerWidth - halfWidth - 8, tileCenter));
      const below = rect.top < 160;
      preview.style.left = `${centerX}px`;
      preview.style.top = `${below ? rect.bottom + 12 : rect.top - 12}px`;
      preview.style.setProperty("--tail-x", `${Math.max(24, Math.min(bubbleWidth - 24, tileCenter - centerX + halfWidth))}px`);
      preview.classList.toggle("below", below);
    }
    preview.replaceChildren();
    preview.classList.toggle("touch", touch);
    preview.append(node("strong", "peek-head", word.head));
    if (word.reading || word.phonetic) preview.append(node("span", "peek-reading", [word.reading, word.phonetic].filter(Boolean).join(" · ")));
    preview.append(node("span", "peek-meaning", (word.gloss || []).join("；") || "暂无释义"));
    if (results[word.hash] === false) preview.append(node("span", "peek-height", `已加厚 ${heights[word.hash] || 1} 层`));
    const replay = node("button", "peek-icon", "🔊");
    replay.type = "button";
    replay.title = "再听一次";
    replay.setAttribute("aria-label", `${word.head}，再听一次`);
    replay.addEventListener("pointerdown", (event) => { clearTimeout(previewTimer); event.preventDefault(); });
    replay.addEventListener("click", () => {
      clearTimeout(previewTimer);
      preview.classList.add("touch");
      if (!voiceGuide.speak(word, true) && !preview.querySelector(".voice-unavailable")) {
        preview.append(node("span", "voice-unavailable", "此浏览器暂无本地发音，请在音色面板查看。"));
      }
    });
    preview.append(replay);
    if (touch) {
      const actions = node("div", "peek-actions");
      const hit = node("button", "peek-icon action-hit", "⛏"); hit.type = "button"; hit.title = "敲掉"; hit.setAttribute("aria-label", "敲掉冰块");
      const lift = node("button", "peek-icon action-lift", "⇧"); lift.type = "button"; lift.title = "加厚"; lift.setAttribute("aria-label", "加厚冰块");
      hit.addEventListener("click", () => knock(word));
      lift.addEventListener("click", () => raise(word));
      actions.append(hit, lift); preview.append(actions);
    }
    preview.hidden = false;
    if (autoSpeak) pronunciationTimer = setTimeout(() => voiceGuide.speak(word), 130);
  }
  function hidePreview() { clearTimeout(previewTimer); clearTimeout(pronunciationTimer); currentPreview = null; preview.hidden = true; }

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
  const knock = (word) => { if (!sfx.muted) sfx.unlock(); return act(word, "knock"); };
  const raise = (word) => { if (!sfx.muted) sfx.unlock(); return act(word, "raise"); };

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
      if (result.unknown.length) {
        const settings = await request("/api/settings");
        const story = node("p", "story", result.story || "");
        quiz.append(node("h2", "", "记忆故事"));
        if (result.story) quiz.append(story);
        const aiControls = node("div", "result-ai-controls");
        const generate = node("button", "result-icon", "✦");
        generate.type = "button";
        generate.title = result.story ? "重新生成记忆故事" : "生成记忆故事";
        generate.setAttribute("aria-label", generate.title);
        const configure = node("a", "result-icon settings-plain", "⚙");
        configure.href = `#/settings?return=${encodeURIComponent(`page/${id}`)}`;
        configure.title = "配置本机 AI";
        configure.setAttribute("aria-label", configure.title);
        const aiStatus = node("p", "result-ai-status", settings.ai?.model ? `本机模型：${settings.ai.model}` : "先在设置中选择本机 AI 模型");
        generate.disabled = !settings.ai?.model;
        generate.addEventListener("click", async () => {
          generate.disabled = true;
          aiStatus.textContent = "正在请本机 AI 编写记忆故事…";
          try {
            const text = await generateMemoryStory(settings.ai, result.unknown);
            await request(`/api/page/${encodeURIComponent(id)}/story`, { text });
            story.textContent = text;
            if (!story.isConnected) quiz.insertBefore(story, aiControls);
            aiStatus.textContent = "故事已保存在这个浏览器";
            generate.title = "重新生成记忆故事";
            generate.setAttribute("aria-label", generate.title);
          } catch (error) { aiStatus.textContent = error.message; }
          finally { generate.disabled = false; }
        });
        aiControls.append(generate, configure, aiStatus);
        quiz.append(aiControls);
      }
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
