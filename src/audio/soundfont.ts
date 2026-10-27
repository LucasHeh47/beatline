// The built-in instrument library: the General MIDI SoundFont that comes with Beatline, read once,
// with each preset's samples decoded when it's first used. Plays notes of an instrument (pitched,
// looped, with the SoundFont's envelope, filter and pan) and renders single drum hits for the sampler.
import { GM_TRIM } from '../core/instruments';
import type { InstrumentParams } from '../core/project';
import { centsToHz, findPreset, G, modulated, parseSoundFont, regionsFor, tcToSecs, type SfPreset, type SfRegion, type SoundFont } from '../core/soundfont';
import type { Voice } from './voices';

/** A note of a recorded instrument. `cls` is its exclusive class (hi-hats that cut each other off). */
export interface InstrumentVoice extends Voice {
  cls: number;
}

const MIN = 0.0001;

export class SoundFontBank {
  private sf: SoundFont | null = null;
  private loading: Promise<SoundFont | null> | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private decoding = new Map<number, Promise<AudioBuffer | null>>();
  /** Something finished loading (sounds that were silent can play now). */
  onReady: (() => void) | null = null;
  /** Why the SoundFont couldn't be read, if it couldn't. */
  error = '';

  constructor(
    private read: () => Promise<Uint8Array | null>,
    private decoder: () => BaseAudioContext,
  ) {}

  /** Reads the SoundFont (once). */
  load(): Promise<SoundFont | null> {
    this.loading ??= this.read()
      .then((bytes) => {
        if (!bytes) throw new Error('The instrument library is missing.');
        this.sf = parseSoundFont(bytes);
        return this.sf;
      })
      .catch((err: unknown) => {
        this.error = (err as Error).message;
        console.error('Instrument library:', err);
        return null;
      });
    return this.loading;
  }

  get loaded(): boolean {
    return !!this.sf;
  }

  preset(bank: number, program: number): SfPreset | undefined {
    return this.sf ? findPreset(this.sf, bank, program) : undefined;
  }

  /** A decoded sample, or null while it decodes (asking starts it). */
  private buffer(index: number): AudioBuffer | null {
    const b = this.buffers.get(index);
    if (b) return b;
    void this.decode(index);
    return null;
  }

  private decode(index: number): Promise<AudioBuffer | null> {
    const have = this.buffers.get(index);
    if (have) return Promise.resolve(have);
    let p = this.decoding.get(index);
    if (p) return p;
    const sf = this.sf;
    const s = sf?.samples[index];
    if (!sf || !s) return Promise.resolve(null);
    p = (async () => {
      try {
        let b: AudioBuffer;
        if (s.compressed) {
          // Each .sf3 sample is a little Ogg Vorbis file
          b = await this.decoder().decodeAudioData(sf.data.slice(s.start, s.end).buffer);
        } else {
          const n = Math.max(1, s.end - s.start);
          b = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: s.rate });
          const out = b.getChannelData(0);
          const v = new DataView(sf.data.buffer, sf.data.byteOffset + s.start * 2, n * 2);
          for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
        }
        this.buffers.set(index, b);
        return b;
      } catch (err) {
        console.warn(`Couldn't decode the sample "${s.name}"`, err);
        return null;
      } finally {
        this.decoding.delete(index);
      }
    })();
    this.decoding.set(index, p);
    return p;
  }

  /** Gets an instrument's samples ready (before playing or exporting it). */
  async prepare(bank: number, program: number): Promise<void> {
    if (!(await this.load())) return;
    const p = this.preset(bank, program);
    if (!p) return;
    const missing = [...new Set(p.regions.map((r) => r.sample))].filter((i) => !this.buffers.has(i));
    if (!missing.length) return;
    await Promise.all(missing.map((i) => this.decode(i)));
    this.onReady?.();
  }

  /** Plays a note of an instrument (null if it isn't loaded yet; loading starts). */
  voice(ctx: BaseAudioContext, ip: InstrumentParams, key: number, vel: number, at: number, out: AudioNode): InstrumentVoice | null {
    if (!this.sf) {
      void this.load().then(() => this.prepare(ip.bank, ip.program));
      return null;
    }
    const preset = this.preset(ip.bank, ip.program);
    if (!preset) return null;
    const v127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
    const regions = regionsFor(preset, key, v127);
    const parts: Part[] = [];
    for (const r of regions) {
      const buf = this.buffer(r.sample);
      if (!buf) {
        void this.prepare(ip.bank, ip.program);
        continue;
      }
      parts.push(regionVoice(ctx, this.sf.samples[r.sample], buf, r, ip, key, vel, at, out));
    }
    if (!parts.length) return null;
    const voice: InstrumentVoice = {
      key,
      cls: regions[0]?.gen[G.exclusiveClass] ?? 0,
      end: Math.max(...parts.map((x) => x.end)),
      stop(t) {
        voice.end = Math.max(...parts.map((x) => x.stop(t)));
      },
      kill(t) {
        for (const x of parts) x.kill(t);
        voice.end = Math.min(voice.end, Math.max(t, at) + 0.03);
      },
    };
    return voice;
  }

  /** One hit of a drum kit's key, recorded into a buffer (for the drum sampler). */
  async renderHit(kit: number, key: number, sampleRate: number): Promise<AudioBuffer | null> {
    await this.prepare(128, kit);
    if (!this.sf || !this.preset(128, kit)) return null;
    const secs = 4;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(sampleRate * secs), sampleRate });
    const v = this.voice(ctx, { bank: 128, program: kit, gain: 0, tune: 0, release: 1, tone: 20000 }, key, 100 / 127, 0, ctx.destination);
    if (!v) return null;
    // Drums ring out as recorded: the key is held for the whole render
    const b = await ctx.startRendering();
    return trimSilence(b);
  }
}

