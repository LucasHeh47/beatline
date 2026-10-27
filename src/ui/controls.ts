// Small controls for the tool options bar and panels: sliders with a number box, toggles,
// dropdowns and segmented buttons.
import type { IconNode } from 'lucide';
import { h, icon } from './dom';
import { tooltip } from './widgets';

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  /** Logarithmic track (brush sizes: fine control at small sizes). */
  log?: boolean;
  width?: number;
  title?: string;
  onChange: (v: number) => void;
  /** Called while dragging (onChange runs once at the end). */
  onInput?: (v: number) => void;
}

/** A labelled slider with an editable number. */
export function slider(o: SliderOptions): HTMLElement {
  const step = o.step ?? 1;
  const toTrack = (v: number) => (o.log ? (Math.log(v - o.min + 1) / Math.log(o.max - o.min + 1)) * 1000 : v);
  const fromTrack = (t: number) => {
    const v = o.log ? Math.exp((t / 1000) * Math.log(o.max - o.min + 1)) - 1 + o.min : t;
    return Math.max(o.min, Math.min(o.max, Math.round(v / step) * step));
  };
  const range = h('input', { type: 'range', class: 'ctl-range', min: o.log ? 0 : o.min, max: o.log ? 1000 : o.max, step: o.log ? 1 : step, value: String(toTrack(o.value)), 'aria-label': o.label }) as HTMLInputElement;
  if (o.width) range.style.width = `${o.width}px`;
  const num = h('input', { type: 'number', class: 'input ctl-num', min: o.min, max: o.max, step, value: String(o.value), 'aria-label': o.label }) as HTMLInputElement;
  const fmt = (v: number) => String(+v.toFixed(step < 1 ? 2 : 0));
  range.addEventListener('input', () => {
    const v = fromTrack(+range.value);
    num.value = fmt(v);
    o.onInput?.(v);
  });
  range.addEventListener('change', () => o.onChange(fromTrack(+range.value)));
  num.addEventListener('change', () => {
    const v = Math.max(o.min, Math.min(o.max, +num.value || o.min));
    num.value = fmt(v);
    range.value = String(toTrack(v));
    o.onChange(v);
  });
  const el = h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, o.label), range, num, o.unit ? h('span', { class: 'ctl-unit' }, o.unit) : null);
  if (o.title) tooltip(el, o.title);
  // Lets callers update it from outside ([ and ] change the brush size)
  (el as HTMLElement & { setValue?: (v: number) => void }).setValue = (v: number) => {
    range.value = String(toTrack(v));
    num.value = fmt(v);
  };
  return el;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, title?: string, ic?: IconNode): HTMLElement {
  const box = h('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
  box.addEventListener('change', () => onChange(box.checked));
  const el = h('label', { class: 'ctl ctl-toggle' }, box, ic ? icon(ic, 14) : null, h('span', null, label));
  if (title) tooltip(el, title);
  return el;
}

export function dropdown<T extends string>(label: string | null, options: [T, string][], value: T, onChange: (v: T) => void, title?: string): HTMLElement {
  const sel = h('select', { class: 'input ctl-select', 'aria-label': label ?? title ?? '' }) as HTMLSelectElement;
  for (const [v, text] of options) sel.append(h('option', { value: v }, text));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  const el = h('label', { class: 'ctl ctl-dropdown' }, label ? h('span', { class: 'ctl-label' }, label) : null, sel);
  if (title) tooltip(el, title);
  return el;
}

export interface Segment<T> {
  value: T;
  icon?: IconNode;
  label?: string;
  title: string;
}

/** Buttons where one is chosen (like a radio group). */
export function segmented<T>(segments: Segment<T>[], value: T, onChange: (v: T) => void): HTMLElement {
  const el = h('div', { class: 'ctl ctl-seg', role: 'radiogroup' });
  const render = (cur: T) => {
    el.replaceChildren(
      ...segments.map((s) => {
        const b = h('button', { class: `btn seg${s.value === cur ? ' on' : ''}`, role: 'radio', 'aria-checked': s.value === cur ? 'true' : 'false', 'aria-label': s.title, onclick: () => {
          render(s.value);
          onChange(s.value);
        } }, s.icon ? icon(s.icon, 15) : null, s.label ?? null);
        tooltip(b, s.title);
        return b;
      }),
    );
  };
  render(value);
  return el;
}

export function sep(): HTMLElement {
  return h('span', { class: 'ctl-sep' });
}

export function infoText(text: string): HTMLElement {
  return h('span', { class: 'ctl-info' }, text);
}

export interface KnobOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  /** Double-click goes back to this. */
  def?: number;
  step?: number;
  /** Turning is on a log scale (frequencies, times). */
  log?: boolean;
  /** How the value reads ("440 Hz", "-6 dB"). */
  format?: (v: number) => string;
  size?: number;
  /** While turning. */
  onInput?: (v: number) => void;
  /** When let go. */
  onChange: (v: number) => void;
  title?: string;
}

