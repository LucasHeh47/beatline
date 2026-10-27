// The Mixer: a strip for the master and each mixer track (every channel and audio track has one), with
// meters, a fader, pan, mute and solo; and the effects of the selected strip, with their settings and
// ready-made chains (guitar amps, vocals, drums, a loud and safe master).
import * as L from 'lucide';
import { CHAIN_PRESETS, EFFECTS, effectDef, makeEffect, type ParamDef } from '../../core/effects';
import type { Effect, MixerTrack, Project } from '../../core/project';
import type { App } from '../app';
import { fmtDb, fmtHz, fmtPan, fmtPct, fmtSecs, knob } from '../controls';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { promptDialog, showMenu, tooltip } from '../widgets';

const DB_MIN = -60;
const DB_MAX = 6;
/** Fader position (0–1) for a level, with more room near 0 dB, like a real desk. */
const faderPos = (db: number) => (db <= DB_MIN ? 0 : Math.pow((db - DB_MIN) / (DB_MAX - DB_MIN), 1.6));
const faderDb = (pos: number) => (pos <= 0.001 ? -80 : DB_MIN + Math.pow(pos, 1 / 1.6) * (DB_MAX - DB_MIN));

function paramFormat(d: ParamDef): (v: number) => string {
  if (d.unit === 'Hz') return fmtHz;
  if (d.unit === 'dB') return fmtDb;
  if (d.unit === 's') return fmtSecs;
  if (d.unit === ':1') return (v) => `${v.toFixed(1)}:1`;
  if ((d.max ?? 1) <= 1 && (d.min ?? 0) >= 0) return fmtPct;
  return (v) => `${+v.toFixed(2)}${d.unit ?? ''}`;
}

export class MixerPanel implements Panel {
  readonly id = 'mixer';
  readonly title = 'Mixer';
  readonly el: HTMLElement;
  private strips: HTMLElement;
  private side: HTMLElement;
  private meters = new Map<string, HTMLCanvasElement>();
  private held = new Map<string, [number, number]>();
  private fx: string | null = null;
  private raf = 0;

  constructor(private app: App) {
    this.strips = h('div', { class: 'mx-strips' });
    this.side = h('div', { class: 'mx-side' });
    this.el = h('div', { class: 'mixer' }, this.strips, this.side);
    for (const k of ['project', 'selection'] as const) app.on(k, () => this.render());
    app.on('transport', () => this.animate());
    this.render();
  }

  shown(): void {
    this.render();
    this.animate();
  }

  private render(): void {
    const app = this.app;
    const p = app.project;
    this.meters.clear();
    this.strips.replaceChildren(...p.mixer.map((m, i) => this.strip(m, i)), h('button', { class: 'mx-add', onclick: () => app.commands.run('add.audioTrack') }, icon(L.Plus, 14), 'Track'));
    this.renderSide();
    this.animate();
  }

