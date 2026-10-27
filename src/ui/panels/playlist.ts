// The Playlist: the song. Patterns and audio clips on tracks, a ruler to move the playhead (and
// Shift+drag a loop), record-armed tracks for guitar and vocals. Double-click to place the current
// pattern; drag clips to move them (Alt copies), their edges to make them longer or shorter, and the
// corners of audio clips to fade them.
import * as L from 'lucide';
import { addClip, deleteClips, duplicateClips, makeUnique, moveClips, sliceClip } from '../../core/arrange';
import { addAudioTrack, audioTicks, barTicks, clipEnd, newMixerTrack, newTrack, nextColor, patternById, PPQ, sampleById, secondsToTicks, songEnd, STEP, ticksToSeconds, uid, type Clip, type Track } from '../../core/project';
import type { App, LiveEdit } from '../app';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { colorPicker, dialog, promptDialog, showMenu, toast, tooltip, type MenuItem } from '../widgets';

const RULER_H = 24;
const ROW_H = 54;
const HEAD_W = 172;

const SNAPS: [string, string, (bar: number) => number][] = [
  ['bar', 'Bar', (bar) => bar],
  ['beat', 'Beat', () => PPQ],
  ['step', '1/16', () => STEP],
  ['none', 'Off', () => 1],
];

type Drag =
  | { kind: 'move'; x0: number; row0: number; ids: Set<string>; orig: Clip[][]; edit: LiveEdit; copy: boolean; dt: number; dr: number }
  | { kind: 'edge'; side: 'left' | 'right'; clip: string; x0: number; orig: Clip; edit: LiveEdit }
  | { kind: 'fade'; side: 'in' | 'out'; clip: string; x0: number; orig: Clip; edit: LiveEdit }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'scrub' }
  | { kind: 'loop'; t0: number; orig: [number, number] | null };

export class PlaylistPanel implements Panel {
  readonly id = 'playlist';
  readonly title = 'Playlist';
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private heads: HTMLElement;
  private headsInner: HTMLElement;
  private canvas: HTMLCanvasElement;
  private scrollX = 0;
  private scrollY = 0;
  private ppt = 0.12;
  private snapId = 'beat';
  private drag: Drag | null = null;
  private queued = false;
  private clipboard: { clip: Clip; row: number; offset: number }[] | null = null;
  private follow = true;
  private dropAt: { tick: number; row: number } | null = null;

