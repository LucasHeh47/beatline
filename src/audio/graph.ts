// The sound's path, built from the project: each channel (instrument) and playlist track feeds a
// mixer track; each mixer track runs its effects, pan and fader into the master, which goes to the
// speakers (or the export). The same graph plays live and renders exports.
import type { AudioEvent } from '../core/sequence';
import type { Channel, Effect, MixerTrack, Project } from '../core/project';
import { buildEffect, type FxNode } from './effects';
import type { SampleLibrary } from './library';
import { samplerVoice, synthVoice, type Voice } from './voices';

const db = (v: number) => (v <= -80 ? 0 : Math.pow(10, v / 20));

interface Strip {
  input: GainNode;
  fx: { id: string; type: string; node: FxNode }[];
  fxEnd: AudioNode;
  pan: StereoPannerNode;
  fader: GainNode;
  /** Mute and solo. */
  gate: GainNode;
  meters: [AnalyserNode, AnalyserNode] | null;
  /** The effects as they were last built (ids, types and on/off). */
  fxKey: string;
}

interface ChannelStrip {
  input: GainNode;
  pan: StereoPannerNode;
  mixer: string;
}

interface TrackBus {
  gain: GainNode;
  mixer: string;
}

export interface GraphOptions {
  meters: boolean;
}

export class Graph {
  readonly strips = new Map<string, Strip>();
  private channels = new Map<string, ChannelStrip>();
  private tracks = new Map<string, TrackBus>();
  /** Notes sounding now, per channel (for choke groups, mono synths and stopping). */
  readonly voices = new Map<string, Voice[]>();
  private sources = new Set<AudioBufferSourceNode>();
  /** The last note of each mono synth: its key and when it ends. */
  private mono = new Map<string, { key: number; end: number; voice: Voice }>();
  private bpm = 120;

  constructor(
    readonly ctx: BaseAudioContext,
    private library: SampleLibrary,
    private out: AudioNode,
    private o: GraphOptions,
  ) {}

  // ---------- building ----------

  /** A mixer track's nodes; the master goes to the output, the others into the master. */
  private makeStrip(id: string): Strip {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const fader = ctx.createGain();
    const gate = ctx.createGain();
    input.connect(pan);
    pan.connect(fader);
    fader.connect(gate);
    gate.connect(id === 'master' ? this.out : this.strips.get('master')!.input);
    let meters: Strip['meters'] = null;
    if (this.o.meters) {
      const split = ctx.createChannelSplitter(2);
      meters = [ctx.createAnalyser(), ctx.createAnalyser()];
      for (const m of meters) m.fftSize = 512;
      gate.connect(split);
      split.connect(meters[0], 0);
      split.connect(meters[1], 1);
    }
    const s: Strip = { input, fx: [], fxEnd: input, pan, fader, gate, meters, fxKey: '' };
    this.strips.set(id, s);
    return s;
  }

  private fxKey(effects: Effect[]): string {
    return effects.map((e) => `${e.id}:${e.type}:${e.on ? 1 : 0}`).join('|');
  }

  /** Rebuilds a strip's effects when they were added, removed, reordered or switched; otherwise updates their settings. */
  private syncEffects(s: Strip, m: MixerTrack): void {
    const key = this.fxKey(m.effects);
    if (key === s.fxKey) {
      for (const f of s.fx) {
        const e = m.effects.find((x) => x.id === f.id);
        if (e) f.node.update(e, this.bpm);
      }
      return;
    }
    s.fxKey = key;
    s.input.disconnect();
    for (const f of s.fx) f.node.dispose();
    s.fx = m.effects.filter((e) => e.on).map((e) => ({ id: e.id, type: e.type, node: buildEffect(this.ctx, e, this.bpm) }));
    let at: AudioNode = s.input;
    for (const f of s.fx) {
      at.connect(f.node.input);
      at = f.node.output;
    }
    at.connect(s.pan);
    s.fxEnd = at;
  }

