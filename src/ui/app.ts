// The Beatline window: one project at a time, with the panels (Browser, Channel Rack, Piano Roll,
// Playlist, Mixer, Recording), the menus, the transport and the start page. Owns the project, its undo
// history, the selection, the audio engine and the recorder, and tells the panels when things change.
import { addClip, audioClip, patternClip } from '../core/arrange';
import { History } from '../core/history';
import { instrumentParams } from '../core/instruments';
import { readMidi } from '../core/midi';
import {
  activePattern,
  addAudioTrack,
  addChannel,
  audioTicks,
  barTicks,
  channelById,
  newPattern,
  nextColor,
  patternEnd,
  readProject,
  songEnd,
  uid,
  writeProject,
  type Project,
  type Sample,
} from '../core/project';
import { instrumentChannel, templateById, TEMPLATES } from '../core/templates';
import { encodeWav } from '../core/wav';
import { AudioEngine, type PlayMode } from '../audio/engine';
import { InputRecorder } from '../audio/recorder';
import type { MediaFileInfo } from '../shared/api';
import { Commands, eventKey } from './commands';
import { HomeView, type HomeSection } from './home';
import { Keyboard } from './keyboard';
import { Layout } from './layout';
import { isDesktop, platform } from './platform';
import { SettingsView } from './settings/SettingsView';
import { ACCENTS, SETTINGS } from './settings/schema';
import { Settings, type Refresh } from './settings/store';
import { StatusBar } from './statusBar';
import { TitleBar } from './titleBar';
import { Transport } from './transport';
import { Updates } from './updates';
import { closePopovers, dialog, setFocusFallback, toast } from './widgets';

/**
 * What changed. 'live' is a change still being made (a knob turning, a note being dragged): canvases
 * redraw, but panels made of controls wait for 'project' so the control being used isn't rebuilt.
 */
export type ChangeKind = 'project' | 'live' | 'selection' | 'playhead' | 'history' | 'settings' | 'pattern' | 'channel' | 'transport' | 'samples';

export type Workspace = 'beats' | 'arrange' | 'mix' | 'record';

export interface Prefs {
  workspace: Workspace;
  /** The browser's share of the width, and the top area's share of the height. */
  left: number;
  top: number;
  /** The tab shown in each panel group, per workspace. */
  tabs: Record<string, string>;
  /** The top area's share of the height, per workspace (when it was dragged). */
  splits: Record<string, number>;
  snap: string;
  recentCommands: string[];
  export?: Record<string, unknown>;
  /** The computer keyboard plays notes. */
  typingKeys: boolean;
  octave: number;
  countIn: number;
  metronome: boolean;
  /** The metronome clicks all the way through recordings (even when it's off for playback). */
  recordClick: boolean;
  /** Recording input. */
  inputDevice: string;
  inputChannel: 'left' | 'right' | 'stereo' | 'mono';
  monitor: boolean;
  latencyMs: number;
  tuning: string;
}

const PREFS_KEY = 'beatline.prefs';

const DEFAULT_PREFS: Prefs = {
  workspace: 'beats',
  left: 0.18,
  top: 0.58,
  tabs: {},
  splits: {},
  snap: 'step',
  recentCommands: [],
  typingKeys: false,
  octave: 4,
  countIn: 1,
  metronome: false,
  recordClick: true,
  inputDevice: '',
  inputChannel: 'mono',
  monitor: true,
  latencyMs: 0,
  tuning: 'standard',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, amt: number): string {
  const to = amt < 0 ? 0 : 255;
  const a = Math.abs(amt);
  return '#' + hexToRgb(hex).map((c) => Math.round(c + (to - c) * a).toString(16).padStart(2, '0')).join('');
}

/** A synth preset that suits a MIDI track's name ("Bass", "Piano"…). */
/** A General MIDI instrument for a MIDI track that didn't say which (guessed from its name). */
function programFor(name: string): number {
  const n = name.toLowerCase();
  if (/bass/.test(n)) return 33;
  if (/rhodes|\bep\b|e\.? ?piano|electric piano/.test(n)) return 4;
  if (/piano|keys/.test(n)) return 0;
  if (/organ/.test(n)) return 16;
  if (/guitar|gtr/.test(n)) return /dist|lead|rock/.test(n) ? 30 : /elec|clean/.test(n) ? 27 : 25;
  if (/string|violin|cello/.test(n)) return 48;
  if (/pad/.test(n)) return 89;
  if (/choir|vox|voice/.test(n)) return 52;
  if (/brass|trumpet|horn/.test(n)) return 61;
  if (/sax/.test(n)) return 65;
  if (/flute/.test(n)) return 73;
  if (/bell|glock/.test(n)) return 9;
  if (/lead|melody|synth/.test(n)) return 81;
  return 0;
}

export function isTyping(t: EventTarget | null = document.activeElement): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement || t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'color'].includes(t.type);
  return t instanceof HTMLSelectElement;
}

/** An edit made while dragging: one undo step for the whole drag. */
export interface LiveEdit {
  update(fn: (p: Project) => void): void;
  end(): void;
  cancel(): void;
}

