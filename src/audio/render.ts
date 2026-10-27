// Exporting: the song (or a pattern, or one mixer track for stems) rendered offline through the same
// graph as playback, then saved as WAV, MP3, M4A, OGG or FLAC. Notes are scheduled a few seconds at
// a time while it renders, so long songs don't build every note up front.
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { AudioBufferSource, BufferTarget, FlacOutputFormat, Mp3OutputFormat, Mp4OutputFormat, OggOutputFormat, Output, Quality, WavOutputFormat, canEncodeAudio } from 'mediabunny';
import { LoudnessMeter, normalizeGain, PeakLimiter } from '../core/audioAnalysis';
import { barTicks, channelById, patternById, secondsToTicks, ticksToSeconds, type Project } from '../core/project';
import { patternNotes, songAudio, songNotes } from '../core/sequence';
import { encodeWav } from '../core/wav';
import processorsUrl from './worklets/processors.ts?worker&url';
import { Graph } from './graph';
import type { SampleLibrary } from './library';

export type ExportFormat = 'wav' | 'wav16' | 'mp3' | 'm4a' | 'ogg' | 'flac';

export interface RenderOptions {
  /** Ticks [from, to). */
  from: number;
  to: number;
  mode: 'song' | 'pattern';
  /** Seconds after the end for reverb and echoes to ring out. */
  tail: number;
  sampleRate: number;
  /** Only this mixer track (a stem); others are silent. */
  only?: string;
}

const BATCH = 4;

let mp3Registered = false;

/** Renders part of the project to sound. */
export async function renderProject(project: Project, library: SampleLibrary, o: RenderOptions, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<AudioBuffer> {
  const p = structuredClone(project);
  if (o.only) for (const m of p.mixer) if (m.id !== 'master') m.solo = m.id === o.only;
  await library.loadAll(p);
  const secs = (t: number) => ticksToSeconds(t, p.bpm);
  const length = secs(o.to - o.from) + o.tail;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, Math.ceil(length * o.sampleRate)), sampleRate: o.sampleRate });
  await ctx.audioWorklet.addModule(processorsUrl);
  const graph = new Graph(ctx, library, ctx.destination, { meters: false });
  graph.sync(p);
  const pt = patternById(p, p.activePattern);
  const at = (tick: number) => secs(tick - o.from);
  // Pattern exports repeat the pattern up to `to`
  const notesIn = (a: number, b: number) => {
    if (o.mode === 'song') return songNotes(p, a, b);
    const len = Math.max(1, pt?.length ?? barTicks(p));
    const out = [];
    for (let rep = Math.floor(a / len) * len; rep < b; rep += len) {
      for (const ev of patternNotes(p, p.activePattern, Math.max(0, a - rep), b - rep)) out.push({ ...ev, at: ev.at + rep });
    }
    return out;
  };
  const schedule = (t0: number, t1: number) => {
    // Ticks for this stretch of time
    const a = o.from + secondsToTicks(t0, p.bpm);
    const b = Math.min(o.to, o.from + secondsToTicks(t1, p.bpm));
    if (b <= a) return;
    for (const ev of notesIn(a, b)) {
      const ch = channelById(p, ev.channel);
      if (ch) graph.playNote(p, ch, ev.key, ev.vel, at(ev.at), secs(Math.min(ev.length, o.to - ev.at)));
    }
    if (o.mode === 'song') {
      for (const ev of songAudio(p, a, b, secs, t0 === 0 ? o.from : undefined)) {
        const stop = Math.min(ev.at + ev.length, o.to);
        graph.playAudio(p, ev, at(ev.at), secs(stop - ev.at), secs(ev.length));
      }
    }
  };
  schedule(0, BATCH + 0.5);
  for (let t = BATCH; t < length; t += BATCH) {
    const from = t + 0.5;
    void ctx.suspend(t).then(() => {
      if (signal?.aborted) {
        // Rendering can't be stopped half-way; it just finishes quickly with nothing more scheduled
        void ctx.resume();
        return;
      }
      schedule(from, from + BATCH);
      onProgress?.(t / length);
      void ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  if (signal?.aborted) throw new DOMException('canceled', 'AbortError');
  onProgress?.(1);
  return out;
}

/** Makes a mix as loud as a target (LUFS), with a limiter so peaks stay under -1 dB. */
export function normalize(b: AudioBuffer, target: number): { buffer: AudioBuffer; measured: number; gain: number } {
  const meter = new LoudnessMeter(b.sampleRate, b.numberOfChannels);
  const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  meter.add(chans);
  const measured = meter.lufs;
  const gainDb = normalizeGain(measured, target);
  const g = Math.pow(10, gainDb / 20);
  const lim = new PeakLimiter(b.sampleRate, b.numberOfChannels, Math.pow(10, -1 / 20));
  const scaled = chans.map((c) => c.map((v) => v * g));
  const head = lim.process(scaled);
  const tail = lim.flush();
  const out = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) {
    const all = new Float32Array(b.length);
    // Drop the limiter's few milliseconds of delay
    all.set(head[c].subarray(lim.delay));
    all.set(tail[c].subarray(0, Math.min(lim.delay, b.length - (head[c].length - lim.delay))), head[c].length - lim.delay);
    out.copyToChannel(all, c);
  }
  return { buffer: out, measured, gain: gainDb };
}

/** Encodes rendered sound into a file. */
export async function encode(b: AudioBuffer, format: ExportFormat, bitrate = 256000): Promise<Uint8Array> {
  const channels = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  if (format === 'wav' || format === 'wav16') return encodeWav({ sampleRate: b.sampleRate, channels }, format === 'wav16' ? 16 : 24);
  if (format === 'mp3' && !mp3Registered && !(await canEncodeAudio('mp3'))) {
    registerMp3Encoder();
    mp3Registered = true;
  }
  const outFormat = format === 'mp3' ? new Mp3OutputFormat() : format === 'ogg' ? new OggOutputFormat() : format === 'flac' ? new FlacOutputFormat() : format === 'm4a' ? new Mp4OutputFormat() : new WavOutputFormat();
  const codec = format === 'mp3' ? 'mp3' : format === 'ogg' ? 'opus' : format === 'flac' ? 'flac' : 'aac';
  const target = new BufferTarget();
  const output = new Output({ format: outFormat, target });
  const src = new AudioBufferSource({ codec, ...(format === 'flac' ? {} : { quality: new Quality({ bitrate }) }) } as ConstructorParameters<typeof AudioBufferSource>[0]);
  output.addAudioTrack(src);
  await output.start();
  // In pieces, so long songs don't need one huge buffer
  const piece = b.sampleRate * 10;
  for (let at = 0; at < b.length; at += piece) {
    const n = Math.min(piece, b.length - at);
    const part = new AudioBuffer({ length: n, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
    for (let c = 0; c < b.numberOfChannels; c++) part.copyToChannel(channels[c].subarray(at, at + n), c);
    await src.add(part);
  }
  await output.finalize();
  return new Uint8Array(target.buffer!);
}

/** Whether this computer can make a format (MP3 always can; the others depend on the system's encoders). */
export async function canExport(format: ExportFormat): Promise<boolean> {
  if (format === 'wav' || format === 'wav16' || format === 'mp3') return true;
  const codec = format === 'ogg' ? 'opus' : format === 'flac' ? 'flac' : 'aac';
  return canEncodeAudio(codec).catch(() => false);
}
