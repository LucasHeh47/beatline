// Every action in the app, with keyboard shortcuts (FL Studio's, where it has one). The menus, the
// command search and the keyboard all use these.
import * as L from 'lucide';
import type { IconNode } from 'lucide';
import { deletePattern, nextPatternName } from '../core/arrange';
import { DRUM_PATTERNS } from '../core/drumPatterns';
import { DRUM_SOUNDS, GM_INSTRUMENTS, SYNTH_PRESETS } from '../core/instruments';
import { writeMidi } from '../core/midi';
import { addAudioTrack, barTicks, nextColor, secondsToTicks, songEnd, uid } from '../core/project';
import { applyDrumPattern, drumChannel, instrumentChannel, synthChannel } from '../core/templates';
import type { App } from './app';
import { openExport } from './dialogs/export';
import { openProgression } from './dialogs/progression';
import { showAbout, showShortcuts } from './help';
import { WORKSPACES } from './layout';
import { openPalette } from './palette';
import { isDesktop, platform } from './platform';
import { promptDialog, toast } from './widgets';

export interface Command {
  id: string;
  title: string;
  category: string;
  keys?: string[];
  icon?: IconNode;
  keywords?: string;
  /** Runs even when focus is in a text field. */
  global?: boolean;
  /** Left out of menus and search (shortcut only). */
  hidden?: boolean;
  run: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const CODE_KEYS: Record<string, string> = {
  Semicolon: ';',
  Equal: '=',
  Minus: '-',
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Quote: "'",
  NumpadAdd: '=',
  NumpadSubtract: '-',
  Space: 'Space',
};

/** Turns a keyboard event into a string like "Ctrl+Shift+K". */
export function eventKey(e: KeyboardEvent): string {
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key.replace(/^Arrow/, '');
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export class Commands {
  private list: Command[] = [];
  private byId = new Map<string, Command>();
  private byKey = new Map<string, Command>();
  private listeners = new Set<() => void>();

  constructor(private app: App) {
    this.register();
  }

  all(): Command[] {
    return this.list.filter((c) => !c.hidden);
  }

  get(id: string): Command | undefined {
    return this.byId.get(id);
  }

  match(e: KeyboardEvent): Command | undefined {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return undefined;
    return this.byKey.get(eventKey(e));
  }

  isEnabled(c: Command): boolean {
    return !c.enabled || c.enabled();
  }

  run(id: string): void {
    const c = this.byId.get(id);
    if (!c || !this.isEnabled(c)) return;
    if (this.app.settings.bool('keyboard.remember') && !c.hidden) {
      const recent = this.app.prefs.recentCommands.filter((x) => x !== id);
      recent.unshift(id);
      this.app.prefs.recentCommands = recent.slice(0, 8);
      this.app.savePrefs();
    }
    try {
      const r = c.run();
      if (r instanceof Promise) r.catch((err: Error) => this.app.error(err));
    } catch (err) {
      this.app.error(err);
    }
  }

  /** Enabled states may have changed (selection, history). */
  refresh(): void {
    for (const l of this.listeners) l();
  }

  onRefresh(fn: () => void): void {
    this.listeners.add(fn);
  }

  private add(c: Command): void {
    this.list.push(c);
    this.byId.set(c.id, c);
    for (const k of c.keys ?? []) this.byKey.set(k, c);
  }

  private register(): void {
    const app = this.app;
    const a = (c: Command) => this.add(c);
    const p = () => app.project;
    const roll = () => app.layout.pianoRoll;
    const list = () => app.layout.playlist;
    const inRoll = () => app.layout.lastPanel === 'pianoRoll';

    // ---------- File ----------
    a({ id: 'file.new', title: 'New project…', category: 'File', icon: L.FilePlus, keys: ['Ctrl+N'], global: true, run: () => app.openHome('new') });
    a({ id: 'file.open', title: 'Open project…', category: 'File', icon: L.FolderOpen, keys: ['Ctrl+O'], global: true, run: () => app.openDialog() });
    a({ id: 'file.home', title: 'Start page', category: 'File', icon: L.House, run: () => app.openHome('home') });
    a({ id: 'file.save', title: 'Save', category: 'File', icon: L.Save, keys: ['Ctrl+S'], global: true, run: () => app.save() });
    a({ id: 'file.saveAs', title: 'Save as…', category: 'File', icon: L.SaveAll, keys: ['Ctrl+Shift+S'], global: true, run: () => app.saveAs() });
    a({ id: 'file.import', title: 'Import audio…', category: 'File', icon: L.FileAudio, keys: ['Ctrl+I'], keywords: 'sample loop wav mp3 add sound', run: async () => {
      const samples = await app.importAudio();
      let at = app.mode === 'song' ? app.engine.position : 0;
      for (const s of samples) {
        app.placeAudio(s, at);
        at += Math.round(secondsToTicks(s.duration, p().bpm));
      }
      if (samples.length && app.mode !== 'song') app.setMode('song');
    } });
    a({ id: 'file.importMidi', title: 'Import MIDI…', category: 'File', icon: L.FileMusic, keywords: 'mid notes', run: () => app.importMidi() });
    a({ id: 'file.exportMidi', title: 'Export pattern as MIDI…', category: 'File', icon: L.FileMusic, keywords: 'mid notes', run: async () => {
      const pt = app.pattern;
      const tracks = p()
        .channels.map((c) => ({ name: c.name, notes: pt.notes[c.id] ?? [], program: c.kind === 'instrument' && c.instrument?.bank !== 128 ? c.instrument?.program : undefined, drums: c.kind === 'instrument' && c.instrument?.bank === 128 }))
        .filter((t) => t.notes.length);
      if (!tracks.length) return toast('The pattern has no notes to export.');
      const path = await platform.saveDialog(`${pt.name}.mid`, 'mid');
      if (!path) return;
      const res = await platform.saveFile(path, writeMidi(tracks, p().bpm, p().beatsPerBar, p().beatUnit));
      if (res.ok) toast(`Exported ${pt.name} as MIDI.`, { kind: 'success', action: isDesktop ? { label: 'Show in folder', run: () => platform.showInFolder(path) } : undefined });
      else toast(res.error ?? "Couldn't save it.", { kind: 'error' });
    } });
    a({ id: 'file.export', title: 'Export song…', category: 'File', icon: L.Upload, keys: ['Ctrl+R'], keywords: 'render mp3 wav mixdown bounce', run: () => openExport(app, 'mix') });
    a({ id: 'file.exportStems', title: 'Export stems…', category: 'File', icon: L.Layers, keywords: 'tracks separate multitrack', run: () => openExport(app, 'stems') });
    a({ id: 'file.showInFolder', title: 'Show project in folder', category: 'File', icon: L.FolderSearch, enabled: () => !!app.projectPath && isDesktop, run: () => platform.showInFolder(app.projectPath!) });
    a({ id: 'file.newWindow', title: 'New window', category: 'File', icon: L.AppWindow, keys: ['Ctrl+Shift+N'], run: () => platform.newWindow() });
    a({ id: 'app.settings', title: 'Settings', category: 'File', icon: L.Settings, keys: ['Ctrl+,'], global: true, run: () => app.openSettings() });

    // ---------- Edit ----------
    a({ id: 'edit.undo', title: 'Undo', category: 'Edit', icon: L.Undo2, keys: ['Ctrl+Z'], enabled: () => app.history.canUndo, run: () => app.undo() });
    a({ id: 'edit.redo', title: 'Redo', category: 'Edit', icon: L.Redo2, keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], enabled: () => app.history.canRedo, run: () => app.redo() });
    a({ id: 'edit.cut', title: 'Cut', category: 'Edit', icon: L.Scissors, keys: ['Ctrl+X'], run: () => (inRoll() ? roll().copy(true) : list().copy(true)) });
    a({ id: 'edit.copy', title: 'Copy', category: 'Edit', icon: L.Copy, keys: ['Ctrl+C'], run: () => (inRoll() ? roll().copy() : list().copy()) });
    a({ id: 'edit.paste', title: 'Paste', category: 'Edit', icon: L.ClipboardPaste, keys: ['Ctrl+V'], run: () => (inRoll() ? roll().paste() : list().paste()) });
    a({ id: 'edit.delete', title: 'Delete', category: 'Edit', icon: L.Trash2, keys: ['Delete'], run: () => (inRoll() ? roll().deleteSelected() : list().deleteSelected()) });
    a({ id: 'edit.duplicate', title: 'Duplicate', category: 'Edit', icon: L.CopyPlus, keys: ['Ctrl+B'], keywords: 'repeat copy after', run: () => (inRoll() ? roll().duplicate() : list().duplicate()) });
    a({ id: 'edit.selectAll', title: 'Select all', category: 'Edit', keys: ['Ctrl+A'], run: () => (inRoll() ? roll().selectAll() : list().selectAll()) });
    a({ id: 'edit.deselect', title: 'Deselect all', category: 'Edit', keys: ['Escape'], run: () => {
      roll().deselect();
      app.selectClips([]);
    } });

    // ---------- Add ----------
    a({ id: 'add.audioTrack', title: 'Add audio track (for recording)', category: 'Add', icon: L.Mic, keywords: 'record guitar vocals track', run: () => app.edit('Add audio track', (x) => void addAudioTrack(x, `Audio ${x.tracks.filter((t) => t.mixer !== 'master').length + 1}`, 0)) });
    for (const d of DRUM_SOUNDS)
      a({ id: `add.drum.${d.id}`, title: `Add ${d.name}`, category: 'Add', icon: L.Drum, keywords: `drum ${d.group}`, run: () => {
        let id = '';
        app.edit(`Add ${d.name}`, (x) => void (id = drumChannel(x, d.id).id));
        app.selectChannel(id);
        app.engine.preview(id, 60);
      } });
    for (const s of SYNTH_PRESETS)
      a({ id: `add.synth.${s.id}`, title: `Add ${s.name}`, category: 'Add', icon: L.Piano, keywords: `synth instrument ${s.category}`, run: () => {
        let id = '';
        app.edit(`Add ${s.name}`, (x) => void (id = synthChannel(x, s.id).id));
        app.selectChannel(id);
        app.layout.show('pianoRoll');
      } });
    for (const g of GM_INSTRUMENTS)
      a({ id: `add.instrument.${g.program}`, title: `Add ${g.name}`, category: 'Add', icon: L.Piano, keywords: `instrument recorded real ${g.family}`, run: () => {
        let id = '';
        app.edit(`Add ${g.name}`, (x) => void (id = instrumentChannel(x, g.program).id));
        app.selectChannel(id);
        app.layout.show('pianoRoll');
        app.engine.preview(id, 60, 0.8, 0.6);
      } });
    for (const d of DRUM_PATTERNS)
      a({ id: `add.beat.${d.id}`, title: `Beat: ${d.name}`, category: 'Add', icon: L.Grid3x3, keywords: 'drum pattern preset groove', run: () => {
        app.edit(`Beat: ${d.name}`, (x) => void applyDrumPattern(x, x.patterns.find((y) => y.id === x.activePattern)!, d.id));
        app.layout.show('channelRack');
        toast(`${d.name} at ${d.bpm} BPM. Press Space to hear it.`);
      } });
    a({ id: 'add.progression', title: 'Chord progression…', category: 'Add', icon: L.ListMusic, keywords: 'chords harmony key generate', run: () => openProgression(app) });

    // ---------- Patterns ----------
    a({ id: 'pattern.new', title: 'New pattern', category: 'Patterns', icon: L.Plus, keys: ['F4'], run: () => app.newPattern() });
    a({ id: 'pattern.clone', title: 'Clone pattern', category: 'Patterns', icon: L.CopyPlus, keywords: 'duplicate copy', run: () => {
      let id = '';
      app.edit('Clone pattern', (x) => {
        const src = x.patterns.find((y) => y.id === x.activePattern)!;
        const c = { ...structuredClone(src), id: uid('p'), name: nextPatternName(x, src.name), color: nextColor(x.patterns.length + 6) };
        x.patterns.push(c);
        id = c.id;
      });
      app.selectPattern(id);
    } });
    a({ id: 'pattern.rename', title: 'Rename pattern…', category: 'Patterns', keys: ['F2'], run: async () => {
      const name = await promptDialog('Rename pattern', 'Name', app.pattern.name);
      if (name?.trim()) app.edit('Rename pattern', (x) => void (x.patterns.find((y) => y.id === x.activePattern)!.name = name.trim()));
    } });
    a({ id: 'pattern.delete', title: 'Delete pattern', category: 'Patterns', icon: L.Trash2, enabled: () => p().patterns.length > 1, run: () => app.edit('Delete pattern', (x) => deletePattern(x, x.activePattern)) });
    a({ id: 'pattern.clear', title: 'Clear pattern', category: 'Patterns', icon: L.Eraser, run: () => app.edit('Clear pattern', (x) => void (x.patterns.find((y) => y.id === x.activePattern)!.notes = {})) });
    a({ id: 'pattern.next', title: 'Next pattern', category: 'Patterns', keys: ['Ctrl+Right'], run: () => {
      const i = p().patterns.findIndex((x) => x.id === p().activePattern);
      app.selectPattern(p().patterns[(i + 1) % p().patterns.length].id);
    } });
    a({ id: 'pattern.prev', title: 'Previous pattern', category: 'Patterns', keys: ['Ctrl+Left'], run: () => {
      const i = p().patterns.findIndex((x) => x.id === p().activePattern);
      app.selectPattern(p().patterns[(i - 1 + p().patterns.length) % p().patterns.length].id);
    } });
    for (const bars of [1, 2, 4, 8])
      a({ id: `pattern.length${bars}`, title: `Pattern length: ${bars} bar${bars === 1 ? '' : 's'}`, category: 'Patterns', checked: () => app.pattern.length === bars * barTicks(p()), run: () => app.edit('Pattern length', (x) => void (x.patterns.find((y) => y.id === x.activePattern)!.length = bars * barTicks(x))) });

    // ---------- Notes (piano roll) ----------
    a({ id: 'notes.quantize', title: 'Quantize', category: 'Notes', icon: L.AlignHorizontalJustifyStart, keys: ['Alt+Q'], keywords: 'snap timing grid', run: () => roll().quantize() });
    a({ id: 'notes.humanize', title: 'Humanize', category: 'Notes', icon: L.Shuffle, keywords: 'random feel timing velocity', run: () => roll().humanize() });
    a({ id: 'notes.legato', title: 'Legato', category: 'Notes', icon: L.MoveHorizontal, keys: ['Alt+L'], keywords: 'connect stretch length', run: () => roll().legato() });
    a({ id: 'notes.chordify', title: 'Make chords from notes', category: 'Notes', icon: L.Layers3, keywords: 'triad harmony scale', run: () => roll().chordify() });
    a({ id: 'notes.arpeggiate', title: 'Arpeggiate…', category: 'Notes', icon: L.ChartNoAxesColumnIncreasing, keys: ['Alt+A'], keywords: 'arp broken chord', run: () => roll().arpeggiate() });
    a({ id: 'notes.strum', title: 'Strum chords', category: 'Notes', icon: L.Guitar, keywords: 'guitar spread', run: () => roll().strum() });
    a({ id: 'notes.fitScale', title: 'Fit notes to the key', category: 'Notes', icon: L.Music2, keywords: 'scale wrong notes correct', run: () => roll().fitScale() });
    a({ id: 'notes.up', title: 'Transpose up a semitone', category: 'Notes', keys: ['Up'], run: () => inRoll() && roll().transpose(1) });
    a({ id: 'notes.down', title: 'Transpose down a semitone', category: 'Notes', keys: ['Down'], run: () => inRoll() && roll().transpose(-1) });
    a({ id: 'notes.octaveUp', title: 'Transpose up an octave', category: 'Notes', keys: ['Ctrl+Up'], run: () => roll().transpose(12) });
    a({ id: 'notes.octaveDown', title: 'Transpose down an octave', category: 'Notes', keys: ['Ctrl+Down'], run: () => roll().transpose(-12) });

    // ---------- Playback ----------
    a({ id: 'play.toggle', title: 'Play / stop', category: 'Playback', icon: L.Play, keys: ['Space'], run: () => app.togglePlay() });
    a({ id: 'play.stop', title: 'Stop (twice: back to the start)', category: 'Playback', icon: L.Square, run: () => app.stop() });
    a({ id: 'play.record', title: 'Record', category: 'Playback', icon: L.Circle, keys: ['Ctrl+Shift+R'], keywords: 'guitar microphone take', run: () => app.record() });
    a({ id: 'play.mode', title: 'Pattern / song mode', category: 'Playback', icon: L.Repeat, keys: ['L'], keywords: 'loop pattern song', run: () => app.setMode(app.mode === 'song' ? 'pattern' : 'song') });
    a({ id: 'play.metronome', title: 'Metronome', category: 'Playback', icon: L.Timer, keys: ['Ctrl+M'], checked: () => app.engine.metronome, run: () => app.setMetronome(!app.engine.metronome) });
    a({ id: 'play.loop', title: 'Loop a section of the song', category: 'Playback', icon: L.Repeat2, keywords: 'cycle region', checked: () => !!p().loop, run: () => {
      const has = !!p().loop;
      app.edit(has ? 'Loop off' : 'Loop on', (x) => {
        const start = Math.floor(app.engine.position / barTicks(x)) * barTicks(x);
        x.loop = has ? null : [start, start + 4 * barTicks(x)];
      });
    } });
    a({ id: 'play.start', title: 'Go to the start', category: 'Playback', keys: ['Home'], run: () => app.seek(0) });
    a({ id: 'play.end', title: 'Go to the end', category: 'Playback', keys: ['End'], run: () => app.seek(app.mode === 'song' ? songEnd(p()) : 0) });
    a({ id: 'play.back', title: 'Back a bar', category: 'Playback', keys: ['Shift+Left'], run: () => app.seek(Math.max(0, app.engine.position - barTicks(p()))) });
    a({ id: 'play.forward', title: 'Forward a bar', category: 'Playback', keys: ['Shift+Right'], run: () => app.seek(app.engine.position + barTicks(p())) });
    a({ id: 'play.tap', title: 'Tap tempo', category: 'Playback', icon: L.Hand, keys: ['Shift+T'], run: () => app.transport.tap() });

    // ---------- View ----------
    a({ id: 'view.playlist', title: 'Playlist', category: 'View', icon: L.GalleryHorizontalEnd, keys: ['F5'], run: () => app.layout.show('playlist') });
    a({ id: 'view.channelRack', title: 'Channel rack', category: 'View', icon: L.Grid3x3, keys: ['F6'], run: () => app.layout.show('channelRack') });
    a({ id: 'view.pianoRoll', title: 'Piano roll', category: 'View', icon: L.Piano, keys: ['F7'], run: () => app.layout.show('pianoRoll') });
    a({ id: 'view.browser', title: 'Browser', category: 'View', icon: L.FolderTree, keys: ['F8'], run: () => app.layout.show('browser') });
    a({ id: 'view.mixer', title: 'Mixer', category: 'View', icon: L.SlidersVertical, keys: ['F9'], run: () => app.layout.show('mixer') });
    a({ id: 'view.record', title: 'Recording and tuner', category: 'View', icon: L.Mic, keys: ['F10'], keywords: 'tuner guitar input', run: () => app.layout.show('record') });
    a({ id: 'view.instrument', title: 'Channel settings', category: 'View', icon: L.SlidersHorizontal, keywords: 'synth sampler instrument sound', run: () => app.layout.show('instrument') });
    WORKSPACES.forEach(([w, label], i) => a({ id: `workspace.${w}`, title: `Workspace: ${label}`, category: 'View', keys: [`Alt+Shift+${i + 1}`], checked: () => app.prefs.workspace === w, run: () => app.layout.setWorkspace(w) }));
    a({ id: 'view.typingKeys', title: 'Computer keyboard plays notes', category: 'View', icon: L.Keyboard, keys: ['Ctrl+T'], keywords: 'typing piano qwerty', checked: () => app.prefs.typingKeys, run: () => {
      app.prefs.typingKeys = !app.prefs.typingKeys;
      app.savePrefs();
      app.statusbar.flash(app.prefs.typingKeys ? 'The keyboard plays notes: Z–M and Q–P; - and = change the octave' : 'Keyboard shortcuts are back');
      app.emit('transport');
      this.refresh();
    } });
    a({ id: 'view.zoomIn', title: 'Zoom in', category: 'View', icon: L.ZoomIn, keys: ['='], run: () => app.layout.zoom(1.5) });
    a({ id: 'view.zoomOut', title: 'Zoom out', category: 'View', icon: L.ZoomOut, keys: ['-'], run: () => app.layout.zoom(1 / 1.5) });
    a({ id: 'view.theme', title: 'Switch light / dark theme', category: 'View', icon: L.SunMoon, run: () => app.settings.set('appearance.theme', app.isDark ? 'light' : 'dark') });
    a({ id: 'view.fullscreen', title: 'Full screen', category: 'View', icon: L.Fullscreen, keys: ['F11'], run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) });

    // ---------- Help ----------
    a({ id: 'help.palette', title: 'Search commands', category: 'Help', icon: L.Search, keys: ['Ctrl+Shift+P', 'F1'], global: true, run: () => openPalette(app) });
    a({ id: 'help.shortcuts', title: 'Keyboard shortcuts', category: 'Help', icon: L.Keyboard, keys: ['Ctrl+/'], run: () => showShortcuts(app) });
    a({ id: 'help.whatsNew', title: "What's new", category: 'Help', icon: L.Sparkles, run: () => app.updates.showWhatsNew() });
    a({ id: 'help.updates', title: 'Check for updates…', category: 'Help', icon: L.RefreshCw, run: () => app.updates.check(false) });
    a({ id: 'help.about', title: 'About Beatline', category: 'Help', icon: L.Info, run: () => showAbout(app) });
    a({ id: 'help.devtools', title: 'Developer tools', category: 'Help', keys: ['Ctrl+Alt+Shift+I'], hidden: true, run: () => platform.toggleDevTools() });
  }
}
