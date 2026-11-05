const MUTE_KEY = "ledok…uted";

let ac = null;
let master, dry, wetGain;

function boot() {
  if (ac) return ac;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.value = 0.85;
  master.connect(ac.destination);

  dry = ac.createGain();
  dry.gain.value = 0.8;
  dry.connect(master);

  const conv = ac.createConvolver();
  conv.buffer = impulse(1.35, 3.4);
  wetGain = ac.createGain();
  wetGain.gain.value = 0.55;
  wetGain.connect(conv).connect(master);
  return ac;
}

function impulse(dur, decay) {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
    for (const at of [0.011, 0.023, 0.037]) d[Math.floor(at * ac.sampleRate)] += 0.45;
  }
  return buf;
}

function noise(dur) {
  const len = Math.max(1, Math.ceil(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const rnd = (a, b) => a + Math.random() * (b - a);

function route(node, send) {
  node.connect(dry);
  if (send > 0) {
    const g = ac.createGain();
    g.gain.value = send;
    node.connect(g).connect(wetGain);
  }
}

function hiss({ dur = 0.08, gain = 0.3, freq = 3000, q = 1, type = "bandpass", sweep = 0, at = 0, send = 0.35 }) {
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(dur);
  src.playbackRate.value = rnd(0.92, 1.08);
  const filt = ac.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(freq, t0);
  if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t0 + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
  src.connect(filt).connect(amp);
  route(amp, send);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function ring({ freq = 800, dur = 0.25, gain = 0.16, type = "sine", at = 0, to = 0, send = 0.4 }) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq * rnd(0.985, 1.015), t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp);
  route(amp, send);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function debris({ count = 5, at = 0 }) {
  for (let i = 0; i < count; i++) {
    hiss({ at: at + rnd(0, 0.28), dur: rnd(0.02, 0.05), gain: rnd(0.06, 0.16), freq: rnd(2600, 6200), q: rnd(3, 9), send: 0.6 });
  }
}

export const sfx = {
  iceTap() {
    if (this.muted) return;
    this.unlock();
    // A sharp fracture, followed by bright shards and a short icy tail.
    hiss({ dur: 0.042, gain: 0.35, freq: 2900, q: 3.4, send: 0.2 });
    hiss({ at: 0.012, dur: 0.085, gain: 0.22, freq: 1050, q: 1.1, send: 0.16 });
    ring({ at: 0.006, freq: 920, to: 570, dur: 0.17, gain: 0.12, type: "triangle", send: 0.3 });
    ring({ at: 0.038, freq: 1780, to: 1210, dur: 0.13, gain: 0.075, type: "sine", send: 0.42 });
    debris({ count: 5, at: 0.025 });
    hiss({ at: 0.12, dur: 0.12, gain: 0.095, freq: 520, q: 0.7, type: "lowpass", send: 0.18 });
  },
  iceLift() {
    if (this.muted) return;
    this.unlock();
    hiss({ dur: 0.13, gain: 0.13, freq: 650, q: 0.6, type: "lowpass", send: 0.02 });
  },
  get muted() {
    return localStorage.getItem(MUTE_KEY) === "1";
  },
  set muted(v) {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  },
  toggle() {
    this.muted = !this.muted;
    return this.muted;
  },
  unlock() {
    boot();
    if (ac.state === "suspended") ac.resume();
  },
  punch() {
    if (this.muted) return;
    this.unlock();
    hiss({ dur: 0.028, gain: 0.5, freq: rnd(3400, 4200), q: 9, send: 0.25 });
    ring({ freq: rnd(150, 175), to: 60, dur: 0.1, gain: 0.3, type: "triangle", send: 0.15 });
    ring({ freq: rnd(2300, 2900), dur: 0.16, gain: 0.1, type: "square", send: 0.5 });
  },
  drop() {
    if (this.muted) return;
    this.unlock();
    ring({ freq: 1150, to: 320, dur: 0.18, gain: 0.13, type: "sine", at: 0.02 });
    debris({ count: 5, at: 0.06 });
    hiss({ at: 0.24, dur: 0.14, gain: 0.16, freq: 420, q: 0.9, type: "lowpass", send: 0.5 });
  },
  crack() {
    if (this.muted) return;
    this.unlock();
    hiss({ dur: 0.03, gain: 0.42, freq: 3600, q: 8, send: 0.2 });
    [0.03, 0.07, 0.12, 0.17].forEach((at) =>
      hiss({ at, dur: rnd(0.02, 0.045), gain: rnd(0.14, 0.26), freq: rnd(1400, 3000), q: rnd(4, 10), send: 0.45 })
    );
    ring({ at: 0.05, freq: 128, to: 74, dur: 0.34, gain: 0.16, type: "sawtooth", send: 0.3 });
  },
  shatter() {
    if (this.muted) return;
    this.unlock();
    hiss({ dur: 0.55, gain: 0.5, freq: 7000, sweep: 0.06, q: 0.9, send: 0.7 });
    for (let i = 0; i < 9; i++) {
      ring({ at: rnd(0, 0.4), freq: rnd(1900, 5200), dur: rnd(0.12, 0.4), gain: rnd(0.05, 0.12), type: "triangle", send: 0.8 });
    }
    hiss({ at: 0.34, dur: 0.22, gain: 0.3, freq: 300, q: 0.8, type: "lowpass", send: 0.4 });
    debris({ count: 8, at: 0.1 });
  },
  penguin() {
    if (this.muted) return;
    this.unlock();
    ring({ freq: 760, to: 210, dur: 0.3, gain: 0.14, type: "square", send: 0.35 });
    hiss({ at: 0.22, dur: 0.4, gain: 0.3, freq: 2400, sweep: 0.12, q: 1.2, send: 0.8 });
  },
  fanfare() {
    if (this.muted) return;
    this.unlock();
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      ring({ at: i * 0.085, freq: f, dur: 0.55, gain: 0.13, type: "triangle", send: 0.75 })
    );
    ring({ at: 0.42, freq: 1047, dur: 0.9, gain: 0.09, type: "sine", send: 0.9 });
  },
  voyage() {
    if (this.muted) return;
    this.unlock();
    ring({ freq: 116, dur: 0.85, gain: 0.22, type: "sawtooth", to: 140, send: 0.5 });
    ring({ at: 0.05, freq: 174, dur: 0.8, gain: 0.12, type: "sine", to: 205, send: 0.5 });
    hiss({ at: 0.1, dur: 0.6, gain: 0.07, freq: 700, q: 0.7, type: "lowpass", send: 0.6 });
  }
};
