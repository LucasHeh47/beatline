// Editing notes: the step sequencer's steps, and the piano roll's tools (quantize, humanize, legato,
// arpeggiate, strum, chords from single notes, transpose). Functions return new note lists.
import { STEP, type Note, type Pattern } from './project';
import { chordOnDegree, inScale, scaleById, snapToScale } from './theory';

/** The note a step plays when it's switched on in the step sequencer. */
export const STEP_KEY = 60;

export const sortNotes = (notes: Note[]) => [...notes].sort((a, b) => a.start - b.start || a.key - b.key);

// ---------- steps ----------

/** Which steps of a channel have a note starting on them. */
export function stepsOf(notes: Note[] | undefined, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  for (const n of notes ?? []) {
    if (n.start % STEP) continue;
    const i = n.start / STEP;
    if (i >= 0 && i < count) out[i] = true;
  }
  return out;
}

/** Whether a channel's notes are more than plain steps (other pitches or lengths): then it's shown as a mini piano roll. */
export function isMelodic(notes: Note[] | undefined): boolean {
  return (notes ?? []).some((n) => n.key !== STEP_KEY || n.start % STEP !== 0 || n.length !== STEP);
}

/** Switches a step on or off. */
export function toggleStep(pt: Pattern, channel: string, step: number, on?: boolean, vel = 0.8): boolean {
  const list = (pt.notes[channel] ??= []);
  const at = step * STEP;
  const i = list.findIndex((n) => n.start === at);
  const want = on ?? i < 0;
  if (want && i < 0) {
    list.push({ key: STEP_KEY, start: at, length: STEP, vel });
    list.sort((a, b) => a.start - b.start);
  } else if (!want && i >= 0) list.splice(i, 1);
  return want;
}

/** Fills every `every` steps (from `from`), replacing the channel's steps. */
export function fillSteps(pt: Pattern, channel: string, every: number, from = 0): void {
  const count = Math.round(pt.length / STEP);
  pt.notes[channel] = [];
  for (let s = from; s < count; s += every) pt.notes[channel].push({ key: STEP_KEY, start: s * STEP, length: STEP, vel: 0.8 });
}

/** Steps written as "x..x" ("X" is accented, "o" softer, "." empty). */
export function stepsFromString(s: string, key = STEP_KEY): Note[] {
  const out: Note[] = [];
  [...s.replace(/\s/g, '')].forEach((ch, i) => {
    if (ch === '.' || ch === '-') return;
    out.push({ key, start: i * STEP, length: STEP, vel: ch === 'X' ? 1 : ch === 'o' ? 0.55 : 0.8 });
  });
  return out;
}

// ---------- piano roll tools ----------

/** Moves note starts (and with `ends`, their ends) to the grid; `strength` 1 is all the way. */
export function quantize(notes: Note[], grid: number, strength = 1, ends = false): Note[] {
  return notes.map((n) => {
    const start = Math.round(n.start + (Math.round(n.start / grid) * grid - n.start) * strength);
    let end = n.start + n.length;
    if (ends) end = Math.round(end + (Math.round(end / grid) * grid - end) * strength);
    else end = start + n.length;
    return { ...n, start: Math.max(0, start), length: Math.max(1, end - start) };
  });
}

/** A small, repeatable random number generator (so "humanize" can be tested). */
export function rng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Nudges timing (± ticks) and velocity (± amount) a little, so it sounds played. */
export function humanize(notes: Note[], timing: number, velocity: number, rand = rng(Date.now())): Note[] {
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, Math.round(n.start + (rand() * 2 - 1) * timing)),
    vel: Math.max(0.05, Math.min(1, n.vel + (rand() * 2 - 1) * velocity)),
  }));
}

export function transpose(notes: Note[], semis: number): Note[] {
  return notes.map((n) => ({ ...n, key: Math.max(0, Math.min(127, n.key + semis)) }));
}

/** Each note lasts until the next one starts (chords stay together). */
export function legato(notes: Note[]): Note[] {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.start);
    return next === undefined ? n : { ...n, length: next - n.start };
  });
}

