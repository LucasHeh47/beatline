import { describe, expect, it } from 'vitest';
import { addClip, deleteChannel, duplicateClips, makeUnique, moveClips, nextPatternName, patternClip, sliceClip } from '../src/core/arrange';
import { decodeWav, encodeWav } from '../src/core/wav';
import { readMidi, writeMidi } from '../src/core/midi';
import { arpeggiate, chordify, fillSteps, fixOverlaps, humanize, isMelodic, legato, quantize, rng, stepsFromString, stepsOf, strum, toggleStep, transpose } from '../src/core/notes';
import { addAudioTrack, addChannel, barBeat, barTicks, newPattern, newProject, PPQ, readProject, STEP, writeProject, type Note } from '../src/core/project';
import { loopWindows, patternNotes, songAudio, songNotes, swingTick } from '../src/core/sequence';
import { TEMPLATES, applyDrumPattern } from '../src/core/templates';
import { chordName, chordOnDegree, hzToNote, inScale, noteName, PROGRESSIONS, progressionNotes, snapToScale, voiceLead } from '../src/core/theory';
import { detectPitch, TUNINGS, tuneTo } from '../src/core/tuner';
import { DRUM_PATTERNS } from '../src/core/drumPatterns';
import { drumById } from '../src/core/instruments';

const n = (key: number, start: number, length = STEP, vel = 0.8): Note => ({ key, start, length, vel });

describe('theory', () => {
  it('names notes and finds them from frequencies', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(hzToNote(440)).toEqual({ key: 69, cents: 0 });
    expect(hzToNote(445).cents).toBeCloseTo(19.56, 1);
  });

  it('knows scales', () => {
    expect(inScale(64, 0, 'major')).toBe(true);
    expect(inScale(63, 0, 'major')).toBe(false);
    expect(inScale(63, 0, 'minor')).toBe(true);
    expect(snapToScale(61, 0, 'major')).toBe(60);
    // F# isn't in A minor pentatonic (A C D E G): G is a semitone away
    expect(snapToScale(66, 9, 'minorPentatonic')).toBe(67);
  });

  it('builds chords on scale degrees', () => {
    expect(chordOnDegree(0, 'major', 0)).toEqual([60, 64, 67]);
    expect(chordOnDegree(0, 'major', 5)).toEqual([69, 72, 76]);
    expect(chordOnDegree(9, 'minor', 0, 4)).toEqual([69, 72, 76, 79]);
  });

  it('names chords, with inversions', () => {
    expect(chordName([60, 64, 67])).toBe('C');
    expect(chordName([57, 60, 64])).toBe('Am');
    expect(chordName([64, 67, 72])).toBe('C/E');
    expect(chordName([55, 59, 62, 65])).toBe('G7');
    expect(chordName([60, 61])).toBe('');
  });

  it('voice-leads progressions so chords move little', () => {
    const chords = [chordOnDegree(0, 'major', 0), chordOnDegree(0, 'major', 4), chordOnDegree(0, 'major', 5), chordOnDegree(0, 'major', 3)];
    const v = voiceLead(chords);
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1].reduce((x, y) => x + y) / 3;
      const b = v[i].reduce((x, y) => x + y) / 3;
      expect(Math.abs(a - b)).toBeLessThan(4);
    }
    // Same notes (pitch classes) as the chords asked for
    expect(chordName(v[1])).toMatch(/^G/);
  });

  it('writes progressions in different styles', () => {
    const pop = PROGRESSIONS.find((p) => p.id === 'pop')!;
    const block = progressionNotes(0, 'major', pop, { beats: 4, sevenths: false, style: 'block', octave: 4, bass: true });
    expect(block.length).toBe(16);
    expect(block.filter((x) => x.start === 4 * PPQ).map((x) => x.key % 12).sort((a, b) => a - b)).toEqual([2, 7, 7, 11]);
    const arp = progressionNotes(0, 'major', pop, { beats: 4, sevenths: false, style: 'arp', octave: 4, bass: false });
    expect(arp.length).toBe(4 * 8);
    expect(new Set(arp.map((x) => x.start)).size).toBe(arp.length);
  });
});

