// The Browser: the built-in sounds (click to hear, double-click or drag to add), ready-made beats and
// synth presets, your folders of samples (click to hear, drag onto the playlist or the channel rack),
// and what's in the project (patterns to drag into the song, audio files, missing files to find).
import * as L from 'lucide';
import { DRUM_PATTERNS } from '../../core/drumPatterns';
import { DRUM_SOUNDS, SYNTH_PRESETS } from '../../core/instruments';
import { clock } from '../../core/project';
import type { MediaFileInfo, SampleFolder } from '../../shared/api';
import type { App } from '../app';
import { h, icon } from '../dom';
import type { Panel } from '../layout';
import { isDesktop, platform } from '../platform';
import { showMenu, toast, tooltip } from '../widgets';

type Tab = 'sounds' | 'samples' | 'project';

export class BrowserPanel implements Panel {
  readonly id = 'browser';
  readonly title = 'Browser';
  readonly el: HTMLElement;
  private tabs: HTMLElement;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private tab: Tab = 'sounds';
  private folders: SampleFolder[] = [];
  private openFolders = new Set<string>();
  private openGroups = new Set<string>(['Kicks', 'Snares & claps', 'Hi-hats & cymbals']);
  private audio: HTMLAudioElement | null = null;

  constructor(private app: App) {
    this.tabs = h('div', { class: 'br-tabs' });
    this.search = h('input', { class: 'input br-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search sounds' }) as HTMLInputElement;
    this.search.addEventListener('input', () => this.render());
    this.list = h('div', { class: 'br-list' });
    this.el = h('div', { class: 'browser' }, this.tabs, this.search, this.list);
    for (const k of ['project', 'samples'] as const) app.on(k, () => {
      if (this.tab === 'project') this.render();
    });
    void this.loadFolders();
    this.render();
  }

  private async loadFolders(): Promise<void> {
    if (!isDesktop) return;
    this.folders = await platform.sampleFolders.list();
    if (this.tab === 'samples') this.render();
  }

  private render(): void {
    this.tabs.replaceChildren(
      ...(
        [
          ['sounds', 'Sounds'],
          ['samples', 'Samples'],
          ['project', 'Project'],
        ] as [Tab, string][]
      ).map(([t, label]) => h('button', { class: `br-tab${this.tab === t ? ' on' : ''}`, onclick: () => {
        this.tab = t;
        this.render();
      } }, label)),
    );
    const q = this.search.value.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    if (this.tab === 'sounds') this.renderSounds(match);
    else if (this.tab === 'samples') this.renderSamples(match);
    else this.renderProject(match);
  }

  private group(id: string, label: string, ic: L.IconNode, items: HTMLElement[], open: boolean): HTMLElement[] {
    if (!items.length) return [];
    const head = h('button', { class: `br-group${open ? ' open' : ''}`, onclick: () => {
      if (this.openGroups.has(id)) this.openGroups.delete(id);
      else this.openGroups.add(id);
      this.render();
    } }, icon(open ? L.ChevronDown : L.ChevronRight, 13), icon(ic, 14), label, h('span', { class: 'br-count' }, String(items.length)));
    return open ? [head, ...items] : [head];
  }

