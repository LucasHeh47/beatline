// Mixer effects: what each one does and its settings (ranges, defaults, labels), plus ready-made
// chains for guitar and vocals. The audio side is in audio/effects.ts.
import { uid, type Effect, type ParamValue } from './project';

export interface ParamDef {
  id: string;
  label: string;
  kind: 'num' | 'choice' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  default: ParamValue;
  unit?: string;
  /** Sliders move on a log scale (frequencies, times). */
  log?: boolean;
  options?: [string, string][];
}

export interface EffectDef {
  type: string;
  name: string;
  description: string;
  category: 'Tone' | 'Dynamics' | 'Space' | 'Guitar' | 'Modulation' | 'Character';
  params: ParamDef[];
}

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', step = 0.01, log = false): ParamDef => ({ id, label, kind: 'num', min, max, default: def, unit, step, log });
const choice = (id: string, label: string, options: [string, string][], def: string): ParamDef => ({ id, label, kind: 'choice', options, default: def });
const bool = (id: string, label: string, def: boolean): ParamDef => ({ id, label, kind: 'bool', default: def });

export const DELAY_TIMES: [string, string][] = [
  ['1/2', '1/2 note'],
  ['1/4', '1/4 note'],
  ['1/4d', 'Dotted 1/4'],
  ['1/4t', '1/4 triplet'],
  ['1/8', '1/8 note'],
  ['1/8d', 'Dotted 1/8'],
  ['1/8t', '1/8 triplet'],
  ['1/16', '1/16 note'],
];

/** Seconds of a note value at a tempo. */
export function noteSeconds(value: string, bpm: number): number {
  const beat = 60 / bpm;
  const base: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
  const m = /^(1\/\d+)([dt]?)$/.exec(value);
  if (!m) return beat / 2;
  const b = (base[m[1]] ?? 0.5) * beat;
  return m[2] === 'd' ? b * 1.5 : m[2] === 't' ? (b * 2) / 3 : b;
}