describe('notes', () => {
  it('toggles and reads steps', () => {
    const pt = newPattern('P', '#fff');
    toggleStep(pt, 'c', 0);
    toggleStep(pt, 'c', 4);
    expect(stepsOf(pt.notes.c, 16).map((x) => (x ? 'x' : '.')).join('')).toBe('x...x...........');
    toggleStep(pt, 'c', 0);
    expect(stepsOf(pt.notes.c, 16)[0]).toBe(false);
    fillSteps(pt, 'c', 4);
    expect(pt.notes.c.length).toBe(4);
    expect(isMelodic(pt.notes.c)).toBe(false);
    expect(isMelodic([n(64, 0)])).toBe(true);
  });

  it('reads step strings with accents', () => {
    const s = stepsFromString('X.o.x...');
    expect(s.map((x) => [x.start / STEP, x.vel])).toEqual([[0, 1], [2, 0.55], [4, 0.8]]);
  });

  it('quantizes, fully or partly', () => {
    expect(quantize([n(60, 30, 20)], STEP).map((x) => [x.start, x.length])).toEqual([[24, 20]]);
    expect(quantize([n(60, 30, 20)], STEP, 0.5)[0].start).toBe(27);
    expect(quantize([n(60, 30, 20)], STEP, 1, true).map((x) => [x.start, x.length])).toEqual([[24, 24]]);
  });

  it('humanizes within limits, repeatably', () => {
    const a = humanize([n(60, 96), n(62, 192)], 5, 0.1, rng(3));
    const b = humanize([n(60, 96), n(62, 192)], 5, 0.1, rng(3));
    expect(a).toEqual(b);
    for (const x of a) expect(Math.abs(x.start - (x.key === 60 ? 96 : 192))).toBeLessThanOrEqual(5);
  });

  it('transposes, makes legato and fixes overlaps', () => {
    expect(transpose([n(60, 0)], 12)[0].key).toBe(72);
    expect(legato([n(60, 0, 10), n(64, 0, 10), n(67, 48, 10)]).map((x) => x.length)).toEqual([48, 48, 10]);
    expect(fixOverlaps([n(60, 0, 100), n(60, 50, 10), n(60, 50, 20)]).map((x) => [x.start, x.length])).toEqual([[0, 50], [50, 10]]);
  });

  it('arpeggiates chords and strums them', () => {
    const chord = [n(60, 0, PPQ), n(64, 0, PPQ), n(67, 0, PPQ)];
    const up = arpeggiate(chord, 'up', STEP);
    expect(up.map((x) => x.key)).toEqual([60, 64, 67, 60]);
    expect(up.map((x) => x.start)).toEqual([0, 24, 48, 72]);
    expect(arpeggiate(chord, 'upDown', STEP / 2).map((x) => x.key).slice(0, 5)).toEqual([60, 64, 67, 64, 60]);
    const s = strum(chord, 6, true);
    expect(s.map((x) => [x.key, x.start])).toEqual([[67, 0], [64, 6], [60, 12]]);
  });

  it('turns notes into the key’s chords', () => {
    expect(chordify([n(62, 0)], 0, 'major').map((x) => x.key)).toEqual([62, 65, 69]);
    expect(chordify([n(57, 0)], 9, 'minor').map((x) => x.key)).toEqual([57, 60, 64]);
    // Not in the key: left alone
    expect(chordify([n(61, 0)], 0, 'major').map((x) => x.key)).toEqual([61]);
  });
});