  private item(label: string, ic: L.IconNode, o: { sub?: string; title?: string; click?: () => void; dbl?: () => void; drag?: (dt: DataTransfer) => void; menu?: (e: MouseEvent) => void; cls?: string }): HTMLElement {
    const el = h('div', { class: `br-item ${o.cls ?? ''}`, tabindex: '0', draggable: o.drag ? 'true' : 'false' }, icon(ic, 14), h('span', { class: 'br-label' }, label), o.sub ? h('span', { class: 'br-sub' }, o.sub) : null);
    if (o.title) tooltip(el, o.title);
    if (o.click) el.addEventListener('click', o.click);
    if (o.dbl) el.addEventListener('dblclick', o.dbl);
    if (o.drag) el.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copy';
        o.drag!(e.dataTransfer);
      }
    });
    if (o.menu) el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      o.menu!(e);
    });
    return el;
  }

  // ---------- built-in sounds ----------

  /** Plays a built-in sound as it is (no channel needed). */
  private previewDrum(id: string): void {
    const app = this.app;
    void app.engine.library.load({ builtin: id }, app.project).then((b) => {
      if (!b) return;
      const ctx = app.engine.ctx;
      void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = b;
      const g = ctx.createGain();
      g.gain.value = 0.8;
      src.connect(g);
      g.connect(ctx.destination);
      src.start();
    });
  }

  private renderSounds(match: (s: string) => boolean): void {
    const app = this.app;
    const out: HTMLElement[] = [];
    const q = this.search.value.trim();
    for (const g of [...new Set(DRUM_SOUNDS.map((d) => d.group))]) {
      const items = DRUM_SOUNDS.filter((d) => d.group === g && match(`${d.name} ${g}`)).map((d) =>
        this.item(d.name, L.Drum, { title: 'Click to hear; double-click or drag to add it to the channel rack', click: () => this.previewDrum(d.id), dbl: () => app.commands.run(`add.drum.${d.id}`), drag: (dt) => dt.setData('text/beatline-drum', d.id) }),
      );
      out.push(...this.group(g, g, L.Drum, items, !!q || this.openGroups.has(g)));
    }
    for (const cat of ['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Other'] as const) {
      const items = SYNTH_PRESETS.filter((s) => s.category === cat && match(`${s.name} ${cat} synth`)).map((s) => this.item(s.name, L.Piano, { title: 'Double-click to add this synth', dbl: () => app.commands.run(`add.synth.${s.id}`) }));
      out.push(...this.group(`synth:${cat}`, `Synth: ${cat}`, L.Piano, items, !!q || this.openGroups.has(`synth:${cat}`)));
    }
    const beats = DRUM_PATTERNS.filter((d) => match(`${d.name} beat`)).map((d) => this.item(d.name, L.Grid3x3, { sub: `${d.bpm}`, title: 'Double-click to write this beat into the pattern', dbl: () => app.commands.run(`add.beat.${d.id}`) }));
    out.push(...this.group('beats', 'Beats', L.Grid3x3, beats, !!q || this.openGroups.has('beats')));
    this.list.replaceChildren(...out);
  }

  // ---------- sample folders ----------

  private play(path: string): void {
    this.audio?.pause();
    this.audio = new Audio(platform.mediaUrl(path));
    this.audio.volume = 0.8;
    void this.audio.play().catch(() => toast("That file couldn't be played."));
  }

  private renderSamples(match: (s: string) => boolean): void {
    const app = this.app;
    const add = h('button', { class: 'btn small outline br-add', onclick: async () => {
      const f = await platform.sampleFolders.add();
      if (f) {
        this.folders = [...this.folders.filter((x) => x.path !== f.path), f];
        this.openFolders.add(f.path);
        this.render();
      }
    } }, icon(L.FolderPlus, 14), 'Add a folder of samples…');
    if (!isDesktop) {
      this.list.replaceChildren(h('p', { class: 'hint br-note' }, 'Sample folders are available in the desktop app.'));
      return;
    }
    const out: HTMLElement[] = [add];
    if (!this.folders.length) out.push(h('p', { class: 'hint br-note' }, 'Add the folders where you keep drum kits, loops and one-shots. Click a file to hear it; drag it onto the playlist or the channel rack.'));
    const q = this.search.value.trim();
    for (const f of this.folders) {
      const open = !!q || this.openFolders.has(f.path);
      const files = f.files.filter((x) => match(x.name));
      const head = h('button', { class: `br-group${open ? ' open' : ''}`, onclick: () => {
        if (this.openFolders.has(f.path)) this.openFolders.delete(f.path);
        else this.openFolders.add(f.path);
        this.render();
      } }, icon(open ? L.ChevronDown : L.ChevronRight, 13), icon(L.Folder, 14), f.name, h('span', { class: 'br-count' }, String(f.files.length)));
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([{ label: 'Remove from the browser', icon: L.X, run: async () => {
          await platform.sampleFolders.remove(f.path);
          this.folders = this.folders.filter((x) => x !== f);
          this.render();
        } }], { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
      });
      out.push(head);
      if (open) for (const file of files.slice(0, 600)) out.push(this.fileItem(file, () => app));
    }
    this.list.replaceChildren(...out);
  }

  private fileItem(file: MediaFileInfo, app: () => App): HTMLElement {
    return this.item(file.name.replace(/\.[^.]+$/, ''), L.AudioWaveform, {
      title: `${file.name} — click to hear, drag onto the playlist or the channel rack`,
      click: () => this.play(file.path),
      dbl: async () => {
        const [s] = await app().importAudio([file]);
        if (s) app().addSampleChannel(s);
      },
      drag: (dt) => dt.setData('text/beatline-file', JSON.stringify(file)),
      cls: 'file',
    });
  }

  // ---------- the project ----------

  private renderProject(match: (s: string) => boolean): void {
    const app = this.app;
    const p = app.project;
    const out: HTMLElement[] = [];
    const patterns = p.patterns.filter((x) => match(x.name)).map((pt) =>
      this.item(pt.name, L.Grid3x3, {
        cls: pt.id === p.activePattern ? 'on' : '',
        title: 'Click to work on it; drag it onto the playlist',
        click: () => app.selectPattern(pt.id),
        dbl: () => app.layout.show('channelRack'),
        drag: (dt) => dt.setData('text/beatline-pattern', pt.id),
        menu: (e) => showMenu([
          { label: 'Rename…', icon: L.Pencil, run: () => {
            app.selectPattern(pt.id);
            app.commands.run('pattern.rename');
          } },
          { label: 'Clone', icon: L.CopyPlus, run: () => {
            app.selectPattern(pt.id);
            app.commands.run('pattern.clone');
          } },
          { label: 'Delete', icon: L.Trash2, disabled: p.patterns.length <= 1, run: () => {
            app.selectPattern(pt.id);
            app.commands.run('pattern.delete');
          } },
        ], { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }),
      }),
    );
    out.push(...this.group('pp', 'Patterns', L.Grid3x3, patterns, true));
    out.push(h('button', { class: 'br-inline', onclick: () => app.newPattern() }, icon(L.Plus, 13), 'New pattern'));
    const channels = p.channels.filter((c) => match(c.name)).map((c) => this.item(c.name, c.kind === 'synth' ? L.Piano : L.Drum, { cls: c.id === app.channel ? 'on' : '', click: () => app.selectChannel(c.id), dbl: () => {
      app.selectChannel(c.id);
      app.layout.show('instrument');
    } }));
    out.push(...this.group('pc', 'Channels', L.Drum, channels, true));
    const samples = p.samples.filter((s) => match(s.name)).map((s) => {
      const missing = app.engine.library.missing.has(s.id);
      return this.item(s.name, missing ? L.FileX : s.recorded ? L.Mic : L.AudioWaveform, {
        sub: missing ? 'missing' : clock(s.duration),
        cls: missing ? 'missing' : '',
        title: missing ? `Can't find ${s.path} — right-click to locate it` : `${s.path} — drag onto the playlist or the channel rack`,
        click: () => !missing && this.play(s.path),
        drag: (dt) => dt.setData('text/beatline-sample', s.id),
        menu: (e) => showMenu([
          { label: 'Locate…', icon: L.FolderSearch, run: () => void app.relink(s.id) },
          { label: 'Use as a sampler channel', icon: L.Grid3x3, run: () => app.addSampleChannel(s) },
          { label: 'Show in folder', icon: L.FolderOpen, disabled: missing || !isDesktop, run: () => platform.showInFolder(s.path) },
        ], { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }),
      });
    });
    out.push(...this.group('ps', 'Audio files', L.AudioWaveform, samples, true));
    this.list.replaceChildren(...out);
  }
}
