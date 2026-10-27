// The instruments' voices: one note of the synth (oscillators, noise, filter, envelopes, LFO, FM,
// glide) or of the sampler (a sample played at a pitch). Each starts at a time and is told when to
// stop; they work in the live player and in an offline export alike.
import type { SamplerParams, SynthParams } from '../core/project';
import { noteHz } from '../core/theory';

export interface Voice {
  key: number;
  /** When it will be silent (seconds, context time). */
  end: number;
  /** Starts the release at a time. */
  stop(at: number): void;
  /** Cuts it off quickly (choke groups, stopping playback). */
  kill(at: number): void;
}

const MIN = 0.0001;

let noise: AudioBuffer | null = null;
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noise = b;
  return b;
}

/** A synth note. `from` is the previous note of a mono synth, to glide from. */
export function synthVoice(ctx: BaseAudioContext, p: SynthParams, key: number, vel: number, at: number, out: AudioNode, from?: number): Voice {
  const hz = noteHz(key);
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const mix = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  const trem = ctx.createGain();
  filter.type = p.filter.type;
  filter.Q.value = p.filter.q;
  mix.connect(filter);
  filter.connect(trem);
  trem.connect(amp);
  amp.connect(out);

  const fm = p.fm > 0;
  const carriers: OscillatorNode[] = [];
  let modulator: OscillatorNode | null = null;
  p.osc.forEach((o, i) => {
    if (o.level <= 0 && !(fm && i === 1)) return;
    const f = hz * Math.pow(2, o.octave + o.semi / 12);
    const n = Math.max(1, Math.min(7, Math.round(o.voices)));
    // With FM on, the second oscillator only bends the first (it isn't heard itself)
    const heard = !(fm && i === 1);
    const level = heard ? ctx.createGain() : null;
    if (level) {
      level.gain.value = o.level / Math.sqrt(n);
      level.connect(mix);
    }
    for (let v = 0; v < n; v++) {
      const osc = ctx.createOscillator();
      osc.type = o.wave;
      const spread = n > 1 ? (v / (n - 1) - 0.5) * o.spread : 0;
      osc.detune.value = o.detune + spread;
      if (from !== undefined && p.glide > 0) {
        const startHz = noteHz(from) * Math.pow(2, o.octave + o.semi / 12);
        osc.frequency.setValueAtTime(startHz, at);
        osc.frequency.exponentialRampToValueAtTime(f, at + p.glide);
      } else osc.frequency.setValueAtTime(f, at);
      if (level) osc.connect(level);
      sources.push(osc);
      if (i === 0) carriers.push(osc);
      if (i === 1 && v === 0) modulator = osc;
    }
  });
  if (fm && modulator) {
    // The FM depth fades like an electric piano's tine
    const depth = ctx.createGain();
    const modHz = hz * Math.pow(2, p.osc[1].octave + p.osc[1].semi / 12);
    const peak = p.fm * modHz * 4 * (0.5 + vel / 2);
    depth.gain.setValueAtTime(peak, at);
    depth.gain.setTargetAtTime(peak * 0.25, at + 0.005, Math.max(0.05, p.amp.d / 2));
    (modulator as OscillatorNode).connect(depth);
    for (const c of carriers) depth.connect(c.frequency);
  }
  if (p.noise > 0) {
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    nz.loop = true;
    const g = ctx.createGain();
    g.gain.value = p.noise;
    nz.connect(g);
    g.connect(mix);
    sources.push(nz);
  }

  // Filter: key tracking, and the filter envelope opening it
  const base = Math.max(20, Math.min(20000, p.filter.cutoff * Math.pow(2, (p.filter.key * (key - 60)) / 12)));
  const top = Math.max(20, Math.min(20000, base * Math.pow(2, p.filter.env)));
  const sus = Math.max(20, Math.min(20000, base * Math.pow(2, p.filter.env * p.fenv.s)));
  filter.frequency.setValueAtTime(base, at);
  if (p.filter.env !== 0) {
    filter.frequency.exponentialRampToValueAtTime(top, at + Math.max(0.001, p.fenv.a));
    filter.frequency.setTargetAtTime(sus, at + Math.max(0.001, p.fenv.a), Math.max(0.005, p.fenv.d / 3));
  }

  // Amplitude envelope
  const peak = Math.pow(10, p.gain / 20) * (0.25 + vel * 0.75);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(peak, at + Math.max(0.001, p.amp.a));
  amp.gain.setTargetAtTime(Math.max(MIN, peak * p.amp.s), at + Math.max(0.001, p.amp.a), Math.max(0.005, p.amp.d / 3));

  // LFO
  let lfo: OscillatorNode | null = null;
  if (p.lfo.target !== 'off' && p.lfo.depth > 0) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = p.lfo.rate;
    const g = ctx.createGain();
    lfo.connect(g);
    if (p.lfo.target === 'pitch') {
      g.gain.value = p.lfo.depth * 100;
      for (const s of sources) if (s instanceof OscillatorNode) g.connect(s.detune);
    } else if (p.lfo.target === 'filter') {
      g.gain.value = p.lfo.depth * 2400;
      g.connect(filter.detune);
    } else {
      trem.gain.value = 1 - p.lfo.depth / 2;
      g.gain.value = p.lfo.depth / 2;
      g.connect(trem.gain);
    }
    lfo.start(at);
    sources.push(lfo);
  }
  for (const s of sources) if (s !== lfo) s.start(at);

  const voice: Voice = {
    key,
    end: Infinity,
    stop(t) {
      const when = Math.max(t, at + 0.002);
      const r = Math.max(0.005, p.amp.r);
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, r / 5);
      if (p.filter.env !== 0) {
        filter.frequency.cancelAndHoldAtTime(when);
        filter.frequency.setTargetAtTime(base, when, Math.max(0.005, p.fenv.r / 4));
      }
      const off = when + r * 1.2 + 0.05;
      for (const s of sources) s.stop(off);
      voice.end = off;
    },
    kill(t) {
      const when = Math.max(t, at);
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, 0.004);
      for (const s of sources) s.stop(when + 0.04);
      voice.end = Math.min(voice.end, when + 0.04);
    },
  };
  sources[0]?.addEventListener('ended', () => amp.disconnect());
  return voice;
}

