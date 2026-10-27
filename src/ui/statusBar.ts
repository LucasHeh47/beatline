// The bottom bar: what's selected, hints while dragging, messages and progress, and the song's key,
// tempo and length.
import { barTicks, clipEnd, clock, songEnd, ticksToSeconds } from '../core/project';
import { keyName } from '../core/theory';
import type { App } from './app';
import { h } from './dom';
import { tooltip } from './widgets';

export class StatusBar {
  readonly el: HTMLElement;
  private sel: HTMLElement;
  private tool: HTMLElement;
  private msg: HTMLElement;
  private progress: HTMLElement;
  private info: HTMLElement;
  private msgTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private app: App) {
    this.sel = h('span', { class: 'sb-item' });
    this.tool = h('span', { class: 'sb-tool' });
    this.msg = h('span', { class: 'sb-msg' });
    this.progress = h('span', { class: 'sb-progress', hidden: true });
    this.info = h('button', { class: 'sb-item sb-seq', onclick: () => app.layout.show('pianoRoll') });
    tooltip(this.info, 'The song’s key (change it in the piano roll), tempo and length');
    this.el = h('footer', { class: 'statusbar' }, this.sel, this.tool, h('span', { class: 'spacer' }), this.msg, this.progress, this.info);
    for (const k of ['selection', 'project', 'channel', 'pattern'] as const) app.on(k, () => this.update());
    this.update();
  }

  update(): void {
    const app = this.app;
    const p = app.project;
    const clips = p.tracks.flatMap((t) => t.clips.filter((c) => app.clips.has(c.id)));
    if (clips.length) {
      const a = Math.min(...clips.map((c) => c.start));
      const b = Math.max(...clips.map(clipEnd));
      const bars = (b - a) / barTicks(p);
      this.sel.textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'} selected · ${bars.toFixed(2).replace(/\.00$/, '')} bar${bars === 1 ? '' : 's'}`;
    } else {
      const ch = p.channels.find((c) => c.id === app.channel);
      this.sel.textContent = `${app.pattern.name}${ch ? ` · ${ch.name}` : ''}`;
    }
    const end = songEnd(p);
    this.info.textContent = `${keyName(p.key.root, p.key.scale)} · ${p.bpm} BPM · ${p.beatsPerBar}/${p.beatUnit}${end ? ` · ${clock(ticksToSeconds(end, p.bpm))}` : ''}`;
  }

  /** A short message that goes away by itself. */
  flash(text: string): void {
    this.msg.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.msg.textContent = ''), 3500);
  }

  /** What a drag is doing right now (null when it ends). */
  hint(text: string | null): void {
    this.tool.textContent = text ?? '';
  }

  setProgress(label: string | null, percent: number): void {
    this.progress.hidden = label === null;
    if (label !== null) this.progress.textContent = `${label} ${Math.round(percent)}%`;
  }
}