describe('playlist', () => {
  it('moves, slices and duplicates clips', () => {
    const p = newProject();
    const pt = p.patterns[0];
    const bar = barTicks(p);
    const c = addClip(p.tracks[0], patternClip(pt, 0, bar));
    expect(c.length).toBe(bar);
    moveClips(p, new Set([c.id]), bar, 2);
    expect(p.tracks[2].clips[0].start).toBe(bar);
    const right = sliceClip(p, c.id, bar + 96)!;
    expect([c.length, right.start, right.length, right.offset]).toEqual([96, bar + 96, bar - 96, 96]);
    const copies = duplicateClips(p, new Set([c.id, right.id]));
    expect(copies.map((x) => x.start)).toEqual([2 * bar, 2 * bar + 96]);
    expect(p.tracks[2].clips.length).toBe(4);
  });

  it('slices audio clips in seconds', () => {
    const p = newProject();
    p.bpm = 120;
    const t = addAudioTrack(p, 'Guitar');
    const c = addClip(t, { id: 'a', kind: 'audio', sampleId: 's', start: 0, length: 4 * PPQ, offset: 1, gain: 0, fadeIn: 0, fadeOut: 0 });
    const r = sliceClip(p, c.id, 2 * PPQ)!;
    // Two beats at 120 BPM is one second
    expect(r.offset).toBeCloseTo(2, 6);
  });

  it('gives a clip its own pattern', () => {
    const p = newProject();
    const c = addClip(p.tracks[0], patternClip(p.patterns[0], 0, barTicks(p)));
    const copy = makeUnique(p, c.id)!;
    expect(c.patternId).toBe(copy.id);
    expect(copy.name).toBe('Pattern 2');
    expect(nextPatternName(p, 'Verse')).toBe('Verse 1');
  });

  it('removes a channel with its notes and mixer track', () => {
    const p = newProject();
    const ch = addChannel(p, { name: 'Kick', kind: 'sampler' });
    p.patterns[0].notes[ch.id] = [n(60, 0)];
    expect(p.mixer.length).toBe(2);
    deleteChannel(p, ch.id);
    expect(p.channels.length).toBe(0);
    expect(p.patterns[0].notes[ch.id]).toBeUndefined();
    expect(p.mixer.length).toBe(1);
  });
});

describe('what plays when', () => {
  it('swings every second 16th', () => {
    expect(swingTick(0, 0.5)).toBe(0);
    expect(swingTick(STEP, 0.5)).toBe(STEP + STEP * 0.25);
    expect(swingTick(STEP * 2, 0.5)).toBe(STEP * 2);
  });

  it('plays a pattern’s notes in a window', () => {
    const p = newProject();
    const ch = addChannel(p, { name: 'Kick', kind: 'sampler' });
    p.patterns[0].notes[ch.id] = stepsFromString('x...x...x...x...');
    expect(patternNotes(p, p.patterns[0].id, 0, 4 * STEP + 1).map((e) => e.at)).toEqual([0, 4 * STEP]);
    ch.mute = true;
    expect(patternNotes(p, p.patterns[0].id, 0, 16 * STEP)).toEqual([]);
  });

  it('plays pattern clips in the song, repeating and cut by the clip', () => {
    const p = newProject();
    const ch = addChannel(p, { name: 'Kick', kind: 'sampler' });
    const pt = p.patterns[0];
    pt.length = 4 * STEP;
    pt.notes[ch.id] = [n(60, 0), n(60, 2 * STEP)];
    // A clip 10 steps long starting at step 16, beginning 2 steps into the pattern
    addClip(p.tracks[1], { id: 'k', kind: 'pattern', patternId: pt.id, start: 16 * STEP, length: 10 * STEP, offset: 2 * STEP, gain: 0, fadeIn: 0, fadeOut: 0 });
    const ev = songNotes(p, 0, 100 * STEP).map((e) => e.at / STEP);
    expect(ev).toEqual([16, 18, 20, 22, 24]);
    p.tracks[1].mute = true;
    expect(songNotes(p, 0, 100 * STEP)).toEqual([]);
  });

  it('starts audio clips, also in the middle', () => {
    const p = newProject();
    const t = addAudioTrack(p, 'Gtr');
    addClip(t, { id: 'a', kind: 'audio', sampleId: 's', start: PPQ, length: 8 * PPQ, offset: 0.5, gain: 0, fadeIn: 0, fadeOut: 0 });
    const secs = (x: number) => x / PPQ / 2;
    expect(songAudio(p, 0, 2 * PPQ, secs).map((e) => [e.at, e.offset])).toEqual([[PPQ, 0.5]]);
    const mid = songAudio(p, 3 * PPQ, 4 * PPQ, secs, 3 * PPQ);
    expect(mid.map((e) => [e.at, e.offset, e.length])).toEqual([[3 * PPQ, 1.5, 6 * PPQ]]);
  });

  it('splits play at the loop end', () => {
    expect(loopWindows(90, 20, [0, 100])).toEqual([
      { start: 90, end: 100, shift: 0 },
      { start: 0, end: 10, shift: 10 },
    ]);
    expect(loopWindows(10, 20, null)).toEqual([{ start: 10, end: 30, shift: 0 }]);
  });
});

