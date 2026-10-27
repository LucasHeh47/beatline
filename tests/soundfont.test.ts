/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GM_DRUMS, GM_INSTRUMENTS } from '../src/core/instruments';
import { findPreset, G, modulated, parseSoundFont, regionsFor, tcToSecs } from '../src/core/soundfont';

const sf = parseSoundFont(new Uint8Array(readFileSync(new URL('../public/soundfonts/FluidR3Mono_GM.sf3', import.meta.url))));

describe('the built-in SoundFont', () => {
  it('has every General MIDI instrument and drum kit', () => {
    for (let program = 0; program < 128; program++) expect(findPreset(sf, 0, program)?.regions.length, `program ${program}`).toBeGreaterThan(0);
    for (const kit of [0, 8, 16, 24, 25, 32, 40, 48]) expect(findPreset(sf, 128, kit)?.regions.length, `kit ${kit}`).toBeGreaterThan(0);
    expect(findPreset(sf, 0, 0)?.name).toBe('Grand Piano');
  });

  it('finds the samples for a note, tuned and looped', () => {
    const piano = findPreset(sf, 0, 0)!;
    for (const key of [21, 48, 60, 72, 108]) {
      const rs = regionsFor(piano, key, 100);
      expect(rs.length, `key ${key}`).toBeGreaterThan(0);
      for (const r of rs) {
        const s = sf.samples[r.sample];
        expect(s.compressed).toBe(true);
        expect(s.end).toBeGreaterThan(s.start);
        // Within the sample chunk, and loop points that make sense
        expect(s.end).toBeLessThanOrEqual(sf.data.length);
        expect(s.loopEnd).toBeGreaterThan(s.loopStart);
        const root = r.gen[G.overridingRootKey] >= 0 ? r.gen[G.overridingRootKey] : s.pitch;
        // The sample used is recorded near the note asked for
        expect(Math.abs(root - key), `key ${key}`).toBeLessThanOrEqual(12);
      }
    }
    // A string ensemble holds its notes: it loops and fades in
    const strings = regionsFor(findPreset(sf, 0, 48)!, 60, 100);
    expect(strings.some((r) => r.gen[G.sampleModes] & 1)).toBe(true);
    expect(tcToSecs(strings[0].gen[G.attackVolEnv])).toBeGreaterThan(0.005);
  });

  it('makes harder notes louder and brighter (modulators)', () => {
    const piano = findPreset(sf, 0, 0)!;
    const at = (vel: number) => {
      const r = regionsFor(piano, 60, vel)[0];
      const m = modulated(r, 60, vel);
      return { atten: r.gen[G.initialAttenuation] * 0.4 + m[G.initialAttenuation], open: r.gen[G.modEnvToFilterFc] + m[G.modEnvToFilterFc] };
    };
    const soft = at(30);
    const hard = at(120);
    expect(hard.atten).toBeLessThan(soft.atten);
    expect(hard.open).toBeGreaterThan(soft.open + 2000);
    // At full strength the filter opens a few octaves above its resting point
    expect(hard.open).toBeGreaterThan(4000);
  });

  it('plays a drum kit by key, with hi-hats that cut each other off', () => {
    const kit = findPreset(sf, 128, 0)!;
    expect(regionsFor(kit, 36, 100).length).toBeGreaterThan(0);
    const cls = (key: number) => regionsFor(kit, key, 100)[0].gen[G.exclusiveClass];
    expect(cls(42)).toBeGreaterThan(0);
    expect(cls(46)).toBe(cls(42));
  });

  it('names its instruments and drums from presets that exist', () => {
    expect(GM_INSTRUMENTS).toHaveLength(128);
    for (const d of GM_DRUMS) expect(regionsFor(findPreset(sf, 128, d.kit!)!, d.key!, 100).length, d.id).toBeGreaterThan(0);
  });
});
