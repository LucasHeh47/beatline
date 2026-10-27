// The player: plays the song (or the pattern being worked on) through the graph, scheduling notes
// and audio a fraction of a second ahead so timing is exact even when the screen is busy. Also the
// metronome and count-in, notes played live (MIDI keyboard, computer keyboard, clicking the piano
// roll) and where the playhead is.
import { barTicks, channelById, PPQ, patternById, songEnd, ticksToSeconds, type Project } from '../core/project';
import { loopWindows, patternNotes, songAudio, songNotes } from '../core/sequence';
import processorsUrl from './worklets/processors.ts?worker&url';
import { Graph } from './graph';
import { SampleLibrary } from './library';
import type { Voice } from './voices';

export type PlayMode = 'pattern' | 'song';

const LOOKAHEAD = 0.15;
const INTERVAL = 25;

export interface EngineHost {
  project(): Project;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly library: SampleLibrary;
  readonly graph: Graph;
  /** Worklets (the gate and the recorder) are ready. */
  readonly ready: Promise<void>;
  playing = false;
  mode: PlayMode = 'pattern';
  metronome = false;
  /** Recording: the song keeps going past its end, and the metronome clicks (when `recordClick`). */
  recording = false;
  recordClick = true;
  /** Called when playback stops by itself. */
  onStop: (() => void) | null = null;

  /** Real time of elapsed tick 0, and the song tick it was. */
  private anchorTime = 0;
  private anchorTick = 0;
  /** Elapsed ticks already scheduled. */
  private scheduled = 0;
  private loop: [number, number] | null = null;
  private timer: number | undefined;
  /** Song tick where playback stopped (or the playhead was put). */
  private parked = 0;
  private live = new Map<string, Voice>();
  /** When each channel last played a note (for the channel rack's lights). */
  readonly lastHit = new Map<string, number>();
  private clicks: GainNode;

  constructor(private host: EngineHost) {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.library = new SampleLibrary(() => this.ctx.sampleRate, () => this.ctx);
    this.graph = new Graph(this.ctx, this.library, this.ctx.destination, { meters: true });
    this.clicks = this.ctx.createGain();
    this.clicks.gain.value = 0.5;
    this.clicks.connect(this.ctx.destination);
    this.ready = this.ctx.audioWorklet.addModule(processorsUrl).catch((err) => console.error('Audio worklets failed to load', err));
  }

  get project(): Project {
    return this.host.project();
  }

  /** The graph follows the project (after any change). */
  sync(): void {
    this.graph.sync(this.project);
    // A tempo change re-anchors the clock so the playhead doesn't jump
    if (this.playing && this.bpm !== this.project.bpm) this.reanchor();
    this.bpm = this.project.bpm;
  }

  private bpm = 120;

  private secs(ticks: number): number {
    return ticksToSeconds(ticks, this.project.bpm);
  }

  // ---------- transport ----------

  /** The loop while playing: the pattern in pattern mode, the loop region (if any) in song mode. */
  private loopFor(mode: PlayMode): [number, number] | null {
    const p = this.project;
    if (mode === 'pattern') {
      const pt = patternById(p, p.activePattern);
      return [0, Math.max(barTicks(p) / 4, pt?.length ?? barTicks(p))];
    }
    return p.loop && p.loop[1] > p.loop[0] ? p.loop : null;
  }

  /** The song tick at elapsed ticks since the anchor. */
  private tickAtElapsed(e: number): number {
    const x = this.anchorTick + e;
    const l = this.loop;
    if (!l || this.anchorTick >= l[1] || this.anchorTick < l[0] || x < l[1]) return x;
    return l[0] + ((x - l[1]) % (l[1] - l[0]));
  }

  private elapsedAt(time: number): number {
    return ((time - this.anchorTime) * this.project.bpm * PPQ) / 60;
  }

  /** Where the playhead is (song or pattern ticks), as heard (the speakers lag a little behind). */
  get position(): number {
    if (!this.playing) return this.parked;
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    return this.tickAtElapsed(Math.max(0, this.elapsedAt(heard)));
  }

  /** Playing, but still in the count-in (the song hasn't started). */
  get countingIn(): boolean {
    return this.playing && this.ctx.currentTime < this.anchorTime;
  }

