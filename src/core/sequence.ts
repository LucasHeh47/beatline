// What plays when: the notes and audio clips that start in a stretch of the song (or of one pattern,
// in pattern mode), with swing applied. The player schedules these a moment ahead; the exporter takes
// them all at once.
import { STEP, clipEnd, patternById, type Clip, type Project, type Track } from './project';

export interface NoteEvent {
  channel: string;
  key: number;
  vel: number;
  /** Ticks from the start of the song (or pattern). */
  at: number;
  length: number;
}

export interface AudioEvent {
  clip: Clip;
  track: Track;
  /** When it starts playing (ticks). */
  at: number;
  /** Seconds into the file to start from (later than the clip's own offset when starting mid-clip). */
  offset: number;
  /** Ticks it plays for. */
  length: number;
}

/** Pushes every second 16th late by `swing` (0–1, up to half a step). */
export function swingTick(t: number, swing: number): number {
  if (!swing) return t;
  const pos = t % (2 * STEP);
  return pos === STEP ? t + swing * STEP * 0.5 : t;
}

/** Playlist tracks that play: not muted, and when any is soloed, only soloed ones. */
export function audibleTracks(p: Project): Track[] {
  const solo = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => !t.mute && (!solo || t.solo));
}

/** Notes of the active pattern starting in [from, to) (pattern mode). */
export function patternNotes(p: Project, patternId: string, from: number, to: number): NoteEvent[] {
  const pt = patternById(p, patternId);
  if (!pt) return [];
  const out: NoteEvent[] = [];
  for (const ch of p.channels) {
    if (ch.mute) continue;
    for (const n of pt.notes[ch.id] ?? []) {
      if (n.start >= pt.length) continue;
      const at = swingTick(n.start, p.swing);
      if (at >= from && at < to) out.push({ channel: ch.id, key: n.key, vel: n.vel, at, length: Math.min(n.length, pt.length - n.start) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Notes of the song's pattern clips starting in [from, to). */
export function songNotes(p: Project, from: number, to: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  const muted = new Set(p.channels.filter((c) => c.mute).map((c) => c.id));
  for (const t of audibleTracks(p)) {
    for (const c of t.clips) {
      if (c.kind !== 'pattern' || c.muted || c.start >= to || clipEnd(c) <= from) continue;
      const pt = patternById(p, c.patternId);
      if (!pt) continue;
      // A clip longer than its pattern repeats it
      const loop = Math.max(STEP, pt.length);
      for (const [ch, notes] of Object.entries(pt.notes)) {
        if (muted.has(ch)) continue;
        for (const n of notes) {
          if (n.start >= loop) continue;
          // The pattern's repeats that fall inside the clip
          const first = Math.floor((c.offset - n.start) / loop);
          for (let r = Math.max(0, first); ; r++) {
            const inClip = n.start + r * loop - c.offset;
            if (inClip >= c.length) break;
            if (inClip < 0) continue;
            const at = swingTick(c.start + inClip, p.swing);
            if (at >= to) break;
            if (at >= from) out.push({ channel: ch, key: n.key, vel: n.vel, at, length: Math.max(1, Math.min(n.length, c.length - inClip)) });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Audio clips that start in [from, to), and with `startAt` the ones already playing there. */
export function songAudio(p: Project, from: number, to: number, ticksToSecs: (t: number) => number, startAt?: number): AudioEvent[] {
  const out: AudioEvent[] = [];
  for (const t of audibleTracks(p)) {
    for (const c of t.clips) {
      if (c.kind !== 'audio' || c.muted) continue;
      if (c.start >= from && c.start < to) out.push({ clip: c, track: t, at: c.start, offset: c.offset, length: c.length });
      else if (startAt !== undefined && c.start < startAt && clipEnd(c) > startAt) {
        const into = startAt - c.start;
        out.push({ clip: c, track: t, at: startAt, offset: c.offset + ticksToSecs(into), length: c.length - into });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Splits a stretch of play [from, from + span) into pieces that don't cross the loop's end: each
 * piece is [start, end) in song ticks, with `shift` ticks of real time before it.
 */
export function loopWindows(from: number, span: number, loop: [number, number] | null): { start: number; end: number; shift: number }[] {
  if (!loop || loop[1] <= loop[0] || from >= loop[1] || from < loop[0]) return [{ start: from, end: from + span, shift: 0 }];
  const out: { start: number; end: number; shift: number }[] = [];
  let at = from;
  let left = span;
  let shift = 0;
  while (left > 1e-9) {
    const piece = Math.min(left, loop[1] - at);
    out.push({ start: at, end: at + piece, shift });
    shift += piece;
    left -= piece;
    at = loop[0];
    if (out.length > 64) break;
  }
  return out;
}
