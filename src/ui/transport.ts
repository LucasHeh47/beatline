// The transport bar: pattern or song mode, play / stop / record, where the playhead is, the tempo
// (type it, drag it or tap it), the time signature, metronome, loop, the computer keyboard as a piano,
// and the master volume with its meter.
import * as L from 'lucide';
import { barBeat, clock, ticksToSeconds } from '../core/project';
import type { App } from './app';
import { fmtDb, knob } from './controls';
import { h, icon } from './dom';
import { tooltip } from './widgets';

const SIGNATURES: [number, number][] = [
  [4, 4],
  [3, 4],
  [6, 8],
  [2, 4],
  [5, 4],
  [7, 8],
  [12, 8],
];

export class Transport {
  readonly el: HTMLElement;
  private pos: HTMLElement;
  private time: HTMLElement;
  private bpm: HTMLInputElement;
  private meter: HTMLCanvasElement;
  private taps: number[] = [];
  private held: [number, number] = [0, 0];
  private raf = 0;

  constructor(private app: App) {
    this.pos = h('span', { class: 'tp-pos' });
    this.time = h('span', { class: 'tp-time' });
    this.bpm = h('input', { class: 'input tp-bpm-input', type: 'number', min: 20, max: 400, step: 0.1, 'aria-label': 'Tempo (BPM)' }) as HTMLInputElement;
    this.meter = h('canvas', { class: 'tp-meter', width: 70, height: 14 }) as HTMLCanvasElement;
    this.el = h('div', { class: 'transport' });
    for (const k of ['transport', 'project', 'pattern', 'settings'] as const) app.on(k, () => this.render());
    app.on('playhead', () => this.updatePos());
    this.render();
  }

