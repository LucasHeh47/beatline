// The built-in sounds: drum and percussion sounds (made by Beatline itself when it starts, so there are
// no sample files to ship) and synth presets for basses, leads, pads and keys.
import { DEFAULT_SAMPLER, DEFAULT_SYNTH, type SamplerParams, type SynthParams } from './project';

export interface DrumSound {
  id: string;
  name: string;
  group: 'Kicks' | 'Snares & claps' | 'Hi-hats & cymbals' | 'Percussion' | 'Bass';
  /** Pitched sounds (808s) follow the piano roll; drums play as they are. */
  pitched?: boolean;
  /** Choke group: open hats are cut off by closed ones. */
  choke?: number;
}

export const DRUM_SOUNDS: DrumSound[] = [
  { id: 'kick808', name: 'Kick 808', group: 'Kicks' },
  { id: 'kickPunch', name: 'Kick Punchy', group: 'Kicks' },
  { id: 'kickLofi', name: 'Kick Lo-fi', group: 'Kicks' },
  { id: 'kickHouse', name: 'Kick House', group: 'Kicks' },
  { id: 'snare', name: 'Snare', group: 'Snares & claps' },
  { id: 'snareTight', name: 'Snare Tight', group: 'Snares & claps' },
  { id: 'snareLofi', name: 'Snare Lo-fi', group: 'Snares & claps' },
  { id: 'clap', name: 'Clap', group: 'Snares & claps' },
  { id: 'snap', name: 'Finger Snap', group: 'Snares & claps' },
  { id: 'rim', name: 'Rimshot', group: 'Snares & claps' },
  { id: 'hatClosed', name: 'Hi-hat Closed', group: 'Hi-hats & cymbals', choke: 1 },
  { id: 'hatOpen', name: 'Hi-hat Open', group: 'Hi-hats & cymbals', choke: 1 },
  { id: 'hatPedal', name: 'Hi-hat Pedal', group: 'Hi-hats & cymbals', choke: 1 },
  { id: 'crash', name: 'Crash', group: 'Hi-hats & cymbals' },
  { id: 'ride', name: 'Ride', group: 'Hi-hats & cymbals' },
  { id: 'tomLow', name: 'Tom Low', group: 'Percussion' },
  { id: 'tomMid', name: 'Tom Mid', group: 'Percussion' },
  { id: 'tomHigh', name: 'Tom High', group: 'Percussion' },
  { id: 'shaker', name: 'Shaker', group: 'Percussion' },
  { id: 'tambourine', name: 'Tambourine', group: 'Percussion' },
  { id: 'cowbell', name: 'Cowbell', group: 'Percussion' },
  { id: 'conga', name: 'Conga', group: 'Percussion' },
  { id: 'woodblock', name: 'Woodblock', group: 'Percussion' },
  { id: 'bass808', name: '808 Bass', group: 'Bass', pitched: true },
];

export const drumById = (id: string | undefined) => DRUM_SOUNDS.find((d) => d.id === id);

/** Sampler settings for a built-in drum sound. */
export function drumSampler(id: string): SamplerParams {
  const d = drumById(id);
  return { ...DEFAULT_SAMPLER, sample: { builtin: id }, pitched: !!d?.pitched, root: d?.pitched ? 36 : 60, choke: d?.choke ?? 0, release: d?.pitched ? 0.12 : 0.05 };
}

export interface SynthPreset {
  id: string;
  name: string;
  category: 'Bass' | 'Lead' | 'Pad' | 'Keys' | 'Pluck' | 'Other';
  params: SynthParams;
}

const synth = (p: Partial<SynthParams> & { osc?: SynthParams['osc'] }): SynthParams => structuredClone({ ...DEFAULT_SYNTH, ...p });
const osc = (wave: SynthParams['osc'][0]['wave'], level: number, more: Partial<SynthParams['osc'][0]> = {}) => ({ wave, octave: 0, semi: 0, detune: 0, level, voices: 1, spread: 15, ...more });

