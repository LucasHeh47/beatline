// The project: the channel rack (instruments and drum sounds), patterns of notes, the playlist (the
// song: patterns and audio clips on tracks), the mixer, and the audio files used. Plain data, saved as
// JSON in .beatline files; recordings and samples stay in their own files.

/** Ticks per beat (a quarter note). Positions and lengths in patterns and the playlist are in ticks. */
export const PPQ = 96;
/** One step of the step sequencer: a 16th note. */
export const STEP = PPQ / 4;

// ---------- instruments ----------

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface Osc {
  wave: Wave;
  /** -3…3 octaves. */
  octave: number;
  /** Semitones, -12…12. */
  semi: number;
  /** Cents, -100…100. */
  detune: number;
  /** 0–1. */
  level: number;
  /** Unison voices (1–7), spread over `spread` cents. */
  voices: number;
  spread: number;
}

/** Attack, decay and release in seconds; sustain 0–1. */
export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface SynthParams {
  osc: [Osc, Osc];
  /** White noise level, 0–1. */
  noise: number;
  /** How much the second oscillator bends the first one's pitch (FM), 0–1. */
  fm: number;
  filter: { type: FilterType; cutoff: number; q: number; /** Octaves the filter envelope opens it. */ env: number; /** 0–1: higher notes open it. */ key: number };
  amp: Env;
  fenv: Env;
  lfo: { target: 'off' | 'pitch' | 'filter' | 'volume'; rate: number; depth: number };
  /** Seconds to slide between notes (mono only). */
  glide: number;
  mono: boolean;
  /** dB. */
  gain: number;
}

/** Built-in drum sounds have ids like "kick808"; imported samples are referenced by their id. */
export interface SampleRef {
  builtin?: string;
  sampleId?: string;
}

export interface SamplerParams {
  sample: SampleRef;
  /** The note at which the sample plays at its own pitch. */
  root: number;
  /** Semitones (fractions allowed). */
  tune: number;
  /** Follows the notes' pitch (off: every note plays the sample as it is, like a drum). */
  pitched: boolean;
  attack: number;
  release: number;
  /** dB. */
  gain: number;
  reverse: boolean;
  /** 0–1 of the way into the sample to start. */
  start: number;
  /** Channels in the same group (1–8) cut each other off (an open hi-hat stopped by a closed one). */
  choke: number;
}

/** A recorded instrument from the built-in library (a General MIDI SoundFont): piano, guitars, strings… */
export interface InstrumentParams {
  /** SoundFont bank (0 for instruments, 128 for drum kits) and program (General MIDI numbering, 0–127). */
  bank: number;
  program: number;
  /** dB. */
  gain: number;
  /** Semitones. */
  tune: number;
  /** How long notes ring on after they end: 1 is as recorded, 0.25 shorter, 4 longer. */
  release: number;
  /** Lowpass filter (Hz): lower is darker, 20000 leaves the sound as it is. */
  tone: number;
}

export type ChannelKind = 'sampler' | 'synth' | 'instrument';

export interface Channel {
  id: string;
  name: string;
  color: string;
  kind: ChannelKind;
  sampler?: SamplerParams;
  synth?: SynthParams;
  instrument?: InstrumentParams;
  /** The preset or sound it started from (shown in the instrument panel). */
  preset?: string;
  /** dB. */
  volume: number;
  /** -100…100. */
  pan: number;
  mute: boolean;
  /** The mixer track it plays through. */
  mixer: string;
}

// ---------- patterns ----------

export interface Note {
  /** MIDI note number (60 is middle C). */
  key: number;
  start: number;
  length: number;
  /** 0–1. */
  vel: number;
}

export interface Pattern {
  id: string;
  name: string;
  color: string;
  /** Ticks (a whole number of steps). */
  length: number;
  /** Notes of each channel, by channel id. */
  notes: Record<string, Note[]>;
}

// ---------- the playlist ----------

export interface Clip {
  id: string;
  kind: 'pattern' | 'audio';
  start: number;
  length: number;
  patternId?: string;
  sampleId?: string;
  /** Where it starts inside its pattern (ticks) or its audio file (seconds). */
  offset: number;
  /** dB. */
  gain: number;
  /** Seconds (audio clips). */
  fadeIn: number;
  fadeOut: number;
  muted?: boolean;
  /** Recordings: which pass of a loop recording this was. */
  take?: number;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
  /** The mixer track its audio clips play through. */
  mixer: string;
  clips: Clip[];
}

// ---------- the mixer ----------

export type ParamValue = number | string | boolean;

export interface Effect {
  id: string;
  type: string;
  on: boolean;
  params: Record<string, ParamValue>;
}

export interface MixerTrack {
  id: string;
  name: string;
  color: string;
  /** dB. */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  effects: Effect[];
}

// ---------- audio files ----------