interface Part {
  end: number;
  /** Starts the release; returns when it will be silent. */
  stop(at: number): number;
  kill(at: number): void;
}

/** One sample of a note: pitch, loop, envelopes, filter and pan as the SoundFont says. */
function regionVoice(ctx: BaseAudioContext, s: SoundFont['samples'][number], buf: AudioBuffer, r: SfRegion, ip: InstrumentParams, key: number, vel: number, at: number, out: AudioNode): Part {
  // The generators with the modulators' changes for this note (velocity makes some instruments brighter, louder or longer)
  const v127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
  const mod = modulated(r, key, v127);
  const g = r.gen.map((x, i) => Math.round(x + mod[i]));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Pitch: how far the note is from the sample's own note, plus the tuning
  const root = g[G.overridingRootKey] >= 0 ? g[G.overridingRootKey] : s.pitch === 255 ? 60 : s.pitch;
  const playKey = g[G.keynum] >= 0 ? g[G.keynum] : key;
  const cents = (playKey - root) * g[G.scaleTuning] + g[G.coarseTune] * 100 + g[G.fineTune] + s.correction + ip.tune * 100;
  src.playbackRate.value = Math.pow(2, cents / 1200);
  // Where it starts, and its loop (in frames of the original sample)
  const startFrames = Math.max(0, g[G.startAddrsOffset] + g[G.startAddrsCoarseOffset] * 32768);
  const mode = g[G.sampleModes] & 3;
  if (mode === 1 || mode === 3) {
    const ls = s.loopStart + g[G.startloopAddrsOffset] + g[G.startloopAddrsCoarseOffset] * 32768;
    const le = s.loopEnd + g[G.endloopAddrsOffset] + g[G.endloopAddrsCoarseOffset] * 32768;
    if (le > ls + 2 && le / s.rate <= buf.duration + 0.01) {
      src.loop = true;
      src.loopStart = ls / s.rate;
      src.loopEnd = le / s.rate;
    }
  }

  // Volume: the zone's attenuation (×0.4, as SoundFont players do) plus the modulators' (velocity), and the channel's gain
  const atten = Math.max(0, r.gen[G.initialAttenuation] * 0.4 + mod[G.initialAttenuation]);
  const trim = ip.bank === 0 ? (GM_TRIM[ip.program] ?? 0) : 0;
  const level = Math.pow(10, -atten / 200) * Math.pow(10, (ip.gain + trim) / 20);
  const amp = ctx.createGain();
  const keyScale = 60 - playKey;
  const delay = tcToSecs(g[G.delayVolEnv]);
  const attack = tcToSecs(g[G.attackVolEnv]);
  const hold = tcToSecs(g[G.holdVolEnv] + keyScale * g[G.keynumToVolEnvHold]);
  const decay = tcToSecs(g[G.decayVolEnv] + keyScale * g[G.keynumToVolEnvDecay]);
  const sustain = level * Math.pow(10, -Math.max(0, g[G.sustainVolEnv]) / 200);
  const release = Math.max(0.01, tcToSecs(g[G.releaseVolEnv]) * Math.max(0.05, ip.release));
  const t0 = at + (delay > 0.002 ? delay : 0);
  amp.gain.setValueAtTime(0, at);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(level, t0 + Math.max(0.002, attack));
  const decayFrom = t0 + Math.max(0.002, attack) + (hold > 0.002 ? hold : 0);
  if (hold > 0.002) amp.gain.setValueAtTime(level, decayFrom);
  // The decay falls in dB at a steady rate: about a fifth of its time per e-fold
  amp.gain.setTargetAtTime(Math.max(MIN, sustain), decayFrom, Math.max(0.002, decay / 5));

  // Filter: the zone's cutoff and its envelope, and the channel's tone
  let node: AudioNode = src;
  const fc = g[G.initialFilterFc];
  const envToFc = g[G.modEnvToFilterFc];
  if (fc < 13500 || envToFc !== 0) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(20000, centsToHz(fc));
    f.Q.value = g[G.initialFilterQ] / 10;
    if (envToFc !== 0) {
      const ma = tcToSecs(g[G.attackModEnv]);
      const md = tcToSecs(g[G.decayModEnv]);
      const ms = 1 - Math.max(0, Math.min(1000, g[G.sustainModEnv])) / 1000;
      const m0 = at + tcToSecs(g[G.delayModEnv]);
      f.detune.setValueAtTime(0, at);
      f.detune.linearRampToValueAtTime(envToFc, m0 + Math.max(0.002, ma));
      f.detune.setTargetAtTime(envToFc * ms, m0 + Math.max(0.002, ma) + tcToSecs(g[G.holdModEnv]), Math.max(0.002, md / 5));
    }
    node.connect(f);
    node = f;
  }
  if (ip.tone < 19000) {
    const t = ctx.createBiquadFilter();
    t.type = 'lowpass';
    t.frequency.value = Math.max(200, ip.tone);
    t.Q.value = 0;
    node.connect(t);
    node = t;
  }
  // Vibrato
  let lfo: OscillatorNode | null = null;
  if (g[G.vibLfoToPitch]) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = centsToHz(g[G.freqVibLFO]);
    const depth = ctx.createGain();
    depth.gain.value = 0;
    depth.gain.setValueAtTime(g[G.vibLfoToPitch], at + tcToSecs(g[G.delayVibLFO]));
    lfo.connect(depth);
    depth.connect(src.detune);
    lfo.start(at);
  }
  node.connect(amp);
  const pan = g[G.pan];
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan / 500));
    amp.connect(p);
    p.connect(out);
  } else amp.connect(out);

  const offset = Math.min(buf.duration - 0.001, startFrames / s.rate);
  src.start(at, Math.max(0, offset));
  const rate = src.playbackRate.value;
  const natural = src.loop ? Infinity : at + (buf.duration - offset) / rate;
  if (Number.isFinite(natural)) lfo?.stop(natural);
  src.addEventListener('ended', () => {
    amp.disconnect();
    lfo?.stop();
  });
  const part: Part = {
    end: natural,
    stop(t) {
      const when = Math.max(t, at + 0.002);
      if (when >= part.end) return part.end;
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, release / 5);
      // Loop while held, then play out to the end (sample mode 3)
      if (mode === 3) src.loop = false;
      const off = Math.min(part.end, when + release * 1.2 + 0.02);
      src.stop(off);
      lfo?.stop(off);
      part.end = off;
      return off;
    },
    kill(t) {
      const when = Math.max(t, at);
      if (when >= part.end) return;
      amp.gain.cancelAndHoldAtTime(when);
      amp.gain.setTargetAtTime(0, when, 0.004);
      src.stop(when + 0.03);
      lfo?.stop(when + 0.03);
      part.end = when + 0.03;
    },
  };
  return part;
}

/** Cuts the silent tail off a rendered sound (below -80 dB), keeping a short fade. */
function trimSilence(b: AudioBuffer): AudioBuffer {
  let last = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = d.length - 1; i > last; i--)
      if (Math.abs(d[i]) > 1e-4) {
        last = i;
        break;
      }
  }
  const len = Math.max(1, Math.min(b.length, last + Math.round(b.sampleRate * 0.01)));
  const out = new AudioBuffer({ length: len, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(0, len), c);
  return out;
}
