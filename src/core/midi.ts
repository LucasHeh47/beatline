// Standard MIDI files (.mid): exporting a pattern's notes (one track per channel) and importing the
// notes of a MIDI file, to use in other music software and back.
import { PPQ, type Note } from './project';

export interface MidiTrack {
  name: string;
  notes: Note[];
}

function varLen(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

/** A type 1 MIDI file: a tempo track, then one track per channel (ticks are Beatline's, 96 per beat). */
export function writeMidi(tracks: MidiTrack[], bpm: number, beatsPerBar = 4, beatUnit = 4): Uint8Array {
  const chunks: number[][] = [];
  const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length + 1), ...u16(PPQ)];
  const tempo = Math.round(60_000_000 / bpm);
  const meta = [
    0, 0xff, 0x51, 3, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 4, beatsPerBar, Math.round(Math.log2(beatUnit)), 24, 8,
    0, 0xff, 0x2f, 0,
  ];
  chunks.push([...ascii('MTrk'), ...u32(meta.length), ...meta]);
  tracks.forEach((t, i) => {
    const ch = i % 16 === 9 ? 15 : i % 16;
    const events: { t: number; on: boolean; key: number; vel: number }[] = [];
    for (const n of t.notes) {
      events.push({ t: n.start, on: true, key: n.key, vel: Math.max(1, Math.min(127, Math.round(n.vel * 127))) });
      events.push({ t: n.start + n.length, on: false, key: n.key, vel: 0 });
    }
    // Note-offs before note-ons at the same moment
    events.sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on));
    const name = ascii(t.name.slice(0, 60));
    const data: number[] = [0, 0xff, 0x03, ...varLen(name.length), ...name];
    let last = 0;
    for (const e of events) {
      data.push(...varLen(Math.max(0, e.t - last)), (e.on ? 0x90 : 0x80) | ch, e.key & 127, e.vel);
      last = e.t;
    }
    data.push(0, 0xff, 0x2f, 0);
    chunks.push([...ascii('MTrk'), ...u32(data.length), ...data]);
  });
  return new Uint8Array([...header, ...chunks.flat()]);
}

export interface MidiFile {
  bpm: number | null;
  tracks: MidiTrack[];
}

/** Reads a MIDI file's notes (converted to 96 ticks per beat), one list per track that has notes. */
export function readMidi(data: Uint8Array): MidiFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const str = (at: number) => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
  if (data.length < 14 || str(0) !== 'MThd') throw new Error("This isn't a MIDI file.");
  const ntracks = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('This MIDI file uses SMPTE time, which Beatline can’t read.');
  const scale = PPQ / division;
  let pos = 8 + dv.getUint32(4);
  let bpm: number | null = null;
  const tracks: MidiTrack[] = [];
  for (let t = 0; t < ntracks && pos + 8 <= data.length; t++) {
    const len = dv.getUint32(pos + 4);
    const isTrack = str(pos) === 'MTrk';
    let p = pos + 8;
    const end = Math.min(data.length, p + len);
    pos = end;
    if (!isTrack) continue;
    let tick = 0;
    let status = 0;
    let name = `Track ${t + 1}`;
    const open = new Map<number, { start: number; vel: number }[]>();
    const notes: Note[] = [];
    const readVar = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const b = data[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    while (p < end) {
      tick += readVar();
      let b = data[p];
      if (b & 0x80) {
        status = b;
        p++;
      } else b = status;
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = data[p++];
        const ml = readVar();
        if (mt === 0x51 && ml === 3) bpm = Math.round((60_000_000 / ((data[p] << 16) | (data[p + 1] << 8) | data[p + 2])) * 100) / 100;
        if (mt === 0x03 && ml) name = String.fromCharCode(...data.subarray(p, p + ml)).trim() || name;
        p += ml;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVar();
      } else if (type === 0x90 || type === 0x80) {
        const key = data[p++];
        const vel = data[p++];
        const at = Math.round(tick * scale);
        if (type === 0x90 && vel > 0) {
          const list = open.get(key) ?? [];
          list.push({ start: at, vel: vel / 127 });
          open.set(key, list);
        } else {
          const n = open.get(key)?.shift();
          if (n) notes.push({ key, start: n.start, length: Math.max(1, at - n.start), vel: n.vel });
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    if (notes.length) tracks.push({ name, notes: notes.sort((a, c) => a.start - c.start || a.key - c.key) });
  }
  return { bpm, tracks };
}
