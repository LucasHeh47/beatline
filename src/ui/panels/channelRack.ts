// The Channel Rack: every instrument and drum sound as a row, with its step sequencer for the
// pattern being worked on. Click or drag across steps to switch them on; channels with melodies show
// their notes in miniature (click to open them in the piano roll).
import * as L from 'lucide';
import { DRUM_PATTERNS } from '../../core/drumPatterns';
import { DRUM_SOUNDS, GM_FAMILIES, GM_INSTRUMENTS, SYNTH_PRESETS } from '../../core/instruments';
import { fillSteps, isMelodic, stepsOf, toggleStep } from '../../core/notes';
import { barTicks, CHANNEL_VOLUME, STEP, uid, type Channel } from '../../core/project';
import { deleteChannel } from '../../core/arrange';
import { applyDrumPattern, drumChannel } from '../../core/templates';
import type { App } from '../app';
import { fmtDb, fmtPan, knob } from '../controls';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { colorPicker, dialog, promptDialog, showMenu, toast, tooltip, type MenuItem } from '../widgets';

export class ChannelRack implements Panel {
  readonly id = 'channelRack';
  readonly title = 'Channel rack';
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private rows: HTMLElement;
  private lights = new Map<string, HTMLElement>();
  private stepEls = new Map<string, HTMLElement[]>();
  private lastStep = -1;
  private raf = 0;

  constructor(private app: App) {
    this.bar = h('div', { class: 'rack-bar' });
    this.rows = h('div', { class: 'rack-rows' });
    this.el = h('div', { class: 'channel-rack', tabindex: '-1' }, this.bar, this.rows);
    for (const k of ['project', 'pattern', 'channel'] as const) app.on(k, () => this.render());
    app.on('playhead', () => this.tick());
    app.on('transport', () => this.tick());
    // Audio files dropped on the rack become sampler channels
    this.el.addEventListener('dragover', (e) => {
      const t = e.dataTransfer?.types ?? [];
      if (t.includes('Files') || t.includes('text/beatline-sample') || t.includes('text/beatline-file') || t.includes('text/beatline-drum') || t.includes('text/beatline-instrument')) {
        e.preventDefault();
        this.el.classList.add('drop');
      }
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', async (e) => {
      this.el.classList.remove('drop');
      const sid = e.dataTransfer?.getData('text/beatline-sample');
      const builtin = e.dataTransfer?.getData('text/beatline-drum');
      const file = e.dataTransfer?.getData('text/beatline-file');
      const program = e.dataTransfer?.getData('text/beatline-instrument');
      if (program) {
        e.preventDefault();
        app.commands.run(`add.instrument.${program}`);
        return;
      }
      if (!sid && !builtin && !file && !e.dataTransfer?.files.length) return;
      e.preventDefault();
      if (builtin) return this.addDrum(builtin);
      const samples = sid ? app.project.samples.filter((s) => s.id === sid) : file ? await app.importAudio([JSON.parse(file)]) : await app.dropFiles([...e.dataTransfer!.files]);
      for (const s of samples) app.addSampleChannel(s);
    });
    this.render();
  }

  shown(): void {
    this.render();
  }

  private addDrum(id: string): void {
    let ch = '';
    this.app.edit(`Add ${DRUM_SOUNDS.find((d) => d.id === id)?.name ?? 'drum'}`, (p) => void (ch = drumChannel(p, id).id));
    this.app.selectChannel(ch);
    this.app.engine.preview(ch, 60);
  }