  constructor(private app: App) {
    this.bar = h('div', { class: 'pl-bar' });
    this.headsInner = h('div', { class: 'pl-heads-inner' });
    this.heads = h('div', { class: 'pl-heads', style: { width: `${HEAD_W}px` } }, this.headsInner);
    this.canvas = h('canvas', { class: 'pl-canvas', tabindex: '0' }) as HTMLCanvasElement;
    const body = h('div', { class: 'pl-body' }, this.heads, h('div', { class: 'pl-canvas-wrap' }, this.canvas));
    this.el = h('div', { class: 'playlist' }, this.bar, body);
    for (const k of ['project', 'transport', 'selection', 'samples'] as const) app.on(k, () => {
      this.renderHeads();
      this.request();
    });
    app.on('project', () => this.renderBar());
    app.on('pattern', () => this.renderBar());
    app.on('live', () => this.request());
    app.on('playhead', () => this.onPlayhead());
    new ResizeObserver(() => this.request()).observe(body);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('dblclick', (e) => this.dbl(e));
    this.canvas.addEventListener('contextmenu', (e) => this.context(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.setupDrop();
    this.renderBar();
    this.renderHeads();
  }

  shown(): void {
    this.renderHeads();
    this.request();
  }

  focus(): void {
    this.canvas.focus();
  }

  private get snap(): number {
    const s = SNAPS.find((x) => x[0] === this.snapId) ?? SNAPS[1];
    return s[2](barTicks(this.app.project));
  }

  // ---------- geometry ----------

  private x(tick: number): number {
    return (tick - this.scrollX) * this.ppt;
  }

  private tickAt(x: number): number {
    return Math.max(0, this.scrollX + x / this.ppt);
  }

  private rowAt(y: number): number {
    return Math.floor((y - RULER_H + this.scrollY) / ROW_H);
  }

  private rowY(i: number): number {
    return RULER_H + i * ROW_H - this.scrollY;
  }

  private snapTick(t: number, free = false): number {
    if (free) return Math.max(0, Math.round(t));
    return Math.max(0, Math.round(t / this.snap) * this.snap);
  }

  private clipAt(x: number, y: number): { clip: Clip; row: number } | null {
    const row = this.rowAt(y);
    const t = this.app.project.tracks[row];
    if (!t || y < RULER_H) return null;
    const tick = this.tickAt(x);
    for (let i = t.clips.length - 1; i >= 0; i--) {
      const c = t.clips[i];
      if (tick >= c.start && tick < clipEnd(c)) return { clip: c, row };
    }
    return null;
  }

  zoomBy(f: number, atX = this.canvas.clientWidth / 2): void {
    const tick = this.tickAt(atX);
    this.ppt = Math.max(0.01, Math.min(2, this.ppt * f));
    this.scrollX = Math.max(0, tick - atX / this.ppt);
    this.request();
  }

  // ---------- the bar and the track headers ----------

  private renderBar(): void {
    const app = this.app;
    const p = app.project;
    const patSel = h('select', { class: 'input', 'aria-label': 'Pattern to place' }, ...p.patterns.map((x) => h('option', { value: x.id }, x.name))) as HTMLSelectElement;
    patSel.value = p.activePattern;
    patSel.addEventListener('change', () => app.selectPattern(patSel.value));
    tooltip(patSel, 'The pattern a double-click places');
    const snap = h('select', { class: 'input', 'aria-label': 'Snap' }, ...SNAPS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    snap.value = this.snapId;
    snap.addEventListener('change', () => (this.snapId = snap.value));
    tooltip(snap, 'Clips snap to this (hold Alt while dragging to place freely)');
    const addTrack = h('button', { class: 'btn small outline', onclick: () => app.commands.run('add.audioTrack') }, icon(L.Mic, 14), 'Audio track');
    tooltip(addTrack, 'A track to record guitar or vocals on, with its own effects');
    const loop = h('button', { class: `btn small${p.loop ? ' on' : ''}`, 'aria-label': 'Loop', onclick: () => app.commands.run('play.loop') }, icon(L.Repeat2, 15));
    tooltip(loop, 'Loop a section (Shift+drag on the ruler to set it)');
    const follow = h('button', { class: `btn small${this.follow ? ' on' : ''}`, 'aria-label': 'Follow the playhead', onclick: () => {
      this.follow = !this.follow;
      follow.classList.toggle('on', this.follow);
    } }, icon(L.ChevronsRight, 15));
    tooltip(follow, 'Scroll along while playing');
    const fit = h('button', { class: 'btn small', 'aria-label': 'Show the whole song', onclick: () => this.fit() }, icon(L.Maximize2, 14));
    tooltip(fit, 'Show the whole song');
    this.bar.replaceChildren(h('span', { class: 'bar-label' }, 'Place'), patSel, snap, h('span', { class: 'spacer' }), addTrack, loop, follow, fit);
  }

  private fit(): void {
    const end = Math.max(songEnd(this.app.project), 8 * barTicks(this.app.project));
    this.ppt = Math.max(0.01, (this.canvas.clientWidth - 20) / end);
    this.scrollX = 0;
    this.request();
  }

  private renderHeads(): void {
    const app = this.app;
    const p = app.project;
    this.headsInner.style.paddingTop = `${RULER_H}px`;
    this.headsInner.replaceChildren(
      ...p.tracks.map((t, i) => {
        const armed = app.armed.has(t.id);
        const btn = (on: boolean, text: string | L.IconNode, label: string, run: () => void, cls = '') => {
          const b = h('button', { class: `pl-hbtn${on ? ' on' : ''} ${cls}`, 'aria-label': label, onclick: run }, typeof text === 'string' ? text : icon(text, 13));
          tooltip(b, label);
          return b;
        };
        const mix = t.mixer !== 'master' ? p.mixer.findIndex((m) => m.id === t.mixer) : 0;
        const name = h('span', { class: 'pl-hname', title: 'Double-click to rename' }, t.name);
        name.addEventListener('dblclick', () => void this.rename(t));
        const el = h(
          'div',
          { class: `pl-head${armed ? ' armed' : ''}`, style: { height: `${ROW_H}px`, '--tr': t.color } as unknown as Partial<CSSStyleDeclaration> },
          h('span', { class: 'pl-swatch' }),
          h('div', { class: 'pl-hmain' }, name, h('div', { class: 'pl-hbtns' },
            btn(t.mute, 'M', t.mute ? 'Unmute' : 'Mute', () => app.edit('Mute track', (x) => void (x.tracks[i].mute = !t.mute)), 'mute'),
            btn(t.solo, 'S', t.solo ? 'Stop soloing' : 'Solo: hear only this track', () => app.edit('Solo track', (x) => void (x.tracks[i].solo = !t.solo)), 'solo'),
            btn(armed, L.Circle, armed ? 'Disarm' : 'Arm for recording (guitar, vocals…)', () => void this.arm(t), 'arm'),
            mix ? btn(false, String(mix), `Plays through mixer track ${mix} — click to see its effects`, () => {
              app.selectMixer(t.mixer);
              app.layout.show('mixer');
            }, 'route') : null,
          )),
        );
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.trackMenu(t, i, e);
        });
        return el;
      }),
      h('button', { class: 'pl-addtrack', onclick: () => app.edit('Add track', (x) => void x.tracks.push(newTrack(`Track ${x.tracks.length + 1}`, '#5c6370'))) }, icon(L.Plus, 13), 'Track'),
    );
    this.headsInner.style.transform = `translateY(${-this.scrollY}px)`;
  }

  /** Arming a track without a mixer track gives it one (for its effects: an amp, a reverb). */
  private async arm(t: Track): Promise<void> {
    const app = this.app;
    if (!app.armed.has(t.id) && t.mixer === 'master') {
      app.edit('Arm track', (p) => {
        const x = p.tracks.find((y) => y.id === t.id)!;
        const mx = newMixerTrack(x.name, x.color === '#5c6370' ? nextColor(p.mixer.length + 3) : x.color);
        p.mixer.push(mx);
        x.mixer = mx.id;
        x.color = mx.color;
      });
    }
    await app.toggleArm(t.id);
    if (app.armed.has(t.id)) app.statusbar.flash('Armed. Press Record (or Ctrl+Shift+R) to record from the playhead.');
  }

  private async rename(t: Track): Promise<void> {
    const n = await promptDialog('Rename track', 'Name', t.name);
    if (!n?.trim()) return;
    this.app.edit('Rename track', (p) => {
      const x = p.tracks.find((y) => y.id === t.id)!;
      x.name = n.trim();
      const m = p.mixer.find((y) => y.id === x.mixer);
      if (m && m.id !== 'master' && !p.channels.some((c) => c.mixer === m.id)) m.name = x.name;
    });
  }

  private trackMenu(t: Track, i: number, e: MouseEvent): void {
    const app = this.app;
    showMenu(
      [
        { label: 'Rename…', icon: L.Pencil, run: () => void this.rename(t) },
        { label: 'Color…', icon: L.Palette, run: async () => {
          let color = t.color;
          const picker = colorPicker((c) => c && (color = c), { current: color });
          if (await dialog('Track color', picker, [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }])) app.edit('Track color', (p) => void (p.tracks[i].color = color));
        } },
        { label: t.mixer === 'master' ? 'Give it a mixer track (for effects)' : 'Show its mixer track', icon: L.SlidersVertical, run: () => {
          if (t.mixer === 'master') {
            app.edit('Mixer track for the track', (p) => {
              const mx = newMixerTrack(t.name, nextColor(p.mixer.length + 3));
              p.mixer.push(mx);
              p.tracks[i].mixer = mx.id;
            });
          }
          app.selectMixer(app.project.tracks[i].mixer);
          app.layout.show('mixer');
        } },
        { separator: true },
        { label: 'Add a track above', icon: L.Plus, run: () => app.edit('Add track', (p) => void p.tracks.splice(i, 0, newTrack(`Track ${p.tracks.length + 1}`, '#5c6370'))) },
        { label: 'Add an audio track below', icon: L.Mic, run: () => app.edit('Add audio track', (p) => void addAudioTrack(p, `Audio ${p.tracks.length + 1}`, i + 1)) },
        { separator: true },
        { label: 'Delete track', icon: L.Trash2, disabled: app.project.tracks.length <= 1, run: () => {
          if (t.clips.length) toast(`${t.name}'s clips were deleted with it. Undo brings them back.`);
          app.edit('Delete track', (p) => void p.tracks.splice(i, 1));
        } },
      ],
      { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY },
    );
  }

