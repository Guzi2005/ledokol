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
  const distractors = words.filter((item) => item.hash !== word.hash)
    .map(meaning).filter((item) => item !== correct && item !== "暂无释义");
  const unique = [...new Set(distractors)];
  // Stable order for a given tile so a re-render does not move the answer.
  const seed = [...word.hash].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  unique.sort((a, b) => (a.length * 17 + seed) % 37 - (b.length * 17 + seed) % 37 || a.localeCompare(b));
  const options = [correct, ...unique.slice(0, 3)];
  const shift = seed % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

export async function viewIceGame(id, view, sfx, request) {
  view.replaceChildren(node("p", "muted", "正在铺冰面…"));
  let page;
  try { page = await request(`/api/page/${encodeURIComponent(id)}`); }
  catch (error) { view.replaceChildren(node("p", "game-error", error.message)); return; }

  const results = { ...(page.results || {}) };
  let layerIndex = 0;
  let combo = 0;
  let busy = false;
  const shell = node("section", "game-shell");
  const heading = node("div", "game-top");
  const board = node("div", "game-board-wrap");
  const status = node("div", "game-status");
  const quiz = node("div", "game-quiz");
  quiz.setAttribute("aria-live", "polite");
  shell.append(heading, board, status, quiz);
  view.replaceChildren(shell);

  const allWords = page.layers.flatMap((layer) => layer.words);
  const marked = (word) => Object.hasOwn(results, word.hash);
  const completed = (layer) => layer.words.every(marked);
  const total = allWords.length;

  function stats() {
    const answered = Object.keys(results).length;
    const known = Object.values(results).filter(Boolean).length;
    status.textContent = `${answered} / ${total} 块已敲 · 答对 ${known} · 连击 ${combo}`;
  }

  function renderHeading() {
    heading.replaceChildren();
    const title = node("div", "game-title", `${id} · 敲冰背词`);
    const exit = node("a", "game-exit", "退出");
    exit.href = "#/";
    exit.setAttribute("aria-label", "退出游戏，返回驾驶舱");
    const subtitle = node("p", "game-help", "点选六角冰块，看词选中文释义。答对碎冰，答错留下裂纹。" );
    const tabs = node("div", "game-layers");
    page.layers.forEach((layer, index) => {
      const tab = node("button", `game-layer ${index === layerIndex ? "active" : ""} ${completed(layer) ? "complete" : ""}`, `${names[layer.lang] || layer.lang} ${layer.words.filter(marked).length}/${layer.words.length}`);
      tab.type = "button";
      tab.disabled = index > layerIndex && !completed(page.layers[layerIndex]);
      tab.addEventListener("click", () => { layerIndex = index; render(); });
      tabs.append(tab);
    });
    heading.append(exit, title, subtitle, tabs);
  }

  function renderBoard() {
    board.replaceChildren();
    const layer = page.layers[layerIndex];
    const field = node("div", "hex-field");
    const positions = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 0, 24, 2, 22, 4, 20, 6, 18, 8, 16, 10, 14, 12];
    const cells = Array(25).fill(null);
    layer.words.forEach((word, index) => { cells[positions[index]] = word; });
    for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
      const row = node("div", `hex-row ${rowIndex % 2 ? "offset" : ""}`);
      for (const word of cells.slice(rowIndex * 5, rowIndex * 5 + 5)) {
        const tile = node("button", `hex-tile ${word ? "word-tile" : "decorative"}`);
        tile.type = "button";
        if (word) {
          tile.textContent = word.head;
          tile.dataset.hash = word.hash;
          tile.setAttribute("aria-label", `${word.head}，选择这块冰`);
          if (marked(word)) {
            tile.classList.add(results[word.hash] ? "melted" : "cracked");
            tile.disabled = true;
            tile.title = results[word.hash] ? "答对" : `待复习：${meaning(word)}`;
          } else tile.addEventListener("click", () => showQuiz(word, tile));
        } else {
          tile.disabled = true;
          tile.setAttribute("aria-hidden", "true");
        }
        row.append(tile);
      }
      field.append(row);
    }
    const penguin = node("div", "board-penguin", "🐧");
    penguin.setAttribute("aria-hidden", "true");
    field.append(penguin);
    board.append(field);
    const caption = node("p", "board-caption", `${names[layer.lang] || layer.lang}冰层 · ${layer.words.length} 个词`);
    board.append(caption);
  }

  function showQuiz(word, tile) {
    if (busy || marked(word)) return;
    sfx.unlock();
    sfx.punch();
    fieldSelection(tile);
    quiz.replaceChildren();
    quiz.classList.add("open");
    quiz.append(node("div", "quiz-kicker", `${names[page.layers[layerIndex].lang]} · 这块冰写着`));
    quiz.append(node("h2", "quiz-word", word.head));
    if (word.reading || word.phonetic) quiz.append(node("p", "quiz-reading", [word.reading, word.phonetic].filter(Boolean).join(" · ")));
    quiz.append(node("p", "quiz-prompt", "它的中文意思是什么？"));
    const options = node("div", "quiz-options");
    choicesFor(word, page.layers[layerIndex].words).forEach((choice) => {
      const button = node("button", "quiz-option", choice);
      button.type = "button";
      button.addEventListener("click", () => answer(word, choice, options));
      options.append(button);
    });
    quiz.append(options);
    options.querySelector("button")?.focus();
  }

  function fieldSelection(tile) {
    board.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
    tile.classList.add("selected");
  }

  async function answer(word, choice, options) {
    if (busy || marked(word)) return;
    busy = true;
    const known = choice === meaning(word);
    [...options.children].forEach((button) => { button.disabled = true; button.classList.toggle("right", button.textContent === meaning(word)); button.classList.toggle("wrong", button.textContent === choice && !known); });
    const feedback = node("p", `quiz-feedback ${known ? "good" : "retry"}`, known ? "敲碎了！" : `裂开了，正确释义：${meaning(word)}`);
    quiz.append(feedback);
    try {
      await request(`/api/page/${encodeURIComponent(id)}/mark`, { hash: word.hash, known });
      results[word.hash] = known;
      combo = known ? combo + 1 : 0;
      known ? sfx.drop() : sfx.crack();
      renderHeading(); renderBoard(); stats();
      const next = node("button", "btn primary quiz-next", completed(page.layers[layerIndex]) ? "下一层冰" : "继续敲冰");
      next.type = "button";
      next.addEventListener("click", async () => {
        quiz.classList.remove("open"); quiz.replaceChildren();
        if (completed(page.layers[layerIndex])) {
          if (layerIndex < page.layers.length - 1) { layerIndex++; render(); sfx.shatter(); }
          else await finish();
        }
      });
      quiz.append(next);
      next.focus();
    } catch (error) {
      feedback.className = "quiz-feedback retry";
      feedback.textContent = `保存失败：${error.message}。请重试。`;
      [...options.children].forEach((button) => { button.disabled = false; button.classList.remove("right", "wrong"); });
    } finally { busy = false; }
  }

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
      const home = node("a", "btn primary", "回驾驶舱"); home.href = "#/";
      quiz.append(home);
      sfx.fanfare();
    } catch (error) { quiz.replaceChildren(node("p", "game-error", `结算失败：${error.message}`)); }
    finally { busy = false; }
  }

  function render() { renderHeading(); renderBoard(); stats(); quiz.classList.remove("open"); quiz.replaceChildren(); }
  if (page.status === "done" || page.layers.every(completed)) await finish();
  else {
    layerIndex = Math.max(0, page.layers.findIndex((layer) => !completed(layer)));
    render();
  }
}
