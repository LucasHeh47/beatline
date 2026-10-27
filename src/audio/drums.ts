// The built-in drum kit, made from oscillators and noise when Beatline starts (in an offline audio
// context, so it's fast and the same every time). 808-style kicks, snares, claps, hats, cymbals,
// toms, percussion and an 808 bass.

type Make = (ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer) => void;

/** A repeatable noise buffer, so the sounds are the same every time. */
function noiseBuffer(ctx: BaseAudioContext, secs = 2): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return b;
}

function env(ctx: BaseAudioContext, out: AudioNode, peak: number, attack: number, decay: number, at = 0): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(out);
  return g;
}

function tone(ctx: BaseAudioContext, type: OscillatorType, from: number, to: number, glide: number, out: AudioNode, len = 3): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, 0);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, glide);
  o.connect(out);
  o.start(0);
  o.stop(len);
  return o;
}

function noise(ctx: BaseAudioContext, buf: AudioBuffer, out: AudioNode, filters: [BiquadFilterType, number, number][] = []): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  let node: AudioNode = s;
  for (const [type, f, q] of filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = f;
    bq.Q.value = q;
    node.connect(bq);
    node = bq;
  }
  node.connect(out);
  s.start(0);
  return s;
}

function shaper(ctx: BaseAudioContext, amount: number, out: AudioNode): WaveShaperNode {
  const w = ctx.createWaveShaper();
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  w.curve = c;
  w.connect(out);
  return w;
}

/** The six square waves of an 808 cymbal: a metallic, inharmonic ring. */
function metal(ctx: BaseAudioContext, out: AudioNode, scale = 1, len = 3): void {
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f * scale;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g);
    g.connect(out);
    o.start(0);
    o.stop(len);
  }
}

const filter = (ctx: BaseAudioContext, type: BiquadFilterType, f: number, q: number, out: AudioNode) => {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.connect(out);
  return b;
};

function kick(ctx: BaseAudioContext, out: AudioNode, n: AudioBuffer, o: { from: number; to: number; glide: number; decay: number; click: number; drive: number; lowpass?: number }): void {
  let dest: AudioNode = out;
  if (o.lowpass) dest = filter(ctx, 'lowpass', o.lowpass, 0.7, dest);
  if (o.drive) dest = shaper(ctx, o.drive, dest);
  tone(ctx, 'sine', o.from, o.to, o.glide, env(ctx, dest, 1, 0.002, o.decay));
  if (o.click) noise(ctx, n, env(ctx, dest, o.click, 0.0005, 0.012), [['bandpass', 3500, 0.8]]);
}

