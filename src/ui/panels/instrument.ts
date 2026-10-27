// Channel settings: the selected channel's sound. A recorded instrument (which one, its level, tuning,
// tone and how long notes ring), a synth (presets, two oscillators with unison and FM, noise, a filter
// with its envelope, the volume envelope, an LFO, glide) or a sampler (a drum sound or a sample, its
// pitch, envelope, reverse and choke group). A small keyboard to try it.
import * as L from 'lucide';
import { DRUM_SOUNDS, GM_FAMILIES, GM_INSTRUMENTS, gmInstrument, SYNTH_PRESETS, synthPreset } from '../../core/instruments';
import { CHANNEL_VOLUME, type Channel, type Env, type InstrumentParams, type Osc, type Project, type SamplerParams, type SynthParams, type Wave } from '../../core/project';
import { isBlackKey, noteName } from '../../core/theory';
import type { App } from '../app';
import { fmtDb, fmtHz, fmtPan, fmtPct, fmtSecs, knob } from '../controls';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { promptDialog, tooltip } from '../widgets';

const WAVES: [Wave, string][] = [
  ['sawtooth', 'Saw'],
  ['square', 'Square'],
  ['triangle', 'Triangle'],
  ['sine', 'Sine'],
];

export class InstrumentPanel implements Panel {
  readonly id = 'instrument';
  readonly title = 'Channel settings';
  readonly el: HTMLElement;
  readonly presets = SYNTH_PRESETS;

  constructor(private app: App) {
    this.el = h('div', { class: 'instrument' });
    for (const k of ['project', 'channel'] as const) app.on(k, () => {
      if (!this.el.hidden) this.render();
    });
    this.render();
  }

  shown(): void {
    this.render();
  }

  private ch(p: Project): Channel {
    return p.channels.find((c) => c.id === this.app.channel)!;
  }

  private render(): void {
    const app = this.app;
    const c = app.channel ? app.project.channels.find((x) => x.id === app.channel) : undefined;
    if (!c) {
      this.el.replaceChildren(h('div', { class: 'panel-empty' }, icon(L.SlidersHorizontal, 28), h('p', null, 'Select a channel in the channel rack to change its sound.')));
      return;
    }
    const name = h('button', { class: 'inst-name', onclick: async () => {
      const n = await promptDialog('Rename channel', 'Name', c.name);
      if (n?.trim()) app.edit('Rename channel', (p) => void (this.ch(p).name = n.trim()));
    } }, h('span', { class: 'inst-swatch', style: { background: c.color } }), c.name, icon(L.Pencil, 12));
    tooltip(name, 'Rename');
    const vol = knob({ label: 'Volume', min: -40, max: 6, value: c.volume, def: CHANNEL_VOLUME, step: 0.5, format: fmtDb, ...app.turning('Channel volume', (p, v) => void (this.ch(p).volume = v)) });
    const pan = knob({ label: 'Pan', min: -100, max: 100, value: c.pan, def: 0, step: 1, format: fmtPan, ...app.turning('Channel pan', (p, v) => void (this.ch(p).pan = v)) });
    const route = h('select', { class: 'input', 'aria-label': 'Mixer track' }, ...app.project.mixer.map((m, i) => h('option', { value: m.id }, i === 0 ? 'Master' : `${i} · ${m.name}`))) as HTMLSelectElement;
    route.value = c.mixer;
    route.addEventListener('change', () => app.edit('Channel routing', (p) => void (this.ch(p).mixer = route.value)));
    tooltip(route, 'The mixer track it plays through (for its effects)');
    const kind = c.kind === 'synth' ? 'Synth' : c.kind === 'instrument' ? 'Instrument' : 'Sampler';
    const head = h('div', { class: 'inst-head' }, name, h('span', { class: 'inst-kind' }, kind), h('span', { class: 'spacer' }), h('label', { class: 'fx-choice' }, h('span', null, 'Mixer'), route), pan, vol);
    const body = c.kind === 'instrument' && c.instrument ? this.instrument(c, c.instrument) : c.kind === 'synth' && c.synth ? this.synth(c, c.synth) : c.sampler ? this.sampler(c, c.sampler) : h('div');
    this.el.replaceChildren(head, body, this.keys(c));
  }