/** A knob: drag up and down to turn it (Shift for fine steps), double-click to reset, or use the wheel. */
export function knob(o: KnobOptions): HTMLElement & { setValue(v: number): void } {
  const size = o.size ?? 34;
  const toPos = (v: number) => (o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min));
  const fromPos = (t: number) => {
    const c = Math.max(0, Math.min(1, t));
    let v = o.log ? o.min * Math.pow(o.max / o.min, c) : o.min + c * (o.max - o.min);
    if (o.step) v = Math.round(v / o.step) * o.step;
    return Math.max(o.min, Math.min(o.max, v));
  };
  const fmt = o.format ?? ((v: number) => String(+v.toFixed(o.step && o.step < 1 ? 2 : 0)));
  let value = o.value;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.classList.add('knob-svg');
  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('class', 'knob-track');
  const arc = document.createElementNS(svgNS, 'path');
  arc.setAttribute('class', 'knob-arc');
  const dot = document.createElementNS(svgNS, 'line');
  dot.setAttribute('class', 'knob-dot');
  svg.append(track, arc, dot);
  const val = h('span', { class: 'knob-value' });
  const el = h('div', { class: 'knob', tabindex: '0', role: 'slider', 'aria-label': o.label, 'aria-valuemin': String(o.min), 'aria-valuemax': String(o.max) }, svg, h('span', { class: 'knob-label' }, o.label), val) as unknown as HTMLElement & { setValue(v: number): void };
  const A0 = (-135 * Math.PI) / 180;
  const A1 = (135 * Math.PI) / 180;
  const pt = (a: number, r = 15) => `${20 + r * Math.sin(a)} ${20 - r * Math.cos(a)}`;
  const arcPath = (a: number, b: number) => `M ${pt(a)} A 15 15 0 ${b - a > Math.PI ? 1 : 0} 1 ${pt(b)}`;
  track.setAttribute('d', arcPath(A0, A1));
  const draw = () => {
    const t = Math.max(0, Math.min(1, toPos(value)));
    const a = A0 + t * (A1 - A0);
    // Knobs with a middle (pan, gain in dB) light up from the middle
    const mid = o.min < 0 && o.max > 0 && !o.log ? A0 + toPos(0) * (A1 - A0) : A0;
    arc.setAttribute('d', a >= mid ? arcPath(mid, Math.max(a, mid + 0.001)) : arcPath(a, mid));
    dot.setAttribute('x1', String(20 + 6 * Math.sin(a)));
    dot.setAttribute('y1', String(20 - 6 * Math.cos(a)));
    dot.setAttribute('x2', String(20 + 13 * Math.sin(a)));
    dot.setAttribute('y2', String(20 - 13 * Math.cos(a)));
    val.textContent = fmt(value);
    el.setAttribute('aria-valuenow', String(value));
  };
  el.setValue = (v: number) => {
    value = v;
    draw();
  };
  draw();
  if (o.title) tooltip(el, o.title);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus();
    el.classList.add('turning');
    let y = e.clientY;
    let t = toPos(value);
    const move = (ev: PointerEvent) => {
      t = Math.max(0, Math.min(1, t + ((y - ev.clientY) / 160) * (ev.shiftKey ? 0.15 : 1)));
      y = ev.clientY;
      const v = fromPos(t);
      if (v !== value) {
        value = v;
        draw();
        o.onInput?.(v);
      }
    };
    const up = () => {
      el.classList.remove('turning');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      o.onChange(value);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => {
    if (o.def === undefined) return;
    value = o.def;
    draw();
    o.onInput?.(value);
    o.onChange(value);
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    value = fromPos(toPos(value) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.01 : 0.04));
    draw();
    o.onInput?.(value);
    o.onChange(value);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    value = fromPos(toPos(value) + d * (e.shiftKey ? 0.01 : 0.04));
    draw();
    o.onInput?.(value);
    o.onChange(value);
  });
  return el;
}

/** "12.5 kHz", "440 Hz" */
export const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
/** "-6.0 dB" */
export const fmtDb = (v: number) => (v <= -80 ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);
/** "120 ms", "1.20 s" */
export const fmtSecs = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
/** "L 30", "C", "R 50" */
export const fmtPan = (v: number) => (Math.abs(v) < 0.5 ? 'C' : v < 0 ? `L ${Math.round(-v)}` : `R ${Math.round(v)}`);
/** "75%" */
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