  private strip(m: MixerTrack, i: number): HTMLElement {
    const app = this.app;
    const sel = app.mixerTrack === m.id;
    const mt = (p: Project) => p.mixer.find((x) => x.id === m.id)!;
    const meter = h('canvas', { class: 'mx-meter', width: 18, height: 160 }) as HTMLCanvasElement;
    this.meters.set(m.id, meter);
    // The fader
    const thumb = h('div', { class: 'mx-thumb' });
    const fader = h('div', { class: 'mx-fader', tabindex: '0', role: 'slider', 'aria-label': `${m.name} volume` }, h('div', { class: 'mx-fader-track' }), thumb);
    const readout = h('span', { class: 'mx-db' }, fmtDb(m.volume));
    const place = (db: number) => {
      thumb.style.bottom = `calc(${(faderPos(db) * 100).toFixed(2)}% - 6px)`;
      readout.textContent = fmtDb(db);
    };
    place(m.volume);
    const turn = app.turning(`${m.name} volume`, (p, v) => void (mt(p).volume = v));
    fader.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fader.setPointerCapture(e.pointerId);
      const r = fader.getBoundingClientRect();
      const at = (y: number) => Math.max(0, Math.min(1, 1 - (y - r.top - 6) / (r.height - 12)));
      let db = faderDb(at(e.clientY));
      place(db);
      turn.onInput(db);
      const move = (ev: PointerEvent) => {
        db = Math.round(faderDb(at(ev.clientY)) * 10) / 10;
        place(db);
        turn.onInput(db);
      };
      const up = () => {
        fader.removeEventListener('pointermove', move);
        fader.removeEventListener('pointerup', up);
        turn.onChange(db);
      };
      fader.addEventListener('pointermove', move);
      fader.addEventListener('pointerup', up);
    });
    fader.addEventListener('dblclick', () => {
      place(0);
      turn.onChange(0);
    });
    let wheeled = m.volume;
    fader.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheeled = Math.max(-80, Math.min(DB_MAX, Math.round((wheeled + (e.deltaY < 0 ? 0.5 : -0.5)) * 10) / 10));
      place(wheeled);
      turn.onChange(wheeled);
    }, { passive: false });
    tooltip(fader, 'Volume: drag, or double-click for 0 dB');
    const pan = knob({ label: '', min: -100, max: 100, value: m.pan, def: 0, step: 1, size: 26, format: fmtPan, title: 'Pan (left / right)', ...app.turning(`${m.name} pan`, (p, v) => void (mt(p).pan = v)) });
    const mute = h('button', { class: `mx-btn mute${m.mute ? ' on' : ''}`, 'aria-label': 'Mute', onclick: () => app.edit(m.mute ? 'Unmute' : 'Mute', (p) => void (mt(p).mute = !m.mute)) }, 'M');
    const solo = m.id === 'master' ? null : h('button', { class: `mx-btn solo${m.solo ? ' on' : ''}`, 'aria-label': 'Solo', onclick: () => app.edit(m.solo ? 'Unsolo' : 'Solo', (p) => void (mt(p).solo = !m.solo)) }, 'S');
    const name = h('div', { class: 'mx-name', title: 'Double-click to rename' }, m.name);
    name.addEventListener('dblclick', async () => {
      const n = await promptDialog('Rename mixer track', 'Name', m.name);
      if (n?.trim()) app.edit('Rename mixer track', (p) => void (mt(p).name = n.trim()));
    });
    const fxCount = m.effects.length;
    const el = h(
      'div',
      { class: `mx-strip${sel ? ' on' : ''}${m.id === 'master' ? ' master' : ''}`, style: { '--mx': m.color } as unknown as Partial<CSSStyleDeclaration>, onclick: () => app.selectMixer(m.id) },
      h('div', { class: 'mx-num' }, m.id === 'master' ? 'Out' : String(i)),
      name,
      h('div', { class: 'mx-fx-count' }, fxCount ? `${fxCount} effect${fxCount === 1 ? '' : 's'}` : 'No effects'),
      pan,
      h('div', { class: 'mx-fader-row' }, fader, meter),
      readout,
      h('div', { class: 'mx-btns' }, mute, solo),
    );
    return el;
  }

  // ---------- the effects of the selected strip ----------

  private renderSide(): void {
    const app = this.app;
    const m = app.project.mixer.find((x) => x.id === app.mixerTrack) ?? app.project.mixer[0];
    const mt = (p: Project) => p.mixer.find((x) => x.id === m.id)!;
    if (this.fx && !m.effects.some((e) => e.id === this.fx)) this.fx = null;
    const add = h('button', { class: 'btn small primary', onclick: (e: MouseEvent) => {
      const cats = [...new Set(EFFECTS.map((x) => x.category))];
      showMenu(
        cats.map((c) => ({ label: c, submenu: () => EFFECTS.filter((x) => x.category === c).map((x) => ({ label: x.name, run: () => {
          const fx = makeEffect(x.type);
          app.edit(`Add ${x.name}`, (p) => void mt(p).effects.push(fx));
          this.fx = fx.id;
          this.renderSide();
        } })) })),
        e.currentTarget as HTMLElement,
      );
    } }, icon(L.Plus, 14), 'Add effect');
    const presets = h('button', { class: 'btn small outline', onclick: (e: MouseEvent) => showMenu(
      CHAIN_PRESETS.map((c) => ({ label: c.name, hint: c.description, run: () => {
        app.edit(`Effects: ${c.name}`, (p) => void (mt(p).effects = c.effects()));
        this.fx = null;
      } })),
      e.currentTarget as HTMLElement,
    ) }, icon(L.Sparkles, 14), 'Presets');
    tooltip(presets, 'Ready-made effect chains: guitar amps, vocals, drums, master');
    const slots = h('div', { class: 'fx-slots' });
    m.effects.forEach((e, i) => {
      const def = effectDef(e.type);
      const on = h('button', { class: `fx-on${e.on ? ' on' : ''}`, 'aria-label': e.on ? 'Switch off' : 'Switch on', onclick: (ev: MouseEvent) => {
        ev.stopPropagation();
        app.edit(e.on ? `${def?.name} off` : `${def?.name} on`, (p) => void (mt(p).effects[i].on = !e.on));
      } });
      tooltip(on, e.on ? 'On (click to bypass)' : 'Bypassed (click to switch on)');
      const menu = h('button', { class: 'btn icon-only', 'aria-label': 'More', onclick: (ev: MouseEvent) => {
        ev.stopPropagation();
        showMenu(
          [
            { label: 'Move up', icon: L.ArrowUp, disabled: i === 0, run: () => app.edit('Move effect', (p) => {
              const list = mt(p).effects;
              [list[i - 1], list[i]] = [list[i], list[i - 1]];
            }) },
            { label: 'Move down', icon: L.ArrowDown, disabled: i === m.effects.length - 1, run: () => app.edit('Move effect', (p) => {
              const list = mt(p).effects;
              [list[i + 1], list[i]] = [list[i], list[i + 1]];
            }) },
            { label: 'Reset settings', icon: L.RotateCcw, run: () => app.edit(`Reset ${def?.name}`, (p) => void (mt(p).effects[i].params = makeEffect(e.type).params)) },
            { separator: true },
            { label: 'Remove', icon: L.Trash2, run: () => app.edit(`Remove ${def?.name}`, (p) => void mt(p).effects.splice(i, 1)) },
          ],
          ev.currentTarget as HTMLElement,
        );
      } }, icon(L.Ellipsis, 14));
      slots.append(h('div', { class: `fx-slot${this.fx === e.id ? ' open' : ''}${e.on ? '' : ' off'}`, onclick: () => {
        this.fx = this.fx === e.id ? null : e.id;
        this.renderSide();
      } }, on, h('span', { class: 'fx-name' }, def?.name ?? e.type), menu));
    });
    if (!m.effects.length) slots.append(h('p', { class: 'hint fx-empty' }, m.id === 'master' ? 'Effects here change the whole song. Try Presets → Master: loud and safe.' : 'Add an effect, or pick a preset — a guitar amp, vocals, drums…'));
    const open = m.effects.find((e) => e.id === this.fx);
    this.side.replaceChildren(
      h('div', { class: 'mx-side-head' }, h('span', { class: 'mx-side-swatch', style: { background: m.color } }), h('strong', null, m.name), h('span', { class: 'spacer' }), presets, add),
      slots,
      open ? this.editor(m, open) : h('div'),
    );
  }

  private editor(m: MixerTrack, e: Effect): HTMLElement {
    const app = this.app;
    const def = effectDef(e.type);
    if (!def) return h('div');
    const fx = (p: Project) => p.mixer.find((x) => x.id === m.id)!.effects.find((x) => x.id === e.id)!;
    const controls = def.params.map((d) => {
      const v = e.params[d.id] ?? d.default;
      if (d.kind === 'num') {
        return knob({ label: d.label, min: d.min!, max: d.max!, value: Number(v), def: Number(d.default), step: d.step, log: d.log, format: paramFormat(d), size: 38, ...app.turning(`${def.name}: ${d.label.toLowerCase()}`, (p, x) => void (fx(p).params[d.id] = x)) });
      }
      if (d.kind === 'choice') {
        const sel = h('select', { class: 'input' }, ...(d.options ?? []).map(([val, label]) => h('option', { value: val }, label))) as HTMLSelectElement;
        sel.value = String(v);
        sel.addEventListener('change', () => app.edit(`${def.name}: ${d.label.toLowerCase()}`, (p) => void (fx(p).params[d.id] = sel.value)));
        return h('label', { class: 'fx-choice' }, h('span', null, d.label), sel);
      }
      const box = h('input', { type: 'checkbox', checked: !!v }) as HTMLInputElement;
      box.addEventListener('change', () => app.edit(`${def.name}: ${d.label.toLowerCase()}`, (p) => void (fx(p).params[d.id] = box.checked)));
      return h('label', { class: 'fx-bool' }, box, h('span', null, d.label));
    });
    return h('div', { class: 'fx-editor' }, h('div', { class: 'fx-editor-head' }, h('strong', null, def.name), h('span', { class: 'hint' }, def.description)), h('div', { class: 'fx-knobs' }, ...controls));
  }

  // ---------- meters ----------

  private animate(): void {
    cancelAnimationFrame(this.raf);
    if (this.el.hidden || !this.el.isConnected) return;
    const loop = () => {
      this.drawMeters();
      // Keep going while there's sound (playing, a recording input, or tails dying away)
      if (this.app.engine.playing || this.app.recorder.open || [...this.held.values()].some(([l, r]) => l > 0.001 || r > 0.001)) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private drawMeters(): void {
    const levels = this.app.engine.graph.levels();
    for (const [id, cv] of this.meters) {
      const [l, r] = levels.get(id) ?? [0, 0];
      const prev = this.held.get(id) ?? [0, 0];
      // Quick up, slow down
      const hl = Math.max(l, prev[0] * 0.92);
      const hr = Math.max(r, prev[1] * 0.92);
      this.held.set(id, [hl, hr]);
      const ctx = cv.getContext('2d')!;
      const W = cv.width;
      const H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, W, H);
      const bar = (v: number, x: number) => {
        const db = v > 0 ? 20 * Math.log10(v) : -80;
        const t = Math.max(0, Math.min(1, (db + 54) / 60));
        const hgt = t * H;
        const g = ctx.createLinearGradient(0, H, 0, 0);
        g.addColorStop(0, '#3fcf8e');
        g.addColorStop(0.75, '#ffd43b');
        g.addColorStop(0.92, '#ff6b6b');
        ctx.fillStyle = g;
        ctx.fillRect(x, H - hgt, W / 2 - 1, hgt);
        if (db > -0.1) {
          ctx.fillStyle = '#ff3b3b';
          ctx.fillRect(x, 0, W / 2 - 1, 3);
        }
      };
      bar(hl, 0);
      bar(hr, W / 2 + 1);
    }
  }
}
