// The built-in sounds: electronic drums (made by Beatline itself when it starts), recorded drum kits and
// instruments (from the General MIDI SoundFont that comes with Beatline), and synth presets for
// basses, leads, pads and keys.
import { DEFAULT_INSTRUMENT, DEFAULT_SAMPLER, DEFAULT_SYNTH, type InstrumentParams, type SamplerParams, type SynthParams } from './project';

export type DrumGroup = 'Kicks' | 'Snares & claps' | 'Hi-hats & cymbals' | 'Percussion' | 'Bass' | 'Acoustic kit' | 'Rock kit' | 'Jazz & brushes' | 'Real percussion';

export interface DrumSound {
  id: string;
  name: string;
  group: DrumGroup;
  /** Pitched sounds (808s) follow the piano roll; drums play as they are. */
  pitched?: boolean;
  /** Choke group: open hats are cut off by closed ones. */
  choke?: number;
  /** Recorded drums: the SoundFont drum kit (program in bank 128) and the key it's on. */
  kit?: number;
  key?: number;
}

/** Recorded drums and percussion from the SoundFont's kits (General MIDI drum keys). */
export const GM_DRUMS: DrumSound[] = [
  { id: 'acKick', name: 'Kick', group: 'Acoustic kit', kit: 0, key: 36 },
  { id: 'acKick2', name: 'Kick Deep', group: 'Acoustic kit', kit: 0, key: 35 },
  { id: 'acSnare', name: 'Snare', group: 'Acoustic kit', kit: 0, key: 38 },
  { id: 'acSnare2', name: 'Snare Bright', group: 'Acoustic kit', kit: 0, key: 40 },
  { id: 'acStick', name: 'Side Stick', group: 'Acoustic kit', kit: 0, key: 37 },
  { id: 'acClap', name: 'Hand Clap', group: 'Acoustic kit', kit: 0, key: 39 },
  { id: 'acHatClosed', name: 'Hi-hat Closed', group: 'Acoustic kit', kit: 0, key: 42, choke: 2 },
  { id: 'acHatPedal', name: 'Hi-hat Pedal', group: 'Acoustic kit', kit: 0, key: 44, choke: 2 },
  { id: 'acHatOpen', name: 'Hi-hat Open', group: 'Acoustic kit', kit: 0, key: 46, choke: 2 },
  { id: 'acTomFloor', name: 'Floor Tom', group: 'Acoustic kit', kit: 0, key: 41 },
  { id: 'acTomLow', name: 'Tom Low', group: 'Acoustic kit', kit: 0, key: 45 },
  { id: 'acTomMid', name: 'Tom Mid', group: 'Acoustic kit', kit: 0, key: 47 },
  { id: 'acTomHigh', name: 'Tom High', group: 'Acoustic kit', kit: 0, key: 50 },
  { id: 'acCrash', name: 'Crash', group: 'Acoustic kit', kit: 0, key: 49 },
  { id: 'acCrash2', name: 'Crash 2', group: 'Acoustic kit', kit: 0, key: 57 },
  { id: 'acSplash', name: 'Splash', group: 'Acoustic kit', kit: 0, key: 55 },
  { id: 'acChina', name: 'China', group: 'Acoustic kit', kit: 0, key: 52 },
  { id: 'acRide', name: 'Ride', group: 'Acoustic kit', kit: 0, key: 51 },
  { id: 'acRideBell', name: 'Ride Bell', group: 'Acoustic kit', kit: 0, key: 53 },
  { id: 'rkKick', name: 'Rock Kick', group: 'Rock kit', kit: 16, key: 36 },
  { id: 'rkSnare', name: 'Rock Snare', group: 'Rock kit', kit: 16, key: 38 },
  { id: 'rkTomLow', name: 'Rock Tom Low', group: 'Rock kit', kit: 16, key: 45 },
  { id: 'rkTomHigh', name: 'Rock Tom High', group: 'Rock kit', kit: 16, key: 50 },
  { id: 'rmKick', name: 'Room Kick', group: 'Rock kit', kit: 8, key: 36 },
  { id: 'rmSnare', name: 'Room Snare', group: 'Rock kit', kit: 8, key: 38 },
  { id: 'jzKick', name: 'Jazz Kick', group: 'Jazz & brushes', kit: 32, key: 36 },
  { id: 'jzSnare', name: 'Jazz Snare', group: 'Jazz & brushes', kit: 32, key: 38 },
  { id: 'brSnare', name: 'Brush Snare', group: 'Jazz & brushes', kit: 40, key: 38 },
  { id: 'brSwirl', name: 'Brush Swirl', group: 'Jazz & brushes', kit: 40, key: 40 },
  { id: 'brSlap', name: 'Brush Slap', group: 'Jazz & brushes', kit: 40, key: 39 },
  { id: 'pcTambourine', name: 'Tambourine', group: 'Real percussion', kit: 0, key: 54 },
  { id: 'pcCowbell', name: 'Cowbell', group: 'Real percussion', kit: 0, key: 56 },
  { id: 'pcShaker', name: 'Shaker', group: 'Real percussion', kit: 0, key: 70 },
  { id: 'pcCabasa', name: 'Cabasa', group: 'Real percussion', kit: 0, key: 69 },
  { id: 'pcCongaHigh', name: 'Conga High', group: 'Real percussion', kit: 0, key: 63 },
  { id: 'pcCongaLow', name: 'Conga Low', group: 'Real percussion', kit: 0, key: 64 },
  { id: 'pcBongoHigh', name: 'Bongo High', group: 'Real percussion', kit: 0, key: 60 },
  { id: 'pcBongoLow', name: 'Bongo Low', group: 'Real percussion', kit: 0, key: 61 },
  { id: 'pcTimbale', name: 'Timbale', group: 'Real percussion', kit: 0, key: 65 },
  { id: 'pcClaves', name: 'Claves', group: 'Real percussion', kit: 0, key: 75 },
  { id: 'pcWoodblock', name: 'Woodblock', group: 'Real percussion', kit: 0, key: 76 },
  { id: 'pcTriangle', name: 'Triangle', group: 'Real percussion', kit: 0, key: 81, choke: 3 },
  { id: 'pcTriangleMute', name: 'Triangle Muted', group: 'Real percussion', kit: 0, key: 80, choke: 3 },
  { id: 'pcGuiro', name: 'Guiro', group: 'Real percussion', kit: 0, key: 73 },
  { id: 'pcVibraslap', name: 'Vibraslap', group: 'Real percussion', kit: 0, key: 58 },
];