const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();
function reversed(b: AudioBuffer): AudioBuffer {
  let r = reversedCache.get(b);
  if (!r) {
    r = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
    for (let c = 0; c < b.numberOfChannels; c++) r.copyToChannel(b.getChannelData(c).slice().reverse(), c);
    reversedCache.set(b, r);
  }
  return r;
}

/** A sampler note: the sample at the note's pitch (or as it is, for drums). */
export function samplerVoice(ctx: BaseAudioContext, p: SamplerParams, buffer: AudioBuffer, key: number, vel: number, at: number, out: AudioNode): Voice {
  const src = ctx.createBufferSource();
  src.buffer = p.reverse ? reversed(buffer) : buffer;
  const rate = Math.pow(2, ((p.pitched ? key - p.root : 0) + p.tune) / 12);
  src.playbackRate.value = rate;
  const amp = ctx.createGain();
  const level = Math.pow(10, p.gain / 20) * (0.2 + vel * 0.8);
  if (p.attack > 0.0005) {
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + p.attack);
  } else amp.gain.setValueAtTime(level, at);
  src.connect(amp);
  amp.connect(out);
  const offset = Math.max(0, Math.min(0.99, p.start)) * buffer.duration;
  src.start(at, offset);
  const natural = at + (buffer.duration - offset) / rate;
  src.addEventListener('ended', () => amp.disconnect());
  const voice: Voice = {
    key,
    end: natural,
    stop(t) {
      // Drums play out whole; pitched samples (808s, instruments) end with the note
      if (!p.pitched) return;
      const when = Math.max(t, at + 0.002);
      if (when >= natural) return;
      const r = Math.max(0.005, p.release);
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, r / 5);
      src.stop(when + r * 1.2 + 0.02);
      voice.end = when + r * 1.2 + 0.02;
    },
    kill(t) {
      const when = Math.max(t, at);
      if (when >= voice.end) return;
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, 0.003);
      src.stop(when + 0.03);
      voice.end = when + 0.03;
    },
  };
  return voice;
}