  /** The menu for adding a channel: instruments, drums, synths, a sample file. */
  addMenu(at: HTMLElement): void {
    const app = this.app;
    const groups = [...new Set(DRUM_SOUNDS.map((d) => d.group))];
    const cats = [...new Set(SYNTH_PRESETS.map((s) => s.category))];
    showMenu(
      [
        { label: 'Instruments (piano, guitar, strings…)', icon: L.Piano, submenu: () => GM_FAMILIES.map((f) => ({ label: f, submenu: () => GM_INSTRUMENTS.filter((g) => g.family === f).map((g) => ({ label: g.name, run: () => app.commands.run(`add.instrument.${g.program}`) })) })) },
        { label: 'Drums and percussion', icon: L.Drum, submenu: () => groups.map((g) => ({ label: g, submenu: () => DRUM_SOUNDS.filter((d) => d.group === g).map((d) => ({ label: d.name, run: () => this.addDrum(d.id) })) })) },
        { label: 'Synths', icon: L.Piano, submenu: () => cats.map((c) => ({ label: c, submenu: () => SYNTH_PRESETS.filter((s) => s.category === c).map((s) => ({ label: s.name, run: () => app.commands.run(`add.synth.${s.id}`) })) })) },
        { label: 'Sample from a file…', icon: L.FileAudio, run: async () => {
          for (const s of await app.importAudio()) app.addSampleChannel(s);
        } },
      ],
      at,
    );
  }