const SOUNDS: Record<string, { len: number; make: Make }> = {
  kick808: { len: 1.4, make: (c, o, n) => kick(c, o, n, { from: 160, to: 46, glide: 0.09, decay: 1.2, click: 0.25, drive: 1.2 }) },
  kickPunch: { len: 0.6, make: (c, o, n) => kick(c, o, n, { from: 200, to: 55, glide: 0.045, decay: 0.38, click: 0.6, drive: 2.2 }) },
  kickLofi: { len: 0.6, make: (c, o, n) => kick(c, o, n, { from: 170, to: 52, glide: 0.05, decay: 0.4, click: 0.35, drive: 3, lowpass: 1600 }) },
  kickHouse: { len: 0.7, make: (c, o, n) => kick(c, o, n, { from: 140, to: 50, glide: 0.06, decay: 0.5, click: 0.4, drive: 1.6 }) },
  snare: {
    len: 0.5,
    make: (c, o, n) => {
      tone(c, 'triangle', 220, 180, 0.03, env(c, o, 0.5, 0.001, 0.12));
      tone(c, 'sine', 330, 300, 0.03, env(c, o, 0.3, 0.001, 0.08));
      noise(c, n, env(c, o, 0.7, 0.001, 0.22), [['highpass', 1200, 0.7], ['peaking', 5000, 1]]);
    },
  },
  snareTight: {
    len: 0.35,
    make: (c, o, n) => {
      tone(c, 'triangle', 280, 230, 0.02, env(c, o, 0.45, 0.001, 0.07));
      noise(c, n, env(c, o, 0.75, 0.001, 0.13), [['bandpass', 4500, 0.6]]);
    },
  },
  snareLofi: {
    len: 0.45,
    make: (c, o, n) => {
      const lp = filter(c, 'lowpass', 3200, 0.7, o);
      tone(c, 'triangle', 200, 170, 0.03, env(c, lp, 0.55, 0.001, 0.14));
      noise(c, n, env(c, lp, 0.6, 0.002, 0.2), [['highpass', 900, 0.7]]);
    },
  },
  clap: {
    len: 0.5,
    make: (c, o, n) => {
      const bp = filter(c, 'bandpass', 1300, 1.1, o);
      // One noise through three quick slaps, then the room
      const g = c.createGain();
      noise(c, n, g);
      for (const t of [0, 0.011, 0.022]) g.connect(env(c, bp, 0.9, 0.0005, 0.01, t));
      g.connect(env(c, bp, 0.75, 0.001, 0.18, 0.03));
    },
  },
  snap: {
    len: 0.25,
    make: (c, o, n) => {
      noise(c, n, env(c, o, 0.9, 0.0005, 0.04), [['bandpass', 2600, 2]]);
      tone(c, 'sine', 1800, 1200, 0.01, env(c, o, 0.25, 0.0005, 0.02));
    },
  },
  rim: {
    len: 0.2,
    make: (c, o, n) => {
      tone(c, 'triangle', 1700, 1600, 0.01, env(c, o, 0.6, 0.0005, 0.03));
      tone(c, 'square', 480, 470, 0.01, env(c, filter(c, 'bandpass', 900, 3, o), 0.4, 0.0005, 0.04));
      noise(c, n, env(c, o, 0.3, 0.0005, 0.015), [['highpass', 4000, 0.7]]);
    },
  },
  hatClosed: { len: 0.25, make: (c, o) => metal(c, env(c, filter(c, 'highpass', 7000, 0.7, filter(c, 'bandpass', 10000, 0.8, o)), 1.4, 0.001, 0.05)) },
  hatOpen: { len: 0.8, make: (c, o) => metal(c, env(c, filter(c, 'highpass', 7000, 0.7, filter(c, 'bandpass', 10000, 0.8, o)), 1.2, 0.002, 0.42)) },
  hatPedal: { len: 0.25, make: (c, o) => metal(c, env(c, filter(c, 'highpass', 6000, 0.7, filter(c, 'bandpass', 8000, 0.9, o)), 1.1, 0.004, 0.07)) },
  crash: {
    len: 2.4,
    make: (c, o, n) => {
      const hp = filter(c, 'highpass', 4500, 0.6, o);
      metal(c, env(c, hp, 0.9, 0.002, 1.8), 1.3);
      noise(c, n, env(c, hp, 0.6, 0.002, 2), [['bandpass', 7000, 0.4]]);
    },
  },
  ride: {
    len: 1.8,
    make: (c, o, n) => {
      const hp = filter(c, 'highpass', 5000, 0.6, o);
      metal(c, env(c, hp, 0.8, 0.001, 1.4), 1.7);
      tone(c, 'sine', 3400, 3400, 0, env(c, o, 0.12, 0.001, 0.9));
      noise(c, n, env(c, hp, 0.15, 0.001, 0.5));
    },
  },
  tomLow: { len: 0.8, make: (c, o, n) => {
    tone(c, 'sine', 140, 95, 0.25, env(c, o, 0.9, 0.002, 0.55));
    noise(c, n, env(c, o, 0.12, 0.001, 0.05), [['bandpass', 1500, 1]]);
  } },
  tomMid: { len: 0.7, make: (c, o, n) => {
    tone(c, 'sine', 200, 140, 0.22, env(c, o, 0.9, 0.002, 0.45));
    noise(c, n, env(c, o, 0.12, 0.001, 0.05), [['bandpass', 1800, 1]]);
  } },
  tomHigh: { len: 0.6, make: (c, o, n) => {
    tone(c, 'sine', 280, 200, 0.18, env(c, o, 0.9, 0.002, 0.38));
    noise(c, n, env(c, o, 0.12, 0.001, 0.05), [['bandpass', 2200, 1]]);
  } },
  shaker: { len: 0.25, make: (c, o, n) => noise(c, n, env(c, o, 0.5, 0.018, 0.07), [['bandpass', 6500, 1.2], ['highpass', 4000, 0.7]]) },
  tambourine: {
    len: 0.5,
    make: (c, o, n) => {
      const hp = filter(c, 'highpass', 6500, 0.8, o);
      for (const t of [0, 0.012, 0.03]) noise(c, n, env(c, hp, 0.45, 0.001, 0.2, t), [['bandpass', 9000, 1.5]]);
      metal(c, env(c, hp, 0.4, 0.001, 0.25), 2.1);
    },
  },
  cowbell: {
    len: 0.5,
    make: (c, o) => {
      const bp = filter(c, 'bandpass', 800, 1.5, o);
      tone(c, 'square', 540, 540, 0, env(c, bp, 0.7, 0.001, 0.35));
      tone(c, 'square', 800, 800, 0, env(c, bp, 0.6, 0.001, 0.3));
    },
  },
  conga: { len: 0.4, make: (c, o) => tone(c, 'sine', 330, 220, 0.04, env(c, o, 0.9, 0.001, 0.26)) },
  woodblock: {
    len: 0.2,
    make: (c, o) => {
      const bp = filter(c, 'bandpass', 1100, 3, o);
      tone(c, 'sine', 920, 900, 0.01, env(c, bp, 1.6, 0.0005, 0.07));
      tone(c, 'sine', 1640, 1600, 0.01, env(c, bp, 0.6, 0.0005, 0.04));
    },
  },
  bass808: {
    len: 2.2,
    make: (c, o) => {
      // C2, with a little drop into the note and soft saturation for weight on small speakers
      const sat = shaper(c, 1.8, o);
      tone(c, 'sine', 80, 65.406, 0.035, env(c, sat, 1, 0.003, 2));
    },
  },
};

const cache = new Map<string, Promise<AudioBuffer>>();

/** The sound of a built-in drum (made once per sample rate). */
export function drumBuffer(id: string, sampleRate: number): Promise<AudioBuffer> | null {
  const s = SOUNDS[id];
  if (!s) return null;
  const k = `${id}@${sampleRate}`;
  let p = cache.get(k);
  if (!p) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil(s.len * sampleRate), sampleRate });
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    s.make(ctx, out, noiseBuffer(ctx));
    p = ctx.startRendering().then((b) => trimSilence(b));
    cache.set(k, p);
  }
  return p;
}

/** Cuts the silent tail off a rendered sound. */
function trimSilence(b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0);
  let end = d.length;
  while (end > 1 && Math.abs(d[end - 1]) < 1e-4) end--;
  if (end >= d.length - 16) return b;
  const out = new AudioBuffer({ length: Math.max(1, end), numberOfChannels: 1, sampleRate: b.sampleRate });
  out.copyToChannel(d.subarray(0, end), 0);
  return out;
}

export const BUILTIN_IDS = Object.keys(SOUNDS);