export class App {
  readonly root: HTMLElement;
  readonly settings = new Settings(SETTINGS);
  prefs: Prefs;
  readonly commands: Commands;
  readonly titlebar: TitleBar;
  readonly transport: Transport;
  readonly statusbar: StatusBar;
  readonly updates: Updates;
  readonly engine: AudioEngine;
  readonly recorder: InputRecorder;
  readonly keyboard: Keyboard;
  readonly layout: Layout;
  readonly history = new History<Project>(200);
  project: Project = TEMPLATES[0].make('Untitled');
  projectPath: string | null = null;
  /** The channel the piano roll and keyboards play. */
  channel: string | null = null;
  /** Selected playlist clips. */
  clips = new Set<string>();
  /**
   * The take being recorded, drawn on the armed track as it grows: where it started (ticks) and the
   * input's level along the way (tick, peak), for the current pass through the loop.
   */
  liveTake: { start: number; points: [number, number][] } | null = null;
  /** Playlist tracks armed for recording. */
  armed = new Set<string>();
  /** The mixer track shown in the effect panel. */
  mixerTrack = 'master';
  recording = false;
  private listeners = new Map<ChangeKind, Set<() => void>>();
  private home: HomeView | null = null;
  private settingsView: SettingsView | null = null;
  private systemDark = matchMedia('(prefers-color-scheme: dark)');
  private recoveryId = `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private recoveredAt = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.prefs = this.loadPrefs();
    this.history.limit = this.settings.num('files.undoSteps');
    this.engine = new AudioEngine({ project: () => this.project });
    this.engine.metronome = this.prefs.metronome;
    this.engine.recordClick = this.prefs.recordClick;
    this.engine.onStop = () => this.emit('transport', 'playhead');
    this.recorder = new InputRecorder(this.engine);
    this.recorder.offsetMs = this.prefs.latencyMs;
    this.engine.library.onChange(() => this.emit('samples'));
    this.commands = new Commands(this);
    this.keyboard = new Keyboard(this);
    this.titlebar = new TitleBar(this);
    this.transport = new Transport(this);
    this.statusbar = new StatusBar(this);
    this.updates = new Updates(this);
    this.layout = new Layout(this);
    root.append(this.titlebar.el, this.transport.el, this.layout.el, this.statusbar.el);

    for (const d of this.settings.defs) if (d.apply) d.apply(this.settings.get(d.id) as never, this);
    this.settings.onChange((id) => this.onSettingChanged(id));
    this.systemDark.addEventListener('change', () => {
      if (this.settings.str('appearance.theme') === 'system') this.applyTheme();
    });
    this.applyTheme();
    this.applyChrome();
    setFocusFallback(() => this.layout.focusMain());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keyboard.keyUp(e));
    this.setupDrop();
    platform.onRequestClose(() => {
      void this.confirmDiscard('closing').then((ok) => {
        if (ok) {
          void platform.recovery.remove(this.recoveryId);
          platform.confirmClose();
        }
      });
    });
    platform.onOpenPaths((paths) => void this.openPaths(paths));
    platform.onNewProject((o) => this.newFromOptions(o));
    window.addEventListener('beforeunload', (e) => {
      if (!isDesktop && this.history.dirty) e.preventDefault();
    });

    this.setProject(this.project, null);
    const params = new URLSearchParams(location.search);
    const file = params.get('file');
    if (file) void this.openPaths([file]);
    else if (params.get('new')) this.newFromOptions(Object.fromEntries(params));
    else if (this.settings.bool('files.restore')) this.openHome('home');
    void this.updates.startup();
    this.startAutosave();
    this.startRecovery();
    // The playhead and meters move while playing; a recording grows on its track
    const frame = () => {
      if (this.engine.playing) {
        const take = this.liveTake;
        if (take && !this.engine.countingIn) {
          const at = this.engine.position;
          const last = take.points[take.points.length - 1];
          const loop = this.engine.loopRegion;
          // Around the loop again: a new pass starts at the loop's start (the clock can also step back a
          // hair when the sound card's delay estimate changes, which isn't a new pass)
          if (last && loop && at < last[0] - (loop[1] - loop[0]) / 2) {
            take.start = loop[0];
            take.points = [];
          }
          if (!last || at >= last[0] || take.points.length === 0) take.points.push([at, this.recorder.level()]);
        }
        this.emit('playhead');
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- events ----------

  on(kind: ChangeKind, fn: () => void): () => void {
    let set = this.listeners.get(kind);
    if (!set) this.listeners.set(kind, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(...kinds: ChangeKind[]): void {
    for (const k of kinds) for (const fn of this.listeners.get(k) ?? []) fn();
  }

  // ---------- state ----------

  get pattern() {
    return activePattern(this.project);
  }

  get bar(): number {
    return barTicks(this.project);
  }

  private loadPrefs(): Prefs {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
      return { ...DEFAULT_PREFS, ...raw, tabs: { ...raw.tabs }, splits: { ...raw.splits }, recentCommands: [...(raw.recentCommands ?? [])] };
    } catch {
      return { ...DEFAULT_PREFS, tabs: {}, splits: {}, recentCommands: [] };
    }
  }

  savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // storage unavailable
    }
  }

  error(err: unknown): void {
    console.error(err);
    toast(String((err as Error)?.message ?? err), { kind: 'error' });
  }

  // ---------- editing ----------

  /** Makes an undoable change. Returning false from `fn` means nothing changed. */
  edit(label: string, fn: (p: Project) => unknown): boolean {
    const before = structuredClone(this.project);
    let r: unknown;
    try {
      r = fn(this.project);
    } catch (err) {
      this.project = before;
      this.error(err);
      this.changed();
      return false;
    }
    if (r === false) {
      this.project = before;
      return false;
    }
    this.history.record(label, before);
    this.changed();
    return true;
  }

  /** A change made bit by bit while dragging (a knob, a note): one undo step when it ends. */
  liveEdit(label: string): LiveEdit {
    const before = structuredClone(this.project);
    let changed = false;
    let done = false;
    return {
      update: (fn) => {
        if (done) return;
        fn(this.project);
        changed = true;
        this.changed(true);
      },
      end: () => {
        if (done) return;
        done = true;
        if (changed) {
          this.history.record(label, before);
          this.changed();
        }
      },
      cancel: () => {
        if (done) return;
        done = true;
        if (changed) {
          this.project = before;
          this.changed();
        }
      },
    };
  }

  /** The project changed: the sound and everything on screen catch up. */
  changed(live = false): void {
    const p = this.project;
    this.engine.sync();
    this.engine.refreshLoop();
    if (live) {
      this.emit('live');
      return;
    }
    if (this.channel && !channelById(p, this.channel)) this.channel = p.channels[0]?.id ?? null;
    for (const id of [...this.clips]) if (!p.tracks.some((t) => t.clips.some((c) => c.id === id))) this.clips.delete(id);
    for (const id of [...this.armed]) if (!p.tracks.some((t) => t.id === id)) this.armed.delete(id);
    if (!p.mixer.some((m) => m.id === this.mixerTrack)) this.mixerTrack = 'master';
    this.emit('project', 'history');
    platform.setDirty(this.history.dirty);
    this.titlebar.refresh();
    this.commands.refresh();
  }

  /** For knobs and sliders: the sound follows while turning, and letting go makes one undo step. */
  turning(label: string, apply: (p: Project, v: number) => void): { onInput(v: number): void; onChange(v: number): void } {
    let session: LiveEdit | null = null;
    return {
      onInput: (v) => {
        session ??= this.liveEdit(label);
        session.update((p) => apply(p, v));
      },
      onChange: (v) => {
        session ??= this.liveEdit(label);
        session.update((p) => apply(p, v));
        session.end();
        session = null;
      },
    };
  }

  undo(): void {
    const prev = this.history.undo(this.project);
    if (!prev) return;
    this.project = prev;
    this.changed();
    this.statusbar.flash(`Undid ${this.history.redoLabel ?? 'the last change'}`);
  }

  redo(): void {
    const next = this.history.redo(this.project);
    if (!next) return;
    this.project = next;
    this.changed();
    this.statusbar.flash(`Redid ${this.history.undoLabel ?? 'the change'}`);
  }

  goToStep(n: number): void {
    while (this.history.undoCount > n && this.history.canUndo) this.undo();
    while (this.history.undoCount < n && this.history.canRedo) this.redo();
  }

  // ---------- selection ----------

  selectChannel(id: string | null): void {
    if (this.channel === id) return;
    this.channel = id;
    this.emit('channel');
    this.commands.refresh();
  }

  selectPattern(id: string): void {
    if (this.project.activePattern === id) return;
    // Not an undo step: just which pattern is being worked on
    this.project.activePattern = id;
    this.engine.refreshLoop();
    this.emit('pattern', 'project');
    this.commands.refresh();
  }

  selectClips(ids: string[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') this.clips = new Set(ids);
    else for (const id of ids) {
      if (mode === 'toggle' && this.clips.has(id)) this.clips.delete(id);
      else this.clips.add(id);
    }
    this.emit('selection');
    this.commands.refresh();
  }

  selectMixer(id: string): void {
    this.mixerTrack = id;
    this.emit('selection');
  }

  // ---------- transport ----------

  get mode(): PlayMode {
    return this.engine.mode;
  }

  setMode(m: PlayMode): void {
    if (this.engine.mode === m) return;
    const playing = this.engine.playing;
    if (playing) this.engine.stop();
    this.engine.mode = m;
    this.engine.seek(0);
    if (playing) void this.engine.play(m, 0);
    this.emit('transport', 'playhead');
  }

  togglePlay(): void {
    if (this.recording) {
      void this.stopRecording();
      return;
    }
    if (this.engine.playing) this.stop();
    else void this.play();
  }

  async play(from?: number): Promise<void> {
    platform.keepAwake(true);
    await this.engine.play(this.engine.mode, from ?? this.engine.position);
    this.emit('transport');
  }

  stop(): void {
    if (this.recording) {
      void this.stopRecording();
      return;
    }
    if (!this.engine.playing) {
      // Stop twice: back to the start
      this.engine.seek(0);
    } else this.engine.stop();
    platform.keepAwake(false);
    this.emit('transport', 'playhead');
  }

  seek(tick: number): void {
    this.engine.seek(tick);
    this.emit('playhead');
  }

  setMetronome(on: boolean): void {
    this.engine.metronome = on;
    this.prefs.metronome = on;
    this.savePrefs();
    this.emit('transport');
  }

  /** Whether the metronome clicks through recordings. */
  setRecordClick(on: boolean): void {
    this.engine.recordClick = on;
    this.prefs.recordClick = on;
    this.savePrefs();
    this.emit('transport');
  }

  // ---------- recording ----------

  /** Opens the chosen input if it isn't already. */
  async openInput(): Promise<boolean> {
    if (this.recorder.open) return true;
    try {
      await this.recorder.openInput(this.prefs.inputDevice, this.prefs.inputChannel);
      this.updateMonitoring();
      this.emit('transport');
      return true;
    } catch (err) {
      toast(`The input couldn't be opened: ${(err as Error).message}. Check that your audio interface or microphone is plugged in, and Windows' microphone privacy settings.`, { kind: 'error', ms: 12000 });
      return false;
    }
  }

  /** Hear the input through the first armed track's effects (an amp, a reverb) while monitoring is on. */
  updateMonitoring(): void {
    const track = this.project.tracks.find((t) => this.armed.has(t.id));
    this.recorder.monitor(this.prefs.monitor && track && this.recorder.open ? this.engine.graph.mixerInput(track.mixer) : null);
  }

  async toggleArm(trackId: string): Promise<void> {
    if (this.armed.has(trackId)) this.armed.delete(trackId);
    else {
      // One track records at a time (simplest to follow)
      this.armed = new Set([trackId]);
      if (!(await this.openInput())) {
        this.armed.clear();
        this.emit('transport', 'project');
        return;
      }
    }
    this.updateMonitoring();
    this.emit('transport', 'project');
  }

  /** Record: sound on the armed track (from the playhead, with the count-in), or notes into the pattern. */
  async record(): Promise<void> {
    if (this.recording) return this.stopRecording();
    if (this.engine.playing) this.engine.stop();
    const track = this.project.tracks.find((t) => this.armed.has(t.id));
    if (!track) {
      // No armed track: notes played on a keyboard go into the pattern
      this.keyboard.recordNotes = true;
      this.recording = true;
      this.engine.recording = true;
      if (this.engine.mode !== 'pattern') this.setMode('pattern');
      await this.engine.play('pattern', this.engine.position, this.prefs.countIn);
      this.emit('transport');
      toast('Recording notes into the pattern: play your MIDI keyboard or the computer keyboard (Ctrl+T turns it on). Press Space to stop.', { ms: 7000 });
      return;
    }
    if (!(await this.openInput())) return;
    if (this.engine.mode !== 'song') this.setMode('song');
    try {
      await this.recorder.start();
    } catch (err) {
      this.error(err);
      return;
    }
    this.recording = true;
    this.engine.recording = true;
    platform.keepAwake(true);
    const from = this.engine.position;
    this.liveTake = { start: from, points: [] };
    await this.engine.play('song', from, this.prefs.countIn);
    this.emit('transport');
  }

  async stopRecording(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    this.engine.recording = false;
    this.liveTake = null;
    if (this.keyboard.recordNotes) {
      this.keyboard.recordNotes = false;
      this.engine.stop();
      this.emit('transport', 'playhead');
      return;
    }
    const take = await this.recorder.stop();
    this.engine.stop();
    platform.keepAwake(false);
    this.emit('transport', 'playhead');
    const track = this.project.tracks.find((t) => this.armed.has(t.id));
    if (!take || !track) {
      toast('Nothing was recorded.');
      return;
    }
    const secs = take.channels[0].length / take.sampleRate;
    const segments = this.engine.takeSegments(take.startTime, secs);
    if (!segments.length) {
      toast('The recording ended during the count-in, so there was nothing to keep.');
      return;
    }
    const n = this.project.samples.filter((s) => s.recorded).length + 1;
    const name = `${this.project.name} - ${track.name} ${n}`;
    const wav = encodeWav({ sampleRate: take.sampleRate, channels: take.channels }, 24);
    const info = await platform.saveRecording(wav, name, this.projectPath);
    if (!info) {
      toast("The recording couldn't be saved.", { kind: 'error' });
      return;
    }
    const sample: Sample = { id: uid('s'), name: info.name.replace(/\.wav$/i, ''), path: info.path, duration: secs, channels: take.channels.length, sampleRate: take.sampleRate, recorded: true, size: info.size, modified: info.modified };
    const buffer = new AudioBuffer({ length: take.channels[0].length, numberOfChannels: take.channels.length, sampleRate: take.sampleRate });
    take.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    this.engine.library.put(sample.id, buffer);
    const ids: string[] = [];
    this.edit(segments.length > 1 ? `Record ${segments.length} takes` : 'Record', (p) => {
      p.samples.push(sample);
      const t = p.tracks.find((x) => x.id === track.id)!;
      // Loop recording: every pass is a take; the last one plays, the others are kept muted
      segments.forEach((seg, i) => {
        const c = audioClip(sample.id, Math.round(seg.tick), Math.max(1, Math.round(seg.length)), seg.offset);
        if (segments.length > 1) {
          c.take = i + 1;
          c.muted = i < segments.length - 1;
        }
        addClip(t, c);
        ids.push(c.id);
      });
    });
    this.selectClips(ids);
    toast(segments.length > 1 ? `Recorded ${segments.length} takes. The last one plays; right-click a muted take to use it instead.` : `Recorded ${secs.toFixed(1)} seconds on ${track.name}.`, { kind: 'success', action: isDesktop ? { label: 'Show file', run: () => platform.showInFolder(info.path) } : undefined });
  }

  // ---------- adding sounds ----------

  /** Imports audio files into the project (reusing ones already there). */
  async importAudio(infos?: MediaFileInfo[]): Promise<Sample[]> {
    infos ??= await platform.importDialog();
    const out: Sample[] = [];
    const fresh: Sample[] = [];
    for (const f of infos) {
      if (/\.(mid|midi)$/i.test(f.name)) continue;
      const have = this.project.samples.find((s) => s.path.toLowerCase() === f.path.toLowerCase());
      if (have) {
        out.push(have);
        continue;
      }
      const s: Sample = { id: uid('s'), name: f.name.replace(/\.[^.]+$/, ''), path: f.path, duration: 0, channels: 2, sampleRate: 48000, size: f.size, modified: f.modified };
      const b = await this.engine.library.load({ sampleId: s.id }, { ...this.project, samples: [...this.project.samples, s] });
      if (!b) {
        toast(`Couldn't read ${f.name}. Beatline reads WAV, MP3, FLAC, OGG, M4A and AIFF.`, { kind: 'error' });
        continue;
      }
      s.duration = b.duration;
      s.channels = b.numberOfChannels;
      s.sampleRate = b.sampleRate;
      fresh.push(s);
      out.push(s);
    }
    if (fresh.length) this.edit(fresh.length === 1 ? `Import ${fresh[0].name}` : `Import ${fresh.length} files`, (p) => void p.samples.push(...fresh));
    return out;
  }

  /** Puts an audio file on the playlist (on a track, or the first empty one) at a tick. */
  placeAudio(s: Sample, at: number, trackId?: string): void {
    this.edit(`Add ${s.name}`, (p) => {
      let t = trackId ? p.tracks.find((x) => x.id === trackId) : undefined;
      t ??= p.tracks.find((x) => x.mixer !== 'master' && !x.clips.length) ?? addAudioTrack(p, s.name.slice(0, 24));
      const c = addClip(t, audioClip(s.id, Math.max(0, at), audioTicks(p, s.duration)));
      this.clips = new Set([c.id]);
    });
  }

  /** A sampler channel playing a file (a one-shot, or pitched like an instrument). */
  addSampleChannel(s: Sample): void {
    this.edit(`Add ${s.name} to the channel rack`, (p) => {
      const ch = addChannel(p, { name: s.name.slice(0, 24), kind: 'sampler', sampler: { sample: { sampleId: s.id }, root: 60, tune: 0, pitched: s.duration > 1.5, attack: 0, release: 0.08, gain: 0, reverse: false, start: 0, choke: 0 } });
      this.channel = ch.id;
    });
    this.emit('channel');
  }

  /** Puts the active pattern on the playlist at a tick (on a track). */
  placePattern(patternId: string, at: number, trackIndex: number): void {
    const pt = this.project.patterns.find((x) => x.id === patternId);
    if (!pt) return;
    this.edit(`Add ${pt.name}`, (p) => {
      const t = p.tracks[Math.max(0, Math.min(p.tracks.length - 1, trackIndex))];
      const c = addClip(t, patternClip(pt, Math.max(0, at), barTicks(p)));
      this.clips = new Set([c.id]);
    });
  }

  newPattern(): void {
    let id = '';
    this.edit('New pattern', (p) => {
      const pt = newPattern(`Pattern ${p.patterns.length + 1}`, nextColor(p.patterns.length + 6));
      p.patterns.push(pt);
      id = pt.id;
    });
    this.selectPattern(id);
  }

  /** Imports a MIDI file: each of its tracks becomes a channel's notes in a new pattern. */
  async importMidi(data?: Uint8Array, name = 'MIDI'): Promise<void> {
    if (!data) {
      const f = await platform.openMidiDialog();
      if (!f) return;
      data = f.data;
      name = f.name;
    }
    let file;
    try {
      file = readMidi(data);
    } catch (err) {
      this.error(err);
      return;
    }
    if (!file.tracks.length) {
      toast('That MIDI file has no notes.');
      return;
    }
    let id = '';
    this.edit(`Import ${name}`, (p) => {
      const pt = newPattern(name.replace(/\.(mid|midi)$/i, '').slice(0, 30), nextColor(p.patterns.length + 6));
      // Each track plays its own instrument from the library (drums on a drum kit)
      for (const t of file.tracks) {
        const ch = t.drums
          ? addChannel(p, { name: t.name.slice(0, 24), kind: 'instrument', instrument: { ...instrumentParams(0), bank: 128 }, preset: 'gm:drums' })
          : instrumentChannel(p, t.program ?? programFor(t.name), t.name.slice(0, 24));
        pt.notes[ch.id] = t.notes;
      }
      pt.length = Math.ceil(patternEnd(pt) / barTicks(p)) * barTicks(p);
      if (file.bpm && p.channels.length === file.tracks.length) p.bpm = Math.round(file.bpm);
      p.patterns.push(pt);
      id = pt.id;
    });
    this.selectPattern(id);
    toast(`Imported ${file.tracks.length} track${file.tracks.length === 1 ? '' : 's'} from ${name} as a new pattern.`, { kind: 'success' });
  }

  // ---------- projects ----------

  /** Starts a new project from a template (nothing is asked; callers check for unsaved work first). */
  newProject(template = 'empty', name = 'Untitled', bpm?: number): void {
    this.engine.stop();
    const t = templateById(template) ?? TEMPLATES[0];
    const p = t.make(name);
    if (bpm && bpm >= 20 && bpm <= 400) p.bpm = bpm;
    this.setProject(p, null);
  }

  /** A new project asked for from outside (Baseline): { new, template?, name?, bpm? }. */
  newFromOptions(o: Record<string, string>): void {
    if (!o.new) return;
    void this.confirmDiscard().then((ok) => {
      if (!ok) return;
      this.newProject(o.template || 'empty', o.name?.trim() || 'Untitled', Number(o.bpm) || undefined);
      this.closeHome();
    });
  }

  private setProject(p: Project, path: string | null): void {
    this.engine.stop();
    this.project = p;
    this.projectPath = path;
    this.channel = p.channels[0]?.id ?? null;
    this.clips.clear();
    this.armed.clear();
    this.mixerTrack = 'master';
    this.history.clear();
    this.history.markSaved();
    this.recoveredAt = -1;
    this.engine.sync();
    this.engine.seek(0);
    // Sounds load in the background so the first notes are ready
    void this.engine.library.loadAll(p);
    this.emit('project', 'pattern', 'channel', 'history', 'selection', 'playhead', 'transport', 'samples');
    this.titlebar.refresh();
    this.commands.refresh();
    platform.setDirty(false);
    void this.checkSamples();
  }

  /** Notes audio files that aren't where the project says (finding ones that moved with the project). */
  private movedCandidates = new Map<string, string>();

  async checkSamples(): Promise<void> {
    const p = this.project;
    if (!isDesktop || !p.samples.length) return;
    let found = await platform.checkMedia(p.samples.map((s) => s.path));
    const moved = p.samples.filter((s) => !found[s.path] && this.movedCandidates.has(s.id));
    if (moved.length) {
      const there = await platform.checkMedia(moved.map((s) => this.movedCandidates.get(s.id)!));
      for (const s of moved) {
        const c = this.movedCandidates.get(s.id)!;
        if (there[c]) {
          s.path = c;
          this.engine.library.forget(s.id);
        }
      }
      found = await platform.checkMedia(p.samples.map((s) => s.path));
    }
    const missing = p.samples.filter((s) => !found[s.path]);
    for (const s of missing) this.engine.library.missing.add(s.id);
    this.emit('samples');
    if (missing.length) toast(`${missing.length} audio file${missing.length === 1 ? ' is' : 's are'} missing. Find ${missing.length === 1 ? 'it' : 'them'} in the Browser's Project tab (right-click → Locate).`, { kind: 'error', ms: 9000 });
  }

  /** Points a missing sample at its new place. */
  async relink(sampleId: string): Promise<void> {
    const s = this.project.samples.find((x) => x.id === sampleId);
    if (!s) return;
    const f = await platform.relinkDialog(s.name);
    if (!f) return;
    this.edit(`Locate ${s.name}`, (p) => {
      const x = p.samples.find((y) => y.id === sampleId)!;
      x.path = f.path;
    });
    this.engine.library.forget(sampleId);
    void this.engine.library.loadAll(this.project);
  }

  saveBeforeQuit(): Promise<boolean> {
    return this.confirmDiscard('closing');
  }

  /** Asks to save unsaved work. Returns false when the user cancels. */
  async confirmDiscard(why: 'closing' | 'other' = 'other'): Promise<boolean> {
    if (!this.history.dirty || !this.history.undoCount) return true;
    const choice = await dialog<'save' | 'discard' | 'cancel'>(
      'Save changes?',
      `Do you want to save the changes to "${this.project.name}"${why === 'closing' ? ' before closing' : ''}?`,
      [
        { label: 'Save', value: 'save', primary: true },
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
      ],
      { cancelValue: 'cancel' },
    );
    if (choice === 'cancel') return false;
    if (choice === 'save') return this.save();
    return true;
  }

  async openDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const f = await platform.openProjectDialog();
    if (f) this.loadProject(f.text, f.path);
  }

  /** Files from Explorer or a drop: a project opens; audio is imported; MIDI becomes a pattern. */
  async openPaths(paths: string[]): Promise<void> {
    const project = paths.find((p) => /\.beatline$/i.test(p));
    if (project) {
      if (!(await this.confirmDiscard())) return;
      try {
        const f = await platform.openProject(project);
        if (f) this.loadProject(f.text, f.path);
      } catch (err) {
        this.error(err);
      }
    }
    for (const m of paths.filter((p) => /\.(mid|midi)$/i.test(p))) {
      const data = await platform.readMidi(m);
      if (data) await this.importMidi(data, m.split(/[\\/]/).pop());
    }
    const audio = paths.filter((p) => !/\.(beatline|mid|midi)$/i.test(p));
    if (audio.length) {
      this.closeHome();
      const list = Object.values(await platform.checkMedia(audio)).filter((x): x is MediaFileInfo => !!x);
      const samples = await this.importAudio(list);
      let at = this.engine.position;
      for (const s of samples) {
        this.placeAudio(s, this.engine.mode === 'song' ? at : 0);
        at += audioTicks(this.project, s.duration);
      }
    }
  }

  async openRecent(path: string): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const f = await platform.openProject(path);
      if (f) this.loadProject(f.text, f.path);
    } catch (err) {
      this.error(err);
      void platform.removeRecentFile(path);
    }
  }

  loadProject(text: string, path: string | null): void {
    try {
      const p = readProject(text);
      const rel = (JSON.parse(text) as { relative?: Record<string, string> }).relative ?? {};
      const dir = path?.replace(/[\\/][^\\/]*$/, '');
      this.movedCandidates = new Map(dir ? Object.entries(rel).map(([id, r]) => [id, `${dir}\\${r}`]) : []);
      this.setProject(p, path);
      this.closeHome();
      // A song opens in song mode, a beat with nothing in the playlist in pattern mode
      this.setMode(songEnd(p) > 0 ? 'song' : 'pattern');
      this.statusbar.flash(`Opened ${p.name}`);
    } catch (err) {
      this.error(err);
    }
  }

  private relativePaths(projectPath: string): Record<string, string> {
    const dir = projectPath.replace(/[\\/][^\\/]*$/, '').toLowerCase();
    const out: Record<string, string> = {};
    for (const s of this.project.samples) {
      if (s.path.toLowerCase().startsWith(dir + '\\') || s.path.toLowerCase().startsWith(dir + '/')) out[s.id] = s.path.slice(dir.length + 1);
    }
    return out;
  }

  async save(): Promise<boolean> {
    if (!this.projectPath) return this.saveAs();
    return this.writeTo(this.projectPath);
  }

  async saveAs(): Promise<boolean> {
    const path = await platform.saveProjectDialog(`${this.project.name || 'Untitled'}.beatline`);
    if (!path) return false;
    return this.writeTo(path);
  }

  private async writeTo(path: string, quiet = false): Promise<boolean> {
    const p = this.project;
    p.name = path.split(/[\\/]/).pop()!.replace(/\.beatline$/i, '') || p.name;
    const res = await platform.saveProject(path, writeProject(p, this.relativePaths(path)));
    if (!res.ok) {
      toast(res.error ?? "Couldn't save the project.", { kind: 'error' });
      return false;
    }
    this.projectPath = path;
    this.history.markSaved();
    platform.setDirty(false);
    void platform.recovery.remove(this.recoveryId);
    this.titlebar.refresh();
    this.emit('history');
    if (!quiet) this.statusbar.flash(`Saved ${p.name}`);
    return true;
  }

  // ---------- automatic saving and recovery ----------

  private autosaveTimer: number | undefined;
  private recoveryTimer: number | undefined;

  startAutosave(): void {
    clearInterval(this.autosaveTimer);
    const minutes = this.settings.num('files.autosaveMinutes');
    if (!isDesktop || !minutes) return;
    this.autosaveTimer = window.setInterval(() => {
      if (this.projectPath && this.history.dirty && !this.recording) void this.writeTo(this.projectPath, true).then((ok) => ok && this.statusbar.flash('Saved automatically'));
    }, minutes * 60_000);
  }

  startRecovery(): void {
    clearInterval(this.recoveryTimer);
    const minutes = this.settings.num('files.recoveryMinutes');
    if (!isDesktop || !minutes) return;
    this.recoveryTimer = window.setInterval(() => {
      const p = this.project;
      if (!this.history.dirty || this.recoveredAt === this.history.current) return;
      this.recoveredAt = this.history.current;
      void platform.recovery.save(this.recoveryId, writeProject(p), { name: p.name, filePath: this.projectPath });
    }, minutes * 60_000);
  }

  async restoreRecovered(id: string, name: string, filePath: string | null): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const text = await platform.recovery.read(id);
    if (!text) {
      toast("That copy couldn't be read.", { kind: 'error' });
      return;
    }
    this.loadProject(text, filePath);
    this.history.markUnsaved();
    platform.setDirty(true);
    this.titlebar.refresh();
    await platform.recovery.remove(id);
    toast(`Recovered "${name}". Save it to keep it.`, { kind: 'success' });
  }

  // ---------- start page and settings ----------

  get homeOpen(): boolean {
    return !!this.home;
  }

  openHome(section: HomeSection = 'home'): void {
    closePopovers();
    if (this.home) {
      this.home.show(section);
      return;
    }
    this.home = new HomeView(this, section, () => {
      this.home = null;
      this.layout.focusMain();
    });
    document.body.append(this.home.el);
  }

  closeHome(): void {
    this.home?.close();
  }

  openSettings(section?: string): void {
    closePopovers();
    if (this.settingsView) {
      this.settingsView.show(section);
      return;
    }
    this.settingsView = new SettingsView(this, section, () => {
      this.settingsView = null;
    });
    document.body.append(this.settingsView.el);
  }

  // ---------- theme ----------

  get isDark(): boolean {
    const t = this.settings.str('appearance.theme');
    return t === 'system' ? this.systemDark.matches : t === 'dark';
  }

  applyTheme(): void {
    const root = document.documentElement;
    const dark = this.isDark;
    root.dataset.theme = dark ? 'dark' : 'light';
    const pair = ACCENTS[this.settings.str('appearance.accent')] ?? ACCENTS.teal;
    const a = dark ? pair[0] : pair[1];
    const [r, g, b] = hexToRgb(a);
    const vars: Record<string, string> = {
      '--accent': a,
      '--accent-strong': shade(a, dark ? -0.15 : -0.2),
      '--accent-soft': `rgba(${r}, ${g}, ${b}, ${dark ? 0.16 : 0.12})`,
      '--accent-text': dark ? '#04201c' : '#ffffff',
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    platform.setTheme({ dark, bar: dark ? '#16181d' : '#f6f7f9', symbol: dark ? '#c9ced8' : '#3c4350' });
    this.titlebar.refresh();
    this.emit('settings');
  }

  applyChrome(): void {
    const s = this.settings;
    const root = document.documentElement;
    root.classList.toggle('is-desktop', isDesktop);
    root.classList.toggle('reduce-motion', s.bool('appearance.reduceMotion'));
    this.statusbar.el.hidden = !s.bool('appearance.showStatusBar');
  }

  private onSettingChanged(id: string): void {
    const d = this.settings.byId.get(id);
    if (!d) return;
    d.apply?.(this.settings.get(id) as never, this);
    const r = new Set<Refresh>(d.refresh ?? []);
    if (r.has('theme')) this.applyTheme();
    if (r.has('chrome')) this.applyChrome();
    if (r.has('titlebar')) this.titlebar.rebuild();
    this.emit('settings');
  }

  // ---------- keyboard and dropping files ----------

  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (document.querySelector('.modal-backdrop') || this.settingsView) return;
    if (isTyping(e.target)) {
      const c = this.commands.match(e);
      if (c?.global) {
        e.preventDefault();
        this.commands.run(c.id);
      }
      return;
    }
    if (this.home) {
      const c = this.commands.match(e);
      if (c && (c.category === 'File' || c.global)) {
        e.preventDefault();
        this.commands.run(c.id);
      }
      return;
    }
    if (document.querySelector('.popover')) return;
    // The computer keyboard as a piano takes letter keys (without Ctrl or Alt)
    if (this.keyboard.keyDown(e)) {
      e.preventDefault();
      return;
    }
    const c = this.commands.match(e);
    if (c) {
      e.preventDefault();
      this.commands.run(c.id);
      return;
    }
    if (eventKey(e) === 'Alt') e.preventDefault();
  }

  private setupDrop(): void {
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('drop', (e) => {
      // Drops on the playlist or channel rack place the sound there; anywhere else imports it
      if (!e.dataTransfer?.files.length || e.defaultPrevented) return;
      e.preventDefault();
      void this.dropFiles([...e.dataTransfer.files]);
    });
  }

  async dropFiles(files: File[], at?: { tick: number; track?: string }): Promise<Sample[]> {
    const project = files.find((f) => /\.beatline$/i.test(f.name));
    if (project) {
      const [info] = await platform.droppedFiles([project]);
      if (info) await this.openPaths([info.path]);
      else if (!isDesktop) this.loadProject(await project.text(), null);
      return [];
    }
    const infos = await platform.droppedFiles(files.filter((f) => !/\.beatline$/i.test(f.name)));
    this.closeHome();
    for (const m of infos.filter((i) => /\.(mid|midi)$/i.test(i.name))) {
      const data = await platform.readMidi(m.path);
      if (data) await this.importMidi(data, m.name);
    }
    const samples = await this.importAudio(infos.filter((i) => !/\.(mid|midi)$/i.test(i.name)));
    if (at) {
      let t = at.tick;
      for (const s of samples) {
        this.placeAudio(s, t, at.track);
        t += audioTicks(this.project, s.duration);
      }
    }
    return samples;
  }
}