  // ---------- clipboard ----------

  copy(cut = false): void {
    const p = this.app.project;
    const items: { clip: Clip; row: number; offset: number }[] = [];
    p.tracks.forEach((t, row) => {
      for (const c of t.clips) if (this.app.clips.has(c.id)) items.push({ clip: structuredClone(c), row, offset: 0 });
    });
    if (!items.length) return;
    const first = Math.min(...items.map((x) => x.clip.start));
    for (const it of items) it.offset = it.clip.start - first;
    this.clipboard = items;
    if (cut) this.deleteSelected();
    else this.app.statusbar.flash(`Copied ${items.length} clip${items.length === 1 ? '' : 's'}`);
  }

  paste(): void {
    if (!this.clipboard?.length) return;
    const at = this.snapTick(this.app.engine.position);
    const ids: string[] = [];
    this.app.edit('Paste clips', (p) => {
      for (const it of this.clipboard!) {
        const t = p.tracks[Math.min(p.tracks.length - 1, it.row)];
        const c = addClip(t, { ...structuredClone(it.clip), id: uid('k'), start: at + it.offset });
        ids.push(c.id);
      }
    });
    this.app.selectClips(ids);
  }

  deleteSelected(): void {
    const ids = new Set(this.app.clips);
    if (!ids.size) return;
    this.app.edit('Delete clips', (p) => deleteClips(p, ids));
  }