/** Moves notes into the scale (to the nearest note in it). */
export function fitToScale(notes: Note[], root: number, scale: string): Note[] {
  return notes.map((n) => (inScale(n.key, root, scale) ? n : { ...n, key: snapToScale(n.key, root, scale) }));
}

/** Notes that sound together (overlapping starts within a tick), as groups. */
export function chordsOf(notes: Note[]): Note[][] {
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const g = groups.get(n.start) ?? [];
    g.push(n);
    groups.set(n.start, g);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => a.key - b.key));
}

export type ArpPattern = 'up' | 'down' | 'upDown' | 'random';

/** Plays each chord's notes one after another every `rate` ticks, for as long as the chord lasts. */
export function arpeggiate(notes: Note[], pattern: ArpPattern, rate: number, gate = 0.9, octaves = 1, rand = rng(7)): Note[] {
  const out: Note[] = [];
  for (const chord of chordsOf(notes)) {
    const start = chord[0].start;
    const end = Math.max(...chord.map((n) => n.start + n.length));
    let keys = chord.map((n) => n.key);
    for (let o = 1; o < octaves; o++) keys = keys.concat(chord.map((n) => n.key + 12 * o));
    const order = pattern === 'down' ? [...keys].reverse() : pattern === 'upDown' ? [...keys, ...keys.slice(1, -1).reverse()] : keys;
    let i = 0;
    for (let t = start; t < end; t += rate, i++) {
      const key = pattern === 'random' ? keys[Math.floor(rand() * keys.length)] : order[i % order.length];
      out.push({ key, start: t, length: Math.max(1, Math.round(Math.min(rate * gate, end - t))), vel: chord[0].vel });
    }
  }
  return out;
}

/** Spreads each chord's notes out like a strummed guitar (`ticks` between strings; up strums go high to low). */
export function strum(notes: Note[], ticks: number, up = false): Note[] {
  const out: Note[] = [];
  for (const chord of chordsOf(notes)) {
    const order = up ? [...chord].reverse() : chord;
    order.forEach((n, i) => out.push({ ...n, start: n.start + i * ticks, length: Math.max(1, n.length - i * ticks) }));
  }
  return out;
}

/** Turns single notes into chords: the scale's own chord on each note (or a fixed shape). */
export function chordify(notes: Note[], root: number, scale: string, size: 3 | 4 = 3): Note[] {
  // Pentatonic and other short scales use the major scale's chords
  const useScale = scaleById(scale).steps.length === 7 ? scale : 'major';
  const steps = scaleById(useScale).steps;
  const out: Note[] = [];
  for (const n of notes) {
    const rel = (((n.key - root) % 12) + 12) % 12;
    const degree = steps.indexOf(rel);
    if (degree < 0) {
      out.push(n);
      continue;
    }
    // chordOnDegree's octave 4 starts at root + 60
    const octave = Math.floor((n.key - root) / 12) - 1;
    for (const k of chordOnDegree(root, useScale, degree, size, octave)) out.push({ ...n, key: k });
  }
  return out;
}

/** Sets velocities in a straight line from the first note to the last. */
export function velocityRamp(notes: Note[], from: number, to: number): Note[] {
  const sorted = sortNotes(notes);
  const a = sorted[0]?.start ?? 0;
  const b = sorted[sorted.length - 1]?.start ?? a;
  return sorted.map((n) => ({ ...n, vel: Math.max(0.02, Math.min(1, b > a ? from + ((n.start - a) / (b - a)) * (to - from) : to)) }));
}

/** Notes of the same pitch can't overlap: earlier ones end where later ones start. */
export function fixOverlaps(notes: Note[]): Note[] {
  const out = sortNotes(notes).map((n) => ({ ...n }));
  const last = new Map<number, Note>();
  const keep: Note[] = [];
  for (const n of out) {
    const prev = last.get(n.key);
    if (prev && prev.start === n.start) continue;
    if (prev && prev.start + prev.length > n.start) prev.length = n.start - prev.start;
    last.set(n.key, n);
    keep.push(n);
  }
  return keep;
}
