// Music theory helpers: note names, scales and keys, chords built on a scale, chord progressions
// with smooth voice leading, and naming the chord a set of notes makes.
import { PPQ, type Note } from './project';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "C4" for 60 (middle C). */
export function noteName(key: number): string {
  return `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;
}

export const isBlackKey = (key: number) => [1, 3, 6, 8, 10].includes(((key % 12) + 12) % 12);

/** Hz of a MIDI note (A4 = 440). */
export const noteHz = (key: number) => 440 * Math.pow(2, (key - 69) / 12);

/** The nearest MIDI note to a frequency, and how far off it is in cents. */
export function hzToNote(hz: number): { key: number; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / 440);
  const key = Math.round(exact);
  return { key, cents: (exact - key) * 100 };
}

export interface Scale {
  id: string;
  name: string;
  steps: number[];
}

export const SCALES: Scale[] = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'majorPentatonic', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minorPentatonic', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'chromatic', name: 'Chromatic (no scale)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const scaleById = (id: string) => SCALES.find((s) => s.id === id) ?? SCALES[0];

export function inScale(key: number, root: number, scale: string): boolean {
  return scaleById(scale).steps.includes((((key - root) % 12) + 12) % 12);
}

/** The nearest note in the scale (ties go down). */
export function snapToScale(key: number, root: number, scale: string): number {
  for (let d = 0; d < 12; d++) {
    if (inScale(key - d, root, scale)) return key - d;
    if (inScale(key + d, root, scale)) return key + d;
  }
  return key;
}

export const keyName = (root: number, scale: string) => `${NOTE_NAMES[((root % 12) + 12) % 12]} ${scaleById(scale).name.toLowerCase()}`;

// ---------- chords ----------

export interface ChordShape {
  id: string;
  name: string;
  /** Short suffix for chord names ("m", "7"…). */
  suffix: string;
  steps: number[];
}

export const CHORDS: ChordShape[] = [
  { id: 'major', name: 'Major', suffix: '', steps: [0, 4, 7] },
  { id: 'minor', name: 'Minor', suffix: 'm', steps: [0, 3, 7] },
  { id: 'dim', name: 'Diminished', suffix: 'dim', steps: [0, 3, 6] },
  { id: 'aug', name: 'Augmented', suffix: 'aug', steps: [0, 4, 8] },
  { id: 'sus2', name: 'Suspended 2nd', suffix: 'sus2', steps: [0, 2, 7] },
  { id: 'sus4', name: 'Suspended 4th', suffix: 'sus4', steps: [0, 5, 7] },
  { id: 'maj7', name: 'Major 7th', suffix: 'maj7', steps: [0, 4, 7, 11] },
  { id: 'min7', name: 'Minor 7th', suffix: 'm7', steps: [0, 3, 7, 10] },
  { id: 'dom7', name: 'Dominant 7th', suffix: '7', steps: [0, 4, 7, 10] },
  { id: 'm7b5', name: 'Half-diminished', suffix: 'm7b5', steps: [0, 3, 6, 10] },
  { id: 'add9', name: 'Add 9', suffix: 'add9', steps: [0, 4, 7, 14] },
  { id: 'min9', name: 'Minor 9th', suffix: 'm9', steps: [0, 3, 7, 10, 14] },
  { id: 'power', name: 'Power chord', suffix: '5', steps: [0, 7, 12] },
];

/** The chord on a degree of the scale (0 is the first), stacking every other scale note. */
export function chordOnDegree(root: number, scale: string, degree: number, size: 3 | 4 = 3, octave = 4): number[] {
  const steps = scaleById(scale).steps.length === 7 ? scaleById(scale).steps : scaleById('major').steps;
  const base = root + 12 * (octave + 1);
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const d = degree + i * 2;
    out.push(base + steps[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7));
  }
  return out;
}

/** The name of the chord some notes make ("Am7", "F", "C/E"), or "" when they don't make one. */
export function chordName(keys: number[]): string {
  const pcs = [...new Set(keys.map((k) => ((k % 12) + 12) % 12))];
  if (pcs.length < 2) return '';
  const bass = ((Math.min(...keys) % 12) + 12) % 12;
  // Simplest and most common shapes first
  const order = ['major', 'minor', 'dom7', 'min7', 'maj7', 'sus4', 'sus2', 'dim', 'm7b5', 'aug', 'power', 'add9', 'min9'];
  for (const id of order) {
    const shape = CHORDS.find((c) => c.id === id)!;
    const want = new Set(shape.steps.map((s) => s % 12));
    if (want.size !== pcs.length) continue;
    for (const r of pcs) {
      if (pcs.every((p) => want.has((p - r + 12) % 12))) {
        const name = `${NOTE_NAMES[r]}${shape.suffix}`;
        return bass === r ? name : `${name}/${NOTE_NAMES[bass]}`;
      }
    }
  }
  return '';
}

// ---------- progressions ----------

export interface Progression {
  id: string;
  name: string;
  /** Scale degrees (0 = I), one chord each. */
  degrees: number[];
  /** The scale it's meant for. */
  mode: 'major' | 'minor';
  /** Roman numerals, for showing. */
  label: string;
}

export const PROGRESSIONS: Progression[] = [
  { id: 'pop', name: 'Pop', degrees: [0, 4, 5, 3], mode: 'major', label: 'I – V – vi – IV' },
  { id: 'sad', name: 'Emotional', degrees: [5, 3, 0, 4], mode: 'major', label: 'vi – IV – I – V' },
  { id: 'fifties', name: '50s doo-wop', degrees: [0, 5, 3, 4], mode: 'major', label: 'I – vi – IV – V' },
  { id: 'royal', name: 'Royal road (anime / J-pop)', degrees: [3, 4, 2, 5], mode: 'major', label: 'IV – V – iii – vi' },
  { id: 'jazz', name: 'Jazz ii – V – I', degrees: [1, 4, 0, 0], mode: 'major', label: 'ii – V – I' },
  { id: 'canon', name: 'Canon', degrees: [0, 4, 5, 2, 3, 0, 3, 4], mode: 'major', label: 'I – V – vi – iii – IV – I – IV – V' },
  { id: 'minorPop', name: 'Dark pop', degrees: [0, 5, 2, 6], mode: 'minor', label: 'i – VI – III – VII' },
  { id: 'andalusian', name: 'Flamenco (Andalusian)', degrees: [0, 6, 5, 4], mode: 'minor', label: 'i – VII – VI – V' },
  { id: 'trap', name: 'Trap / drill', degrees: [0, 5, 6, 4], mode: 'minor', label: 'i – VI – VII – v' },
  { id: 'blues', name: '12-bar blues', degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], mode: 'major', label: 'I I I I – IV IV I I – V IV I V' },
];

export interface ProgressionOptions {
  /** Beats each chord lasts. */
  beats: number;
  sevenths: boolean;
  /** 'block' holds the chord; 'stabs' plays it on every beat; 'arp' plays its notes one after another. */
  style: 'block' | 'stabs' | 'arp';
  octave: number;
  /** Adds the root an octave below each chord. */
  bass: boolean;
}

/** Turns chord voicings so each chord moves as little as possible from the one before. */
export function voiceLead(chords: number[][]): number[][] {
  const out: number[][] = [];
  for (const c of chords) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(c);
      continue;
    }
    const center = prev.reduce((a, b) => a + b, 0) / prev.length;
    let best = c;
    let bestD = Infinity;
    // Every inversion, an octave down and up
    for (let shift = -1; shift <= 1; shift++) {
      for (let inv = 0; inv < c.length; inv++) {
        const v = c.map((k, i) => k + 12 * shift + (i < inv ? 12 : 0)).sort((a, b) => a - b);
        const d = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
        if (d < bestD - 1e-9) {
          bestD = d;
          best = v;
        }
      }
    }
    out.push(best);
  }
  return out;
}

/** The notes of a chord progression in a key, starting at tick 0. */
export function progressionNotes(root: number, scale: string, prog: Progression, o: ProgressionOptions): Note[] {
  const useScale = scaleById(scale).steps.length === 7 ? scale : prog.mode;
  let chords = prog.degrees.map((d) => chordOnDegree(root, useScale, d, o.sevenths ? 4 : 3, o.octave));
  // Flamenco and trap use a major V (the harmonic minor's)
  if (prog.id === 'andalusian') chords = chords.map((c, i) => (prog.degrees[i] === 4 ? c.map((k, j) => (j === 1 ? k + 1 : k)) : c));
  const voiced = voiceLead(chords);
  const len = Math.round(o.beats * PPQ);
  const notes: Note[] = [];
  voiced.forEach((c, i) => {
    const t = i * len;
    if (o.style === 'block') for (const k of c) notes.push({ key: k, start: t, length: len, vel: 0.75 });
    else if (o.style === 'stabs') {
      for (let b = 0; b < o.beats; b++) for (const k of c) notes.push({ key: k, start: t + b * PPQ, length: Math.round(PPQ * 0.75), vel: b === 0 ? 0.85 : 0.7 });
    } else {
      // Up through the chord in 8th notes, over and over
      const step = PPQ / 2;
      const order = [...c, ...c.slice(1, -1).reverse()];
      for (let s = 0; s * step < len; s++) notes.push({ key: order[s % order.length], start: t + s * step, length: step, vel: s % 2 ? 0.65 : 0.8 });
    }
    if (o.bass) notes.push({ key: chords[i][0] - 12, start: t, length: len, vel: 0.8 });
  });
  return notes;
}