export interface Sample {
  id: string;
  name: string;
  /** Where the file is (absolute). */
  path: string;
  /** Seconds. */
  duration: number;
  channels: number;
  sampleRate: number;
  /** Made by recording in Beatline. */
  recorded?: boolean;
  size?: number;
  modified?: number;
}

export interface Marker {
  id: string;
  /** Ticks. */
  at: number;
  name: string;
}

export interface Project {
  app: 'beatline';
  version: 1;
  name: string;
  bpm: number;
  /** Beats in a bar (the time signature's top number) and what gets the beat (its bottom number). */
  beatsPerBar: number;
  beatUnit: number;
  /** 0–1: how far every second 16th is pushed late. */
  swing: number;
  /** The song's key, for the piano roll's scale guides and chord tools. */
  key: { root: number; scale: string };
  samples: Sample[];
  channels: Channel[];
  patterns: Pattern[];
  activePattern: string;
  tracks: Track[];
  /** The master first. */
  mixer: MixerTrack[];
  /** The loop region of the song (ticks), or none. */
  loop: [number, number] | null;
  markers: Marker[];
}

// ---------- ids and colors ----------

let seq = 0;
export function uid(prefix = ''): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}${seq.toString(36)}`;
}

export const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#3fcf8e', '#22b8cf', '#4ea1ff', '#845ef7', '#cc5de8', '#f06595'];

export const nextColor = (n: number) => COLORS[n % COLORS.length];

// ---------- time ----------

/** Ticks in a bar. */
export const barTicks = (p: Pick<Project, 'beatsPerBar' | 'beatUnit'>) => Math.round((p.beatsPerBar * PPQ * 4) / p.beatUnit);

export const ticksToSeconds = (ticks: number, bpm: number) => (ticks / PPQ) * (60 / bpm);
export const secondsToTicks = (secs: number, bpm: number) => (secs * bpm * PPQ) / 60;

/** "3.2.1" style position: bar, beat and 16th (all from 1). */
export function barBeat(ticks: number, p: Pick<Project, 'beatsPerBar' | 'beatUnit'>): string {
  const beat = (PPQ * 4) / p.beatUnit;
  const bar = Math.floor(ticks / barTicks(p));
  const inBar = ticks - bar * barTicks(p);
  const b = Math.floor(inBar / beat);
  const s = Math.floor((inBar - b * beat) / STEP);
  return `${bar + 1}.${b + 1}.${s + 1}`;
}

/** m:ss.t */
export function clock(secs: number): string {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

// ---------- making things ----------

export const DEFAULT_SYNTH: SynthParams = {
  osc: [
    { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.8, voices: 1, spread: 15 },
    { wave: 'square', octave: 0, semi: 0, detune: 7, level: 0.4, voices: 1, spread: 15 },
  ],
  noise: 0,
  fm: 0,
  filter: { type: 'lowpass', cutoff: 2400, q: 1, env: 2, key: 0.3 },
  amp: { a: 0.005, d: 0.3, s: 0.7, r: 0.25 },
  fenv: { a: 0.005, d: 0.4, s: 0.3, r: 0.3 },
  lfo: { target: 'off', rate: 5, depth: 0.2 },
  glide: 0,
  mono: false,
  gain: -6,
};

export const DEFAULT_INSTRUMENT: InstrumentParams = { bank: 0, program: 0, gain: 0, tune: 0, release: 1, tone: 20000 };

export const DEFAULT_SAMPLER: SamplerParams = { sample: { builtin: 'kick808' }, root: 60, tune: 0, pitched: false, attack: 0, release: 0.05, gain: 0, reverse: false, start: 0, choke: 0 };

export function newMixerTrack(name: string, color = '#7d8597', id = uid('x')): MixerTrack {
  return { id, name, color, volume: 0, pan: 0, mute: false, solo: false, effects: [] };
}

export function newPattern(name: string, color: string, length = 16 * STEP): Pattern {
  return { id: uid('p'), name, color, length, notes: {} };
}

export function newTrack(name: string, color: string, mixer = 'master'): Track {
  return { id: uid('t'), name, color, mute: false, solo: false, mixer, clips: [] };
}

export function newProject(name = 'Untitled'): Project {
  const pattern = newPattern('Pattern 1', COLORS[6]);
  return {
    app: 'beatline',
    version: 1,
    name,
    bpm: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    swing: 0,
    key: { root: 0, scale: 'major' },
    samples: [],
    channels: [],
    patterns: [pattern],
    activePattern: pattern.id,
    tracks: Array.from({ length: 8 }, (_, i) => newTrack(`Track ${i + 1}`, '#5c6370')),
    mixer: [newMixerTrack('Master', '#e4e7ec', 'master')],
    loop: null,
    markers: [],
  };
}

/** A new channel's volume: some room to spare, so a few sounds together don't clip. */
export const CHANNEL_VOLUME = -6;

/**
 * Adds a channel with its own mixer track (named after it), so each sound can get its own effects.
 * Returns the channel.
 */
export function addChannel(p: Project, ch: Omit<Channel, 'id' | 'mixer' | 'color' | 'volume' | 'pan' | 'mute'> & Partial<Pick<Channel, 'color' | 'volume' | 'pan'>>): Channel {
  const color = ch.color ?? nextColor(p.channels.length);
  const mx = newMixerTrack(ch.name, color);
  p.mixer.push(mx);
  const c: Channel = { volume: CHANNEL_VOLUME, pan: 0, ...ch, color, id: uid('c'), mute: false, mixer: mx.id };
  p.channels.push(c);
  return c;
}

/** An audio track (for recording or audio files) with its own mixer track, at the end or at `index`. */
export function addAudioTrack(p: Project, name: string, index = p.tracks.length): Track {
  const color = nextColor(p.tracks.length + 3);
  const mx = newMixerTrack(name, color);
  p.mixer.push(mx);
  const t = newTrack(name, color, mx.id);
  p.tracks.splice(Math.max(0, Math.min(p.tracks.length, index)), 0, t);
  return t;
}

// ---------- reading ----------

export const clipEnd = (c: Clip) => c.start + c.length;

export const activePattern = (p: Project): Pattern => p.patterns.find((x) => x.id === p.activePattern) ?? p.patterns[0];

export const channelById = (p: Project, id: string) => p.channels.find((c) => c.id === id);
export const patternById = (p: Project, id: string | undefined) => (id ? p.patterns.find((x) => x.id === id) : undefined);
export const sampleById = (p: Project, id: string | undefined) => (id ? p.samples.find((x) => x.id === id) : undefined);
export const mixerById = (p: Project, id: string) => p.mixer.find((m) => m.id === id) ?? p.mixer[0];

/** The end of the song: the last clip's end (ticks). */
export function songEnd(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

/** The ticks a pattern's notes reach (at least its length). */
export function patternEnd(pt: Pattern): number {
  let end = pt.length;
  for (const list of Object.values(pt.notes)) for (const n of list) end = Math.max(end, n.start + n.length);
  return end;
}

/** Audio clips' length in ticks for a time in seconds (at the project's tempo). */
export const audioTicks = (p: Pick<Project, 'bpm'>, secs: number) => Math.max(1, Math.round(secondsToTicks(secs, p.bpm)));

/** Where a clip is found, with its track. */
export function findClip(p: Project, id: string): { clip: Clip; track: Track } | null {
  for (const t of p.tracks) {
    const clip = t.clips.find((c) => c.id === id);
    if (clip) return { clip, track: t };
  }
  return null;
}

// ---------- saving ----------

export interface SavedProject extends Project {
  /** Audio file paths relative to the project file, to find them when the folder moved. */
  relative?: Record<string, string>;
}

/** Defaults for anything an older file didn't have. */
const withDefaults = <T>(defaults: Partial<T>, x: T): T => ({ ...defaults, ...x });

/** Reads a saved project, filling in anything older files didn't have. */
export function readProject(json: string): Project {
  const p = JSON.parse(json) as Partial<SavedProject>;
  if (!p || p.app !== 'beatline' || !Array.isArray(p.patterns)) throw new Error("This isn't a Beatline project.");
  if ((p.version ?? 1) > 1) throw new Error('This project was saved by a newer Beatline. Update Beatline to open it.');
  const base = newProject(p.name ?? 'Untitled');
  const mixer = Array.isArray(p.mixer) && p.mixer.length ? p.mixer.map((m) => ({ ...newMixerTrack(m.name ?? 'Insert'), ...m, effects: m.effects ?? [] })) : base.mixer;
  if (!mixer.some((m) => m.id === 'master')) mixer.unshift(newMixerTrack('Master', '#e4e7ec', 'master'));
  const patterns = p.patterns.length ? p.patterns.map((x) => ({ ...x, notes: x.notes ?? {}, length: x.length || 16 * STEP })) : base.patterns;
  const out: Project = {
    ...base,
    ...p,
    app: 'beatline',
    version: 1,
    samples: p.samples ?? [],
    channels: (p.channels ?? []).map((c) => withDefaults<Channel>({ volume: 0, pan: 0, mute: false, mixer: 'master' }, c)),
    patterns,
    tracks: (p.tracks ?? base.tracks).map((t) => ({ ...newTrack(t.name ?? 'Track', t.color ?? '#5c6370'), ...t, clips: (t.clips ?? []).map((c) => withDefaults<Clip>({ gain: 0, fadeIn: 0, fadeOut: 0, offset: 0 }, c)) })),
    mixer,
    markers: p.markers ?? [],
    loop: p.loop ?? null,
    key: p.key ?? base.key,
  };
  delete (out as Partial<SavedProject>).relative;
  if (!out.patterns.some((x) => x.id === out.activePattern)) out.activePattern = out.patterns[0].id;
  return out;
}

export function writeProject(p: Project, relative?: Record<string, string>): string {
  const out: SavedProject = { ...p };
  if (relative && Object.keys(relative).length) out.relative = relative;
  return JSON.stringify(out);
}
