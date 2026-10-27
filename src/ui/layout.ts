// The window's panels: the Browser on the left; the Playlist and Piano Roll on top; the Channel Rack,
// Mixer, Recording and Channel settings below. The splits can be dragged; workspaces (Make beats,
// Arrange, Mix, Record) bring the right tabs forward and size the areas for the job.
import type { App, Workspace } from './app';
import { h } from './dom';
import { BrowserPanel } from './panels/browser';
import { ChannelRack } from './panels/channelRack';
import { InstrumentPanel } from './panels/instrument';
import { MixerPanel } from './panels/mixer';
import { PianoRoll } from './panels/pianoRoll';
import { PlaylistPanel } from './panels/playlist';
import { RecordPanel } from './panels/record';

export interface Panel {
  readonly id: string;
  readonly title: string;
  readonly el: HTMLElement;
  /** The panel became visible (its tab was chosen). */
  shown?(): void;
}

const WORKSPACE_TABS: Record<Workspace, { top: string; bottom: string; split: number }> = {
  beats: { top: 'pianoRoll', bottom: 'channelRack', split: 0.52 },
  arrange: { top: 'playlist', bottom: 'channelRack', split: 0.62 },
  mix: { top: 'playlist', bottom: 'mixer', split: 0.4 },
  record: { top: 'playlist', bottom: 'record', split: 0.5 },
};

export const WORKSPACES: [Workspace, string][] = [
  ['beats', 'Make beats'],
  ['arrange', 'Arrange'],
  ['mix', 'Mix'],
  ['record', 'Record'],
];

class TabGroup {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private body: HTMLElement;
  current: Panel;

  constructor(
    readonly id: string,
    readonly panels: Panel[],
    private onSwitch: (p: Panel) => void,
  ) {
    this.bar = h('div', { class: 'tabs-bar', role: 'tablist' });
    this.body = h('div', { class: 'tabs-body' });
    this.el = h('section', { class: `panel-group group-${id}` }, this.bar, this.body);
    for (const p of panels) {
      p.el.classList.add('panel');
      this.body.append(p.el);
    }
    this.current = panels[0];
    this.render();
  }

  show(id: string): void {
    const p = this.panels.find((x) => x.id === id);
    if (!p) return;
    this.current = p;
    this.render();
    this.onSwitch(p);
    p.shown?.();
  }

  private render(): void {
    this.bar.replaceChildren(
      ...this.panels.map((p) => h('button', { class: `tab-btn${p === this.current ? ' on' : ''}`, role: 'tab', 'aria-selected': p === this.current ? 'true' : 'false', onclick: () => this.show(p.id) }, p.title)),
    );
    for (const p of this.panels) p.el.hidden = p !== this.current;
  }
}

export class Layout {
  readonly el: HTMLElement;
  readonly browser: BrowserPanel;
  readonly channelRack: ChannelRack;
  readonly pianoRoll: PianoRoll;
  readonly playlist: PlaylistPanel;
  readonly mixer: MixerPanel;
  readonly record: RecordPanel;
  readonly instrument: InstrumentPanel;
  private groups: TabGroup[];
  /** The panel clicked last (Ctrl+C, Delete… act on it). */
  lastPanel = 'channelRack';
  private leftEl: HTMLElement;
  private top: HTMLElement;
  private bottom: HTMLElement;

  constructor(private app: App) {
    this.browser = new BrowserPanel(app);
    this.channelRack = new ChannelRack(app);
    this.pianoRoll = new PianoRoll(app);
    this.playlist = new PlaylistPanel(app);
    this.mixer = new MixerPanel(app);
    this.record = new RecordPanel(app);
    this.instrument = new InstrumentPanel(app);

    const remember = (g: TabGroup) => (p: Panel) => {
      app.prefs.tabs[`${app.prefs.workspace}:${g.id}`] = p.id;
      app.savePrefs();
    };
    const left: TabGroup = new TabGroup('left', [this.browser], () => undefined);
    const top: TabGroup = new TabGroup('top', [this.playlist, this.pianoRoll], (p) => remember(top)(p));
    const bottom: TabGroup = new TabGroup('bottom', [this.channelRack, this.mixer, this.record, this.instrument], (p) => remember(bottom)(p));
    this.groups = [left, top, bottom];
    for (const g of this.groups) g.el.addEventListener('pointerdown', () => (this.lastPanel = g.current.id), true);

    this.leftEl = left.el;
    this.top = top.el;
    this.bottom = bottom.el;
    const vSplit = this.splitter('col', (dx) => this.resize('left', dx));
    const hSplit = this.splitter('row', (_dx, dy) => this.resize('top', dy));
    const right = h('div', { class: 'ws-col ws-right' }, top.el, hSplit, bottom.el);
    this.el = h('main', { class: 'workspace' }, left.el, vSplit, right);
    this.applySizes();
    this.setWorkspace(app.prefs.workspace, false);
    window.addEventListener('resize', () => this.applySizes());
  }

  /** Brings a panel forward (its tab). */
  show(id: string): void {
    for (const g of this.groups) if (g.panels.some((p) => p.id === id)) g.show(id);
    this.lastPanel = id;
  }

  isShown(id: string): boolean {
    return this.groups.some((g) => g.current.id === id);
  }

  setWorkspace(w: Workspace, save = true): void {
    this.app.prefs.workspace = w;
    const def = WORKSPACE_TABS[w];
    for (const g of this.groups) {
      const want = this.app.prefs.tabs[`${w}:${g.id}`] ?? (g.id === 'top' ? def.top : g.id === 'bottom' ? def.bottom : undefined);
      if (want) g.show(want);
    }
    this.app.prefs.top = this.app.prefs.splits[w] ?? def.split;
    this.applySizes();
    if (save) this.app.savePrefs();
    this.app.emit('settings');
  }

  /** Zooms the panel being worked in (the playlist or the piano roll). */
  zoom(f: number): void {
    if (this.lastPanel === 'pianoRoll') this.pianoRoll.zoomBy(f);
    else this.playlist.zoomBy(f);
  }

  focusMain(): void {
    (this.lastPanel === 'pianoRoll' ? this.pianoRoll : this.playlist).focus();
  }

  private splitter(dir: 'row' | 'col', onDrag: (dx: number, dy: number) => void): HTMLElement {
    const el = h('div', { class: `splitter splitter-${dir}`, role: 'separator', 'aria-orientation': dir === 'row' ? 'horizontal' : 'vertical' });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      let x = e.clientX;
      let y = e.clientY;
      el.classList.add('on');
      const move = (ev: PointerEvent) => {
        onDrag(ev.clientX - x, ev.clientY - y);
        x = ev.clientX;
        y = ev.clientY;
      };
      const up = () => {
        el.classList.remove('on');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.app.prefs.splits[this.app.prefs.workspace] = this.app.prefs.top;
        this.app.savePrefs();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    return el;
  }

  private resize(which: 'top' | 'left', d: number): void {
    const p = this.app.prefs;
    const W = Math.max(1, this.el.clientWidth);
    const H = Math.max(1, this.el.clientHeight);
    if (which === 'top') p.top = Math.max(0.15, Math.min(0.85, p.top + d / H));
    else p.left = Math.max(0.1, Math.min(0.4, p.left + d / W));
    this.applySizes();
  }

  private applySizes(): void {
    const p = this.app.prefs;
    this.top.style.flex = `${p.top} 1 0`;
    this.bottom.style.flex = `${1 - p.top} 1 0`;
    this.leftEl.style.flex = `0 0 ${(p.left * 100).toFixed(2)}%`;
    this.app.emit('settings');
  }
}
