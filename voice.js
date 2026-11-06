const STORAGE_KEY = "ledokol-voice-v1";
const locales = { en: "en-US", ja: "ja-JP", ru: "ru-RU" };

export const voiceStyles = [
  { id: "young", icon: "👦", label: "少年", pitch: 1.2, rate: 1.02 },
  { id: "bright", icon: "✦", label: "清亮", pitch: 1.35, rate: 1.08 },
  { id: "gentle", icon: "☁", label: "柔和", pitch: 1.06, rate: 0.91 },
  { id: "deep", icon: "◆", label: "低沉", pitch: 0.84, rate: 0.9 },
];

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

export function createVoiceGuide() {
  const saved = load();
  const state = {
    enabled: saved.enabled !== false,
    style: voiceStyles.some((item) => item.id === saved.style) ? saved.style : "young",
    byLang: saved.byLang && typeof saved.byLang === "object" ? saved.byLang : {},
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

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function voices(lang) {
    if (!browserSpeech) return [];
    return synth.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(lang) && voice.localService === true);
  }
  function score(voice) {
    const name = voice.name.toLowerCase();
    return (/boy|young|少年|yunxi|ryan|keita|dmitry/.test(name) ? 10 : 0)
      + (/male|男/.test(name) ? 4 : 0) + (voice.default ? 1 : 0);
  }
  function chosen(lang) {
    const available = voices(lang);
    return available.find((voice) => voice.voiceURI === state.byLang[lang])
      || available.sort((a, b) => score(b) - score(a))[0];
  }
  async function speakBundled(word, token) {
    try {
      report("正在准备站点内置离线发音…");
      audioContext ||= new audioApi();
      await audioContext.resume();
      bundledPromise ||= import("./vendor/spellophone/dist/browser.js").then(async ({ createEspeak, toFloat32 }) => ({
        engine: await createEspeak({ dataUrl: "/vendor/spellophone/espeak-ng-data/", languages: ["en"] }),
        toFloat32,
      }));
      const { engine, toFloat32 } = await bundledPromise;
      if (token !== playToken) return;
      const lang = locales[word.lang] ? word.lang : "en";
      await engine.loadLanguages([lang]);
      if (token !== playToken) return;
      const style = voiceStyles.find((item) => item.id === state.style) || voiceStyles[0];
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
    const style = voiceStyles.find((item) => item.id === state.style) || voiceStyles[0];
    utterance.lang = voice.lang || locales[word.lang];
    utterance.voice = voice;
    utterance.pitch = style.pitch;
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
  function stop() {
    playToken++;
    if (browserSpeech) synth.cancel();
    if (audioSource) { try { audioSource.stop(); } catch {} audioSource = undefined; }
  }
  return {
    state, supported, voices, chosen, speak, stop,
    get status() { return status; },
    onStatus(listener) { statusListener = listener; },
    setEnabled(value) { state.enabled = Boolean(value); if (!state.enabled) stop(); save(); },
    setStyle(value) { if (voiceStyles.some((item) => item.id === value)) { state.style = value; save(); } },
    setVoice(lang, uri) { state.byLang[lang] = uri; save(); },
  };
}