  // ---------- a recorded instrument ----------

  private instrument(c: Channel, s: InstrumentParams): HTMLElement {
    const app = this.app;
    const ins = (p: Project) => this.ch(p).instrument!;
    const k = (label: string, min: number, max: number, value: number, def: number, set: (s: InstrumentParams, v: number) => void, o: { step?: number; log?: boolean; format?: (v: number) => string; title?: string } = {}) =>
      knob({ label, min, max, value, def, step: o.step, log: o.log, format: o.format, title: o.title, size: 34, ...app.turning(`${c.name}: ${label.toLowerCase()}`, (p, v) => set(ins(p), v)) });
    const pick = h('select', { class: 'input', 'aria-label': 'Instrument' }, ...GM_FAMILIES.map((fam) => h('optgroup', { label: fam }, ...GM_INSTRUMENTS.filter((g) => g.family === fam).map((g) => h('option', { value: String(g.program) }, g.name))))) as HTMLSelectElement;
    pick.value = String(s.program);
    pick.addEventListener('change', () => {
      const g = gmInstrument(Number(pick.value));
      app.edit(`Instrument: ${g.name}`, (p) => {
        const ch = this.ch(p);
        // A channel still named after its instrument takes the new one's name
        if (ch.name === gmInstrument(ch.instrument!.program).name) ch.name = g.name;
        ch.instrument!.program = g.program;
        ch.preset = `gm:${g.program}`;
      });
      void app.engine.library.sf.prepare(0, g.program).then(() => app.engine.preview(c.id, 60, 0.8, 0.6));
    });
    const sf = app.engine.library.sf;
    const status = sf.error ? h('span', { class: 'hint error' }, `The instrument library couldn't be loaded: ${sf.error}`) : h('span', { class: 'hint' }, 'Recorded from real instruments. For more space, add a reverb on its mixer track.');
    return h(
      'div',
      { class: 'inst-body' },
      h('div', { class: 'inst-row' }, h('label', { class: 'fx-choice' }, h('span', null, 'Instrument'), pick), status),
      h('div', { class: 'inst-grid' },
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'Sound'), h('div', { class: 'inst-knobs' },
          k('Gain', -24, 12, s.gain, 0, (x, v) => void (x.gain = v), { step: 0.5, format: fmtDb }),
          k('Tune', -24, 24, s.tune, 0, (x, v) => void (x.tune = v), { step: 0.01, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} st`, title: 'Semitones: transposes every note' }),
          k('Tone', 300, 20000, s.tone, 20000, (x, v) => void (x.tone = v), { log: true, format: (v) => (v >= 19000 ? 'Open' : fmtHz(v)), title: 'Turn down for a darker, softer sound' }),
          k('Release', 0.1, 4, s.release, 1, (x, v) => void (x.release = v), { log: true, format: (v) => `×${v.toFixed(2)}`, title: 'How long notes ring on after you let go: ×1 is as recorded' }),
        )),
      ),
    );
  }

  // ---------- the synth ----------

  private synth(c: Channel, s: SynthParams): HTMLElement {
    const app = this.app;
    const syn = (p: Project) => this.ch(p).synth!;
    const k = (label: string, min: number, max: number, value: number, def: number, set: (s: SynthParams, v: number) => void, o: { step?: number; log?: boolean; format?: (v: number) => string; title?: string } = {}) =>
      knob({ label, min, max, value, def, step: o.step, log: o.log, format: o.format, title: o.title, size: 34, ...app.turning(`${c.name}: ${label.toLowerCase()}`, (p, v) => set(syn(p), v)) });
    const preset = h('select', { class: 'input', 'aria-label': 'Preset' }, ...['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Other'].map((cat) => h('optgroup', { label: cat }, ...SYNTH_PRESETS.filter((x) => x.category === cat).map((x) => h('option', { value: x.id }, x.name))))) as HTMLSelectElement;
    preset.value = c.preset && synthPreset(c.preset) ? c.preset : 'basic';
    preset.addEventListener('change', () => {
      const pre = synthPreset(preset.value);
      if (pre) app.edit(`Preset: ${pre.name}`, (p) => {
        const ch = this.ch(p);
        ch.synth = structuredClone(pre.params);
        ch.preset = pre.id;
      });
      app.engine.preview(c.id, 60, 0.8, 0.6);
    });
    const osc = (i: 0 | 1) => {
      const o = s.osc[i];
      const wave = h('select', { class: 'input', 'aria-label': 'Wave' }, ...WAVES.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      wave.value = o.wave;
      wave.addEventListener('change', () => app.edit(`Oscillator ${i + 1} wave`, (p) => void (syn(p).osc[i].wave = wave.value as Wave)));
      const set = (key: keyof Osc) => (x: SynthParams, v: number) => void ((x.osc[i] as unknown as Record<string, number>)[key] = v);
      return h(
        'div',
        { class: 'inst-group' },
        h('div', { class: 'inst-group-head' }, `Oscillator ${i + 1}`, wave),
        h('div', { class: 'inst-knobs' },
          k('Level', 0, 1, o.level, i === 0 ? 0.8 : 0.4, set('level'), { step: 0.01, format: fmtPct }),
          k('Octave', -3, 3, o.octave, 0, set('octave'), { step: 1, format: (v) => `${v > 0 ? '+' : ''}${v}` }),
          k('Semitones', -12, 12, o.semi, 0, set('semi'), { step: 1, format: (v) => `${v > 0 ? '+' : ''}${v}` }),
          k('Fine', -100, 100, o.detune, 0, set('detune'), { step: 1, format: (v) => `${Math.round(v)} ct` }),
          k('Voices', 1, 7, o.voices, 1, set('voices'), { step: 1, format: (v) => String(Math.round(v)), title: 'Unison: several slightly detuned copies for a big, wide sound' }),
          k('Spread', 0, 60, o.spread, 15, set('spread'), { step: 1, format: (v) => `${Math.round(v)} ct` }),
        ),
      );
    };
    const env = (label: string, e: Env, key: 'amp' | 'fenv') =>
      h(
        'div',
        { class: 'inst-group' },
        h('div', { class: 'inst-group-head' }, label),
        h('div', { class: 'inst-knobs' },
          k('Attack', 0.001, 4, e.a, 0.005, (x, v) => void (x[key].a = v), { log: true, format: fmtSecs }),
          k('Decay', 0.01, 6, e.d, 0.3, (x, v) => void (x[key].d = v), { log: true, format: fmtSecs }),
          k('Sustain', 0, 1, e.s, 0.7, (x, v) => void (x[key].s = v), { step: 0.01, format: fmtPct }),
          k('Release', 0.005, 6, e.r, 0.25, (x, v) => void (x[key].r = v), { log: true, format: fmtSecs }),
        ),
      );
    const ftype = h('select', { class: 'input', 'aria-label': 'Filter' }, h('option', { value: 'lowpass' }, 'Low-pass'), h('option', { value: 'highpass' }, 'High-pass'), h('option', { value: 'bandpass' }, 'Band-pass')) as HTMLSelectElement;
    ftype.value = s.filter.type;
    ftype.addEventListener('change', () => app.edit('Filter type', (p) => void (syn(p).filter.type = ftype.value as SynthParams['filter']['type'])));
    const lfoTarget = h('select', { class: 'input', 'aria-label': 'LFO' }, h('option', { value: 'off' }, 'Off'), h('option', { value: 'pitch' }, 'Pitch (vibrato)'), h('option', { value: 'filter' }, 'Filter (wah)'), h('option', { value: 'volume' }, 'Volume (tremolo)')) as HTMLSelectElement;
    lfoTarget.value = s.lfo.target;
    lfoTarget.addEventListener('change', () => app.edit('LFO', (p) => void (syn(p).lfo.target = lfoTarget.value as SynthParams['lfo']['target'])));
    const mono = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.mono, onchange: (e: Event) => app.edit('Mono', (p) => void (syn(p).mono = (e.target as HTMLInputElement).checked)) }), h('span', null, 'One note at a time (mono)'));
    return h(
      'div',
      { class: 'inst-body' },
      h('div', { class: 'inst-row' }, h('label', { class: 'fx-choice' }, h('span', null, 'Preset'), preset), mono),
      h('div', { class: 'inst-grid' },
        osc(0),
        osc(1),
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'Filter', ftype), h('div', { class: 'inst-knobs' },
          k('Cutoff', 40, 18000, s.filter.cutoff, 2400, (x, v) => void (x.filter.cutoff = v), { log: true, format: fmtHz }),
          k('Resonance', 0.3, 18, s.filter.q, 1, (x, v) => void (x.filter.q = v), { log: true, step: 0.1, format: (v) => v.toFixed(1) }),
          k('Envelope', -4, 6, s.filter.env, 2, (x, v) => void (x.filter.env = v), { step: 0.1, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`, title: 'How far the filter envelope opens the filter' }),
          k('Key track', 0, 1, s.filter.key, 0.3, (x, v) => void (x.filter.key = v), { step: 0.01, format: fmtPct, title: 'Higher notes open the filter more' }),
        )),
        env('Volume envelope', s.amp, 'amp'),
        env('Filter envelope', s.fenv, 'fenv'),
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'LFO', lfoTarget), h('div', { class: 'inst-knobs' },
          k('Rate', 0.05, 20, s.lfo.rate, 5, (x, v) => void (x.lfo.rate = v), { log: true, format: (v) => `${v.toFixed(2)} Hz` }),
          k('Depth', 0, 1, s.lfo.depth, 0.2, (x, v) => void (x.lfo.depth = v), { step: 0.01, format: fmtPct }),
        )),
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'Character'), h('div', { class: 'inst-knobs' },
          k('Noise', 0, 1, s.noise, 0, (x, v) => void (x.noise = v), { step: 0.01, format: fmtPct }),
          k('FM', 0, 1, s.fm, 0, (x, v) => void (x.fm = v), { step: 0.01, format: fmtPct, title: 'Oscillator 2 bends oscillator 1: bells and electric pianos (oscillator 2 is then not heard itself)' }),
          k('Glide', 0, 1, s.glide, 0, (x, v) => void (x.glide = v), { step: 0.005, format: fmtSecs, title: 'Slides between notes (mono)' }),
          k('Gain', -30, 6, s.gain, -6, (x, v) => void (x.gain = v), { step: 0.5, format: fmtDb }),
        )),
      ),
    );
  }

  // ---------- the sampler ----------

  private sampler(c: Channel, s: SamplerParams): HTMLElement {
    const app = this.app;
    const smp = (p: Project) => this.ch(p).sampler!;
    const k = (label: string, min: number, max: number, value: number, def: number, set: (s: SamplerParams, v: number) => void, o: { step?: number; log?: boolean; format?: (v: number) => string; title?: string } = {}) =>
      knob({ label, min, max, value, def, step: o.step, log: o.log, format: o.format, title: o.title, size: 34, ...app.turning(`${c.name}: ${label.toLowerCase()}`, (p, v) => set(smp(p), v)) });
    const sound = h('select', { class: 'input', 'aria-label': 'Sound' },
      ...[...new Set(DRUM_SOUNDS.map((d) => d.group))].map((g) => h('optgroup', { label: g }, ...DRUM_SOUNDS.filter((d) => d.group === g).map((d) => h('option', { value: `b:${d.id}` }, d.name)))),
      app.project.samples.length ? h('optgroup', { label: 'Audio files' }, ...app.project.samples.map((x) => h('option', { value: `s:${x.id}` }, x.name))) : null,
    ) as HTMLSelectElement;
    sound.value = s.sample.builtin ? `b:${s.sample.builtin}` : `s:${s.sample.sampleId}`;
    sound.addEventListener('change', () => {
      const [kind, id] = [sound.value.slice(0, 1), sound.value.slice(2)];
      app.edit('Change sound', (p) => {
        smp(p).sample = kind === 'b' ? { builtin: id } : { sampleId: id };
        if (kind === 'b') this.ch(p).preset = id;
      });
      setTimeout(() => app.engine.preview(c.id, smp(app.project).root), 80);
    });
    const file = h('button', { class: 'btn small outline', onclick: async () => {
      const [x] = await app.importAudio();
      if (x) app.edit('Change sound', (p) => void (smp(p).sample = { sampleId: x.id }));
    } }, icon(L.FileAudio, 14), 'From a file…');
    const toggle = (label: string, on: boolean, set: (s: SamplerParams, v: boolean) => void, title: string) => {
      const el = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => app.edit(`${c.name}: ${label.toLowerCase()}`, (p) => set(smp(p), (e.target as HTMLInputElement).checked)) }), h('span', null, label));
      tooltip(el, title);
      return el;
    };
    const choke = h('select', { class: 'input', 'aria-label': 'Choke group' }, h('option', { value: '0' }, 'None'), ...[1, 2, 3, 4].map((g) => h('option', { value: String(g) }, `Group ${g}`))) as HTMLSelectElement;
    choke.value = String(s.choke);
    choke.addEventListener('change', () => app.edit('Choke group', (p) => void (smp(p).choke = Number(choke.value))));
    tooltip(choke, 'Sounds in the same group cut each other off — an open hi-hat stopped by the closed one');
    return h(
      'div',
      { class: 'inst-body' },
      h('div', { class: 'inst-row' }, h('label', { class: 'fx-choice' }, h('span', null, 'Sound'), sound), file),
      h('div', { class: 'inst-row' },
        toggle('Follows the notes’ pitch', s.pitched, (x, v) => void (x.pitched = v), 'On: plays higher and lower like an instrument (808s, one-note samples). Off: every note is the sample as it is (drums).'),
        toggle('Reverse', s.reverse, (x, v) => void (x.reverse = v), 'Plays the sound backwards'),
        h('label', { class: 'fx-choice' }, h('span', null, 'Choke'), choke),
      ),
      h('div', { class: 'inst-grid' },
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'Pitch'), h('div', { class: 'inst-knobs' },
          k('Tune', -24, 24, s.tune, 0, (x, v) => void (x.tune = v), { step: 0.1, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st` }),
          k('Root note', 24, 96, s.root, 60, (x, v) => void (x.root = v), { step: 1, format: (v) => noteName(Math.round(v)), title: 'The note at which the sample plays at its own pitch' }),
        )),
        h('div', { class: 'inst-group' }, h('div', { class: 'inst-group-head' }, 'Envelope'), h('div', { class: 'inst-knobs' },
          k('Attack', 0, 1, s.attack, 0, (x, v) => void (x.attack = v), { step: 0.001, format: fmtSecs }),
          k('Release', 0.005, 3, s.release, 0.05, (x, v) => void (x.release = v), { log: true, format: fmtSecs }),
          k('Start', 0, 0.9, s.start, 0, (x, v) => void (x.start = v), { step: 0.005, format: fmtPct, title: 'Starts part-way into the sound' }),
          k('Gain', -30, 12, s.gain, 0, (x, v) => void (x.gain = v), { step: 0.5, format: fmtDb }),
        )),
      ),
    );
  }

  // ---------- try it ----------

  private keys(c: Channel): HTMLElement {
    const app = this.app;
    const wrap = h('div', { class: 'inst-keys' });
    const from = c.kind === 'sampler' && !c.sampler?.pitched ? 60 : 48;
    const to = from + (c.kind === 'sampler' && !c.sampler?.pitched ? 12 : 24);
    for (let key = from; key <= to; key++) {
      const b = h('button', { class: `pkey${isBlackKey(key) ? ' black' : ''}`, 'aria-label': noteName(key) });
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        app.engine.noteOn(c.id, key, 0.85);
        const up = () => {
          b.classList.remove('down');
          app.engine.noteOff(c.id, key);
          b.removeEventListener('pointerup', up);
          b.removeEventListener('pointercancel', up);
        };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      });
      if (key % 12 === 0) b.textContent = noteName(key);
      wrap.append(b);
    }
    return h('div', { class: 'inst-try' }, h('span', { class: 'hint' }, 'Try it:'), wrap, h('span', { class: 'hint' }, app.prefs.typingKeys ? 'The computer keyboard plays too (Ctrl+T)' : 'Ctrl+T: play it with the computer keyboard'));
  }
}