  /** Beats of the count-in still to come (0 once the song has started). */
  get countInLeft(): number {
    if (!this.countingIn) return 0;
    const beat = this.secs((PPQ * 4) / this.project.beatUnit);
    return Math.min(this.countInBeats, Math.ceil((this.anchorTime - this.ctx.currentTime) / beat - 1e-6));
  }

  /** Puts the playhead somewhere (while playing, playback continues from there). */
  seek(tick: number): void {
    this.parked = Math.max(0, tick);
    if (this.playing) {
      this.graph.stopAll();
      this.start(this.parked, 0);
    }
  }

  async play(mode: PlayMode, from = this.parked, countInBars = 0): Promise<void> {
    if (this.playing) this.stop(false);
    await this.ctx.resume();
    await this.ready;
    this.mode = mode;
    this.graph.sync(this.project);
    this.start(from, countInBars);
  }

  private start(from: number, countInBars: number): void {
    const p = this.project;
    this.loop = this.loopFor(this.mode);
    if (this.mode === 'pattern' && this.loop && (from < this.loop[0] || from >= this.loop[1])) from = 0;
    const countIn = countInBars * this.secs(barTicks(p));
    this.anchorTime = this.ctx.currentTime + 0.06 + countIn;
    this.anchorTick = from;
    this.scheduled = 0;
    this.playing = true;
    if (countIn > 0) this.countIn(countInBars);
    // Audio clips already under the playhead start mid-way
    if (this.mode === 'song') {
      for (const ev of songAudio(p, from, from + 1, (t) => this.secs(t), from)) if (ev.clip.start < from) this.scheduleAudio(ev, this.anchorTime, ev.at);
    }
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), INTERVAL);
    this.tick();
  }

  stop(park = true): void {
    if (!this.playing) return;
    if (park) this.parked = this.position;
    this.playing = false;
    clearInterval(this.timer);
    this.graph.stopAll();
  }

  /** Back to the start (or the loop's start). */
  rewind(): void {
    const l = this.loopFor(this.mode);
    this.seek(this.mode === 'song' && l ? l[0] : 0);
  }

  private reanchor(): void {
    const now = this.ctx.currentTime + 0.02;
    const tick = this.tickAtElapsed(Math.max(0, this.elapsedAt(now)));
    this.graph.stopAll(now);
    this.anchorTime = now;
    this.anchorTick = tick;
    this.scheduled = 0;
  }

  /** The loop or pattern changed while playing (keeps going from where it is). */
  refreshLoop(): void {
    if (!this.playing) return;
    const want = this.loopFor(this.mode);
    if (JSON.stringify(want) === JSON.stringify(this.loop)) return;
    this.reanchor();
    this.loop = want;
    if (this.loop && (this.anchorTick < this.loop[0] || this.anchorTick >= this.loop[1])) this.anchorTick = this.loop[0];
  }

  private tick(): void {
    if (!this.playing) return;
    const p = this.project;
    const until = this.elapsedAt(this.ctx.currentTime + LOOKAHEAD);
    if (until <= this.scheduled) return;
    const from = this.scheduled;
    const span = until - from;
    this.scheduled = until;
    // Song mode without a loop stops at the end of the song (not while recording: that makes it longer)
    const end = this.mode === 'song' && !this.loop && !this.recording ? Math.max(songEnd(p), barTicks(p)) : Infinity;
    for (const w of loopWindows(this.tickAtElapsed(from), span, this.loop)) {
      const base = from + w.shift;
      const timeOf = (tick: number) => this.anchorTime + this.secs(base + (tick - w.start));
      const cutAt = this.loop ? this.loop[1] : end;
      const notes = this.mode === 'pattern' ? patternNotes(p, p.activePattern, w.start, w.end) : songNotes(p, w.start, Math.min(w.end, end));
      for (const ev of notes) {
        const ch = channelById(p, ev.channel);
        if (!ch) continue;
        const len = Math.min(ev.length, cutAt - ev.at);
        this.graph.playNote(p, ch, ev.key, ev.vel, timeOf(ev.at), this.secs(len));
        this.lastHit.set(ch.id, timeOf(ev.at));
      }
      if (this.mode === 'song') {
        // After the loop wraps, clips running across the loop start begin mid-way
        const wrapped = w.shift > 0 && this.loop && w.start === this.loop[0];
        for (const ev of songAudio(p, w.start, Math.min(w.end, end), (t) => this.secs(t), wrapped ? w.start : undefined)) this.scheduleAudio(ev, timeOf(ev.at), ev.at);
      }
      if (this.metronome || (this.recording && this.recordClick)) this.scheduleClicks(w.start, w.end, timeOf);
    }
    if (this.tickAtElapsed(this.elapsedAt(this.ctx.currentTime)) >= end) {
      this.stop(false);
      this.parked = 0;
      this.onStop?.();
    }
  }

  private scheduleAudio(ev: Parameters<Graph['playAudio']>[1], at: number, tick: number): void {
    const p = this.project;
    const stopTick = Math.min(ev.at + ev.length, this.loop ? this.loop[1] : Infinity);
    this.graph.playAudio(p, ev, Math.max(at, this.ctx.currentTime), this.secs(stopTick - tick), this.secs(ev.at + ev.length - tick));
  }

  // ---------- metronome ----------

  private click(at: number, accent: boolean): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g);
    g.connect(this.clicks);
    o.start(at);
    o.stop(at + 0.06);
  }

  private scheduleClicks(a: number, b: number, timeOf: (tick: number) => number): void {
    const p = this.project;
    const beat = (PPQ * 4) / p.beatUnit;
    const bar = barTicks(p);
    for (let t = Math.ceil(a / beat) * beat; t < b; t += beat) this.click(timeOf(t), t % bar === 0);
  }

  /** Beats in the count-in that's playing. */
  private countInBeats = 0;

  private countIn(bars: number): void {
    const p = this.project;
    const beat = this.secs((PPQ * 4) / p.beatUnit);
    const n = bars * p.beatsPerBar;
    this.countInBeats = n;
    const start = this.anchorTime - n * beat;
    for (let i = 0; i < n; i++) this.click(start + i * beat, i % p.beatsPerBar === 0);
  }

  setMetronomeVolume(v: number): void {
    this.clicks.gain.value = v;
  }

  // ---------- playing live ----------

  /** A note played on a keyboard (held until noteOff). */
  noteOn(channelId: string, key: number, vel = 0.8): void {
    const p = this.project;
    const ch = channelById(p, channelId);
    if (!ch) return;
    void this.ctx.resume();
    const v = this.graph.playNote(p, ch, key, vel, this.ctx.currentTime + 0.005, Infinity);
    if (v) this.live.set(`${channelId}:${key}`, v);
    this.lastHit.set(channelId, this.ctx.currentTime);
  }

  noteOff(channelId: string, key: number): void {
    const v = this.live.get(`${channelId}:${key}`);
    if (!v) return;
    v.stop(this.ctx.currentTime);
    this.live.delete(`${channelId}:${key}`);
  }

  /** A short preview of a note (clicking the piano roll or a channel). */
  preview(channelId: string, key: number, vel = 0.8, secs = 0.3): void {
    const p = this.project;
    const ch = channelById(p, channelId);
    if (!ch) return;
    void this.ctx.resume();
    this.graph.playNote(p, ch, key, vel, this.ctx.currentTime + 0.005, secs);
    this.lastHit.set(channelId, this.ctx.currentTime);
  }

  /** The song tick at a moment of real time (recordings line up with this). */
  tickAtTime(time: number): number {
    return this.tickAtElapsed(Math.max(0, this.elapsedAt(time)));
  }

  /**
   * Where a recording of `secs` seconds starting at `startTime` goes in the song: one piece per pass
   * through the loop (loop recording makes takes), each with its place and where it starts in the
   * recording. Sound from the count-in, before the song starts, is left out.
   */
  takeSegments(startTime: number, secs: number): { tick: number; offset: number; length: number }[] {
    let e0 = this.elapsedAt(startTime);
    const e1 = this.elapsedAt(startTime + secs);
    let skip = 0;
    if (e0 < 0) {
      skip = this.secs(-e0);
      e0 = 0;
    }
    if (e1 <= e0) return [];
    return loopWindows(this.tickAtElapsed(e0), e1 - e0, this.loop)
      .filter((w) => w.end - w.start >= 1)
      .map((w) => ({ tick: w.start, offset: skip + this.secs(w.shift), length: w.end - w.start }));
  }

  get loopRegion(): [number, number] | null {
    return this.loop;
  }
}
