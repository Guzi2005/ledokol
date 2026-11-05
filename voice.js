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
  const supported = Boolean(synth && window.SpeechSynthesisUtterance);
  let lastWord = "";
  let lastSpokenAt = 0;

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function voices(lang) {
    if (!supported) return [];
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
  function speak(word, force = false) {
    if ((!state.enabled && !force) || !supported || !word?.head) return false;
    const voice = chosen(word.lang);
    if (!voice) return false;
    const key = `${word.lang}:${word.head}`;
    if (!force && key === lastWord && Date.now() - lastSpokenAt < 850) return true;
    lastWord = key;
    lastSpokenAt = Date.now();
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(word.head);
    const style = voiceStyles.find((item) => item.id === state.style) || voiceStyles[0];
    utterance.lang = voice.lang || locales[word.lang];
    utterance.voice = voice;
    utterance.pitch = style.pitch;
    utterance.rate = style.rate;
    utterance.volume = 0.95;
    try { synth.speak(utterance); return true; }
    catch { return false; }
  }
  function stop() { if (supported) synth.cancel(); }
  return {
    state, supported, voices, chosen, speak, stop,
    setEnabled(value) { state.enabled = Boolean(value); if (!state.enabled) stop(); save(); },
    setStyle(value) { if (voiceStyles.some((item) => item.id === value)) { state.style = value; save(); } },
    setVoice(lang, uri) { state.byLang[lang] = uri; save(); },
  };
}
