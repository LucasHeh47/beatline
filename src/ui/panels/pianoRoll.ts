// The Piano Roll: the selected channel's notes in the pattern. Click to draw a note (it plays), drag to
// move it, drag its end to change its length, right-click to erase, Ctrl+drag to select a box. The
// keyboard on the left plays; rows in the song's key are lighter; chords are named above them.
import * as L from 'lucide';
import { arpeggiate, chordify, chordsOf, fitToScale, fixOverlaps, humanize, legato, quantize, strum, transpose, type ArpPattern } from '../../core/notes';
import { barTicks, channelById, PPQ, STEP, type Note } from '../../core/project';
import { CHORDS, chordName, inScale, isBlackKey, NOTE_NAMES, noteName, SCALES } from '../../core/theory';
import type { App, LiveEdit } from '../app';
import { field, select } from '../dialogs/common';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { dialog, showMenu, toast, tooltip } from '../widgets';

const KEYS_W = 56;
const RULER_H = 22;
const VEL_H = 64;
const MIN_KEY = 12;
const MAX_KEY = 119;

export const SNAPS: [string, string, (bar: number) => number][] = [
  ['bar', 'Bar', (bar) => bar],
  ['beat', 'Beat', () => PPQ],
  ['8th', '1/8', () => PPQ / 2],
  ['step', '1/16 (step)', () => STEP],
  ['32nd', '1/32', () => STEP / 2],
  ['8t', '1/8 triplet', () => PPQ / 3],
  ['16t', '1/16 triplet', () => PPQ / 6],
  ['none', 'Off', () => 1],
];

const noteId = (n: Note) => `${n.start}:${n.key}`;

type Drag =
  | { kind: 'move'; x0: number; key0: number; orig: Note[]; ids: Set<string>; edit: LiveEdit; copy: boolean }
  | { kind: 'resize'; x0: number; orig: Note[]; ids: Set<string>; edit: LiveEdit }
  | { kind: 'erase'; edit: LiveEdit }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'vel'; edit: LiveEdit }
  | { kind: 'keys'; key: number }
  | { kind: 'scrub' };

export class PianoRoll implements Panel {
  readonly id = 'pianoRoll';
  readonly title = 'Piano roll';
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private canvas: HTMLCanvasElement;
  private wrap: HTMLElement;
  /** Ticks at the left edge, and pixels per tick. */
  private scrollX = 0;
  private ppt = 0.6;
  /** The key at the top edge, and pixels per key. */
  private topKey = 84;
  private rowH = 14;
  private sel = new Set<string>();
  private drag: Drag | null = null;
  /** Length of the last note drawn or resized (new notes get it). */
  private lastLength = STEP;
  private clipboard: Note[] | null = null;
  private chord = 'none';
  private ghosts = true;
  private queued = false;
  private hover: { x: number; y: number } | null = null;
  private placed = '';
  /** The pitch change of the note drag so far (to play each new pitch once). */
  private lastDk = 0;

