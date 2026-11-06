const STORAGE_KEY = "ledokol-voice-v1";
const locales = { en: "en-US", ja: "ja-JP", ru: "ru-RU" };
const previewText = {
  en: "Hello! Let's break the ice.",
  ja: "こんにちは。氷を割ろう！",
  ru: "Привет! Давай колоть лёд!",
};

export const voiceStyles = [
  { id: "young", icon: "👦", label: "少年感", detail: "音高稍高", pitch: 1.2, rate: 1.02 },
  { id: "bright", icon: "✦", label: "清亮", detail: "音高更高", pitch: 1.35, rate: 1.08 },
  { id: "gentle", icon: "☁", label: "柔和", detail: "稍慢稍低", pitch: 1.06, rate: 0.91 },
  { id: "deep", icon: "◆", label: "低沉", detail: "音高较低", pitch: 0.84, rate: 0.9 },
];

// Names that browsers commonly give to real child/junior voices. These are
// preferred over adult voices when a language has more than one system voice.
const YOUNG_VOICE = /child|children|kid|junior|young|youth|teen|boy|girl|anime|kawaii|shota|loli|小|少[年女]|儿童|童声|yunxi|xiaoyi|nanami|ayumi|haruka|yuki|sora|masha|katya|milena|tatyana/i;

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function langCode(lang) {
  const code = String(lang || "").toLowerCase().split("-")[0];
  return locales[code] ? code : "en";
}

export function createVoiceGuide() {
  const saved = load();
  const state = {
    enabled: saved.enabled !== false,
    style: voiceStyles.some((item) => item.id === saved.style) ? saved.style : "young",
    byLang: saved.byLang && typeof saved.byLang === "object" ? saved.byLang : {},
    // Remote/browser voices may send the spoken word to a service. They are
    // never listed or selected until the user opts in explicitly.
    allowRemote: saved.allowRemote === true,
  };
  const synth = window.speechSynthesis;
  const browserSpeech = Boolean(synth && window.SpeechSynthesisUtterance);
  const audioApi = window.AudioContext || window.webkitAudioContext;
  const supported = browserSpeech || Boolean(audioApi);
  let lastWord = "";
  let lastSpokenAt = 0;
  let bundledPromise;
  let audioContext;
  let audioSource;
  let playToken = 0;
  let status = "";
  let statusListener;

  function report(message) { status = message; statusListener?.(message); }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
  function isRemote(voice) { return voice.localService !== true; }
  function isYoung(voice) { return YOUNG_VOICE.test(`${voice.name || ""} ${voice.voiceURI || ""}`); }
  function voicesFor(lang, remote) {
    if (!browserSpeech) return [];
    const code = langCode(lang);
    return synth.getVoices().filter((voice) => (
      String(voice.lang || "").toLowerCase().split("-")[0] === code
      && isRemote(voice) === remote
    ));
  }
  function localVoices(lang) { return voicesFor(lang, false); }
  function remoteVoices(lang) { return voicesFor(lang, true); }
  function voices(lang) {
    return state.allowRemote ? [...localVoices(lang), ...remoteVoices(lang)] : localVoices(lang);
  }
  function score(voice) {
    const name = `${voice.name || ""} ${voice.voiceURI || ""}`.toLowerCase();
    return (isYoung(voice) ? 40 : 0)
      + (/female|woman|girl|女/.test(name) ? 3 : 0)
      + (isRemote(voice) ? 0 : 8)
      + (voice.default ? 1 : 0);
  }
  function chosen(lang) {
    const code = langCode(lang);
    const available = [...voices(code)].sort((a, b) => score(b) - score(a));
    return available.find((voice) => voice.voiceURI === state.byLang[code]) || available[0];
  }
  function styleFor() {
    return voiceStyles.find((item) => item.id === state.style) || voiceStyles[0];
  }
  async function speakBundled(word, token) {
    try {
      report("正在准备站点内置离线发音…");
      audioContext ||= new audioApi();
      await audioContext.resume();
      bundledPromise ||= import("./vendor/spellophone/dist/browser.js").then(async ({ createEspeak, toFloat32 }) => ({
        engine: await createEspeak({ dataUrl: new URL("./vendor/spellophone/espeak-ng-data/", import.meta.url), languages: ["en"] }),
        toFloat32,
      }));
      const { engine, toFloat32 } = await bundledPromise;
      if (token !== playToken) return;
      const lang = langCode(word.lang);
      await engine.loadLanguages([lang]);
      if (token !== playToken) return;
      const style = styleFor();
      const result = engine.synthesize(lang === "ja" ? word.reading || word.head : word.head, {
        voice: lang, pitch: Math.min(99, Math.round(style.pitch * 55)), rate: Math.round(style.rate * 175), endPause: false,
      });
      const buffer = audioContext.createBuffer(1, result.samples.length, result.sampleRate);
      buffer.copyToChannel(toFloat32(result.samples), 0);
      if (token !== playToken) return;
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = buffer;
      audioSource.connect(audioContext.destination);
      audioSource.start();
      report("站点内置离线发音 · 声音由设备生成");
    } catch (error) {
      bundledPromise = undefined;
      report(`离线发音未能启动：${error.message}`);
    }
  }
  function speak(word, force = false) {
    if ((!state.enabled && !force) || !supported || !word?.head) return false;
    const key = `${word.lang}:${word.head}`;
    if (!force && key === lastWord && Date.now() - lastSpokenAt < 850) return true;
    lastWord = key;
    lastSpokenAt = Date.now();
    stop();
    const voice = chosen(word.lang);
    if (!voice) {
      if (!audioApi) return false;
      void speakBundled(word, playToken);
      return true;
    }
    const utterance = new SpeechSynthesisUtterance(word.head);
    const style = styleFor();
    utterance.lang = voice.lang || locales[langCode(word.lang)];
    utterance.voice = voice;
    utterance.pitch = 1;
    utterance.rate = style.rate;
    utterance.volume = 0.95;
    const token = playToken;
    utterance.onerror = () => { if (token === playToken && audioApi) void speakBundled(word, token); };
    try { synth.speak(utterance); return true; }
    catch {
      if (!audioApi) return false;
      void speakBundled(word, token);
      return true;
    }
  }
  function preview(lang) {
    const code = langCode(lang);
    const started = speak({ lang: code, head: previewText[code] }, true);
    if (!started) report("这个浏览器没有可用的发音引擎。");
    return started;
  }
  function stop() {
    playToken++;
    if (browserSpeech) synth.cancel();
    if (audioSource) { try { audioSource.stop(); } catch {} audioSource = undefined; }
  }
  return {
    state, supported, systemSpeech: browserSpeech, voices, localVoices, remoteVoices, chosen, isRemote, isYoung, speak, preview, stop,
    get status() { return status; },
    onStatus(listener) { statusListener = listener; },
    setEnabled(value) { state.enabled = Boolean(value); if (!state.enabled) stop(); save(); },
    setStyle(value) { if (voiceStyles.some((item) => item.id === value)) { state.style = value; save(); } },
    setVoice(lang, uri) {
      const code = langCode(lang);
      if (!uri || voices(code).some((voice) => voice.voiceURI === uri)) state.byLang[code] = uri;
      save();
    },
    setAllowRemote(value) {
      state.allowRemote = Boolean(value);
      stop();
      save();
    },
  };
}
