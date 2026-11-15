const STORAGE_KEY = "ledokol-voice-v2";
const locales = { en: "en-US", ja: "ja-JP", ru: "ru-RU" };
const names = { en: "英语", ja: "日语", ru: "俄语" };
const previewText = {
  en: "Hello! Let's break the ice.",
  ja: "こんにちは。氷を割ろう！",
  ru: "Привет! Давай колоть лёд!",
};

// Prefer higher quality voices when available; online voices remain opt-in so
// vocabulary is never sent to a speech service without the user's choice.
const NATURAL_VOICE = /natural|neural|online|premium|enhanced|siri|google|aria|jenny|guy|sonia|ryan|libby|ava|andrew|emma|brian|ashley|cora|elizabeth|michelle|monica|nanami|keita|mayu|shiori|svetlana|dmitry|daria|milena|yuri|katya/i;
const LEGACY_VOICE = /microsoft (david|zira|mark|huihui|yaoyao|haruka|ayumi|ichiro|irina|pavel)/i;
const YOUNG_VOICE = /child|children|kid|junior|young|youth|teen|boy|girl|anime|kawaii|shota|小|少[年女]|儿童|童声|yunxi|xiaoyi|nanami|ayumi|haruka|yuki|sora|masha|katya|milena|tatyana/i;

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
    byLang: saved.byLang && typeof saved.byLang === "object" ? saved.byLang : {},
    // Natural voices are provided by the browser's speech service. Turning
    // this off keeps everything on-device but falls back to older voices.
    allowRemote: saved.allowRemote === true,
  };
  const synth = window.speechSynthesis;
  const browserSpeech = Boolean(synth && window.SpeechSynthesisUtterance);
  const supported = browserSpeech;
  let lastWord = "";
  let lastSpokenAt = 0;
  let playToken = 0;
  let status = "";
  let statusListener;
  let voicesPromise;
  const preparedSpeech = new Map();

  function report(message) { status = message; statusListener?.(message); }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
  function isRemote(voice) { return voice.localService !== true; }
  function isNatural(voice) { return NATURAL_VOICE.test(`${voice.name || ""} ${voice.voiceURI || ""}`); }
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
  function score(voice) {
    return (isNatural(voice) ? 100 : 0)
      + (isRemote(voice) ? 15 : 5)
      + (isYoung(voice) ? 12 : 0)
      + (voice.default ? 1 : 0)
      - (LEGACY_VOICE.test(voice.name || "") ? 20 : 0);
  }
  function voices(lang) {
    const pool = state.allowRemote ? [...remoteVoices(lang), ...localVoices(lang)] : localVoices(lang);
    return pool.sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
  }
  function chosen(lang) {
    const pool = voices(lang);
    return pool.find((voice) => voice.voiceURI === state.byLang[langCode(lang)]) || pool[0];
  }
  function loadVoices() {
    if (!browserSpeech) return Promise.resolve([]);
    const available = synth.getVoices();
    if (available.length) return Promise.resolve(available);
    if (!voicesPromise) voicesPromise = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        synth.removeEventListener?.("voiceschanged", finish);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(finish, 1500);
      synth.addEventListener?.("voiceschanged", finish);
    });
    return voicesPromise;
  }
  async function prepare(words = []) {
    const available = await loadVoices();
    if (!available.length) return false;
    preparedSpeech.clear();
    for (const word of words) {
      if (!word?.head) continue;
      const code = langCode(word.lang);
      const voice = chosen(code);
      if (voice) preparedSpeech.set(`${word.lang}:${word.head}`, voice);
    }
    return true;
  }
  function speak(word, force = false) {
    if ((!state.enabled && !force) || !supported || !word?.head) return false;
    const key = `${word.lang}:${word.head}`;
    if (!force && key === lastWord && Date.now() - lastSpokenAt < 850) return true;
    lastWord = key;
    lastSpokenAt = Date.now();
    stop();
    const token = playToken;
    void loadVoices().then(() => {
      if (token !== playToken) return;
      const voice = preparedSpeech.get(key) || chosen(word.lang);
      if (!voice) {
        report(state.allowRemote
          ? `没有找到可用的${names[langCode(word.lang)]}语音：请确认浏览器已启用在线语音，或在系统中安装语音包。`
          : "当前只使用设备语音，而这台设备没有对应语音包；开启在线语音即可使用自然发音。");
        return;
      }
      try {
        const utterance = new SpeechSynthesisUtterance(word.head);
        utterance.lang = voice.lang || locales[langCode(word.lang)];
        utterance.voice = voice;
        utterance.pitch = 1;
        utterance.rate = 0.95;
        utterance.volume = 1;
        utterance.onerror = (event) => { if (token === playToken) report(`发音失败：${event.error || "未知原因"}`); };
        synth.speak(utterance);
      } catch (error) { report(`发音失败：${error.message}`); }
    });
    return true;
  }
  function preview(lang) {
    const code = langCode(lang);
    const started = speak({ lang: code, head: previewText[code] }, true);
    if (!started) report("这个浏览器没有可用的语音合成接口。");
    return started;
  }
  function stop() {
    playToken++;
    if (browserSpeech) synth.cancel();
  }
  return {
    state, supported, systemSpeech: browserSpeech, voices, localVoices, remoteVoices, chosen, isRemote, isNatural, isYoung, speak, preview, stop,
    get status() { return status; },
    onStatus(listener) { statusListener = listener; },
    setEnabled(value) { state.enabled = Boolean(value); if (!state.enabled) stop(); save(); },
    setVoice(lang, uri) {
      const code = langCode(lang);
      if (!uri || voices(code).some((voice) => voice.voiceURI === uri)) state.byLang[code] = uri;
      preparedSpeech.clear();
      save();
    },
    setAllowRemote(value) {
      state.allowRemote = Boolean(value);
      preparedSpeech.clear();
      stop();
      save();
    },
    prepare,
  };
}