  /** Brings the graph in line with the project (call after any change). */
  sync(p: Project): void {
    const ctx = this.ctx;
    // Tempo-synced effects (delays) pick up a new tempo through their settings update
    this.bpm = p.bpm;
    // Mixer tracks
    const ids = new Set(p.mixer.map((m) => m.id));
    for (const [id, s] of this.strips) {
      if (ids.has(id)) continue;
      s.input.disconnect();
      s.gate.disconnect();
      for (const f of s.fx) f.node.dispose();
      this.strips.delete(id);
    }
    const solo = p.mixer.some((m) => m.solo && m.id !== 'master');
    // The master first: the others feed it
    if (!this.strips.has('master')) this.makeStrip('master');
    for (const m of p.mixer) {
      const s = this.strips.get(m.id) ?? this.makeStrip(m.id);
      this.syncEffects(s, m);
      const now = ctx.currentTime;
      const smooth = (param: AudioParam, v: number) => (ctx instanceof OfflineAudioContext ? (param.value = v) : param.setTargetAtTime(v, now, 0.015));
      smooth(s.fader.gain, db(m.volume));
      smooth(s.pan.pan, Math.max(-1, Math.min(1, m.pan / 100)));
      const audible = m.id === 'master' ? !m.mute : !m.mute && (!solo || m.solo);
      smooth(s.gate.gain, audible ? 1 : 0);
    }
    // Channels
    const chIds = new Set(p.channels.map((c) => c.id));
    for (const [id, c] of this.channels) {
      if (chIds.has(id)) continue;
      c.pan.disconnect();
      this.channels.delete(id);
    }
    for (const c of p.channels) this.syncChannel(c);
    // Playlist tracks (their audio clips)
    const tIds = new Set(p.tracks.map((t) => t.id));
    for (const [id, t] of this.tracks) {
      if (tIds.has(id)) continue;
      t.gain.disconnect();
      this.tracks.delete(id);
    }
    for (const t of p.tracks) {
      let bus = this.tracks.get(t.id);
      if (!bus) {
        bus = { gain: ctx.createGain(), mixer: '' };
        this.tracks.set(t.id, bus);
      }
      if (bus.mixer !== t.mixer || !this.strips.has(bus.mixer)) {
        bus.gain.disconnect();
        bus.gain.connect((this.strips.get(t.mixer) ?? this.strips.get('master'))!.input);
        bus.mixer = t.mixer;
      }
    }
  }

  private syncChannel(c: Channel): void {
    const ctx = this.ctx;
    let s = this.channels.get(c.id);
    if (!s) {
      const input = ctx.createGain();
      const pan = ctx.createStereoPanner();
      input.connect(pan);
      s = { input, pan, mixer: '' };
      this.channels.set(c.id, s);
    }
    const strip = this.strips.get(c.mixer) ?? this.strips.get('master')!;
    if (s.mixer !== c.mixer || !this.strips.has(s.mixer)) {
      s.pan.disconnect();
      s.pan.connect(strip.input);
      s.mixer = c.mixer;
    }
    s.input.gain.value = db(c.volume);
    s.pan.pan.value = Math.max(-1, Math.min(1, c.pan / 100));
  }

  /** The input of a mixer track (recording monitors play into it). */
  mixerInput(id: string): AudioNode {
    return (this.strips.get(id) ?? this.strips.get('master'))!.input;
  }

  // ---------- playing ----------

  /** Plays a note of a channel at a time (seconds) for a length (seconds; Infinity until noteOff). */
  playNote(p: Project, c: Channel, key: number, vel: number, at: number, length: number): Voice | null {
    const strip = this.channels.get(c.id);
    if (!strip) return null;
    let v: Voice | null = null;
    const list = this.voices.get(c.id) ?? [];
    if (c.kind === 'sampler' && c.sampler) {
      const buf = this.library.buffer(c.sampler.sample, p);
      if (!buf) return null;
      // Choke group: earlier notes of the same group stop (open hat cut by the closed one)
      if (c.sampler.choke) {
        for (const other of p.channels) {
          if (other.kind !== 'sampler' || other.sampler?.choke !== c.sampler.choke) continue;
          for (const ov of this.voices.get(other.id) ?? []) if (ov.end > at) ov.kill(at);
        }
      } else if (!c.sampler.pitched) {
        // A drum hit cuts its own previous hit short only if it would ring for long
        for (const ov of list) if (ov.end > at + 1.5) ov.kill(at);
      }
      v = samplerVoice(this.ctx, c.sampler, buf, key, vel, at, strip.input);
    } else if (c.kind === 'synth' && c.synth) {
      let from: number | undefined;
      if (c.synth.mono) {
        const last = this.mono.get(c.id);
        if (last && last.end > at - 0.001) {
          from = last.key;
          last.voice.kill(at);
        }
      }
      v = synthVoice(this.ctx, c.synth, key, vel, at, strip.input, from);
    }
    if (!v) return null;
    if (Number.isFinite(length)) v.stop(at + length);
    if (c.kind === 'synth' && c.synth?.mono) this.mono.set(c.id, { key, end: Number.isFinite(length) ? at + length : Infinity, voice: v });
    // Forget voices that have finished
    const now = this.ctx.currentTime;
    this.voices.set(c.id, [...list.filter((x) => x.end > now), v]);
    return v;
  }