/** The recorded drum that stands in for an electronic one (for band-style beats). */
export const ACOUSTIC_FOR: Record<string, string> = {
  kick808: 'acKick',
  kickPunch: 'acKick',
  kickLofi: 'acKick2',
  kickHouse: 'acKick',
  snare: 'acSnare',
  snareTight: 'acSnare2',
  snareLofi: 'acSnare',
  clap: 'acClap',
  rim: 'acStick',
  hatClosed: 'acHatClosed',
  hatOpen: 'acHatOpen',
  hatPedal: 'acHatPedal',
  crash: 'acCrash',
  ride: 'acRide',
  tomLow: 'acTomLow',
  tomMid: 'acTomMid',
  tomHigh: 'acTomHigh',
  shaker: 'pcShaker',
  tambourine: 'pcTambourine',
  cowbell: 'pcCowbell',
  conga: 'pcCongaHigh',
  woodblock: 'pcWoodblock',
};

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
  ...GM_DRUMS,
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

// ---------- recorded instruments (General MIDI) ----------

export const GM_FAMILIES = ['Piano', 'Chromatic percussion', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass', 'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth effects', 'World', 'Percussive', 'Sound effects'] as const;

export type GmFamily = (typeof GM_FAMILIES)[number];

const GM_NAMES = [
  'Grand Piano', 'Bright Piano', 'Electric Grand', 'Honky-tonk Piano', 'Electric Piano', 'FM Electric Piano', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Bandoneon',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Electric Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass', 'Pop Bass', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Double Bass', 'Tremolo Strings', 'Pizzicato Strings', 'Harp', 'Timpani',
  'String Ensemble', 'Slow Strings', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horns', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang', 'Solo Vox', 'Fifths Lead', 'Bass & Lead',
  'Fantasia Pad', 'Warm Pad', 'Polysynth', 'Space Voice', 'Bowed Glass', 'Metal Pad', 'Halo Pad', 'Sweep Pad',
  'Ice Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblin', 'Echo Drops', 'Star Theme',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shehnai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone', 'Helicopter', 'Applause', 'Gunshot',
];

export interface GmInstrument {
  program: number;
  name: string;
  family: GmFamily;
}

/** The 128 General MIDI instruments, by program number. */
export const GM_INSTRUMENTS: GmInstrument[] = GM_NAMES.map((name, program) => ({ program, name, family: GM_FAMILIES[program >> 3] }));

export const gmInstrument = (program: number) => GM_INSTRUMENTS[Math.max(0, Math.min(127, Math.round(program)))];

/**
 * dB each instrument is turned up or down so they all come in at about the same loudness (the
 * SoundFont's own levels differ by over 30 dB). Measured from a held chord at velocity 0.8, aiming for
 * -16 dB RMS without peaks over -1 dB.
 */
export const GM_TRIM = [
  5.5, 5.5, 3.5, 7, -2.5, -1, 4.5, 1, 2.5, 2, 1, -3, 2, -0.5, 1, 4,
  -0.5, -4.5, -1.5, -0.5, -1, 2.5, 2, 1.5, 2.5, 4.5, 3, -0.5, -0.5, -0.5, -1, -3,
  -0.5, -2, -3, -0.5, -3.5, -3, -1, -0.5, -2, -0.5, -5.5, 1.5, 3, -0.5, 0, 3.5,
  -3.5, -3.5, 2.5, 2.5, -1, -1.5, 0, -0.5, -4.5, -8, -8, -2, -4, -2.5, -1.5, -1,
  -1.5, -5.5, -3.5, -2, -3.5, -3, -3.5, -2.5, -4.5, -3, -3, -4, -5, -4.5, -8, -8,
  -5.5, -4, 0.5, -6.5, -8, -7, -6.5, -8, -1.5, 1, -8, 0, 0.5, -2.5, -4.5, 3.5,
  -1, -8, -2.5, -5, 0.5, 5, -0.5, -8, -3, -2.5, 4, -1, 0, -2.5, -6.5, -3,
  5.5, 9, 3.5, 7.5, 6.5, 6.5, 0.5, 2.5, 3, 3, 9, 3, 1, 9, 0.5, 2,
];

/** Settings for a recorded instrument. */
export function instrumentParams(program: number): InstrumentParams {
  return { ...DEFAULT_INSTRUMENT, program: Math.max(0, Math.min(127, Math.round(program))) };
}