export const EFFECTS: EffectDef[] = [
  {
    type: 'eq',
    name: 'EQ',
    description: 'Turns the lows, mids and highs up or down.',
    category: 'Tone',
    params: [num('low', 'Low', -18, 18, 0, 'dB', 0.5), num('lowFreq', 'Low freq', 40, 500, 120, 'Hz', 1, true), num('mid', 'Mid', -18, 18, 0, 'dB', 0.5), num('midFreq', 'Mid freq', 200, 5000, 1000, 'Hz', 1, true), num('midQ', 'Mid width', 0.3, 6, 1, '', 0.1), num('high', 'High', -18, 18, 0, 'dB', 0.5), num('highFreq', 'High freq', 2000, 16000, 6000, 'Hz', 1, true), num('lowCut', 'Low cut', 20, 400, 20, 'Hz', 1, true)],
  },
  {
    type: 'compressor',
    name: 'Compressor',
    description: 'Evens out the loud and quiet parts, so a sound sits steady in the mix.',
    category: 'Dynamics',
    params: [num('threshold', 'Threshold', -60, 0, -18, 'dB', 0.5), num('ratio', 'Ratio', 1, 20, 4, ':1', 0.1), num('attack', 'Attack', 0.001, 0.3, 0.01, 's', 0.001, true), num('release', 'Release', 0.02, 1, 0.2, 's', 0.01, true), num('makeup', 'Makeup', 0, 24, 3, 'dB', 0.5)],
  },
  {
    type: 'gate',
    name: 'Noise Gate',
    description: 'Silences hum and hiss between notes (great on guitar amps and microphones).',
    category: 'Dynamics',
    params: [num('threshold', 'Threshold', -80, -10, -50, 'dB', 0.5), num('release', 'Release', 0.01, 0.5, 0.08, 's', 0.005, true)],
  },
  {
    type: 'limiter',
    name: 'Limiter',
    description: 'Stops the sound going over a level — keeps the master from clipping.',
    category: 'Dynamics',
    params: [num('ceiling', 'Ceiling', -12, 0, -1, 'dB', 0.1), num('gain', 'Input gain', 0, 18, 0, 'dB', 0.5)],
  },
  {
    type: 'reverb',
    name: 'Reverb',
    description: 'Puts the sound in a room, a hall or a cathedral.',
    category: 'Space',
    params: [num('size', 'Decay', 0.2, 8, 1.8, 's', 0.1, true), num('predelay', 'Pre-delay', 0, 0.2, 0.02, 's', 0.005), num('damping', 'Darker', 0, 1, 0.4), num('mix', 'Mix', 0, 1, 0.25)],
  },
  {
    type: 'delay',
    name: 'Delay',
    description: 'Echoes in time with the song.',
    category: 'Space',
    params: [choice('time', 'Time', DELAY_TIMES, '1/8d'), num('feedback', 'Feedback', 0, 0.95, 0.35), num('tone', 'Tone', 800, 16000, 5000, 'Hz', 1, true), num('mix', 'Mix', 0, 1, 0.25), bool('pingpong', 'Ping-pong', true)],
  },
  {
    type: 'amp',
    name: 'Guitar Amp',
    description: 'A guitar amplifier and speaker cabinet: plug your guitar in and pick a sound.',
    category: 'Guitar',
    params: [
      choice('model', 'Amp', [['clean', 'Clean'], ['crunch', 'Crunch'], ['lead', 'Lead'], ['metal', 'Metal'], ['bass', 'Bass amp']], 'crunch'),
      num('gain', 'Gain', 0, 1, 0.5),
      num('bass', 'Bass', -12, 12, 0, 'dB', 0.5),
      num('mid', 'Mid', -12, 12, 0, 'dB', 0.5),
      num('treble', 'Treble', -12, 12, 0, 'dB', 0.5),
      num('presence', 'Presence', -12, 12, 2, 'dB', 0.5),
      num('volume', 'Volume', -24, 12, 0, 'dB', 0.5),
      bool('cab', 'Speaker cabinet', true),
    ],
  },
  {
    type: 'distortion',
    name: 'Distortion',
    description: 'Overdrive and fuzz: grit for guitars, basses and drums.',
    category: 'Character',
    params: [choice('shape', 'Type', [['overdrive', 'Overdrive'], ['fuzz', 'Fuzz'], ['hard', 'Hard clip'], ['bit', 'Bit crush']], 'overdrive'), num('drive', 'Drive', 0, 1, 0.4), num('tone', 'Tone', 500, 12000, 4000, 'Hz', 1, true), num('mix', 'Mix', 0, 1, 1)],
  },
  {
    type: 'chorus',
    name: 'Chorus',
    description: 'Shimmering width, like two players at once.',
    category: 'Modulation',
    params: [num('rate', 'Rate', 0.1, 5, 0.8, 'Hz', 0.05, true), num('depth', 'Depth', 0, 1, 0.5), num('mix', 'Mix', 0, 1, 0.5)],
  },
  {
    type: 'phaser',
    name: 'Phaser',
    description: 'A sweeping, swirling sound.',
    category: 'Modulation',
    params: [num('rate', 'Rate', 0.05, 5, 0.4, 'Hz', 0.05, true), num('depth', 'Depth', 0, 1, 0.7), num('feedback', 'Feedback', 0, 0.9, 0.4), num('mix', 'Mix', 0, 1, 0.5)],
  },
  {
    type: 'filter',
    name: 'Filter',
    description: 'Cuts the highs (low-pass) or the lows (high-pass) — for builds and transitions.',
    category: 'Tone',
    params: [choice('type', 'Type', [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']], 'lowpass'), num('cutoff', 'Cutoff', 20, 20000, 8000, 'Hz', 1, true), num('q', 'Resonance', 0.1, 18, 0.7, '', 0.1, true)],
  },
  {
    type: 'stereo',
    name: 'Stereo Width',
    description: 'Makes the sound wider or narrower (0 is mono).',
    category: 'Character',
    params: [num('width', 'Width', 0, 2, 1.3)],
  },
];

export const effectDef = (type: string) => EFFECTS.find((e) => e.type === type);

export function makeEffect(type: string, params: Record<string, ParamValue> = {}): Effect {
  const def = effectDef(type);
  const p: Record<string, ParamValue> = {};
  for (const d of def?.params ?? []) p[d.id] = d.default;
  return { id: uid('fx'), type, on: true, params: { ...p, ...params } };
}

export const numParam = (e: Effect, id: string): number => {
  const v = e.params[id];
  if (typeof v === 'number') return v;
  const d = effectDef(e.type)?.params.find((x) => x.id === id)?.default;
  return typeof d === 'number' ? d : 0;
};
export const strParam = (e: Effect, id: string): string => String(e.params[id] ?? effectDef(e.type)?.params.find((x) => x.id === id)?.default ?? '');
export const boolParam = (e: Effect, id: string): boolean => !!(e.params[id] ?? effectDef(e.type)?.params.find((x) => x.id === id)?.default);

export interface ChainPreset {
  id: string;
  name: string;
  description: string;
  effects: () => Effect[];
}

/** Ready-made effect chains for a mixer track (guitar sounds, vocals, drums). */
export const CHAIN_PRESETS: ChainPreset[] = [
  { id: 'guitarClean', name: 'Guitar: clean', description: 'Sparkly clean amp with chorus and a little room.', effects: () => [makeEffect('gate', { threshold: -60 }), makeEffect('amp', { model: 'clean', gain: 0.3, treble: 2 }), makeEffect('chorus', { mix: 0.3 }), makeEffect('reverb', { size: 1.6, mix: 0.18 })] },
  { id: 'guitarCrunch', name: 'Guitar: crunch', description: 'Classic rock crunch.', effects: () => [makeEffect('gate', { threshold: -55 }), makeEffect('amp', { model: 'crunch', gain: 0.55, mid: 2 }), makeEffect('reverb', { size: 1.2, mix: 0.12 })] },
  { id: 'guitarLead', name: 'Guitar: lead', description: 'Singing solo tone with echo.', effects: () => [makeEffect('gate', { threshold: -55 }), makeEffect('amp', { model: 'lead', gain: 0.7, mid: 3 }), makeEffect('delay', { time: '1/4', feedback: 0.35, mix: 0.22 }), makeEffect('reverb', { size: 2.2, mix: 0.2 })] },
  { id: 'guitarMetal', name: 'Guitar: metal', description: 'Tight, heavy high gain.', effects: () => [makeEffect('gate', { threshold: -45, release: 0.05 }), makeEffect('amp', { model: 'metal', gain: 0.8, bass: 3, mid: -4, treble: 3 }), makeEffect('eq', { lowCut: 80, high: 1 })] },
  { id: 'guitarAmbient', name: 'Guitar: ambient', description: 'Washes of delay and reverb.', effects: () => [makeEffect('amp', { model: 'clean', gain: 0.25 }), makeEffect('delay', { time: '1/4d', feedback: 0.55, mix: 0.35, pingpong: true }), makeEffect('reverb', { size: 6, mix: 0.45, damping: 0.6 })] },
  { id: 'acoustic', name: 'Acoustic guitar', description: 'For a miked acoustic: less boom, more sparkle.', effects: () => [makeEffect('eq', { lowCut: 90, mid: -2, midFreq: 300, high: 3 }), makeEffect('compressor', { threshold: -20, ratio: 3 }), makeEffect('reverb', { size: 1.4, mix: 0.15 })] },
  { id: 'bassGuitar', name: 'Bass guitar', description: 'Round and steady.', effects: () => [makeEffect('amp', { model: 'bass', gain: 0.35 }), makeEffect('compressor', { threshold: -22, ratio: 4, attack: 0.02 })] },
  { id: 'vocals', name: 'Vocals', description: 'Clear and up front.', effects: () => [makeEffect('eq', { lowCut: 100, mid: -2, midFreq: 400, high: 3, highFreq: 8000 }), makeEffect('compressor', { threshold: -24, ratio: 4, makeup: 6 }), makeEffect('delay', { time: '1/8', feedback: 0.2, mix: 0.1 }), makeEffect('reverb', { size: 1.8, mix: 0.18 })] },
  { id: 'drumBus', name: 'Punchy drums', description: 'Glue and punch for a drum mix.', effects: () => [makeEffect('compressor', { threshold: -16, ratio: 4, attack: 0.02, release: 0.12, makeup: 4 }), makeEffect('eq', { low: 2, high: 2 })] },
  { id: 'master', name: 'Master: loud and safe', description: 'Gentle compression and a limiter so nothing clips.', effects: () => [makeEffect('compressor', { threshold: -12, ratio: 2, attack: 0.03, release: 0.25, makeup: 2 }), makeEffect('limiter', { ceiling: -1, gain: 3 })] },
];