  constructor(private app: App) {
    this.bar = h('div', { class: 'roll-bar' });
    this.canvas = h('canvas', { class: 'roll-canvas', tabindex: '0' }) as HTMLCanvasElement;
    this.wrap = h('div', { class: 'roll-wrap' }, this.canvas);
    this.el = h('div', { class: 'piano-roll' }, this.bar, this.wrap);
    for (const k of ['project', 'pattern', 'channel'] as const) app.on(k, () => {
      this.renderBar();
      this.request();
    });
    app.on('live', () => this.request());
    app.on('playhead', () => this.request());
    app.on('settings', () => this.request());
    new ResizeObserver(() => this.request()).observe(this.wrap);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.request();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this.dbl(e));
    this.renderBar();
  }

  shown(): void {
    this.renderBar();
    this.request();
    this.scrollToNotes();
  }

  focus(): void {
    this.canvas.focus();
  }

  // ---------- data ----------

  private get channelId(): string | null {
    return this.app.channel;
  }

  private notes(): Note[] {
    const c = this.channelId;
    return c ? this.app.pattern.notes[c] ?? [] : [];
  }

  private get snap(): number {
    const s = SNAPS.find((x) => x[0] === this.app.prefs.snap) ?? SNAPS[3];
    return s[2](barTicks(this.app.project));
  }

  /** Changes the selected channel's notes in the pattern (one undo step). */
  private change(label: string, fn: (notes: Note[]) => Note[]): void {
    const c = this.channelId;
    if (!c) return toast('Pick a channel first (click its name in the channel rack).');
    const pid = this.app.pattern.id;
    this.app.edit(label, (p) => {
      const pt = p.patterns.find((x) => x.id === pid)!;
      pt.notes[c] = fixOverlaps(fn(pt.notes[c] ?? []));
      this.grow(pt);
    });
  }

  /** A pattern grows (to whole bars) when notes go past its end. */
  private grow(pt: { length: number; notes: Record<string, Note[]> }): void {
    const bar = barTicks(this.app.project);
    let end = 0;
    for (const list of Object.values(pt.notes)) for (const n of list) end = Math.max(end, n.start + n.length);
    if (end > pt.length) pt.length = Math.ceil(end / bar) * bar;
  }

  /** Applies a tool to the selected notes (or all of them when none are selected). */
  private tool(label: string, fn: (notes: Note[]) => Note[]): void {
    const all = this.notes();
    if (!all.length) return toast('There are no notes to change.');
    const picked = this.sel.size ? all.filter((n) => this.sel.has(noteId(n))) : all;
    const rest = all.filter((n) => !picked.includes(n));
    const changed = fn(picked.map((n) => ({ ...n })));
    this.change(label, () => [...rest, ...changed]);
    if (this.sel.size) this.sel = new Set(changed.map(noteId));
  }

  quantize(): void {
    this.tool('Quantize', (n) => quantize(n, this.snap));
  }

  humanize(): void {
    this.tool('Humanize', (n) => humanize(n, Math.max(2, Math.round(STEP / 6)), 0.12));
  }

  legato(): void {
    this.tool('Legato', legato);
  }

  chordify(): void {
    const k = this.app.project.key;
    this.tool('Make chords', (n) => chordify(n, k.root, k.scale));
  }

  strum(): void {
    this.tool('Strum', (n) => strum(n, 3));
  }

  fitScale(): void {
    const k = this.app.project.key;
    this.tool('Fit to the key', (n) => fitToScale(n, k.root, k.scale));
  }

  transpose(semis: number): void {
    this.tool(semis > 0 ? 'Transpose up' : 'Transpose down', (n) => transpose(n, semis));
  }

  async arpeggiate(): Promise<void> {
    const pattern = select<ArpPattern>([['up', 'Up'], ['down', 'Down'], ['upDown', 'Up and down'], ['random', 'Random']], 'up');
    const rate = select([[String(PPQ / 2), '1/8'], [String(STEP), '1/16'], [String(STEP / 2), '1/32'], [String(PPQ / 3), '1/8 triplet']], String(STEP));
    const octaves = select([['1', '1 octave'], ['2', '2 octaves'], ['3', '3 octaves']], '1');
    const ok = await dialog('Arpeggiate', h('div', { class: 'form' }, h('p', { class: 'hint' }, 'Plays each chord’s notes one after another, for as long as the chord lasts.'), field('Direction', pattern), field('Speed', rate), field('Range', octaves)), [
      { label: 'Arpeggiate', value: true, primary: true },
      { label: 'Cancel', value: false },
    ]);
    if (ok) this.tool('Arpeggiate', (n) => arpeggiate(n, pattern.value as ArpPattern, Number(rate.value), 0.9, Number(octaves.value)));
  }

  selectAll(): void {
    this.sel = new Set(this.notes().map(noteId));
    this.request();
  }

  deselect(): void {
    this.sel.clear();
    this.request();
  }

  deleteSelected(): void {
    if (!this.sel.size) return;
    const ids = new Set(this.sel);
    this.change('Delete notes', (n) => n.filter((x) => !ids.has(noteId(x))));
    this.sel.clear();
  }

  copy(cut = false): void {
    const picked = this.notes().filter((n) => this.sel.has(noteId(n)));
    if (!picked.length) return;
    const first = Math.min(...picked.map((n) => n.start));
    this.clipboard = picked.map((n) => ({ ...n, start: n.start - first }));
    if (cut) this.deleteSelected();
    else this.app.statusbar.flash(`Copied ${picked.length} note${picked.length === 1 ? '' : 's'}`);
  }

  /** Pastes at the playhead (in pattern mode) or after the selection. */
  paste(): void {
    if (!this.clipboard?.length) return;
    const sel = this.notes().filter((n) => this.sel.has(noteId(n)));
    const at = sel.length ? Math.max(...sel.map((n) => n.start + n.length)) : this.app.mode === 'pattern' ? Math.floor(this.app.engine.position / this.snap) * this.snap : 0;
    const added = this.clipboard.map((n) => ({ ...n, start: n.start + at }));
    this.change('Paste notes', (n) => [...n, ...added]);
    this.sel = new Set(added.map(noteId));
  }

  duplicate(): void {
    const picked = this.notes().filter((n) => this.sel.has(noteId(n)));
    if (!picked.length) return;
    const a = Math.min(...picked.map((n) => n.start));
    const b = Math.max(...picked.map((n) => n.start + n.length));
    const span = Math.ceil((b - a) / this.snap) * this.snap;
    const added = picked.map((n) => ({ ...n, start: n.start + span }));
    this.change('Duplicate notes', (n) => [...n, ...added]);
    this.sel = new Set(added.map(noteId));
  }

  zoomBy(f: number, atX?: number): void {
    const x = atX ?? this.gridW() / 2;
    const tick = this.scrollX + x / this.ppt;
    this.ppt = Math.max(0.05, Math.min(8, this.ppt * f));
    this.scrollX = Math.max(0, tick - x / this.ppt);
    this.request();
  }

  /** Scrolls so the notes (or middle C) are in view. */
  private scrollToNotes(): void {
    const ns = this.notes();
    const rows = Math.floor((this.canvas.clientHeight - RULER_H - VEL_H) / this.rowH);
    const mid = ns.length ? Math.round((Math.min(...ns.map((n) => n.key)) + Math.max(...ns.map((n) => n.key))) / 2) : 60;
    this.topKey = Math.min(MAX_KEY, Math.max(MIN_KEY + rows, mid + Math.floor(rows / 2)));
    // The whole pattern fits across
    const w = this.gridW();
    if (w > 50) this.ppt = Math.max(0.05, Math.min(4, w / Math.max(this.app.pattern.length, barTicks(this.app.project))));
    this.scrollX = 0;
    this.request();
  }

  // ---------- the toolbar ----------

  private renderBar(): void {
    const app = this.app;
    const p = app.project;
    const chSel = h('select', { class: 'input', 'aria-label': 'Channel' }, ...p.channels.map((c) => h('option', { value: c.id }, c.name))) as HTMLSelectElement;
    if (app.channel) chSel.value = app.channel;
    chSel.addEventListener('change', () => app.selectChannel(chSel.value));
    tooltip(chSel, 'The channel whose notes you see and draw');
    const snap = h('select', { class: 'input', 'aria-label': 'Snap' }, ...SNAPS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    snap.value = app.prefs.snap;
    snap.addEventListener('change', () => {
      app.prefs.snap = snap.value;
      app.savePrefs();
      this.request();
    });
    tooltip(snap, 'Notes snap to this (hold Alt while dragging to place freely)');
    const root = h('select', { class: 'input', 'aria-label': 'Key' }, ...NOTE_NAMES.map((n, i) => h('option', { value: String(i) }, n))) as HTMLSelectElement;
    root.value = String(p.key.root);
    const scale = h('select', { class: 'input', 'aria-label': 'Scale' }, ...SCALES.map((s) => h('option', { value: s.id }, s.name))) as HTMLSelectElement;
    scale.value = p.key.scale;
    const setKey = () => app.edit('Key', (x) => void (x.key = { root: Number(root.value), scale: scale.value }));
    root.addEventListener('change', setKey);
    scale.addEventListener('change', setKey);
    tooltip(root, 'The song’s key: its notes are the light rows');
    const chord = h('select', { class: 'input', 'aria-label': 'Chord stamp' }, h('option', { value: 'none' }, 'Single notes'), h('option', { value: 'scale' }, 'Chords in the key'), ...CHORDS.map((c) => h('option', { value: c.id }, `${c.name} chords`))) as HTMLSelectElement;
    chord.value = this.chord;
    chord.addEventListener('change', () => (this.chord = chord.value));
    tooltip(chord, 'Draw a whole chord with one click');
    const btn = (ic: L.IconNode, label: string, cmd: string, tip: string) => {
      const b = h('button', { class: 'btn small', 'aria-label': label, onclick: () => app.commands.run(cmd) }, icon(ic, 15));
      tooltip(b, tip);
      return b;
    };
    const ghost = h('button', { class: `btn small${this.ghosts ? ' on' : ''}`, 'aria-label': 'Ghost notes', onclick: () => {
      this.ghosts = !this.ghosts;
      ghost.classList.toggle('on', this.ghosts);
      this.request();
    } }, icon(L.Ghost, 15));
    tooltip(ghost, 'Show the other channels’ notes faintly');
    const more = h('button', { class: 'btn small', 'aria-label': 'More tools', onclick: (e: MouseEvent) => showMenu(
      [
        { label: 'Quantize', icon: L.AlignHorizontalJustifyStart, hint: 'Alt+Q', run: () => this.quantize() },
        { label: 'Humanize', icon: L.Shuffle, run: () => this.humanize() },
        { label: 'Legato', icon: L.MoveHorizontal, hint: 'Alt+L', run: () => this.legato() },
        { label: 'Make chords from notes', icon: L.Layers3, run: () => this.chordify() },
        { label: 'Arpeggiate…', icon: L.ChartNoAxesColumnIncreasing, hint: 'Alt+A', run: () => void this.arpeggiate() },
        { label: 'Strum chords', icon: L.Guitar, run: () => this.strum() },
        { label: 'Fit notes to the key', icon: L.Music2, run: () => this.fitScale() },
        { separator: true },
        { label: 'Up an octave', hint: 'Ctrl+Up', run: () => this.transpose(12) },
        { label: 'Down an octave', hint: 'Ctrl+Down', run: () => this.transpose(-12) },
        { separator: true },
        { label: 'Write a chord progression…', icon: L.ListMusic, run: () => app.commands.run('add.progression') },
        { label: 'Export the pattern as MIDI…', icon: L.FileMusic, run: () => app.commands.run('file.exportMidi') },
      ],
      e.currentTarget as HTMLElement,
    ) }, icon(L.Wand, 15), 'Tools');
    this.bar.replaceChildren(
      chSel,
      snap,
      h('span', { class: 'bar-label' }, 'Key'),
      root,
      scale,
      chord,
      h('span', { class: 'spacer' }),
      btn(L.AlignHorizontalJustifyStart, 'Quantize', 'notes.quantize', 'Quantize: notes to the grid (Alt+Q)'),
      btn(L.Layers3, 'Chords', 'notes.chordify', 'Turn single notes into chords of the key'),
      btn(L.ChartNoAxesColumnIncreasing, 'Arpeggiate', 'notes.arpeggiate', 'Arpeggiate the chords (Alt+A)'),
      ghost,
      more,
    );
  }

  // ---------- geometry ----------

  private gridW(): number {
    return Math.max(0, this.canvas.clientWidth - KEYS_W);
  }

  private x(tick: number): number {
    return KEYS_W + (tick - this.scrollX) * this.ppt;
  }

  private tickAt(x: number): number {
    return this.scrollX + (x - KEYS_W) / this.ppt;
  }

  private y(key: number): number {
    return RULER_H + (this.topKey - key) * this.rowH;
  }

  private keyAt(y: number): number {
    return Math.max(MIN_KEY, Math.min(MAX_KEY, this.topKey - Math.floor((y - RULER_H) / this.rowH)));
  }

  private snapTick(t: number, free: boolean): number {
    if (free) return Math.max(0, Math.round(t));
    const g = this.snap;
    return Math.max(0, Math.round(t / g) * g);
  }

  private noteAt(x: number, y: number): Note | null {
    const key = this.keyAt(y);
    const t = this.tickAt(x);
    const list = this.notes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.key === key && t >= n.start && t < n.start + n.length) return n;
    }
    return null;
  }

  // ---------- mouse ----------

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    const app = this.app;
    this.canvas.focus();
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    const H = this.canvas.clientHeight;
    // The keyboard plays
    if (x < KEYS_W && y > RULER_H && y < H - VEL_H) {
      const key = this.keyAt(y);
      if (app.channel) app.engine.noteOn(app.channel, key, 0.8);
      this.drag = { kind: 'keys', key };
      return;
    }
    if (y < RULER_H) {
      this.drag = { kind: 'scrub' };
      this.scrubTo(x);
      return;
    }
    if (!this.channelId) {
      toast('Pick a channel first (click its name in the channel rack).');
      return;
    }
    if (y > H - VEL_H) {
      this.drag = { kind: 'vel', edit: app.liveEdit('Velocity') };
      this.setVel(x, y);
      return;
    }
    const n = this.noteAt(x, y);
    if (e.button === 2) {
      this.drag = { kind: 'erase', edit: app.liveEdit('Erase notes') };
      this.eraseAt(x, y);
      return;
    }
    if (e.ctrlKey && !n) {
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey };
      return;
    }
    if (n) {
      const id = noteId(n);
      if (e.shiftKey) {
        if (this.sel.has(id)) this.sel.delete(id);
        else this.sel.add(id);
      } else if (!this.sel.has(id)) this.sel = new Set([id]);
      app.engine.preview(this.channelId, n.key, n.vel, 0.25);
      const nearEnd = this.x(n.start + n.length) - x < Math.max(5, Math.min(10, n.length * this.ppt * 0.3));
      const orig = this.notes().map((m) => ({ ...m }));
      if (nearEnd) this.drag = { kind: 'resize', x0: x, orig, ids: new Set(this.sel), edit: app.liveEdit('Note length') };
      else this.drag = { kind: 'move', x0: x, key0: n.key, orig, ids: new Set(this.sel), edit: app.liveEdit(e.altKey && e.shiftKey ? 'Copy notes' : 'Move notes'), copy: false };
      this.request();
      return;
    }
    // Empty space: draw a note (or a chord) and keep dragging to place it
    const start = Math.floor(this.tickAt(x) / this.snap) * this.snap;
    const key = this.keyAt(y);
    const keys = this.stampKeys(key);
    const added = keys.map((k) => ({ key: k, start: Math.max(0, start), length: this.lastLength, vel: 0.8 }));
    const edit = app.liveEdit(keys.length > 1 ? 'Draw chord' : 'Draw note');
    const pid = app.pattern.id;
    const ch = this.channelId;
    edit.update((p) => {
      const pt = p.patterns.find((q) => q.id === pid)!;
      pt.notes[ch] = fixOverlaps([...(pt.notes[ch] ?? []), ...added]);
      this.grow(pt);
    });
    this.sel = new Set(added.map(noteId));
    this.placed = [...this.sel].join(',');
    for (const a of added) app.engine.preview(ch, a.key, 0.8, 0.3);
    this.drag = { kind: 'move', x0: x, key0: key, orig: this.notes().map((m) => ({ ...m })), ids: new Set(this.sel), edit, copy: false };
  }

  /** The keys a click draws: one, or a chord (of the key, or a shape). */
  private stampKeys(key: number): number[] {
    if (this.chord === 'none') return [key];
    const k = this.app.project.key;
    if (this.chord === 'scale') {
      if (!inScale(key, k.root, k.scale)) return [key];
      return chordify([{ key, start: 0, length: 1, vel: 1 }], k.root, k.scale).map((n) => n.key);
    }
    const shape = CHORDS.find((c) => c.id === this.chord);
    return shape ? shape.steps.map((s) => key + s) : [key];
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.hover = { x, y };
    const d = this.drag;
    if (!d) {
      const n = y > RULER_H && y < this.canvas.clientHeight - VEL_H && x > KEYS_W ? this.noteAt(x, y) : null;
      this.canvas.style.cursor = n ? (this.x(n.start + n.length) - x < Math.max(5, Math.min(10, n.length * this.ppt * 0.3)) ? 'ew-resize' : 'move') : x > KEYS_W ? 'crosshair' : 'pointer';
      this.request();
      return;
    }
    const app = this.app;
    const ch = this.channelId;
    const pid = app.pattern.id;
    switch (d.kind) {
      case 'keys': {
        const key = this.keyAt(y);
        if (key !== d.key && ch) {
          app.engine.noteOff(ch, d.key);
          app.engine.noteOn(ch, key, 0.8);
          d.key = key;
        }
        break;
      }
      case 'scrub':
        this.scrubTo(x);
        break;
      case 'erase':
        this.eraseAt(x, y);
        break;
      case 'vel':
        this.setVel(x, y);
        break;
      case 'box':
        d.x1 = x;
        d.y1 = y;
        this.request();
        break;
      case 'move': {
        if (!ch) break;
        const raw = this.tickAt(x) - this.tickAt(d.x0);
        const dk = this.keyAt(y) - d.key0;
        const moved: Note[] = [];
        const minStart = Math.min(...d.orig.filter((n) => d.ids.has(noteId(n))).map((n) => n.start));
        // Alt places freely; otherwise the move is whole grid steps
        const shift = Math.max(-minStart, e.altKey ? Math.round(raw) : Math.round(raw / this.snap) * this.snap);
        const list = d.orig.map((n) => {
          if (!d.ids.has(noteId(n))) return n;
          const m = { ...n, start: n.start + shift, key: Math.max(0, Math.min(127, n.key + dk)) };
          moved.push(m);
          return m;
        });
        d.edit.update((p) => {
          const pt = p.patterns.find((q) => q.id === pid)!;
          pt.notes[ch] = list.map((n) => ({ ...n }));
          this.grow(pt);
        });
        const ids = new Set(moved.map(noteId));
        // A new pitch plays as you drag through it
        if (dk !== this.lastDk && moved.length) for (const m of moved.slice(0, 4)) app.engine.preview(ch, m.key, m.vel, 0.15);
        this.lastDk = dk;
        this.sel = ids;
        break;
      }
      case 'resize': {
        if (!ch) break;
        const dt = (x - d.x0) / this.ppt;
        const list = d.orig.map((n) => {
          if (!d.ids.has(noteId(n))) return n;
          const end = this.snapTick(n.start + n.length + dt, e.altKey);
          const length = Math.max(e.altKey ? 1 : Math.min(this.snap, n.length), end - n.start);
          this.lastLength = length;
          return { ...n, length };
        });
        d.edit.update((p) => {
          const pt = p.patterns.find((q) => q.id === pid)!;
          pt.notes[ch] = list.map((n) => ({ ...n }));
          this.grow(pt);
        });
        break;
      }
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    const ch = this.channelId;
    switch (d.kind) {
      case 'keys':
        if (ch) this.app.engine.noteOff(ch, d.key);
        break;
      case 'move':
      case 'resize': {
        d.edit.end();
        // A note that was only clicked keeps its length as the one to draw next
        if (d.kind === 'move') {
          const first = this.notes().find((n) => this.sel.has(noteId(n)));
          if (first && this.placed !== [...this.sel].join(',')) this.lastLength = first.length;
        }
        this.placed = '';
        break;
      }
      case 'erase':
      case 'vel':
        d.edit.end();
        break;
      case 'box': {
        const t0 = this.tickAt(Math.min(d.x0, d.x1));
        const t1 = this.tickAt(Math.max(d.x0, d.x1));
        const k0 = this.keyAt(Math.max(d.y0, d.y1));
        const k1 = this.keyAt(Math.min(d.y0, d.y1));
        const ids = this.notes().filter((n) => n.key >= k0 && n.key <= k1 && n.start + n.length > t0 && n.start < t1).map(noteId);
        this.sel = d.add ? new Set([...this.sel, ...ids]) : new Set(ids);
        break;
      }
    }
    this.request();
  }

  private dbl(e: MouseEvent): void {
    const [x, y] = this.local(e);
    // Double-clicking a note deletes it (a quick way to tidy up)
    const n = y > RULER_H && y < this.canvas.clientHeight - VEL_H ? this.noteAt(x, y) : null;
    if (n && !this.placed) {
      const id = noteId(n);
      this.change('Delete note', (list) => list.filter((m) => noteId(m) !== id));
      this.sel.delete(id);
    }
  }

  private eraseAt(x: number, y: number): void {
    const d = this.drag;
    const ch = this.channelId;
    if (!d || d.kind !== 'erase' || !ch) return;
    const n = this.noteAt(x, y);
    if (!n) return;
    const id = noteId(n);
    const pid = this.app.pattern.id;
    d.edit.update((p) => {
      const pt = p.patterns.find((q) => q.id === pid)!;
      pt.notes[ch] = (pt.notes[ch] ?? []).filter((m) => noteId(m) !== id);
    });
    this.sel.delete(id);
  }

  /** Velocity lane: sets the notes under the pointer (the selected ones when dragging one of them). */
  private setVel(x: number, y: number): void {
    const d = this.drag;
    const ch = this.channelId;
    if (!d || d.kind !== 'vel' || !ch) return;
    const H = this.canvas.clientHeight;
    const v = Math.max(0.02, Math.min(1, (H - 4 - y) / (VEL_H - 10)));
    const t = this.tickAt(x);
    const pid = this.app.pattern.id;
    const hits = this.notes().filter((n) => Math.abs(this.x(n.start) - x) < 5 || (t >= n.start && t < n.start + Math.min(n.length, 6 / this.ppt)));
    if (!hits.length) return;
    const ids = new Set(hits.map(noteId));
    d.edit.update((p) => {
      const pt = p.patterns.find((q) => q.id === pid)!;
      for (const n of pt.notes[ch] ?? []) if (ids.has(noteId(n))) n.vel = v;
    });
  }

  private scrubTo(x: number): void {
    const app = this.app;
    if (app.mode !== 'pattern') app.setMode('pattern');
    app.seek(Math.max(0, Math.min(app.pattern.length - 1, this.snapTick(this.tickAt(x), false))));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [x] = this.local(e);
    if (e.ctrlKey) this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, x - KEYS_W);
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollX = Math.max(0, this.scrollX + (e.deltaX || e.deltaY) / this.ppt);
    else if (e.altKey) this.rowH = Math.max(6, Math.min(32, this.rowH + (e.deltaY < 0 ? 1 : -1)));
    else this.topKey = Math.max(MIN_KEY + 8, Math.min(MAX_KEY, this.topKey + (e.deltaY < 0 ? 2 : -2)));
    this.request();
  }

  // ---------- drawing ----------

  request(): void {
    if (this.queued || this.el.hidden) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    const app = this.app;
    const c = this.canvas;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.el);
    const col = (v: string) => css.getPropertyValue(v).trim();
    const p = app.project;
    const pt = app.pattern;
    const ch = this.channelId ? channelById(p, this.channelId) : undefined;
    const bar = barTicks(p);
    const gridB = H - VEL_H;
    ctx.fillStyle = col('--roll-bg');
    ctx.fillRect(0, 0, W, H);
    // Rows: in the key lighter, the key's root tinted, black keys darker
    const keysShown = Math.ceil((gridB - RULER_H) / this.rowH) + 1;
    for (let i = 0; i < keysShown; i++) {
      const key = this.topKey - i;
      if (key < 0) break;
      const y = this.y(key);
      const inKey = inScale(key, p.key.root, p.key.scale);
      ctx.fillStyle = (key - p.key.root) % 12 === 0 ? col('--roll-root') : inKey ? col('--roll-in') : col('--roll-out');
      ctx.fillRect(KEYS_W, y, W - KEYS_W, this.rowH);
      ctx.fillStyle = col('--roll-line');
      ctx.fillRect(KEYS_W, y + this.rowH - 1, W - KEYS_W, key % 12 === 0 ? 1 : 0.5);
    }
    // Columns: bars, beats and the snap grid
    const t0 = Math.max(0, Math.floor(this.scrollX / this.snap) * this.snap);
    const t1 = this.tickAt(W);
    const gridStep = Math.max(this.snap, this.snap * Math.ceil(4 / (this.snap * this.ppt)));
    for (let t = t0; t <= t1; t += gridStep) {
      const x = Math.round(this.x(t)) + 0.5;
      ctx.fillStyle = t % bar === 0 ? col('--roll-bar') : t % PPQ === 0 ? col('--roll-beat') : col('--roll-line');
      ctx.fillRect(x, RULER_H, 1, gridB - RULER_H);
    }
    // Past the pattern's end
    const endX = this.x(pt.length);
    if (endX < W) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(Math.max(KEYS_W, endX), RULER_H, W - endX, gridB - RULER_H);
    }
    // Ghost notes of the other channels
    if (this.ghosts) {
      ctx.fillStyle = col('--roll-ghost');
      for (const [id, list] of Object.entries(pt.notes)) {
        if (id === this.channelId) continue;
        for (const n of list) {
          const x = this.x(n.start);
          if (x > W || x + n.length * this.ppt < KEYS_W) continue;
          ctx.fillRect(x, this.y(n.key) + 2, Math.max(2, n.length * this.ppt - 1), this.rowH - 4);
        }
      }
    }
    // Notes
    const color = ch?.color ?? '#4ea1ff';
    const notes = this.notes();
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const n of notes) {
      const x = this.x(n.start);
      const w = Math.max(3, n.length * this.ppt - 1);
      if (x > W || x + w < KEYS_W) continue;
      const y = this.y(n.key);
      if (y > gridB || y + this.rowH < RULER_H) continue;
      const on = this.sel.has(noteId(n));
      ctx.globalAlpha = 0.55 + 0.45 * n.vel;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, w, this.rowH - 2, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (on) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (w > 22 && this.rowH >= 11) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(noteName(n.key), x + 4, y + this.rowH / 2);
      }
    }
    // Marquee
    const d = this.drag;
    if (d?.kind === 'box') {
      ctx.strokeStyle = col('--accent');
      ctx.fillStyle = col('--accent-soft');
      const bx = Math.min(d.x0, d.x1);
      const by = Math.min(d.y0, d.y1);
      ctx.fillRect(bx, by, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    // Where a click would draw
    if (!d && this.hover && this.hover.x > KEYS_W && this.hover.y > RULER_H && this.hover.y < gridB && !this.noteAt(this.hover.x, this.hover.y)) {
      const key = this.keyAt(this.hover.y);
      const start = Math.floor(this.tickAt(this.hover.x) / this.snap) * this.snap;
      ctx.strokeStyle = color;
      ctx.setLineDash([3, 3]);
      for (const k of this.stampKeys(key)) ctx.strokeRect(this.x(start) + 0.5, this.y(k) + 1.5, Math.max(3, this.lastLength * this.ppt - 1), this.rowH - 3);
      ctx.setLineDash([]);
    }
    // The keyboard
    for (let i = 0; i < keysShown; i++) {
      const key = this.topKey - i;
      const y = this.y(key);
      if (y > gridB) break;
      const black = isBlackKey(key);
      ctx.fillStyle = black ? '#20232a' : '#e9ecf2';
      ctx.fillRect(0, y, black ? KEYS_W * 0.62 : KEYS_W, this.rowH);
      if (black) {
        ctx.fillStyle = '#c9ced8';
        ctx.fillRect(KEYS_W * 0.62, y, KEYS_W * 0.38, this.rowH);
      }
      ctx.fillStyle = '#9097a3';
      ctx.fillRect(0, y + this.rowH - 0.5, KEYS_W, 0.5);
      if (key % 12 === 0 && this.rowH >= 9) {
        ctx.fillStyle = '#3c4350';
        ctx.fillText(noteName(key), KEYS_W - 26, y + this.rowH / 2);
      }
      const drag = this.drag;
      if (drag?.kind === 'keys' && drag.key === key) {
        ctx.fillStyle = col('--accent');
        ctx.globalAlpha = 0.6;
        ctx.fillRect(0, y, KEYS_W, this.rowH);
        ctx.globalAlpha = 1;
      }
    }
    // The ruler with bar numbers and chord names
    ctx.fillStyle = col('--roll-ruler');
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = col('--text-muted');
    ctx.textBaseline = 'middle';
    for (let t = Math.floor(this.scrollX / bar) * bar; t <= t1; t += bar) {
      const x = this.x(t);
      if (x < KEYS_W - 1) continue;
      ctx.fillRect(Math.round(x), RULER_H - 7, 1, 7);
      ctx.fillText(String(t / bar + 1), x + 3, 6);
    }
    ctx.fillStyle = col('--accent');
    for (const chord of chordsOf(notes)) {
      if (chord.length < 3) continue;
      const name = chordName(chord.map((n) => n.key));
      const x = this.x(chord[0].start);
      if (name && x >= KEYS_W - 1 && x < W) ctx.fillText(name, x + 3, RULER_H - 5);
    }
    // Velocity lane
    ctx.fillStyle = col('--roll-vel');
    ctx.fillRect(0, gridB, W, VEL_H);
    ctx.fillStyle = col('--text-faint');
    ctx.fillText('Velocity', 8, gridB + 12);
    for (const n of notes) {
      const x = this.x(n.start);
      if (x < KEYS_W || x > W) continue;
      const hgt = (VEL_H - 10) * n.vel;
      ctx.fillStyle = this.sel.has(noteId(n)) ? '#ffffff' : color;
      ctx.fillRect(x, H - 4 - hgt, 3, hgt);
      ctx.beginPath();
      ctx.arc(x + 1.5, H - 4 - hgt, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The playhead (pattern mode)
    if (app.mode === 'pattern') {
      const x = this.x(app.engine.position);
      if (x >= KEYS_W && x <= W) {
        ctx.fillStyle = col('--playhead');
        ctx.fillRect(Math.round(x), 0, 1.5, gridB);
      }
    }
    if (!ch) {
      ctx.fillStyle = col('--text-muted');
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.fillText('Pick a channel in the channel rack to write its notes here.', KEYS_W + 20, RULER_H + 30);
    }
  }
}