  duplicate(): void {
    const ids = new Set(this.app.clips);
    if (!ids.size) return;
    let made: Clip[] = [];
    this.app.edit('Duplicate clips', (p) => void (made = duplicateClips(p, ids)));
    this.app.selectClips(made.map((c) => c.id));
  }

  selectAll(): void {
    this.app.selectClips(this.app.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
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
    if (e.button === 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (y < RULER_H) {
      if (e.shiftKey) {
        const t0 = this.snapTick(this.tickAt(x));
        this.drag = { kind: 'loop', t0, orig: app.project.loop };
      } else {
        this.drag = { kind: 'scrub' };
        this.scrubTo(x);
      }
      return;
    }
    const hit = this.clipAt(x, y);
    if (!hit) {
      if (!e.shiftKey && !e.ctrlKey) app.selectClips([]);
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey || e.ctrlKey };
      return;
    }
    const c = hit.clip;
    if (e.ctrlKey) app.selectClips([c.id], 'toggle');
    else if (e.shiftKey) app.selectClips([c.id], 'add');
    else if (!app.clips.has(c.id)) app.selectClips([c.id]);
    const cx = this.x(c.start);
    const cw = c.length * this.ppt;
    const top = this.rowY(hit.row);
    // Fade handles: the top corners of audio clips
    if (c.kind === 'audio' && y - top < 12 && cw > 30) {
      const fi = cx + secondsToTicks(c.fadeIn, app.project.bpm) * this.ppt;
      const fo = cx + cw - secondsToTicks(c.fadeOut, app.project.bpm) * this.ppt;
      if (Math.abs(x - fi) < 8) return void (this.drag = { kind: 'fade', side: 'in', clip: c.id, x0: x, orig: structuredClone(c), edit: app.liveEdit('Fade in') });
      if (Math.abs(x - fo) < 8) return void (this.drag = { kind: 'fade', side: 'out', clip: c.id, x0: x, orig: structuredClone(c), edit: app.liveEdit('Fade out') });
    }
    const edge = Math.min(8, cw / 4);
    if (x - cx < edge) return void (this.drag = { kind: 'edge', side: 'left', clip: c.id, x0: x, orig: structuredClone(c), edit: app.liveEdit('Trim clip') });
    if (cx + cw - x < edge) return void (this.drag = { kind: 'edge', side: 'right', clip: c.id, x0: x, orig: structuredClone(c), edit: app.liveEdit('Trim clip') });
    // Every track's clips as they were, so each step of the drag starts from there
    const orig = app.project.tracks.map((t) => structuredClone(t.clips));
    this.drag = { kind: 'move', x0: x, row0: hit.row, ids: new Set(app.clips), orig, edit: app.liveEdit(e.altKey ? 'Copy clips' : 'Move clips'), copy: e.altKey, dt: 0, dr: 0 };
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const d = this.drag;
    const app = this.app;
    if (!d) {
      const hit = y >= RULER_H ? this.clipAt(x, y) : null;
      let cursor = y < RULER_H ? 'pointer' : 'default';
      if (hit) {
        const cx = this.x(hit.clip.start);
        const cw = hit.clip.length * this.ppt;
        const edge = Math.min(8, cw / 4);
        cursor = x - cx < edge || cx + cw - x < edge ? 'ew-resize' : y - this.rowY(hit.row) < 12 && hit.clip.kind === 'audio' ? 'col-resize' : 'grab';
      }
      this.canvas.style.cursor = cursor;
      return;
    }
    const bpm = app.project.bpm;
    switch (d.kind) {
      case 'scrub':
        this.scrubTo(x);
        break;
      case 'loop': {
        const t = this.snapTick(this.tickAt(x));
        app.project.loop = t === d.t0 ? null : [Math.min(t, d.t0), Math.max(t, d.t0)];
        this.request();
        break;
      }
      case 'box':
        d.x1 = x;
        d.y1 = y;
        this.request();
        break;
      case 'move': {
        const dt = Math.round((this.tickAt(x) - this.tickAt(d.x0)) / this.snap) * this.snap;
        const dr = this.rowAt(y) - d.row0;
        if (dt === d.dt && dr === d.dr) break;
        d.dt = dt;
        d.dr = dr;
        const orig = d.orig;
        d.edit.update((p) => {
          // From the original positions each time, so the move doesn't add up
          p.tracks.forEach((t, i) => (t.clips = structuredClone(orig[i] ?? [])));
          const moved = moveClips(p, d.ids, dt, dr, d.copy);
          if (d.copy) app.clips = new Set(moved.map((c) => c.id));
        });
        break;
      }
      case 'edge': {
        const raw = this.tickAt(x) - this.tickAt(d.x0);
        const delta = e.altKey ? Math.round(raw) : Math.round(raw / this.snap) * this.snap;
        const o = d.orig;
        d.edit.update((p) => {
          const c = p.tracks.flatMap((t) => t.clips).find((k) => k.id === d.clip);
          if (!c) return;
          const maxLen = o.kind === 'audio' ? audioTicks(p, (sampleById(p, o.sampleId)?.duration ?? 0) - o.offset) : Infinity;
          if (d.side === 'right') {
            c.length = Math.max(STEP, Math.min(maxLen, o.length + delta));
          } else {
            // Moving the start: the clip begins later (or earlier) in its pattern or file
            // Not before the start of the file (or of the pattern), nor before the song's start
            const minD = o.kind === 'audio' ? -Math.floor(secondsToTicks(o.offset, bpm)) : -o.offset;
            const dd = Math.max(minD, -o.start, Math.min(o.length - STEP, delta));
            c.start = o.start + dd;
            c.length = o.length - dd;
            c.offset = o.kind === 'audio' ? Math.max(0, o.offset + ticksToSeconds(dd, bpm)) : Math.max(0, o.offset + dd);
          }
        });
        break;
      }
      case 'fade': {
        const secs = ticksToSeconds((x - d.x0) / this.ppt, bpm);
        const o = d.orig;
        const total = ticksToSeconds(o.length, bpm);
        d.edit.update((p) => {
          const c = p.tracks.flatMap((t) => t.clips).find((k) => k.id === d.clip);
          if (!c) return;
          if (d.side === 'in') c.fadeIn = Math.max(0, Math.min(total - o.fadeOut, o.fadeIn + secs));
          else c.fadeOut = Math.max(0, Math.min(total - o.fadeIn, o.fadeOut - secs));
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
    const app = this.app;
    switch (d.kind) {
      case 'move':
      case 'edge':
      case 'fade':
        d.edit.end();
        break;
      case 'loop': {
        // The drag only showed it; now it becomes an undo step
        const loop = app.project.loop;
        app.project.loop = d.orig;
        app.edit(loop ? 'Set the loop' : 'Loop off', (p) => void (p.loop = loop));
        break;
      }
      case 'box': {
        const t0 = this.tickAt(Math.min(d.x0, d.x1));
        const t1 = this.tickAt(Math.max(d.x0, d.x1));
        const r0 = this.rowAt(Math.min(d.y0, d.y1));
        const r1 = this.rowAt(Math.max(d.y0, d.y1));
        const ids = app.project.tracks.flatMap((t, i) => (i >= r0 && i <= r1 ? t.clips.filter((c) => clipEnd(c) > t0 && c.start < t1).map((c) => c.id) : []));
        if (Math.abs(d.x1 - d.x0) > 3 || Math.abs(d.y1 - d.y0) > 3) app.selectClips(ids, d.add ? 'add' : 'replace');
        break;
      }
    }
    this.request();
  }

  private dbl(e: MouseEvent): void {
    const app = this.app;
    const [x, y] = this.local(e);
    if (y < RULER_H) return;
    const hit = this.clipAt(x, y);
    if (hit) {
      if (hit.clip.kind === 'pattern' && hit.clip.patternId) {
        app.selectPattern(hit.clip.patternId);
        app.layout.show('channelRack');
      }
      return;
    }
    const row = this.rowAt(y);
    if (row < 0 || row >= app.project.tracks.length) return;
    const at = Math.floor(this.tickAt(x) / this.snap) * this.snap;
    app.placePattern(app.project.activePattern, at, row);
    if (app.mode !== 'song') app.setMode('song');
  }

  private scrubTo(x: number): void {
    const app = this.app;
    if (app.mode !== 'song') app.setMode('song');
    app.seek(this.snapTick(this.tickAt(x), true));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [x] = this.local(e);
    if (e.ctrlKey) this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, x);
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollX = Math.max(0, this.scrollX + (e.deltaX || e.deltaY) / this.ppt);
    else {
      const max = Math.max(0, this.app.project.tracks.length * ROW_H + 40 - (this.canvas.clientHeight - RULER_H));
      this.scrollY = Math.max(0, Math.min(max, this.scrollY + e.deltaY));
      this.headsInner.style.transform = `translateY(${-this.scrollY}px)`;
    }
    this.request();
  }

  private context(e: MouseEvent): void {
    e.preventDefault();
    const app = this.app;
    const [x, y] = this.local(e);
    const hit = this.clipAt(x, y);
    const at = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
    if (!hit) {
      const row = this.rowAt(y);
      if (y < RULER_H || row < 0 || row >= app.project.tracks.length) return;
      const tick = Math.floor(this.tickAt(x) / this.snap) * this.snap;
      showMenu(
        [
          { label: `Place ${app.pattern.name} here`, icon: L.Plus, run: () => app.placePattern(app.project.activePattern, tick, row) },
          { label: 'Import audio here…', icon: L.FileAudio, run: async () => {
            let t = tick;
            for (const s of await app.importAudio()) {
              app.placeAudio(s, t, app.project.tracks[row].id);
              t += audioTicks(app.project, s.duration);
            }
          } },
          { label: 'Paste', icon: L.ClipboardPaste, disabled: !this.clipboard, run: () => {
            app.seek(tick);
            this.paste();
          } },
        ],
        at,
      );
      return;
    }
    const c = hit.clip;
    if (!app.clips.has(c.id)) app.selectClips([c.id]);
    const tick = this.snapTick(this.tickAt(x));
    const items: MenuItem[] = [];
    if (c.kind === 'pattern') {
      items.push(
        { label: 'Edit this pattern', icon: L.Grid3x3, run: () => {
          app.selectPattern(c.patternId!);
          app.layout.show('channelRack');
        } },
        { label: 'Make unique (its own copy)', icon: L.CopyPlus, run: () => {
          let id = '';
          app.edit('Make unique', (p) => void (id = makeUnique(p, c.id)?.id ?? ''));
          if (id) app.selectPattern(id);
        } },
      );
    } else {
      const takes = app.project.tracks[hit.row].clips.filter((k) => k.kind === 'audio' && k.take && k.start < clipEnd(c) && clipEnd(k) > c.start);
      if (c.take && takes.length > 1)
        items.push({ label: c.muted ? `Use take ${c.take}` : `Take ${c.take} is playing`, icon: L.CircleCheck, disabled: !c.muted, run: () => app.edit(`Use take ${c.take}`, (p) => {
          for (const k of p.tracks[hit.row].clips) if (takes.some((t) => t.id === k.id)) k.muted = k.id !== c.id;
        }) });
      items.push(
        { label: 'Gain…', icon: L.Volume2, run: async () => {
          const v = await promptDialog('Clip gain', 'Gain in dB (negative is quieter)', String(c.gain), (s) => (Number.isFinite(Number(s)) && Math.abs(Number(s)) <= 24 ? null : 'A number between -24 and 24'));
          if (v !== null) app.edit('Clip gain', (p) => void (p.tracks[hit.row].clips.find((k) => k.id === c.id)!.gain = Number(v)));
        } },
        { label: 'Use as a sampler channel', icon: L.Grid3x3, run: () => {
          const s = sampleById(app.project, c.sampleId);
          if (s) app.addSampleChannel(s);
        } },
      );
    }
    items.push(
      { separator: true },
      { label: 'Slice here', icon: L.Scissors, disabled: tick <= c.start || tick >= clipEnd(c), run: () => app.edit('Slice clip', (p) => void sliceClip(p, c.id, tick)) },
      { label: c.muted ? 'Unmute clip' : 'Mute clip', icon: c.muted ? L.Volume2 : L.VolumeX, run: () => app.edit(c.muted ? 'Unmute clip' : 'Mute clip', (p) => void (p.tracks[hit.row].clips.find((k) => k.id === c.id)!.muted = !c.muted)) },
      { label: 'Duplicate', icon: L.CopyPlus, hint: 'Ctrl+B', run: () => this.duplicate() },
      { label: 'Delete', icon: L.Trash2, hint: 'Delete', run: () => this.deleteSelected() },
    );
    showMenu(items, at);
  }

  // ---------- dropping ----------

  private setupDrop(): void {
    const c = this.canvas;
    const place = (e: DragEvent) => {
      const [x, y] = this.local(e);
      return { tick: Math.floor(this.tickAt(x) / this.snap) * this.snap, row: Math.max(0, Math.min(this.app.project.tracks.length - 1, this.rowAt(y))) };
    };
    c.addEventListener('dragover', (e) => {
      const t = e.dataTransfer?.types ?? [];
      if (!t.includes('Files') && !t.includes('text/beatline-sample') && !t.includes('text/beatline-pattern') && !t.includes('text/beatline-file')) return;
      e.preventDefault();
      this.dropAt = place(e);
      this.request();
    });
    c.addEventListener('dragleave', () => {
      this.dropAt = null;
      this.request();
    });
    c.addEventListener('drop', async (e) => {
      const at = place(e);
      this.dropAt = null;
      const dt = e.dataTransfer;
      if (!dt) return;
      e.preventDefault();
      const app = this.app;
      const track = app.project.tracks[at.row]?.id;
      const pid = dt.getData('text/beatline-pattern');
      const sid = dt.getData('text/beatline-sample');
      const file = dt.getData('text/beatline-file');
      if (pid) app.placePattern(pid, at.tick, at.row);
      else if (file) {
        const [s] = await app.importAudio([JSON.parse(file)]);
        if (s) app.placeAudio(s, at.tick, track);
      }
      else if (sid) {
        const s = sampleById(app.project, sid);
        if (s) app.placeAudio(s, at.tick, track);
      } else if (dt.files.length) await app.dropFiles([...dt.files], { tick: at.tick, track });
      if (app.mode !== 'song') app.setMode('song');
    });
  }

  // ---------- drawing ----------

  private onPlayhead(): void {
    const app = this.app;
    if (this.follow && app.engine.playing && app.mode === 'song' && !this.drag) {
      const x = this.x(app.engine.position);
      const w = this.canvas.clientWidth;
      if (x > w - 40 || x < 0) this.scrollX = Math.max(0, app.engine.position - 40 / this.ppt);
    }
    this.request();
  }

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
    const p = app.project;
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
    const bar = barTicks(p);
    ctx.fillStyle = col('--pl-bg');
    ctx.fillRect(0, 0, W, H);
    // Rows
    p.tracks.forEach((t, i) => {
      const y = this.rowY(i);
      if (y > H || y + ROW_H < RULER_H) return;
      ctx.fillStyle = i % 2 ? col('--pl-row-alt') : col('--pl-row');
      ctx.fillRect(0, y, W, ROW_H);
      if (app.armed.has(t.id)) {
        ctx.fillStyle = 'rgba(229, 56, 59, 0.08)';
        ctx.fillRect(0, y, W, ROW_H);
      }
    });
    // Bar and beat lines
    const t1 = this.tickAt(W);
    const beatPx = PPQ * this.ppt;
    for (let t = Math.floor(this.scrollX / PPQ) * PPQ; t <= t1; t += PPQ) {
      if (beatPx < 6 && t % bar) continue;
      ctx.fillStyle = t % bar === 0 ? col('--pl-bar') : col('--pl-beat');
      ctx.fillRect(Math.round(this.x(t)), RULER_H, 1, H - RULER_H);
    }
    // Loop region
    if (p.loop) {
      ctx.fillStyle = col('--accent-soft');
      ctx.fillRect(this.x(p.loop[0]), RULER_H, (p.loop[1] - p.loop[0]) * this.ppt, H - RULER_H);
    }
    // Clips
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    p.tracks.forEach((t, i) => {
      const y = this.rowY(i);
      if (y > H || y + ROW_H < RULER_H) return;
      for (const k of t.clips) {
        const x = this.x(k.start);
        const w = k.length * this.ppt;
        if (x > W || x + w < 0) continue;
        this.drawClip(ctx, k, t, x, y + 2, w, ROW_H - 4, col);
      }
    });
    // Recording in progress
    if (app.recording && app.engine.playing && !app.keyboard.recordNotes) {
      const row = p.tracks.findIndex((t) => app.armed.has(t.id));
      if (row >= 0) {
        const y = this.rowY(row);
        const x = this.x(app.engine.position);
        ctx.fillStyle = 'rgba(229, 56, 59, 0.35)';
        ctx.fillRect(Math.max(0, x - 6), y + 2, 6, ROW_H - 4);
      }
    }
    // Where a drop would go
    if (this.dropAt) {
      ctx.strokeStyle = col('--accent');
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.x(this.dropAt.tick) + 0.5, this.rowY(this.dropAt.row) + 2.5, bar * this.ppt, ROW_H - 5);
      ctx.setLineDash([]);
    }
    // Marquee
    const d = this.drag;
    if (d?.kind === 'box') {
      ctx.fillStyle = col('--accent-soft');
      ctx.strokeStyle = col('--accent');
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    // Ruler
    ctx.fillStyle = col('--pl-ruler');
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = col('--text-muted');
    ctx.textBaseline = 'middle';
    const every = Math.max(1, Math.ceil(40 / (bar * this.ppt)));
    for (let b = Math.floor(this.scrollX / bar); b * bar <= t1; b++) {
      if (b % every) continue;
      const x = this.x(b * bar);
      ctx.fillRect(Math.round(x), RULER_H - 8, 1, 8);
      ctx.fillText(String(b + 1), x + 3, 9);
    }
    if (p.loop) {
      ctx.fillStyle = col('--accent');
      ctx.fillRect(this.x(p.loop[0]), RULER_H - 5, (p.loop[1] - p.loop[0]) * this.ppt, 5);
    }
    // Song end
    const end = songEnd(p);
    if (end) {
      ctx.fillStyle = col('--text-faint');
      ctx.fillRect(Math.round(this.x(end)), RULER_H - 14, 1, 14);
    }
    // Playhead (song mode)
    if (app.mode === 'song') {
      const x = this.x(app.engine.position);
      if (x >= 0 && x <= W) {
        ctx.fillStyle = app.recording ? '#e5383b' : col('--playhead');
        ctx.fillRect(Math.round(x), 0, 1.5, H);
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x + 0.5, 7);
        ctx.fill();
      }
    }
    if (!p.tracks.some((t) => t.clips.length)) {
      ctx.fillStyle = col('--text-muted');
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('Double-click a track to place the pattern, drop audio files here, or arm a track (●) and record.', 16, RULER_H + 14);
    }
  }

  private drawClip(ctx: CanvasRenderingContext2D, k: Clip, t: Track, x: number, y: number, w: number, hh: number, col: (v: string) => string): void {
    const app = this.app;
    const p = app.project;
    const sel = app.clips.has(k.id);
    const pt = k.kind === 'pattern' ? patternById(p, k.patternId) : undefined;
    const sample = k.kind === 'audio' ? sampleById(p, k.sampleId) : undefined;
    const color = pt?.color ?? t.color ?? '#4ea1ff';
    const missing = sample && app.engine.library.missing.has(sample.id);
    ctx.save();
    ctx.globalAlpha = k.muted || t.mute ? 0.35 : 1;
    ctx.fillStyle = col('--pl-clip-bg');
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(2, w), hh, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.85;
    ctx.fillRect(x, y, Math.max(2, w), 13);
    ctx.globalAlpha = k.muted || t.mute ? 0.35 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(2, w), hh, 4);
    ctx.clip();
    // Contents: the pattern's notes, or the waveform
    if (pt) {
      const len = Math.max(STEP, pt.length);
      const all = Object.entries(pt.notes).flatMap(([cid, list]) => list.map((n) => ({ n, c: p.channels.find((ch) => ch.id === cid)?.color ?? color })));
      if (all.length) {
        const lo = Math.min(...all.map((a) => a.n.key));
        const hi = Math.max(...all.map((a) => a.n.key));
        const rh = Math.max(1.5, (hh - 18) / Math.max(1, hi - lo + 1));
        for (let rep = Math.floor(k.offset / len) * len - k.offset; rep < k.length; rep += len) {
          for (const { n, c } of all) {
            const s = rep + n.start;
            if (s < 0 || s >= k.length || n.start >= len) continue;
            ctx.fillStyle = c;
            ctx.fillRect(x + s * this.ppt, y + 15 + (hi - n.key) * rh, Math.max(1.5, Math.min(n.length, k.length - s) * this.ppt - 0.5), Math.max(1.5, rh - 0.4));
          }
        }
      }
    } else if (sample) {
      const peaks = app.engine.library.peaksOf({ sampleId: sample.id }, p);
      if (peaks) {
        ctx.fillStyle = color;
        const mid = y + 13 + (hh - 13) / 2;
        const amp = (hh - 16) / 2;
        const sr = sample.sampleRate || 48000;
        const secsPerPx = ticksToSeconds(1 / this.ppt, p.bpm);
        const x0 = Math.max(x, 0);
        const x1 = Math.min(x + w, this.canvas.clientWidth);
        for (let px = x0; px < x1; px++) {
          const secs = k.offset + (px - x) * secsPerPx;
          const a = Math.floor((secs * sr) / peaks.per);
          const b = Math.max(a + 1, Math.floor(((secs + secsPerPx) * sr) / peaks.per));
          let m = 0;
          for (let i = a; i < b && i < peaks.data.length; i++) m = Math.max(m, peaks.data[i]);
          const v = m * amp * Math.pow(10, k.gain / 20);
          ctx.fillRect(px, mid - v, 1, Math.max(0.5, v * 2));
        }
      }
      // Fades
      const fi = secondsToTicks(k.fadeIn, p.bpm) * this.ppt;
      const fo = secondsToTicks(k.fadeOut, p.bpm) * this.ppt;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      if (fi > 1) {
        ctx.beginPath();
        ctx.moveTo(x, y + hh);
        ctx.lineTo(x + fi, y + 13);
        ctx.stroke();
      }
      if (fo > 1) {
        ctx.beginPath();
        ctx.moveTo(x + w - fo, y + 13);
        ctx.lineTo(x + w, y + hh);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      if (sel) {
        ctx.fillRect(x + fi - 3, y + 13, 6, 6);
        ctx.fillRect(x + w - fo - 3, y + 13, 6, 6);
      }
    }
    // Name
    ctx.fillStyle = '#0d0f12';
    ctx.textBaseline = 'top';
    const name = pt ? pt.name : sample ? `${sample.name}${k.take ? ` · take ${k.take}` : ''}${missing ? ' (missing)' : ''}` : '?';
    ctx.fillText(name, x + 4, y + 1);
    ctx.restore();
    if (sel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, Math.max(2, w - 1), hh - 1, 4);
      ctx.stroke();
    }
  }
}