  private render(): void {
    const app = this.app;
    const p = app.project;
    const pt = app.pattern;
    const steps = Math.max(1, Math.round(pt.length / STEP));
    // ---------- the bar ----------
    const patSel = h('select', { class: 'input rack-pattern', 'aria-label': 'Pattern' }, ...p.patterns.map((x) => h('option', { value: x.id }, x.name)), h('option', { value: '+new' }, 'New pattern…')) as HTMLSelectElement;
    patSel.value = pt.id;
    patSel.addEventListener('change', () => {
      if (patSel.value === '+new') app.newPattern();
      else app.selectPattern(patSel.value);
    });
    tooltip(patSel, 'The pattern being worked on (F4 makes a new one)');
    const bars = barTicks(p);
    const lenSel = h('select', { class: 'input', 'aria-label': 'Pattern length' }, ...[1, 2, 3, 4, 8].map((b) => h('option', { value: String(b * bars) }, `${b} bar${b === 1 ? '' : 's'}`))) as HTMLSelectElement;
    lenSel.value = String(pt.length);
    if (lenSel.value !== String(pt.length)) lenSel.append(h('option', { value: String(pt.length), selected: true }, `${(pt.length / bars).toFixed(2)} bars`));
    lenSel.addEventListener('change', () => app.edit('Pattern length', (x) => void (x.patterns.find((y) => y.id === pt.id)!.length = Number(lenSel.value))));
    tooltip(lenSel, 'How long the pattern is');
    const swing = knob({ label: 'Swing', min: 0, max: 1, value: p.swing, def: 0, step: 0.01, size: 26, format: (v) => `${Math.round(v * 100)}%`, title: 'Pushes every second 16th note late, for a laid-back groove', ...app.turning('Swing', (x, v) => void (x.swing = v)) });
    const beats = h('button', { class: 'btn small outline', onclick: (e: MouseEvent) => showMenu(DRUM_PATTERNS.map((d) => ({ label: `${d.name} · ${d.bpm} BPM`, run: () => app.commands.run(`add.beat.${d.id}`) })), e.currentTarget as HTMLElement) }, icon(L.Grid3x3, 14), 'Beats');
    tooltip(beats, 'Ready-made drum beats in many styles');
    const add = h('button', { class: 'btn small primary', onclick: (e: MouseEvent) => this.addMenu(e.currentTarget as HTMLElement) }, icon(L.Plus, 14), 'Add');
    tooltip(add, 'Add an instrument, a drum, a synth or a sample');
    const prog = h('button', { class: 'btn small outline', onclick: () => app.commands.run('add.progression') }, icon(L.ListMusic, 14), 'Chords');
    tooltip(prog, 'Write a chord progression in your key');
    this.bar.replaceChildren(patSel, lenSel, swing, h('span', { class: 'spacer' }), beats, prog, add);

    // ---------- the rows ----------
    this.lights.clear();
    this.stepEls.clear();
    if (!p.channels.length) {
      this.rows.replaceChildren(h('div', { class: 'panel-empty' }, icon(L.Drum, 28), h('p', null, 'No channels yet. Add drums or a synth, or pick a ready-made beat.'), h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: (e: MouseEvent) => this.addMenu(e.currentTarget as HTMLElement) }, 'Add a sound'), h('button', { class: 'btn outline', onclick: () => {
        app.edit('Beat', (x) => void applyDrumPattern(x, x.patterns.find((y) => y.id === x.activePattern)!, 'boomBap'));
      } }, 'Start with a beat'))));
      return;
    }
    this.rows.replaceChildren(...p.channels.map((c) => this.row(c, steps)));
    this.lastStep = -1;
    this.tick();
  }

  private row(c: Channel, count: number): HTMLElement {
    const app = this.app;
    const pt = app.pattern;
    const notes = pt.notes[c.id] ?? [];
    const selected = app.channel === c.id;
    const light = h('span', { class: 'ch-light' });
    this.lights.set(c.id, light);
    const mute = h('button', { class: `ch-mute${c.mute ? '' : ' on'}`, 'aria-label': c.mute ? 'Turn on' : 'Mute', onclick: (e: MouseEvent) => {
      if (e.ctrlKey) {
        // Solo: this one on, all the others off (again: everything back on)
        const others = app.project.channels.filter((x) => x.id !== c.id);
        const soloed = !c.mute && others.every((x) => x.mute);
        app.edit('Solo channel', (p) => {
          for (const x of p.channels) x.mute = soloed ? false : x.id !== c.id;
        });
      } else app.edit(c.mute ? 'Unmute channel' : 'Mute channel', (p) => void (p.channels.find((x) => x.id === c.id)!.mute = !c.mute));
    } });
    tooltip(mute, 'On / off (Ctrl+click: hear only this one)');
    const ch = (p: { channels: Channel[] }) => p.channels.find((x) => x.id === c.id)!;
    const vol = knob({ label: '', min: -40, max: 6, value: c.volume, def: CHANNEL_VOLUME, step: 0.5, size: 22, format: fmtDb, title: 'Volume', ...app.turning('Channel volume', (p, v) => void (ch(p).volume = v)) });
    const pan = knob({ label: '', min: -100, max: 100, value: c.pan, def: 0, step: 1, size: 22, format: fmtPan, title: 'Pan (left / right)', ...app.turning('Channel pan', (p, v) => void (ch(p).pan = v)) });
    const mixIndex = app.project.mixer.findIndex((m) => m.id === c.mixer);
    const route = h('button', { class: 'ch-route', onclick: () => {
      app.selectMixer(c.mixer);
      app.layout.show('mixer');
    } }, mixIndex <= 0 ? 'M' : String(mixIndex));
    tooltip(route, `Plays through mixer track ${mixIndex <= 0 ? 'Master' : `${mixIndex} (${app.project.mixer[mixIndex].name})`} — click to see it`);
    const name = h('button', { class: `ch-name${selected ? ' on' : ''}`, style: { '--ch': c.color } as unknown as Partial<CSSStyleDeclaration>, onclick: () => {
      app.selectChannel(c.id);
      app.engine.preview(c.id, c.kind === 'synth' ? 60 : 60);
    }, ondblclick: () => {
      app.selectChannel(c.id);
      app.layout.show('instrument');
    } }, h('span', { class: 'ch-swatch' }), h('span', { class: 'ch-label' }, c.name));
    tooltip(name, `${c.name}: click to play and select it; double-click for its settings`);
    name.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.channelMenu(c, e);
    });
    let steps: HTMLElement;
    if (isMelodic(notes)) steps = this.mini(c, notes);
    else steps = this.stepButtons(c, count);
    return h('div', { class: `ch-row${selected ? ' on' : ''}${c.mute ? ' muted' : ''}` }, light, mute, pan, vol, route, name, steps);
  }

  private stepButtons(c: Channel, count: number): HTMLElement {
    const app = this.app;
    const pt = app.pattern;
    const on = stepsOf(pt.notes[c.id], count);
    const vel = new Map((pt.notes[c.id] ?? []).map((n) => [n.start / STEP, n.vel]));
    const wrap = h('div', { class: 'ch-steps' });
    const els: HTMLElement[] = [];
    let painting: { to: boolean; edit: ReturnType<App['liveEdit']> } | null = null;
    const set = (i: number, to: boolean) => {
      const el = els[i];
      if (el.classList.contains('on') === to) return;
      el.classList.toggle('on', to);
      el.style.opacity = '';
      painting!.edit.update((p) => toggleStep(p.patterns.find((x) => x.id === pt.id)!, c.id, i, to));
      if (to) app.engine.preview(c.id, 60, 0.8, 0.15);
    };
    for (let i = 0; i < count; i++) {
      const b = h('button', { class: `step${on[i] ? ' on' : ''}${Math.floor(i / 4) % 2 ? ' alt' : ''}`, 'aria-label': `Step ${i + 1}`, style: { '--ch': c.color } as unknown as Partial<CSSStyleDeclaration> });
      if (on[i]) b.style.opacity = String(0.45 + 0.55 * (vel.get(i) ?? 0.8));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const to = e.button === 2 ? false : !b.classList.contains('on');
        painting = { to, edit: app.liveEdit(to ? 'Add steps' : 'Remove steps') };
        set(i, to);
        // The row follows the pointer while the button is held: every step it crosses is set
        wrap.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.step');
          const j = hit ? els.indexOf(hit as HTMLElement) : -1;
          if (painting && j >= 0) set(j, painting.to);
        };
        const up = () => {
          wrap.removeEventListener('pointermove', move);
          wrap.removeEventListener('pointerup', up);
          wrap.removeEventListener('pointercancel', up);
          painting?.edit.end();
          painting = null;
          // Selecting the channel redraws the rack, so only once the drag is over
          app.selectChannel(c.id);
        };
        wrap.addEventListener('pointermove', move);
        wrap.addEventListener('pointerup', up);
        wrap.addEventListener('pointercancel', up);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      els.push(b);
      wrap.append(b);
    }
    this.stepEls.set(c.id, els);
    return wrap;
  }

  /** A small view of a melody's notes (it's edited in the piano roll). */
  private mini(c: Channel, notes: { key: number; start: number; length: number }[]): HTMLElement {
    const app = this.app;
    const cv = h('canvas', { class: 'ch-mini' }) as HTMLCanvasElement;
    const draw = () => {
      const w = cv.clientWidth || 400;
      const hh = cv.clientHeight || 22;
      const dpr = devicePixelRatio || 1;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
      const ctx = cv.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const len = Math.max(app.pattern.length, ...notes.map((n) => n.start + n.length));
      const lo = Math.min(...notes.map((n) => n.key));
      const hi = Math.max(...notes.map((n) => n.key));
      const rowH = Math.max(1.5, (hh - 4) / Math.max(1, hi - lo + 1));
      ctx.fillStyle = c.color;
      for (const n of notes) ctx.fillRect((n.start / len) * w, 2 + (hi - n.key) * rowH, Math.max(2, (n.length / len) * w - 1), Math.max(1.5, rowH - 0.5));
    };
    requestAnimationFrame(draw);
    const el = h('button', { class: 'ch-steps mini', onclick: () => {
      app.selectChannel(c.id);
      app.layout.show('pianoRoll');
    } }, cv);
    tooltip(el, 'A melody: click to edit it in the piano roll');
    return el;
  }

  private channelMenu(c: Channel, e: MouseEvent): void {
    const app = this.app;
    const pt = app.pattern;
    const count = Math.round(pt.length / STEP);
    const items: MenuItem[] = [
      { label: 'Edit in the piano roll', icon: L.Piano, run: () => {
        app.selectChannel(c.id);
        app.layout.show('pianoRoll');
      } },
      { label: 'Channel settings', icon: L.SlidersHorizontal, run: () => {
        app.selectChannel(c.id);
        app.layout.show('instrument');
      } },
      { separator: true },
      { label: 'Fill every 2 steps', run: () => app.edit('Fill steps', (p) => fillSteps(p.patterns.find((x) => x.id === pt.id)!, c.id, 2)) },
      { label: 'Fill every 4 steps', run: () => app.edit('Fill steps', (p) => fillSteps(p.patterns.find((x) => x.id === pt.id)!, c.id, 4)) },
      { label: 'Fill every 8 steps', run: () => app.edit('Fill steps', (p) => fillSteps(p.patterns.find((x) => x.id === pt.id)!, c.id, 8)) },
      { label: 'Clear steps', icon: L.Eraser, run: () => app.edit('Clear steps', (p) => void delete p.patterns.find((x) => x.id === pt.id)!.notes[c.id]) },
      { label: 'Randomize', icon: L.Dices, run: () => app.edit('Randomize steps', (p) => {
        const x = p.patterns.find((y) => y.id === pt.id)!;
        x.notes[c.id] = [];
        for (let i = 0; i < count; i++) if (Math.random() < (i % 4 === 0 ? 0.6 : 0.25)) toggleStep(x, c.id, i, true, 0.6 + Math.random() * 0.4);
      }) },
      { separator: true },
      { label: 'Rename…', icon: L.Pencil, run: async () => {
        const n = await promptDialog('Rename channel', 'Name', c.name);
        if (n?.trim()) app.edit('Rename channel', (p) => {
          const ch = p.channels.find((x) => x.id === c.id)!;
          ch.name = n.trim();
          const m = p.mixer.find((x) => x.id === ch.mixer);
          if (m && m.id !== 'master' && !p.channels.some((o) => o !== ch && o.mixer === m.id)) m.name = ch.name;
        });
      } },
      { label: 'Color…', icon: L.Palette, run: async () => {
        let color = c.color;
        const picker = colorPicker((x) => x && (color = x), { current: color });
        if (await dialog('Channel color', picker, [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }])) app.edit('Channel color', (p) => void (p.channels.find((x) => x.id === c.id)!.color = color));
      } },
      { label: 'Clone', icon: L.CopyPlus, run: () => app.edit('Clone channel', (p) => {
        const src = p.channels.find((x) => x.id === c.id)!;
        const copy: Channel = { ...structuredClone(src), id: uid('c'), name: `${src.name} 2` };
        p.channels.splice(p.channels.indexOf(src) + 1, 0, copy);
      }) },
      { label: 'Move up', icon: L.ArrowUp, disabled: app.project.channels[0]?.id === c.id, run: () => this.move(c.id, -1) },
      { label: 'Move down', icon: L.ArrowDown, disabled: app.project.channels[app.project.channels.length - 1]?.id === c.id, run: () => this.move(c.id, 1) },
      { separator: true },
      { label: 'Delete', icon: L.Trash2, run: () => {
        const used = app.project.patterns.filter((x) => x.notes[c.id]?.length).length;
        app.edit('Delete channel', (p) => deleteChannel(p, c.id));
        if (used) toast(`${c.name} and its notes in ${used} pattern${used === 1 ? '' : 's'} were deleted. Undo brings them back.`);
      } },
    ];
    showMenu(items, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }

  private move(id: string, d: number): void {
    this.app.edit('Move channel', (p) => {
      const i = p.channels.findIndex((x) => x.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= p.channels.length) return false;
      [p.channels[i], p.channels[j]] = [p.channels[j], p.channels[i]];
    });
  }

  /** Lights channels that just played, and marks the step being played. */
  private tick(): void {
    const app = this.app;
    const e = app.engine;
    const now = e.ctx.currentTime;
    for (const [id, el] of this.lights) {
      const t = e.lastHit.get(id);
      el.classList.toggle('on', t !== undefined && now - t < 0.12 && now >= t - 0.02);
    }
    const step = e.playing && e.mode === 'pattern' ? Math.floor(e.position / STEP) : -1;
    if (step !== this.lastStep) {
      for (const els of this.stepEls.values()) {
        els[this.lastStep]?.classList.remove('now');
        els[step]?.classList.add('now');
      }
      this.lastStep = step;
    }
    // Lights fade even after playback stops
    cancelAnimationFrame(this.raf);
    if (!e.playing && [...this.lights.values()].some((x) => x.classList.contains('on'))) this.raf = requestAnimationFrame(() => this.tick());
  }
}
