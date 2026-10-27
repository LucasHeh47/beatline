// The tuner: finds the pitch of a played note (YIN, a well-tested method that ignores the strong
// overtones of guitar strings), and the guitar tunings to tune to.
import { hzToNote, noteHz } from './theory';

export interface Pitch {
  hz: number;
  /** 0–1: how sure it is (a clear note is near 1). */
  clarity: number;
}

/** The pitch in some samples, or null when there's no clear note (silence, noise, chords). */
export function detectPitch(buf: Float32Array, sampleRate: number, minHz = 40, maxHz = 1500, threshold = 0.15): Pitch | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.004) return null;
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const w = n - maxLag;
  // Difference function and its cumulative mean normalization
  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + lag];
      s += x * x;
    }
    d[lag] = s;
  }
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    sum += d[lag];
    cmnd[lag] = sum > 0 ? (d[lag] * lag) / sum : 1;
  }
  // The first dip under the threshold (the fundamental), at its lowest point
  let lag = -1;
  for (let l = minLag; l <= maxLag; l++) {
    if (cmnd[l] < threshold) {
      while (l + 1 <= maxLag && cmnd[l + 1] < cmnd[l]) l++;
      lag = l;
      break;
    }
  }
  if (lag < 0) return null;
  // A parabola through the neighbors finds the dip between samples
  const a = cmnd[lag - 1] ?? cmnd[lag];
  const b = cmnd[lag];
  const c = cmnd[lag + 1] ?? cmnd[lag];
  const shift = a + c - 2 * b !== 0 ? (a - c) / (2 * (a + c - 2 * b)) : 0;
  const hz = sampleRate / (lag + shift);
  return { hz, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

export interface Tuning {
  id: string;
  name: string;
  /** MIDI notes, lowest string first. */
  strings: number[];
}

export const TUNINGS: Tuning[] = [
  { id: 'standard', name: 'Guitar: standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
  { id: 'dropD', name: 'Guitar: drop D', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'halfDown', name: 'Guitar: half step down (Eb)', strings: [39, 44, 49, 54, 58, 63] },
  { id: 'dadgad', name: 'Guitar: DADGAD', strings: [38, 45, 50, 55, 57, 62] },
  { id: 'openG', name: 'Guitar: open G', strings: [38, 43, 50, 55, 59, 62] },
  { id: 'bass', name: 'Bass: standard (E A D G)', strings: [28, 33, 38, 43] },
  { id: 'ukulele', name: 'Ukulele (G C E A)', strings: [67, 60, 64, 69] },
  { id: 'chromatic', name: 'Any note (chromatic)', strings: [] },
];

/** What to show for a detected pitch: the nearest note (or string), and how many cents off. */
export function tuneTo(hz: number, tuning: Tuning): { key: number; cents: number; string: number | null } {
  if (!tuning.strings.length) {
    const { key, cents } = hzToNote(hz);
    return { key, cents, string: null };
  }
  let best = 0;
  let bestD = Infinity;
  tuning.strings.forEach((k, i) => {
    const d = Math.abs(1200 * Math.log2(hz / noteHz(k)));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const key = tuning.strings[best];
  return { key, cents: 1200 * Math.log2(hz / noteHz(key)), string: best };
}