describe('files', () => {
  it('saves and reads projects', () => {
    const p = TEMPLATES.find((t) => t.id === 'hiphop')!.make('Beat');
    const back = readProject(writeProject(p));
    expect(back).toEqual(p);
    expect(() => readProject('{"app":"frameline"}')).toThrow();
  });

  it('writes and reads MIDI files', () => {
    const notes = [n(60, 0, 96, 1), n(64, 0, 96, 0.5), n(67, 192, 48, 0.75)];
    const data = writeMidi([{ name: 'Piano', notes }], 128);
    const back = readMidi(data);
    expect(back.bpm).toBeCloseTo(128, 1);
    expect(back.tracks[0].name).toBe('Piano');
    expect(back.tracks[0].notes.map((x) => [x.key, x.start, x.length])).toEqual(notes.map((x) => [x.key, x.start, x.length]));
    expect(back.tracks[0].notes[1].vel).toBeCloseTo(0.5, 1);
    // Instruments and drums survive the trip
    const band = readMidi(writeMidi([{ name: 'Guitar', notes, program: 25 }, { name: 'Drums', notes: [n(36, 0)], drums: true }, { name: 'Lead', notes }], 120));
    expect(band.tracks.map((t) => [t.name, t.program, !!t.drums])).toEqual([
      ['Guitar', 25, false],
      ['Drums', undefined, true],
      ['Lead', undefined, false],
    ]);
  });

  it('writes and reads WAV files', () => {
    const ch = new Float32Array([0, 0.5, -0.5, 1, -1]);
    for (const bits of [16, 24, 32] as const) {
      const back = decodeWav(encodeWav({ sampleRate: 48000, channels: [ch, ch] }, bits));
      expect(back.sampleRate).toBe(48000);
      expect(back.channels.length).toBe(2);
      back.channels[1].forEach((v, i) => expect(v).toBeCloseTo(ch[i], 3));
    }
  });
});

describe('tuner', () => {
  const tone = (hz: number, sr = 48000, n = 4096) => {
    const b = new Float32Array(n);
    // A string-like tone: strong overtones
    for (let i = 0; i < n; i++) b[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / sr) + 0.25 * Math.sin((4 * Math.PI * hz * i) / sr) + 0.15 * Math.sin((6 * Math.PI * hz * i) / sr);
    return b;
  };

  it('finds the pitch of guitar strings', () => {
    for (const hz of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
      const p = detectPitch(tone(hz), 48000)!;
      expect(Math.abs(1200 * Math.log2(p.hz / hz))).toBeLessThan(3);
    }
  });

  it('is quiet on silence', () => {
    expect(detectPitch(new Float32Array(4096), 48000)).toBeNull();
  });

  it('tells which string and how far off', () => {
    const r = tuneTo(112, TUNINGS[0]);
    expect(r.string).toBe(1);
    expect(r.cents).toBeGreaterThan(25);
  });
});

describe('templates and beats', () => {
  it('makes every template', () => {
    for (const t of TEMPLATES) {
      const p = t.make('X');
      expect(p.channels.length).toBeGreaterThan(0);
      expect(p.mixer[0].id).toBe('master');
      for (const c of p.channels) expect(p.mixer.some((m) => m.id === c.mixer)).toBe(true);
    }
    const band = TEMPLATES.find((t) => t.id === 'band')!.make('Band');
    expect(band.tracks[0].name).toBe('Vocals');
    expect(band.tracks[1].name).toBe('Guitar');
    expect(band.mixer.find((m) => m.id === band.tracks[1].mixer)!.effects.some((e) => e.type === 'amp')).toBe(true);
  });

  it('every drum pattern uses real sounds and 16 steps', () => {
    for (const d of DRUM_PATTERNS) for (const r of d.rows) {
      expect(drumById(r.sound)).toBeTruthy();
      expect(r.steps.length).toBe(16);
    }
  });

  it('applies a beat, reusing channels', () => {
    const p = newProject();
    applyDrumPattern(p, p.patterns[0], 'rock');
    const count = p.channels.length;
    applyDrumPattern(p, p.patterns[0], 'rock');
    expect(p.channels.length).toBe(count);
    expect(p.bpm).toBe(110);
  });

  it('shows positions as bar.beat.step', () => {
    const p = newProject();
    expect(barBeat(0, p)).toBe('1.1.1');
    expect(barBeat(barTicks(p) + PPQ + STEP, p)).toBe('2.2.2');
  });
});