  tap(): void {
    const now = performance.now();
    this.taps = [...this.taps.filter((t) => now - t < 2500), now].slice(-6);
    if (this.taps.length < 3) {
      this.app.statusbar.flash(`Tap ${4 - this.taps.length} more time${this.taps.length === 3 ? '' : 's'}…`);
      return;
    }
    const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    const bpm = Math.round((60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)) * 10) / 10;
    if (bpm >= 20 && bpm <= 400) this.setBpm(bpm);
  }

  private setBpm(v: number): void {
    const bpm = Math.max(20, Math.min(400, Math.round(v * 10) / 10));
    this.app.edit('Tempo', (p) => void (p.bpm = bpm));
  }

  private render(): void {
    const app = this.app;
    const p = app.project;
    const e = app.engine;
    const mode = h('div', { class: 'tp-mode', role: 'radiogroup' },
      ...(['pattern', 'song'] as const).map((m) => {
        const b = h('button', { class: `tp-mode-btn${app.mode === m ? ' on' : ''}`, role: 'radio', 'aria-checked': app.mode === m ? 'true' : 'false', onclick: () => app.setMode(m) }, m === 'pattern' ? 'Pattern' : 'Song');
        tooltip(b, m === 'pattern' ? 'Loop the pattern you’re working on' : 'Play the whole song (the playlist)', 'L');
        return b;
      }),
    );
    const play = h('button', { class: `tp-btn play${e.playing && !app.recording ? ' on' : ''}`, 'aria-label': e.playing ? 'Pause' : 'Play', onclick: () => app.togglePlay() }, icon(e.playing ? L.Pause : L.Play, 18));
    tooltip(play, e.playing ? 'Pause' : 'Play', 'Space');
    const stop = h('button', { class: 'tp-btn', 'aria-label': 'Stop', onclick: () => app.stop() }, icon(L.Square, 16));
    tooltip(stop, 'Stop (again: back to the start)');
    const rec = h('button', { class: `tp-btn rec${app.recording ? ' on' : ''}`, 'aria-label': 'Record', onclick: () => void app.record() }, icon(L.Circle, 16));
    tooltip(rec, app.armed.size ? 'Record on the armed track' : 'Record (arm a track for audio; otherwise notes from a keyboard go into the pattern)', 'Ctrl+Shift+R');
    this.bpm.value = String(p.bpm);
    this.bpm.onchange = () => this.setBpm(Number(this.bpm.value) || p.bpm);
    const bpmLabel = h('span', { class: 'tp-bpm-label' }, 'BPM');
    // Drag the label up and down to change the tempo
    bpmLabel.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      bpmLabel.setPointerCapture(ev.pointerId);
      const y0 = ev.clientY;
      const start = p.bpm;
      const session = app.liveEdit('Tempo');
      const move = (m: PointerEvent) => {
        const v = Math.max(20, Math.min(400, Math.round(start + (y0 - m.clientY) * (m.shiftKey ? 0.1 : 0.5))));
        this.bpm.value = String(v);
        session.update((x) => void (x.bpm = v));
      };
      const up = () => {
        bpmLabel.removeEventListener('pointermove', move);
        bpmLabel.removeEventListener('pointerup', up);
        session.end();
      };
      bpmLabel.addEventListener('pointermove', move);
      bpmLabel.addEventListener('pointerup', up);
    });
    tooltip(bpmLabel, 'Tempo: type it, or drag up and down');
    const tap = h('button', { class: 'btn small tp-tap', onclick: () => this.tap() }, 'Tap');
    tooltip(tap, 'Tap along to set the tempo', 'Shift+T');
    const sig = h('select', { class: 'input tp-sig', 'aria-label': 'Time signature' }, ...SIGNATURES.map(([a, b]) => h('option', { value: `${a}/${b}` }, `${a}/${b}`))) as HTMLSelectElement;
    sig.value = `${p.beatsPerBar}/${p.beatUnit}`;
    sig.addEventListener('change', () => {
      const [a, b] = sig.value.split('/').map(Number);
      app.edit('Time signature', (x) => {
        x.beatsPerBar = a;
        x.beatUnit = b;
      });
    });
    tooltip(sig, 'Time signature');
    const metro = h('button', { class: `tp-btn small${e.metronome ? ' on' : ''}`, 'aria-label': 'Metronome', onclick: () => app.setMetronome(!e.metronome) }, icon(L.Timer, 16));
    tooltip(metro, e.metronome ? 'Metronome on' : 'Metronome off', 'Ctrl+M');
    const loop = h('button', { class: `tp-btn small${p.loop ? ' on' : ''}`, 'aria-label': 'Loop', onclick: () => app.commands.run('play.loop') }, icon(L.Repeat2, 16));
    tooltip(loop, p.loop ? 'Looping a section of the song (click to stop looping)' : 'Loop a section of the song (or Shift+drag on the playlist’s ruler)');
    const keys = h('button', { class: `tp-btn small${app.prefs.typingKeys ? ' on' : ''}`, 'aria-label': 'Computer keyboard plays notes', onclick: () => app.commands.run('view.typingKeys') }, icon(L.Keyboard, 16), app.prefs.typingKeys ? h('span', { class: 'tp-oct' }, `C${app.prefs.octave}`) : null);
    tooltip(keys, app.prefs.typingKeys ? 'The keyboard plays notes (Z–M, Q–P; - and = change the octave). Click to turn off.' : 'Play notes with the computer keyboard', 'Ctrl+T');
    const midi = app.keyboard.midiNames.length ? h('span', { class: 'tp-midi', title: app.keyboard.midiNames.join(', ') }, icon(L.Piano, 14), 'MIDI') : null;
    const master = p.mixer[0];
    const vol = knob({ label: '', min: -40, max: 6, value: master.volume, def: 0, step: 0.5, size: 24, format: fmtDb, title: 'Master volume', ...app.turning('Master volume', (x, v) => void (x.mixer[0].volume = v)) });
    this.el.replaceChildren(
      mode,
      h('div', { class: 'tp-group' }, play, stop, rec),
      h('div', { class: 'tp-display' }, this.pos, this.time),
      h('div', { class: 'tp-group tp-tempo' }, this.bpm, bpmLabel, tap, sig),
      h('div', { class: 'tp-group' }, metro, loop, keys),
      midi ?? '',
      h('span', { class: 'spacer' }),
      h('div', { class: 'tp-group tp-master' }, h('span', { class: 'hint' }, 'Master'), vol, this.meter),
    );
    this.updatePos();
    this.animate();
  }

  private updatePos(): void {
    const app = this.app;
    const p = app.project;
    const t = app.engine.position;
    this.pos.textContent = barBeat(t, p);
    this.time.textContent = clock(ticksToSeconds(t, p.bpm));
    this.el.classList.toggle('recording', app.recording);
  }

  /** The master meter, while there's sound. */
  private animate(): void {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      const [l, r] = this.app.engine.graph.levels().get('master') ?? [0, 0];
      this.held = [Math.max(l, this.held[0] * 0.9), Math.max(r, this.held[1] * 0.9)];
      const c = this.meter;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(128,128,128,0.18)';
      ctx.fillRect(0, 0, c.width, c.height);
      this.held.forEach((v, i) => {
        const db = v > 0 ? 20 * Math.log10(v) : -80;
        const w = Math.max(0, Math.min(1, (db + 54) / 54)) * c.width;
        ctx.fillStyle = db > -0.5 ? '#ff4d4d' : db > -9 ? '#ffd43b' : '#3fcf8e';
        ctx.fillRect(0, i * 7 + 1, w, 5);
      });
      if (this.app.engine.playing || this.app.recorder.open || this.held[0] > 0.001) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
}
