// Editing the playlist: placing pattern and audio clips, moving, slicing, duplicating and deleting
// them, and making a clip's pattern its own copy.
import { clipEnd, findClip, patternById, patternEnd, ticksToSeconds, uid, type Clip, type Pattern, type Project, type Track } from './project';

/** Length of a new clip of a pattern: the pattern rounded up to whole bars. */
export function patternClipLength(pt: Pattern, bar: number): number {
  return Math.max(bar, Math.ceil(patternEnd(pt) / bar) * bar);
}

export function patternClip(pt: Pattern, start: number, bar: number): Clip {
  return { id: uid('k'), kind: 'pattern', patternId: pt.id, start, length: patternClipLength(pt, bar), offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 };
}

export function audioClip(sampleId: string, start: number, length: number, offset = 0): Clip {
  return { id: uid('k'), kind: 'audio', sampleId, start, length, offset, gain: 0, fadeIn: 0, fadeOut: 0 };
}

export function addClip(t: Track, c: Clip): Clip {
  t.clips.push(c);
  t.clips.sort((a, b) => a.start - b.start);
  return c;
}

/** Moves clips by `dt` ticks and `dTrack` tracks (not before the start, onto existing tracks). With `copy` the originals stay. */
export function moveClips(p: Project, ids: Set<string>, dt: number, dTrack: number, copy = false): Clip[] {
  const moving: { clip: Clip; from: number }[] = [];
  p.tracks.forEach((t, i) => {
    for (const c of t.clips) if (ids.has(c.id)) moving.push({ clip: c, from: i });
  });
  if (!moving.length) return [];
  dt = Math.max(dt, -Math.min(...moving.map((m) => m.clip.start)));
  const lo = Math.min(...moving.map((m) => m.from));
  const hi = Math.max(...moving.map((m) => m.from));
  dTrack = Math.max(-lo, Math.min(p.tracks.length - 1 - hi, dTrack));
  const out: Clip[] = [];
  for (const { clip, from } of moving) {
    let c = clip;
    if (copy) c = { ...structuredClone(clip), id: uid('k') };
    else p.tracks[from].clips = p.tracks[from].clips.filter((x) => x !== clip);
    c.start += dt;
    addClip(p.tracks[from + dTrack], c);
    out.push(c);
  }
  return out;
}

export function deleteClips(p: Project, ids: Set<string>): void {
  for (const t of p.tracks) t.clips = t.clips.filter((c) => !ids.has(c.id));
}

/** Splits a clip at a tick; the right part is returned. */
export function sliceClip(p: Project, id: string, at: number): Clip | null {
  const f = findClip(p, id);
  if (!f) return null;
  const c = f.clip;
  if (at <= c.start || at >= clipEnd(c)) return null;
  const right: Clip = { ...structuredClone(c), id: uid('k') };
  const d = at - c.start;
  right.start = at;
  right.length = c.length - d;
  // Audio offsets are seconds into the file; pattern offsets are ticks into the pattern
  right.offset = c.kind === 'audio' ? c.offset + ticksToSeconds(d, p.bpm) : c.offset + d;
  right.fadeIn = 0;
  c.length = d;
  c.fadeOut = 0;
  addClip(f.track, right);
  return right;
}

/** Copies of the clips right after them (Ctrl+B in FL). */
export function duplicateClips(p: Project, ids: Set<string>): Clip[] {
  const list = p.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  if (!list.length) return [];
  const span = Math.max(...list.map(clipEnd)) - Math.min(...list.map((c) => c.start));
  const out: Clip[] = [];
  for (const t of p.tracks) {
    const copies = t.clips.filter((x) => ids.has(x.id)).map((c): Clip => ({ ...structuredClone(c), id: uid('k'), start: c.start + span }));
    for (const c of copies) addClip(t, c);
    out.push(...copies);
  }
  return out;
}

/** Gives a clip its own copy of its pattern, so editing it doesn't change the others. */
export function makeUnique(p: Project, clipId: string): Pattern | null {
  const f = findClip(p, clipId);
  const pt = patternById(p, f?.clip.patternId);
  if (!f || !pt) return null;
  const copy: Pattern = { ...structuredClone(pt), id: uid('p'), name: nextPatternName(p, pt.name) };
  p.patterns.push(copy);
  f.clip.patternId = copy.id;
  return copy;
}

/** "Verse 2" after "Verse", "Pattern 4" after "Pattern 3"… */
export function nextPatternName(p: Project, base: string): string {
  const stem = base.replace(/\s*\d+$/, '') || 'Pattern';
  let n = 1;
  const names = new Set(p.patterns.map((x) => x.name));
  while (names.has(`${stem} ${n}`)) n++;
  return `${stem} ${n}`;
}

/** Removes a pattern and its clips. */
export function deletePattern(p: Project, id: string): void {
  if (p.patterns.length <= 1) return;
  p.patterns = p.patterns.filter((x) => x.id !== id);
  for (const t of p.tracks) t.clips = t.clips.filter((c) => c.patternId !== id);
  if (p.activePattern === id) p.activePattern = p.patterns[0].id;
}

/** Removes a channel, its notes in every pattern, and its mixer track when nothing else uses it. */
export function deleteChannel(p: Project, id: string): void {
  const ch = p.channels.find((c) => c.id === id);
  if (!ch) return;
  p.channels = p.channels.filter((c) => c !== ch);
  for (const pt of p.patterns) delete pt.notes[id];
  const used = p.channels.some((c) => c.mixer === ch.mixer) || p.tracks.some((t) => t.mixer === ch.mixer);
  if (!used && ch.mixer !== 'master') p.mixer = p.mixer.filter((m) => m.id !== ch.mixer);
}

/** Inserts (positive) or removes (negative) time at a tick across the whole song. */
export function shiftTime(p: Project, at: number, d: number): void {
  for (const t of p.tracks) {
    if (d < 0) t.clips = t.clips.filter((c) => !(c.start >= at && c.start < at - d));
    for (const c of t.clips) if (c.start >= at) c.start += d;
  }
  for (const m of p.markers) if (m.at >= at) m.at = Math.max(at, m.at + d);
}
