// Keyboard shortcut reference and About dialog.
import type { App } from './app';
import { h, kbd } from './dom';
import { platform } from './platform';
import { dialog } from './widgets';

const MOUSE: [string, string][] = [
  ['Switch steps on or off (drag to paint)', 'Click a step'],
  ['Hear a channel and select it', 'Click its name'],
  ['Draw a note (it plays)', 'Click in the piano roll'],
  ['Make a note longer or shorter', 'Drag its end'],
  ['Erase notes', 'Right-click or right-drag'],
  ['Select a box of notes', 'Ctrl+drag'],
  ['Place freely, off the grid', 'Hold Alt while dragging'],
  ['Place the pattern in the song', 'Double-click a playlist track'],
  ['Copy clips', 'Alt+drag'],
  ['Loop a section of the song', 'Shift+drag on the ruler'],
  ['Fade an audio clip in or out', 'Drag its top corners'],
  ['Turn a knob finely', 'Shift+drag; double-click resets'],
  ['Zoom', 'Ctrl+wheel'],
];

export function showShortcuts(app: App): void {
  const table = h('div', { class: 'shortcut-table' });
  table.append(h('div', { class: 'cat' }, 'Mouse'));
  for (const [label, keys] of MOUSE) table.append(h('div', null, label), h('div', null, kbd(keys)));
  const byCat = new Map<string, { title: string; keys: string[] }[]>();
  for (const c of app.commands.all()) {
    if (!c.keys?.length) continue;
    const cat = c.category;
    const list = byCat.get(cat) ?? [];
    list.push({ title: c.title.replace(/…$/, ''), keys: c.keys });
    byCat.set(cat, list);
  }
  for (const [cat, list] of byCat) {
    table.append(h('div', { class: 'cat' }, cat));
    for (const c of list) table.append(h('div', null, c.title), h('div', null, ...c.keys.map((k) => kbd(k))));
  }
  const body = h('div', null, h('p', null, 'Every command is also searchable with Ctrl+Shift+P — no need to memorize these.'), table);
  void dialog('Keyboard shortcuts', body, [{ label: 'Close', value: true, primary: true }], { wide: true });
}

export async function showAbout(_app: App): Promise<void> {
  const version = await platform.appVersion();
  const body = h(
    'div',
    null,
    h('p', null, `Version ${version}${version.includes('-') ? ' (development build)' : ''}. Make beats, write songs and record your guitar and vocals.`),
    h('p', null, 'A step sequencer and piano roll with scales, chords and arpeggios; drums, synths and samplers built in; a playlist to arrange patterns and recordings; a mixer with EQ, compression, reverb, delay and guitar amps; recording with a tuner, metronome, count-in and takes; and exports to WAV, MP3 and more, with stems.'),
    h('p', { class: 'hint' }, 'Part of the same family as Gridline, Pixelline, Frameline and Baseline.'),
  );
  await dialog('About Beatline', body, [{ label: 'Close', value: true, primary: true }]);
}
