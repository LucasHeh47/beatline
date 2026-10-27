// Recording: the input (an audio interface's guitar input, a microphone), its level, hearing yourself
// through the track's effects, the count-in and metronome, quick setups for a guitar or vocal track,
// and a tuner.
import * as L from 'lucide';
import { CHAIN_PRESETS } from '../../core/effects';
import { addAudioTrack, mixerById } from '../../core/project';
import { noteName } from '../../core/theory';
import { detectPitch, TUNINGS, tuneTo } from '../../core/tuner';
import { InputRecorder, type InputDevice } from '../../audio/recorder';
import type { App } from '../app';
import { fmtDb, knob } from '../controls';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { tooltip } from '../widgets';

export class RecordPanel implements Panel {
  readonly id = 'record';
  readonly title = 'Recording';
  readonly el: HTMLElement;
  private left: HTMLElement;
  private tuner: HTMLElement;
  private devices: InputDevice[] = [];
  private meter: HTMLCanvasElement;
  private needle: HTMLCanvasElement;
  private noteEl: HTMLElement;
  private centsEl: HTMLElement;
  private stringsEl: HTMLElement;
  private raf = 0;
  private buf = new Float32Array(4096);
  private smoothHz = 0;
  private peak = 0;

  constructor(private app: App) {
    this.left = h('div', { class: 'rec-setup' });
    this.meter = h('canvas', { class: 'rec-meter', width: 220, height: 12 }) as HTMLCanvasElement;
    this.needle = h('canvas', { class: 'tuner-needle', width: 280, height: 120 }) as HTMLCanvasElement;
    this.noteEl = h('div', { class: 'tuner-note' }, '–');
    this.centsEl = h('div', { class: 'tuner-cents' }, 'Play a string');
    this.stringsEl = h('div', { class: 'tuner-strings' });
    this.tuner = h('div', { class: 'rec-tuner' });
    this.el = h('div', { class: 'record-panel' }, this.left, this.tuner);
    for (const k of ['project', 'transport'] as const) app.on(k, () => {
      if (!this.el.hidden) this.render();
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.loadDevices());
    this.render();
  }

  shown(): void {
    void this.loadDevices();
    this.render();
  }

  private async loadDevices(): Promise<void> {
    try {
      this.devices = await InputRecorder.devices();
    } catch {
      this.devices = [];
    }
    this.render();
  }

  private render(): void {
    const app = this.app;
    const p = app.project;
    const r = app.recorder;
    const prefs = app.prefs;
    const device = h('select', { class: 'input rec-device', 'aria-label': 'Input' }, h('option', { value: '' }, 'Default input'), ...this.devices.map((d) => h('option', { value: d.id }, d.label))) as HTMLSelectElement;
    device.value = prefs.inputDevice;
    const channel = h('select', { class: 'input', 'aria-label': 'Input channel' }, h('option', { value: 'mono' }, 'Mono (all inputs)'), h('option', { value: 'left' }, 'Input 1 (left)'), h('option', { value: 'right' }, 'Input 2 (right)'), h('option', { value: 'stereo' }, 'Stereo (1 and 2)')) as HTMLSelectElement;
    channel.value = prefs.inputChannel;
    tooltip(channel, 'On an audio interface, a guitar is usually in input 1 and a microphone in input 2');
    const reopen = async () => {
      prefs.inputDevice = device.value;
      prefs.inputChannel = channel.value as typeof prefs.inputChannel;
      app.savePrefs();
      if (r.open) {
        r.close();
        await app.openInput();
      }
    };
    device.addEventListener('change', () => void reopen());
    channel.addEventListener('change', () => void reopen());
    const openBtn = h('button', { class: `btn small ${r.open ? 'outline' : 'primary'}`, onclick: async () => {
      if (r.open) {
        r.close();
        app.armed.clear();
        app.emit('transport', 'project');
      } else if (await app.openInput()) await this.loadDevices();
      this.render();
    } }, icon(r.open ? L.MicOff : L.Mic, 14), r.open ? 'Close input' : 'Open input');
    const gain = knob({ label: 'Input', min: -24, max: 24, value: r.gainDb, def: 0, step: 0.5, size: 30, format: fmtDb, title: 'Input gain: aim for the meter to peak in the yellow when you play hard', onInput: (v) => r.setInputGain(v), onChange: (v) => r.setInputGain(v) });
    const monitor = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.monitor, onchange: (e: Event) => {
      prefs.monitor = (e.target as HTMLInputElement).checked;
      app.savePrefs();
      app.updateMonitoring();
    } }), h('span', null, 'Hear yourself through the track’s effects (use headphones)'));
    const latency = knob({ label: 'Delay fix', min: -100, max: 200, value: prefs.latencyMs, def: 0, step: 1, size: 30, format: (v) => `${Math.round(v)} ms`, title: 'If recordings come out late, turn this up until they line up with the beat (Beatline already allows for the sound card’s reported delay)', onChange: (v) => {
      prefs.latencyMs = v;
      r.offsetMs = v;
      app.savePrefs();
    } });
    const countIn = h('select', { class: 'input', 'aria-label': 'Count-in' }, h('option', { value: '0' }, 'No count-in'), h('option', { value: '1' }, 'Count in 1 bar'), h('option', { value: '2' }, 'Count in 2 bars')) as HTMLSelectElement;
    countIn.value = String(prefs.countIn);
    countIn.addEventListener('change', () => {
      prefs.countIn = Number(countIn.value);
      app.savePrefs();
    });
    const metro = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: app.engine.metronome, onchange: (e: Event) => app.setMetronome((e.target as HTMLInputElement).checked) }), h('span', null, 'Metronome'));
    const armed = p.tracks.find((t) => app.armed.has(t.id));
    const quick = (label: string, ic: L.IconNode, chain: string) =>
      h('button', { class: 'btn small outline', onclick: async () => {
        let id = '';
        app.edit(`Add ${label.toLowerCase()} track`, (x) => {
          // At the top of the playlist, where it's seen
          const t = addAudioTrack(x, label, 0);
          mixerById(x, t.mixer).effects = CHAIN_PRESETS.find((c) => c.id === chain)!.effects();
          id = t.id;
        });
        await app.toggleArm(id);
        app.layout.show('playlist');
      } }, icon(ic, 14), label);
    const amps = armed
      ? h(
          'div',
          { class: 'rec-amps' },
          h('span', { class: 'hint' }, `Sound for ${armed.name}:`),
          ...CHAIN_PRESETS.filter((c) => /guitar|acoustic|bass|vocal/i.test(c.id)).map((c) => {
            const b = h('button', { class: 'chip', onclick: () => {
              app.edit(`Effects: ${c.name}`, (x) => {
                const t = x.tracks.find((y) => y.id === armed.id)!;
                mixerById(x, t.mixer).effects = c.effects();
              });
            } }, c.name.replace(/^Guitar: /, ''));
            tooltip(b, c.description);
            return b;
          }),
        )
      : null;
    const recBtn = h('button', { class: `btn rec-big${app.recording ? ' on' : ''}`, onclick: () => app.commands.run('play.record') }, icon(app.recording ? L.Square : L.Circle, 16), app.recording ? 'Stop recording' : armed ? `Record on ${armed.name}` : 'Record notes');
    tooltip(recBtn, armed ? 'Records from the playhead, after the count-in (Ctrl+Shift+R)' : 'With no track armed, notes you play on a keyboard go into the pattern');
    this.left.replaceChildren(
      h('h3', null, 'Input'),
      h('div', { class: 'rec-row' }, device, channel, openBtn),
      h('div', { class: 'rec-row' }, gain, h('div', { class: 'rec-meter-wrap' }, this.meter, h('span', { class: 'hint' }, r.open ? 'Play: the meter should move' : 'Open the input to see its level')), latency),
      monitor,
      h('h3', null, 'Record'),
      armed
        ? h('p', { class: 'rec-armed' }, icon(L.Circle, 12), ` ${armed.name} is armed. Recording starts at the playhead.`)
        : h('p', { class: 'hint' }, 'Arm a track in the playlist (the ● button), or make one:'),
      armed ? '' : h('div', { class: 'row-btns' }, quick('Guitar', L.Guitar, 'guitarCrunch'), quick('Vocals', L.Mic, 'vocals'), quick('Bass', L.AudioLines, 'bassGuitar'), quick('Acoustic', L.Guitar, 'acoustic')),
      amps ?? '',
      h('div', { class: 'rec-row' }, countIn, metro, recBtn),
      h('p', { class: 'hint' }, 'Loop a section (Shift+drag on the playlist ruler) to record several takes in a row; the last one plays and the others are kept.'),
    );
    // The tuner
    const tuning = h('select', { class: 'input', 'aria-label': 'Tuning' }, ...TUNINGS.map((t) => h('option', { value: t.id }, t.name))) as HTMLSelectElement;
    tuning.value = prefs.tuning;
    tuning.addEventListener('change', () => {
      prefs.tuning = tuning.value;
      app.savePrefs();
      this.renderStrings(-1);
    });
    this.tuner.replaceChildren(h('div', { class: 'rec-tuner-head' }, h('h3', null, 'Tuner'), tuning), this.noteEl, this.needle, this.centsEl, this.stringsEl, r.open ? '' : h('p', { class: 'hint' }, 'Open the input and play a string.'));
    this.renderStrings(-1);
    this.loop();
  }

  private renderStrings(active: number): void {
    const t = TUNINGS.find((x) => x.id === this.app.prefs.tuning) ?? TUNINGS[0];
    this.stringsEl.replaceChildren(...t.strings.map((k, i) => h('span', { class: `tuner-string${i === active ? ' on' : ''}` }, noteName(k).replace(/\d+$/, ''))));
  }

  /** Meter and tuner, while the panel is showing and the input is open. */
  private loop(): void {
    cancelAnimationFrame(this.raf);
    if (this.el.hidden || !this.app.recorder.open) {
      this.drawMeter(0);
      return;
    }
    let frame = 0;
    const step = () => {
      if (this.el.hidden || !this.app.recorder.open) return;
      const r = this.app.recorder;
      this.drawMeter(r.level());
      // The tuner a few times a second is plenty (and lighter)
      if (frame++ % 3 === 0) this.updateTuner();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private drawMeter(level: number): void {
    this.peak = Math.max(level, this.peak * 0.9);
    const c = this.meter;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(128,128,128,0.2)';
    ctx.fillRect(0, 0, c.width, c.height);
    const db = this.peak > 0 ? 20 * Math.log10(this.peak) : -80;
    const t = Math.max(0, Math.min(1, (db + 54) / 54));
    ctx.fillStyle = db > -1 ? '#ff4d4d' : db > -12 ? '#ffd43b' : '#3fcf8e';
    ctx.fillRect(0, 0, t * c.width, c.height);
  }

  private updateTuner(): void {
    const app = this.app;
    app.recorder.samples(this.buf);
    const pitch = detectPitch(this.buf, app.engine.ctx.sampleRate);
    const tuning = TUNINGS.find((x) => x.id === app.prefs.tuning) ?? TUNINGS[0];
    if (!pitch || pitch.clarity < 0.75) {
      this.drawNeedle(null);
      this.centsEl.textContent = 'Play a string';
      return;
    }
    // Smooth the reading so the needle doesn't jitter
    this.smoothHz = this.smoothHz && Math.abs(1200 * Math.log2(pitch.hz / this.smoothHz)) < 50 ? this.smoothHz * 0.7 + pitch.hz * 0.3 : pitch.hz;
    const r = tuneTo(this.smoothHz, tuning);
    this.noteEl.textContent = noteName(r.key);
    const c = Math.round(r.cents);
    this.centsEl.textContent = Math.abs(c) <= 3 ? 'In tune' : c < 0 ? `${-c} cents flat — tune up` : `${c} cents sharp — tune down`;
    this.centsEl.classList.toggle('ok', Math.abs(c) <= 3);
    this.drawNeedle(r.cents);
    this.renderStrings(r.string ?? -1);
  }

  private drawNeedle(cents: number | null): void {
    const c = this.needle;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H - 10;
    const R = H - 24;
    // Scale: -50 to +50 cents
    ctx.strokeStyle = 'rgba(128,128,128,0.6)';
    ctx.lineWidth = 2;
    for (let v = -50; v <= 50; v += 10) {
      const a = (v / 50) * (Math.PI / 3) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - (v === 0 ? 14 : 7)), cy + Math.sin(a) * (R - (v === 0 ? 14 : 7)));
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }
    if (cents === null) return;
    const v = Math.max(-50, Math.min(50, cents));
    const a = (v / 50) * (Math.PI / 3) - Math.PI / 2;
    ctx.strokeStyle = Math.abs(v) <= 3 ? '#3fcf8e' : Math.abs(v) <= 15 ? '#ffd43b' : '#ff6b6b';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
    ctx.stroke();
  }
}
