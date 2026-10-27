// The start page: new projects from templates (an empty beat, ready-made grooves, setups for recording
// a band or a singer-songwriter), recent projects, unsaved work to recover, and tips. Shown when
// Beatline starts and from the logo.
import * as L from 'lucide';
import { TEMPLATES, type Template } from '../core/templates';
import type { RecentFile, RecoveredProject } from '../shared/api';
import type { App } from './app';
import { h, icon } from './dom';
import { isDesktop, platform } from './platform';
import { showMenu, tooltip } from './widgets';

export type HomeSection = 'home' | 'new' | 'open';

function relativeTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const mins = Math.round((now.getTime() - ms) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  const days = (now.getTime() - ms) / 86400000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function folderOf(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  if (parts.length <= 2) return parts.join('\\');
  return '…\\' + parts.slice(-2).join('\\');
}

const TIPS: { icon: L.IconNode; title: string; text: string }[] = [
  { icon: L.Grid3x3, title: 'A beat in seconds', text: 'Click steps in the channel rack to switch them on, or press Beats and pick a style. Space plays it.' },
  { icon: L.Keyboard, title: 'Play with your keyboard', text: 'Ctrl+T turns the computer keyboard into a piano: Z to M is one octave, Q to P the next. Plug in a MIDI keyboard and it just works.' },
  { icon: L.Guitar, title: 'Record your guitar', text: 'In the Record workspace, make a Guitar track: it comes with an amp. Arm it, press record, and play along after the count-in.' },
  { icon: L.Repeat2, title: 'Takes', text: 'Shift+drag on the playlist ruler to loop a section, then record: every pass is kept as a take, and the last one plays.' },
  { icon: L.ListMusic, title: 'Chords made easy', text: 'Add > Chord progression writes chords in your key: pop, emotional, jazz, trap. Then arpeggiate or strum them in the piano roll.' },
  { icon: L.Music2, title: 'Stay in key', text: 'Pick the key in the piano roll: its notes are the light rows. "Chords in the key" draws a whole chord with one click.' },
  { icon: L.Search, title: 'Find any command', text: 'Press Ctrl+Shift+P and type what you want: "swing", "metronome", "export", "tuner"...' },
  { icon: L.Upload, title: 'Ready to share', text: 'Ctrl+R exports MP3 or WAV, with loudness made right for Spotify and YouTube. Export stems for every track separately.' },
];

function greeting(): string {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

export class HomeView {
  readonly el: HTMLElement;
  private main: HTMLElement;
  private nav: HTMLElement;
  private section: HomeSection;
  private recent: RecentFile[] = [];
  private recovered: RecoveredProject[] = [];
  private filter = '';
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .popover')) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(
    private app: App,
    section: HomeSection,
    private onClosed: () => void,
  ) {
    this.section = section;
    this.nav = h('nav', { class: 'home-nav' });
    this.main = h('main', { class: 'home-main' });
    const close = h('button', { class: 'btn home-close', 'aria-label': 'Close the start page', onclick: () => this.close() }, icon(L.X, 18));
    tooltip(close, 'Back to the project', 'Esc');
    this.el = h('div', { class: 'home-view', role: 'dialog', 'aria-label': 'Start page' }, h('aside', { class: 'home-rail' }, this.nav), h('div', { class: 'home-body' }, h('div', { class: 'home-top' }, h('div', { class: 'spacer' }), close), this.main));
    document.addEventListener('keydown', this.onKey, true);
    this.renderNav();
    this.render();
    void this.loadRecent();
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.onClosed();
  }

  show(section: HomeSection): void {
    this.section = section;
    this.renderNav();
    this.render();
    void this.loadRecent();
  }

  private async loadRecent(): Promise<void> {
    this.recent = await platform.recentFiles();
    this.recovered = await platform.recovery.list();
    this.render();
  }

  private renderNav(): void {
    const app = this.app;
    const brand = h('div', { class: 'home-brand' }, h('span', { class: 'brand-mark' }, icon(L.AudioLines, 16)), 'Beatline');
    const item = (id: HomeSection, label: string, ic: L.IconNode) => h('button', { class: `home-nav-item${this.section === id ? ' on' : ''}`, onclick: () => this.show(id) }, icon(ic, 18), label);
    const action = (label: string, ic: L.IconNode, run: () => unknown) =>
      h('button', { class: 'home-nav-item', onclick: () => {
        this.close();
        void run();
      } }, icon(ic, 18), label);
    this.nav.replaceChildren(
      brand,
      item('home', 'Home', L.House),
      item('new', 'New', L.FilePlus),
      item('open', 'Open', L.FolderOpen),
      h('div', { class: 'home-nav-sep' }),
      action('Save', L.Save, () => app.commands.run('file.save')),
      action('Export', L.Upload, () => app.commands.run('file.export')),
      h('div', { class: 'spacer' }),
      action('Settings', L.Settings, () => app.openSettings()),
      action('About', L.Info, () => app.commands.run('help.about')),
    );
  }

  private render(): void {
    const scroll = this.main.scrollTop;
    this.main.replaceChildren();
    if (this.section === 'home') this.renderHome();
    else if (this.section === 'new') this.renderNew();
    else this.renderOpen();
    this.main.scrollTop = scroll;
  }

  private renderHome(): void {
    this.main.append(h('h1', { class: 'home-h1' }, greeting()));
    if (this.recovered.length) this.main.append(this.recoveryBlock());
    const strip = h('div', { class: 'size-strip' }, ...TEMPLATES.slice(0, 6).map((t) => this.templateCard(t)));
    this.main.append(
      h('div', { class: 'home-row-head' }, h('h2', null, 'New project'), h('button', { class: 'btn text home-link', onclick: () => this.show('new') }, 'All templates', icon(L.ArrowRight, 14))),
      strip,
      this.recentBlock(false),
      this.tipsBlock(),
    );
  }

  /** Projects with unsaved changes from a session that ended unexpectedly. */
  private recoveryBlock(): HTMLElement {
    const list = h('div', { class: 'recover-list' });
    for (const r of this.recovered) {
      list.append(
        h(
          'div',
          { class: 'recover-row' },
          icon(L.LifeBuoy, 18),
          h('span', { class: 'name' }, r.name, h('span', { class: 'hint' }, ` · ${relativeTime(r.savedAt)}`)),
          h('button', { class: 'btn primary small', onclick: () => {
            this.close();
            void this.app.restoreRecovered(r.id, r.name, r.filePath);
          } }, 'Recover'),
          h('button', { class: 'btn outline small', onclick: async () => {
            await platform.recovery.remove(r.id);
            this.recovered = this.recovered.filter((x) => x !== r);
            this.render();
          } }, 'Discard'),
        ),
      );
    }
    return h('section', { class: 'home-recover' }, h('h2', null, 'Unsaved work from last time'), h('p', { class: 'hint' }, 'Beatline closed before these were saved. Recover them to keep working, or discard them.'), list);
  }

  private tipsBlock(): HTMLElement {
    const start = Math.floor(Date.now() / 86_400_000) % TIPS.length;
    const tips = [0, 1, 2].map((i) => TIPS[(start + i) % TIPS.length]);
    return h(
      'section',
      { class: 'home-tips' },
      h('h2', null, 'Tips'),
      h('div', { class: 'tips-grid' }, ...tips.map((t) => h('div', { class: 'tip-card' }, h('div', { class: 'tip-icon' }, icon(t.icon, 18)), h('div', null, h('div', { class: 'tip-title' }, t.title), h('div', { class: 'tip-text' }, t.text))))),
    );
  }

  private renderNew(): void {
    this.main.append(h('h1', { class: 'home-h1' }, 'New project'), h('p', { class: 'hint home-sub' }, 'Start empty, from a groove that is already playing, or set up to record. Everything can be changed afterwards.'));
    this.main.append(h('div', { class: 'size-grid' }, ...TEMPLATES.map((t) => this.templateCard(t))));
  }

  private renderOpen(): void {
    this.main.append(h('h1', { class: 'home-h1' }, 'Open'));
    const browse = h('button', { class: 'btn primary', onclick: () => {
      this.close();
      void this.app.openDialog();
    } }, icon(L.FolderOpen, 16), 'Browse…');
    this.main.append(h('div', { class: 'home-open-actions' }, browse, h('span', { class: 'hint' }, 'Beatline projects (.beatline). To add audio or MIDI to a project, use Import (Ctrl+I) or drag files onto the window.')));
    this.main.append(this.recentBlock(true));
  }

  private async newProject(t: Template): Promise<void> {
    if (!(await this.app.confirmDiscard())) return;
    this.close();
    this.app.newProject(t.id);
    this.app.setMode(t.id === 'empty' || t.id === 'songwriter' ? 'pattern' : 'song');
    this.app.layout.setWorkspace(t.id === 'band' || t.id === 'songwriter' ? 'record' : t.id === 'empty' ? 'beats' : 'arrange');
  }

  private templateCard(t: Template): HTMLElement {
    const icons: Record<string, L.IconNode> = { empty: L.Plus, hiphop: L.Headphones, trap: L.Zap, house: L.Disc3, lofi: L.Coffee, pop: L.Star, band: L.Guitar, songwriter: L.Mic };
    const card = h('button', { class: 'size-card', onclick: () => void this.newProject(t) }, h('div', { class: `size-thumb tpl tpl-${t.id}` }, icon(icons[t.id] ?? L.Music, 26)), h('div', { class: 'size-meta' }, h('div', { class: 'size-title' }, t.name), h('div', { class: 'size-sub' }, t.description)));
    if (t.id === 'empty') tooltip(card, 'A kick, clap, hi-hat and snare ready to program', 'Ctrl+N');
    return card;
  }

  private recentBlock(full: boolean): HTMLElement {
    const wrap = h('section', { class: 'home-recent' });
    const search = h('input', { class: 'input home-search', type: 'search', placeholder: 'Search recent projects', value: this.filter, 'aria-label': 'Search recent projects' }) as HTMLInputElement;
    search.addEventListener('input', () => {
      this.filter = search.value;
      const pos = search.selectionStart;
      this.render();
      const again = this.main.querySelector('.home-search') as HTMLInputElement | null;
      again?.focus();
      again?.setSelectionRange(pos, pos);
    });
    wrap.append(h('div', { class: 'home-row-head' }, h('h2', null, 'Recent'), h('div', { class: 'spacer' }), search));
    const q = this.filter.trim().toLowerCase();
    let list = [...this.recent.filter((r) => r.pinned), ...this.recent.filter((r) => !r.pinned)];
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
    if (!full && !q) list = list.slice(0, 12);
    if (!list.length) {
      const msg = q ? `No recent projects match "${this.filter}".` : isDesktop ? 'Projects you open or save will show up here.' : 'Recent projects are listed in the desktop app.';
      wrap.append(h('div', { class: 'home-empty' }, icon(L.Clock, 26), h('p', null, msg)));
      return wrap;
    }
    const table = h('div', { class: 'recent-list', role: 'list' });
    table.append(h('div', { class: 'recent-row head' }, h('span'), h('span', null, 'Name'), h('span', null, 'Location'), h('span', null, 'Opened'), h('span')));
    for (const r of list) table.append(this.recentRow(r));
    wrap.append(table);
    return wrap;
  }

  private recentRow(r: RecentFile): HTMLElement {
    const pin = h('button', { class: `btn icon-only${r.pinned ? ' on' : ''}`, 'aria-label': r.pinned ? 'Unpin' : 'Pin to the top', onclick: (e: MouseEvent) => {
      e.stopPropagation();
      void platform.pinRecentFile(r.path, !r.pinned).then(() => this.loadRecent());
    } }, icon(r.pinned ? L.PinOff : L.Pin, 15));
    tooltip(pin, r.pinned ? 'Unpin' : 'Pin to the top');
    const more = h('button', { class: 'btn icon-only', 'aria-label': 'More', onclick: (e: MouseEvent) => {
      e.stopPropagation();
      showMenu(
        [
          { label: 'Open', icon: L.FolderOpen, run: () => this.openRecent(r) },
          { label: 'Open in a new window', icon: L.AppWindow, run: () => platform.newWindow(r.path) },
          { label: 'Show in folder', icon: L.FolderSearch, run: () => platform.showInFolder(r.path) },
          { separator: true },
          { label: 'Remove from list', icon: L.X, run: () => void platform.removeRecentFile(r.path).then(() => this.loadRecent()) },
        ],
        e.currentTarget as HTMLElement,
      );
    } }, icon(L.Ellipsis, 15));
    const row = h(
      'div',
      { class: 'recent-row', role: 'listitem', tabindex: '0', title: r.path },
      h('span', { class: 'file-icon beatline' }, icon(L.AudioLines, 18)),
      h('span', { class: 'name' }, r.name.replace(/\.beatline$/i, ''), r.pinned ? h('span', { class: 'pinned-mark', title: 'Pinned' }, icon(L.Pin, 12)) : null),
      h('span', { class: 'loc' }, folderOf(r.path)),
      h('span', { class: 'when' }, relativeTime(r.openedAt)),
      h('span', { class: 'acts' }, pin, more),
    );
    row.addEventListener('click', () => this.openRecent(r));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.openRecent(r);
    });
    return row;
  }

  private openRecent(r: RecentFile): void {
    this.close();
    void this.app.openRecent(r.path);
  }
}
