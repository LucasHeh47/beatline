// Starting points for new projects: an empty beat, ready-made grooves in a few styles (drums, bass and
// chords already playing), and setups for recording a band or a singer-songwriter.
import { addClip, patternClip } from './arrange';
import { CHAIN_PRESETS, makeEffect } from './effects';
import { drumSampler, drumById, synthPreset } from './instruments';
import { stepsFromString } from './notes';
import { drumPatternById } from './drumPatterns';
import { addAudioTrack, addChannel, barTicks, mixerById, newPattern, newProject, PPQ, type Channel, type Note, type Pattern, type Project } from './project';
import { chordOnDegree, PROGRESSIONS, progressionNotes } from './theory';

export interface Template {
  id: string;
  name: string;
  description: string;
  make: (name: string) => Project;
}

/** A new project with a limiter on the master, so the song never clips. */
export function freshProject(name: string): Project {
  const p = newProject(name);
  p.mixer[0].effects = [makeEffect('limiter', { ceiling: -0.3 })];
  return p;
}

/** A drum channel for a built-in sound (the existing one, or a new one). */
export function drumChannel(p: Project, sound: string): Channel {
  const have = p.channels.find((c) => c.kind === 'sampler' && c.sampler?.sample.builtin === sound);
  if (have) return have;
  return addChannel(p, { name: drumById(sound)?.name ?? sound, kind: 'sampler', sampler: drumSampler(sound), preset: sound });
}

export function synthChannel(p: Project, presetId: string, name?: string): Channel {
  const pre = synthPreset(presetId) ?? synthPreset('basic')!;
  return addChannel(p, { name: name ?? pre.name, kind: 'synth', synth: structuredClone(pre.params), preset: pre.id });
}

/** Writes a ready-made beat into a pattern (adding the drum channels it needs). Returns false if unknown. */
export function applyDrumPattern(p: Project, pt: Pattern, id: string, setTempo = true): boolean {
  const d = drumPatternById(id);
  if (!d) return false;
  for (const row of d.rows) {
    const ch = drumChannel(p, row.sound);
    pt.notes[ch.id] = stepsFromString(row.steps);
  }
  pt.length = Math.max(pt.length, 16 * (PPQ / 4));
  if (setTempo) {
    p.bpm = d.bpm;
    p.swing = d.swing;
  }
  return true;
}

/** A pattern of notes for one channel, repeated to fill `bars`. */
function melodic(p: Project, name: string, ch: Channel, notes: Note[]): Pattern {
  const pt = newPattern(name, ch.color);
  pt.notes[ch.id] = notes;
  const end = Math.max(...notes.map((n) => n.start + n.length));
  pt.length = Math.ceil(end / barTicks(p)) * barTicks(p);
  p.patterns.push(pt);
  return pt;
}

/** Lays out the patterns on the playlist: each [pattern, track, from bar, bars] repeats its pattern. */
function arrange(p: Project, plan: [Pattern, number, number, number][]): void {
  const bar = barTicks(p);
  for (const [pt, track, from, bars] of plan) {
    const len = Math.max(bar, pt.length);
    for (let at = from * bar; at < (from + bars) * bar; at += len) addClip(p.tracks[track], patternClip(pt, at, bar));
  }
}

/** A groove: drums, a bass line following the chords, and the chords. */
function groove(name: string, o: { drums: string; key: number; scale: string; prog: string; bass: string; keys: string; style: 'block' | 'stabs' | 'arp'; sevenths?: boolean }): Project {
  const p = freshProject(name);
  p.key = { root: o.key, scale: o.scale };
  const drums = p.patterns[0];
  drums.name = 'Drums';
  applyDrumPattern(p, drums, o.drums);
  const prog = PROGRESSIONS.find((x) => x.id === o.prog)!;
  const chordNotes = progressionNotes(o.key, o.scale, prog, { beats: 4, sevenths: !!o.sevenths, style: o.style, octave: 4, bass: false });
  const keys = synthChannel(p, o.keys);
  const chords = melodic(p, 'Chords', keys, chordNotes);
  // The bass plays each chord's root on the beat
  const bassCh = synthChannel(p, o.bass);
  const bassNotes: Note[] = prog.degrees.flatMap((d, i) => {
    const root = chordOnDegree(o.key, o.scale, d, 3, 2)[0];
    return [0, 1, 2, 3].map((b) => ({ key: root, start: i * 4 * PPQ + b * PPQ, length: Math.round(PPQ * 0.8), vel: b === 0 ? 0.9 : 0.75 }));
  });
  const bass = melodic(p, 'Bass', bassCh, bassNotes);
  const bars = Math.max(1, chords.length / barTicks(p));
  arrange(p, [
    [chords, 0, 0, bars * 3],
    [drums, 1, bars, bars * 2],
    [bass, 2, bars, bars * 2],
  ]);
  p.tracks[0].name = 'Chords';
  p.tracks[1].name = 'Drums';
  p.tracks[2].name = 'Bass';
  p.activePattern = drums.id;
  return p;
}