export const SYNTH_PRESETS: SynthPreset[] = [
  {
    id: 'subBass',
    name: 'Sub Bass',
    category: 'Bass',
    params: synth({ osc: [osc('sine', 1, { octave: -1 }), osc('triangle', 0.2, { octave: -1 })], filter: { type: 'lowpass', cutoff: 600, q: 0.7, env: 0, key: 0 }, amp: { a: 0.005, d: 0.2, s: 1, r: 0.12 }, mono: true, glide: 0.04, gain: -4 }),
  },
  {
    id: 'reese',
    name: 'Reese Bass',
    category: 'Bass',
    params: synth({ osc: [osc('sawtooth', 0.7, { octave: -1, voices: 3, spread: 22 }), osc('sawtooth', 0.6, { octave: -1, detune: -12 })], filter: { type: 'lowpass', cutoff: 700, q: 2, env: 1.5, key: 0.2 }, amp: { a: 0.01, d: 0.3, s: 0.9, r: 0.2 }, fenv: { a: 0.01, d: 0.5, s: 0.4, r: 0.3 }, lfo: { target: 'filter', rate: 0.6, depth: 0.25 }, mono: true, gain: -8 }),
  },
  {
    id: 'pluckBass',
    name: 'Pluck Bass',
    category: 'Bass',
    params: synth({ osc: [osc('square', 0.7, { octave: -1 }), osc('sawtooth', 0.4, { octave: -1, detune: 6 })], filter: { type: 'lowpass', cutoff: 300, q: 4, env: 3.5, key: 0.3 }, amp: { a: 0.002, d: 0.35, s: 0.2, r: 0.1 }, fenv: { a: 0.001, d: 0.18, s: 0, r: 0.1 }, gain: -7 }),
  },
  {
    id: 'lead',
    name: 'Saw Lead',
    category: 'Lead',
    params: synth({ osc: [osc('sawtooth', 0.7, { voices: 3, spread: 18 }), osc('square', 0.35, { octave: 1, detune: 4 })], filter: { type: 'lowpass', cutoff: 3500, q: 1.5, env: 1, key: 0.5 }, amp: { a: 0.01, d: 0.2, s: 0.8, r: 0.2 }, lfo: { target: 'pitch', rate: 5.5, depth: 0.08 }, glide: 0.03, mono: true, gain: -9 }),
  },
  {
    id: 'supersaw',
    name: 'Supersaw',
    category: 'Lead',
    params: synth({ osc: [osc('sawtooth', 0.6, { voices: 7, spread: 35 }), osc('sawtooth', 0.35, { octave: -1, voices: 3, spread: 20 })], filter: { type: 'lowpass', cutoff: 6000, q: 0.8, env: 0.5, key: 0.3 }, amp: { a: 0.01, d: 0.3, s: 0.85, r: 0.35 }, gain: -12 }),
  },
  {
    id: 'squareLead',
    name: 'Chip Lead',
    category: 'Lead',
    params: synth({ osc: [osc('square', 0.6), osc('square', 0.2, { octave: 1 })], filter: { type: 'lowpass', cutoff: 9000, q: 0.5, env: 0, key: 0 }, amp: { a: 0.001, d: 0.1, s: 0.8, r: 0.05 }, gain: -12 }),
  },
  {
    id: 'pad',
    name: 'Warm Pad',
    category: 'Pad',
    params: synth({ osc: [osc('sawtooth', 0.5, { voices: 5, spread: 25 }), osc('triangle', 0.5, { octave: 1, detune: 5 })], filter: { type: 'lowpass', cutoff: 1400, q: 0.7, env: 1, key: 0.3 }, amp: { a: 0.8, d: 1, s: 0.8, r: 1.5 }, fenv: { a: 1.2, d: 1.5, s: 0.6, r: 1.5 }, lfo: { target: 'filter', rate: 0.25, depth: 0.2 }, gain: -12 }),
  },
  {
    id: 'strings',
    name: 'Strings',
    category: 'Pad',
    params: synth({ osc: [osc('sawtooth', 0.55, { voices: 5, spread: 14 }), osc('sawtooth', 0.4, { octave: -1, voices: 3, spread: 10 })], filter: { type: 'lowpass', cutoff: 2600, q: 0.6, env: 0.4, key: 0.6 }, amp: { a: 0.35, d: 0.6, s: 0.85, r: 0.9 }, lfo: { target: 'pitch', rate: 5, depth: 0.04 }, gain: -12 }),
  },
  {
    id: 'ePiano',
    name: 'Electric Piano',
    category: 'Keys',
    params: synth({ osc: [osc('sine', 0.9), osc('sine', 0.5, { octave: 2, semi: 0 })], fm: 0.35, filter: { type: 'lowpass', cutoff: 5000, q: 0.5, env: 0.5, key: 0.4 }, amp: { a: 0.003, d: 1.6, s: 0.25, r: 0.5 }, fenv: { a: 0.002, d: 0.5, s: 0.2, r: 0.4 }, lfo: { target: 'volume', rate: 4.5, depth: 0.12 }, gain: -6 }),
  },
  {
    id: 'organ',
    name: 'Organ',
    category: 'Keys',
    params: synth({ osc: [osc('sine', 0.7), osc('sine', 0.5, { octave: 1 })], noise: 0, filter: { type: 'lowpass', cutoff: 8000, q: 0.5, env: 0, key: 0 }, amp: { a: 0.01, d: 0.1, s: 1, r: 0.08 }, lfo: { target: 'volume', rate: 6.5, depth: 0.15 }, gain: -8 }),
  },
  {
    id: 'bell',
    name: 'Bell',
    category: 'Keys',
    params: synth({ osc: [osc('sine', 0.8, { octave: 1 }), osc('sine', 0.6, { octave: 2, semi: 7 })], fm: 0.6, filter: { type: 'lowpass', cutoff: 9000, q: 0.5, env: 0, key: 0 }, amp: { a: 0.001, d: 2.2, s: 0, r: 1.2 }, gain: -10 }),
  },
  {
    id: 'pluck',
    name: 'Pluck',
    category: 'Pluck',
    params: synth({ osc: [osc('sawtooth', 0.6, { voices: 3, spread: 12 }), osc('square', 0.3, { octave: 1 })], filter: { type: 'lowpass', cutoff: 500, q: 2, env: 4, key: 0.5 }, amp: { a: 0.001, d: 0.45, s: 0, r: 0.25 }, fenv: { a: 0.001, d: 0.22, s: 0, r: 0.2 }, gain: -8 }),
  },
  {
    id: 'brass',
    name: 'Brass',
    category: 'Other',
    params: synth({ osc: [osc('sawtooth', 0.7, { voices: 3, spread: 8 }), osc('sawtooth', 0.5, { octave: -1 })], filter: { type: 'lowpass', cutoff: 900, q: 1, env: 2.2, key: 0.4 }, amp: { a: 0.06, d: 0.3, s: 0.8, r: 0.2 }, fenv: { a: 0.08, d: 0.4, s: 0.5, r: 0.2 }, gain: -10 }),
  },
  {
    id: 'basic',
    name: 'Basic Synth',
    category: 'Other',
    params: synth({}),
  },
];

export const synthPreset = (id: string) => SYNTH_PRESETS.find((p) => p.id === id);
