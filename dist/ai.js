export const AI_DEFAULTS = { endpoint: "http://127.0.0.1:11434/v1", model: "" };

export function localEndpoint(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw new Error("请输入完整的本机 AI 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("AI 地址只能使用本机 localhost 或 127.0.0.1");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("AI 地址不能包含账号、参数或密钥");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

export function aiConfig(raw) {
  const endpoint = localEndpoint(raw?.endpoint || AI_DEFAULTS.endpoint);
  const model = String(raw?.model || "").trim();
  if (!model) throw new Error("请填写本机模型名称，或先检测本地模型");
  if (/:cloud$/i.test(model)) throw new Error("请选择已下载到本机的模型，不能使用云端模型");
  if (model.length > 200) throw new Error("模型名称过长");
  return { endpoint, model };
}

function apiUrl(endpoint, route) {
  const base = localEndpoint(endpoint);
  return `${base.replace(/\/chat\/completions$/, "")}${route}`;
}

async function localFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
      targetAddressSpace: "loopback",
      signal: controller.signal,
      ...options,
    });
    if (!response.ok) throw new Error(`本机 AI 返回 ${response.status}：${(await response.text()).slice(0, 180)}`);
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("本机 AI 响应超时，请检查模型是否已加载");
    if (error instanceof TypeError) throw new Error("无法连接本机 AI。请启动服务并允许此网站跨来源访问（CORS）。");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function listLocalModels(endpoint) {
  const data = await localFetch(apiUrl(endpoint, "/models"));
  return Array.isArray(data.data) ? data.data.map((item) => item.id).filter((id) => typeof id === "string" && !/:cloud$/i.test(id)) : [];
}

export async function generateMemoryStory(config, words) {
  const { endpoint, model } = aiConfig(config);
  if (!Array.isArray(words) || !words.length) throw new Error("本轮没有需要复习的词");
  const items = words.map((word) => `${word.lang}: ${word.head}（${(word.gloss || []).join("；")}）`).join("\n");
  const data = await localFetch(apiUrl(endpoint, "/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.7,
      messages: [
        { role: "system", content: "你是多语言记忆教练。只根据用户给出的词写自然、易记的中文小故事，不添加无关说明。" },
        { role: "user", content: `请用这些待复习词写一段 80～150 字的中文记忆故事。外语词保持原形，后面标注中文释义：\n${items}` },
      ],
    }),
  });
  const story = data?.choices?.[0]?.message?.content;
  if (typeof story !== "string" || !story.trim()) throw new Error("本机 AI 没有返回故事内容");
  return story.trim();
}