export const TEMPLATES: Template[] = [
  {
    id: 'empty',
    name: 'Empty beat',
    description: 'A kick, clap, hi-hat and snare ready to program.',
    make: (name) => {
      const p = freshProject(name);
      for (const s of ['kick808', 'clap', 'hatClosed', 'snare']) drumChannel(p, s);
      p.patterns[0].notes[p.channels[0].id] = stepsFromString('x...x...x...x...');
      return p;
    },
  },
  { id: 'hiphop', name: 'Hip-hop', description: 'A boom-bap beat with electric piano and a sub bass, 90 BPM.', make: (n) => groove(n, { drums: 'boomBap', key: 9, scale: 'minor', prog: 'minorPop', bass: 'subBass', keys: 'ePiano', style: 'block', sevenths: true }) },
  { id: 'trap', name: 'Trap', description: '808s, rolling hats and a dark bell melody, 140 BPM.', make: (n) => groove(n, { drums: 'trap', key: 5, scale: 'minor', prog: 'trap', bass: 'subBass', keys: 'bell', style: 'arp' }) },
  { id: 'house', name: 'House', description: 'Four on the floor, offbeat bass and stab chords, 124 BPM.', make: (n) => groove(n, { drums: 'fourFloor', key: 2, scale: 'minor', prog: 'minorPop', bass: 'pluckBass', keys: 'pad', style: 'stabs', sevenths: true }) },
  { id: 'lofi', name: 'Lo-fi', description: 'Lazy swung drums under jazzy keys, 82 BPM.', make: (n) => groove(n, { drums: 'lofi', key: 0, scale: 'major', prog: 'jazz', bass: 'subBass', keys: 'ePiano', style: 'block', sevenths: true }) },
  { id: 'pop', name: 'Pop', description: 'The four chords of a thousand songs with a pluck and drums, 110 BPM.', make: (n) => groove(n, { drums: 'rock', key: 7, scale: 'major', prog: 'pop', bass: 'pluckBass', keys: 'pluck', style: 'arp' }) },
  {
    id: 'band',
    name: 'Rock band',
    description: 'Drums and bass playing, with a guitar track (amp and effects) and a vocal track ready to record.',
    make: (name) => {
      const p = groove(name, { drums: 'rock', key: 4, scale: 'minor', prog: 'minorPop', bass: 'pluckBass', keys: 'organ', style: 'block' });
      // The organ makes way for the guitar: muted in the playlist, still there to try
      p.tracks[0].mute = true;
      setupRecording(p, [
        ['Guitar', 'guitarCrunch'],
        ['Vocals', 'vocals'],
      ]);
      return p;
    },
  },
  {
    id: 'songwriter',
    name: 'Singer-songwriter',
    description: 'A guitar and a vocal track with their effects, a gentle beat, and the metronome — press record.',
    make: (name) => {
      const p = freshProject(name);
      p.bpm = 90;
      applyDrumPattern(p, p.patterns[0], 'halfTime', false);
      p.patterns[0].name = 'Soft beat';
      setupRecording(p, [
        ['Guitar', 'acoustic'],
        ['Vocals', 'vocals'],
      ]);
      return p;
    },
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** Adds audio tracks for recording, each with an effect chain on its own mixer track. */
export function setupRecording(p: Project, tracks: [string, string][]): void {
  for (const [name, chain] of tracks) {
    // Recording tracks go first in the playlist
    const t = addAudioTrack(p, name, 0);
    const preset = CHAIN_PRESETS.find((c) => c.id === chain);
    if (preset) mixerById(p, t.mixer).effects = preset.effects();
  }
}