  /** Plays part of an audio clip at a time: `secs` long, `remain` seconds before the clip itself ends. */
  playAudio(p: Project, ev: AudioEvent, at: number, secs: number, remain = secs): AudioBufferSourceNode | null {
    const c = ev.clip;
    if (!c.sampleId) return null;
    const buf = this.library.buffer({ sampleId: c.sampleId }, p);
    const bus = this.tracks.get(ev.track.id);
    if (!buf || !bus || ev.offset >= buf.duration) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const level = db(c.gain);
    const dur = Math.min(secs, buf.duration - ev.offset);
    // Fades are measured from the clip's own start and end, which may be outside this part
    const into = ev.offset - c.offset;
    const fadeIn = Math.max(0, c.fadeIn - into);
    const gainAt = (t: number) => {
      // t: seconds from `at`
      let v = level;
      if (c.fadeIn > 0 && into + t < c.fadeIn) v *= (into + t) / c.fadeIn;
      if (c.fadeOut > 0 && remain - t < c.fadeOut) v *= Math.max(0, remain - t) / c.fadeOut;
      return v;
    };
    g.gain.setValueAtTime(gainAt(0), at);
    if (fadeIn > 0) g.gain.linearRampToValueAtTime(gainAt(Math.min(fadeIn, dur)), at + Math.min(fadeIn, dur));
    const outFrom = Math.max(0, remain - c.fadeOut);
    if (c.fadeOut > 0 && outFrom < dur) {
      g.gain.setValueAtTime(gainAt(Math.max(outFrom, Math.min(fadeIn, dur))), at + Math.max(outFrom, Math.min(fadeIn, dur)));
      g.gain.linearRampToValueAtTime(gainAt(dur), at + dur);
    }
    // A tiny fade where this part ends, so cuts don't click
    g.gain.setValueAtTime(gainAt(Math.max(0, dur - 0.004)), at + Math.max(0, dur - 0.004));
    g.gain.linearRampToValueAtTime(0, at + dur);
    src.connect(g);
    g.connect(bus.gain);
    src.start(at, ev.offset, dur);
    this.sources.add(src);
    src.addEventListener('ended', () => {
      this.sources.delete(src);
      g.disconnect();
    });
    return src;
  }

  /** Stops everything sounding (playback stopped). */
  stopAll(at = this.ctx.currentTime): void {
    for (const list of this.voices.values()) for (const v of list) if (v.end > at) v.kill(at);
    this.voices.clear();
    this.mono.clear();
    for (const s of this.sources) {
      try {
        s.stop(at + 0.01);
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
  }

  /** Releases a channel's held notes (a key let go on a MIDI keyboard). */
  release(channel: string, key: number, at = this.ctx.currentTime): void {
    for (const v of this.voices.get(channel) ?? []) if (v.key === key && v.end === Infinity) v.stop(at);
  }

  // ---------- meters ----------

  private buf = new Float32Array(512);

  private peak(a: AnalyserNode): number {
    a.getFloatTimeDomainData(this.buf);
    let p = 0;
    for (const v of this.buf) {
      const x = v < 0 ? -v : v;
      if (x > p) p = x;
    }
    return p;
  }

  /** Peak levels of every mixer track, left and right. */
  levels(): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const [id, s] of this.strips) if (s.meters) out.set(id, [this.peak(s.meters[0]), this.peak(s.meters[1])]);
    return out;
  }
}
