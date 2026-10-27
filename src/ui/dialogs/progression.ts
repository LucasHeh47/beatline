// Chord progressions: pick a key and a progression (pop, emotional, jazz, trap…), how the chords are
// played (held, on every beat, or arpeggiated) and an instrument — they're written into a pattern,
// with a bass line if you like.
import { addChannel, barTicks, newPattern, nextColor, PPQ, type Note } from '../../core/project';
import { SYNTH_PRESETS, synthPreset } from '../../core/instruments';
import { chordOnDegree, NOTE_NAMES, PROGRESSIONS, progressionNotes, SCALES } from '../../core/theory';
import type { App } from '../app';
import { h } from '../dom';
import { dialog, toast } from '../widgets';
import { checkbox, field, row, select } from './common';

export async function openProgression(app: App): Promise<void> {
  const p = app.project;
  const root = select(NOTE_NAMES.map((n, i) => [String(i), n] as [string, string]), String(p.key.root));
  const scale = select(SCALES.filter((s) => s.steps.length === 7).map((s) => [s.id, s.name] as [string, string]), SCALES.find((s) => s.id === p.key.scale && s.steps.length === 7) ? p.key.scale : 'major');
  const prog = select(PROGRESSIONS.map((x) => [x.id, `${x.name} · ${x.label}`] as [string, string]), p.key.scale === 'minor' ? 'minorPop' : 'pop');
  prog.style.width = '100%';
  const beats = select([['2', 'Half a bar'], ['4', 'One bar'], ['8', 'Two bars']], '4');
  const style = select<'block' | 'stabs' | 'arp'>([['block', 'Held'], ['stabs', 'On every beat'], ['arp', 'Arpeggiated']], 'block');
  const sevenths = checkbox('Richer chords (sevenths)', false);
  const bass = checkbox('Add a bass line', true);
  const synths = p.channels.filter((c) => c.kind === 'synth');
  const instrument = select(
    [...synths.map((c) => [`c:${c.id}`, c.name] as [string, string]), ...SYNTH_PRESETS.filter((s) => ['Keys', 'Pad', 'Pluck'].includes(s.category)).map((s) => [`n:${s.id}`, `New ${s.name}`] as [string, string])],
    synths[0] ? `c:${synths[0].id}` : 'n:ePiano',
  );
  // Picking a progression made for minor keys switches the scale
  prog.addEventListener('change', () => {
    const x = PROGRESSIONS.find((y) => y.id === prog.value);
    if (x) scale.value = x.mode === 'minor' ? 'minor' : 'major';
  });
  const ok = await dialog(
    'Chord progression',
    h(
      'div',
      { class: 'form' },
      h('p', { class: 'hint' }, 'Writes the chords into a new pattern. The chords move smoothly from one to the next; change any of them in the piano roll afterwards.'),
      row(field('Key', root), field('Scale', scale)),
      field('Progression', prog),
      row(field('Each chord lasts', beats), field('Played', style)),
      field('Instrument', instrument),
      sevenths.el,
      bass.el,
    ),
    [
      { label: 'Write the chords', value: true, primary: true },
      { label: 'Cancel', value: false },
    ],
  );
  if (!ok) return;
  const progression = PROGRESSIONS.find((x) => x.id === prog.value)!;
  const k = Number(root.value);
  const notes = progressionNotes(k, scale.value, progression, { beats: Number(beats.value), sevenths: sevenths.input.checked, style: style.value as 'block' | 'stabs' | 'arp', octave: 4, bass: false });
  let patternId = '';
  let channelId = '';
  app.edit(`Chords: ${progression.name}`, (x) => {
    x.key = { root: k, scale: scale.value };
    let chId = instrument.value.slice(2);
    if (instrument.value.startsWith('n:')) {
      const pre = synthPreset(chId)!;
      chId = addChannel(x, { name: pre.name, kind: 'synth', synth: structuredClone(pre.params), preset: pre.id }).id;
    }
    const pt = newPattern(`${progression.name} chords`, nextColor(x.patterns.length + 6));
    pt.notes[chId] = notes;
    if (bass.input.checked) {
      const pre = synthPreset('subBass')!;
      const b = x.channels.find((c) => c.preset === 'subBass') ?? addChannel(x, { name: 'Sub Bass', kind: 'synth', synth: structuredClone(pre.params), preset: pre.id });
      const len = Number(beats.value) * PPQ;
      const line: Note[] = progression.degrees.map((d, i) => ({ key: chordOnDegree(k, scale.value, d, 3, 2)[0], start: i * len, length: Math.round(len * 0.95), vel: 0.85 }));
      pt.notes[b.id] = line;
    }
    const end = progression.degrees.length * Number(beats.value) * PPQ;
    pt.length = Math.ceil(end / barTicks(x)) * barTicks(x);
    x.patterns.push(pt);
    patternId = pt.id;
    channelId = chId;
  });
  app.selectPattern(patternId);
  app.selectChannel(channelId);
  app.layout.show('pianoRoll');
  toast(`Wrote ${progression.label} in ${NOTE_NAMES[k]} ${scale.value === 'minor' ? 'minor' : SCALES.find((s) => s.id === scale.value)?.name.toLowerCase()}. Press Space to hear it.`, { kind: 'success' });
}
