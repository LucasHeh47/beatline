// Reading SoundFont files (.sf2, and .sf3 with Ogg Vorbis samples): the presets (instruments and drum
// kits), which sample each note and velocity plays, and how (tuning, loop, envelope, filter, pan).
// Pure data; the sound itself is made in audio/soundfont.ts.

export interface SfSample {
  name: string;
  /** Sample frames (.sf2) or bytes of the Ogg data (.sf3) in the sample chunk. */
  start: number;
  end: number;
  /** Loop points in frames from the sample's own start. */
  loopStart: number;
  loopEnd: number;
  rate: number;
  /** The MIDI note it was recorded at, and a correction in cents. */
  pitch: number;
  correction: number;
  /** Ogg Vorbis (.sf3). */
  compressed: boolean;
}

/**
 * A modulator: a source (the note's velocity or key) changing a generator by up to `amount`, as its
 * curve says. Sources are packed as in the file: index, controller flag, direction, polarity, curve.
 */
export interface SfMod {
  src: number;
  dest: number;
  amount: number;
  amtSrc: number;
  trans: number;
}

/** One sample's part of a preset: the notes and velocities it plays, its generator values and modulators. */
export interface SfRegion {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  sample: number;
  gen: Int32Array;
  mods: SfMod[];
}

export interface SfPreset {
  name: string;
  bank: number;
  program: number;
  regions: SfRegion[];
}

export interface SoundFont {
  presets: SfPreset[];
  samples: SfSample[];
  /** The sample chunk: 16-bit samples (.sf2) or Ogg Vorbis files one after another (.sf3). */
  data: Uint8Array;
}

/** Generator numbers used here (SoundFont 2.04, section 8.1.2). */
export const G = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  vibLfoToPitch: 6,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  pan: 17,
  delayVibLFO: 23,
  freqVibLFO: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

const GEN_COUNT = 61;

/** Values a generator has when no zone sets it. */
const DEFAULTS = (() => {
  const d = new Int32Array(GEN_COUNT);
  d[G.initialFilterFc] = 13500;
  for (const g of [21, 23, G.delayModEnv, G.attackModEnv, G.holdModEnv, G.decayModEnv, G.releaseModEnv, G.delayVolEnv, G.attackVolEnv, G.holdVolEnv, G.decayVolEnv, G.releaseVolEnv]) d[g] = -12000;
  d[G.keynum] = -1;
  d[G.velocity] = -1;
  d[G.scaleTuning] = 100;
  d[G.overridingRootKey] = -1;
  return d;
})();

/** Generators a preset can't change (sample positions, and settings that belong to the instrument). */
const INSTRUMENT_ONLY = new Set<number>([0, 1, 2, 3, 4, 12, 45, 50, G.keynum, G.velocity, G.sampleModes, G.exclusiveClass, G.overridingRootKey, G.instrument, G.sampleID]);

/** The modulators every note has unless an instrument replaces them: softer notes are quieter and darker. */
const DEFAULT_MODS: SfMod[] = [
  { src: 0x0502, dest: G.initialAttenuation, amount: 960, amtSrc: 0, trans: 0 },
  { src: 0x0102, dest: G.initialFilterFc, amount: -2400, amtSrc: 0, trans: 0 },
];

const sameMod = (a: SfMod, b: SfMod) => a.src === b.src && a.dest === b.dest && a.amtSrc === b.amtSrc && a.trans === b.trans;

/** A list of modulators with others laid over it (an identical one replaces the one underneath). */
function overlay(base: SfMod[], over: SfMod[]): SfMod[] {
  const out = base.filter((m) => !over.some((o) => sameMod(o, m)));
  return [...out, ...over];
}

interface Zone {
  gens: Map<number, number>;
  mods: SfMod[];
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
}

const text = (b: Uint8Array, at: number, len: number) => {
  let s = '';
  for (let i = 0; i < len && b[at + i]; i++) s += String.fromCharCode(b[at + i]);
  return s.trim();
};

/** Reads a SoundFont. Throws if it isn't one. */
export function parseSoundFont(bytes: Uint8Array): SoundFont {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (at: number) => text(bytes, at, 4);
  if (bytes.length < 12 || id(0) !== 'RIFF' || id(8) !== 'sfbk') throw new Error("This isn't a SoundFont file.");
  const parts = new Map<string, { at: number; size: number }>();
  const walk = (from: number, to: number, inList: boolean) => {
    let at = from;
    while (at + 8 <= to) {
      const name = id(at);
      const size = v.getUint32(at + 4, true);
      if (!inList && name === 'LIST') walk(at + 12, Math.min(to, at + 8 + size), true);
      else parts.set(name, { at: at + 8, size: Math.min(size, to - at - 8) });
      at += 8 + size + (size & 1);
    }
  };
  walk(12, bytes.length, false);
  const part = (name: string) => {
    const p = parts.get(name);
    if (!p) throw new Error(`The SoundFont has no "${name}" part.`);
    return p;
  };
  const records = (name: string, size: number) => {
    const p = part(name);
    return { at: p.at, count: Math.floor(p.size / size) };
  };

  // Samples
  const shdr = records('shdr', 46);
  const samples: SfSample[] = [];
  for (let i = 0; i < shdr.count - 1; i++) {
    const at = shdr.at + i * 46;
    const start = v.getUint32(at + 20, true);
    const type = v.getUint16(at + 44, true);
    const compressed = (type & 0x10) !== 0;
    const loopStart = v.getUint32(at + 28, true);
    const loopEnd = v.getUint32(at + 32, true);
    samples.push({
      name: text(bytes, at, 20),
      start,
      end: v.getUint32(at + 24, true),
      // .sf2 loops are positions in the whole chunk; .sf3 ones count from the sample's start
      loopStart: compressed ? loopStart : loopStart - start,
      loopEnd: compressed ? loopEnd : loopEnd - start,
      rate: v.getUint32(at + 36, true) || 44100,
      pitch: v.getUint8(at + 40),
      correction: v.getInt8(at + 41),
      compressed,
    });
  }

  // Zones of instruments (ibag/igen) and presets (pbag/pgen)
  const readZones = (bagName: string, genName: string, modName: string, from: number, to: number): Zone[] => {
    const bag = part(bagName);
    const gen = part(genName);
    const mod = parts.get(modName);
    const zones: Zone[] = [];
    for (let b = from; b < to; b++) {
      const g0 = v.getUint16(bag.at + b * 4, true);
      const g1 = v.getUint16(bag.at + (b + 1) * 4, true);
      const m0 = v.getUint16(bag.at + b * 4 + 2, true);
      const m1 = v.getUint16(bag.at + (b + 1) * 4 + 2, true);
      const z: Zone = { gens: new Map(), mods: [], keyLo: 0, keyHi: 127, velLo: 0, velHi: 127 };
      for (let m = m0; mod && m < m1 && (m + 1) * 10 <= mod.size; m++) {
        const at = mod.at + m * 10;
        const dest = v.getUint16(at + 2, true);
        if (dest < GEN_COUNT) z.mods.push({ src: v.getUint16(at, true), dest, amount: v.getInt16(at + 4, true), amtSrc: v.getUint16(at + 6, true), trans: v.getUint16(at + 8, true) });
      }
      for (let g = g0; g < g1 && (g + 1) * 4 <= gen.size; g++) {
        const at = gen.at + g * 4;
        const op = v.getUint16(at, true);
        if (op === G.keyRange) {
          z.keyLo = v.getUint8(at + 2);
          z.keyHi = v.getUint8(at + 3);
        } else if (op === G.velRange) {
          z.velLo = v.getUint8(at + 2);
          z.velHi = v.getUint8(at + 3);
        } else if (op === G.instrument || op === G.sampleID) z.gens.set(op, v.getUint16(at + 2, true));
        else if (op < GEN_COUNT) z.gens.set(op, v.getInt16(at + 2, true));
      }
      zones.push(z);
    }
    return zones;
  };

  const inst = records('inst', 22);
  const instruments: { global: Zone | null; zones: Zone[] }[] = [];
  for (let i = 0; i < inst.count - 1; i++) {
    const from = v.getUint16(inst.at + i * 22 + 20, true);
    const to = v.getUint16(inst.at + (i + 1) * 22 + 20, true);
    const zones = readZones('ibag', 'igen', 'imod', from, to);
    // A first zone without a sample holds defaults for the others
    const global = zones.length && !zones[0].gens.has(G.sampleID) ? zones.shift()! : null;
    instruments.push({ global, zones: zones.filter((z) => z.gens.has(G.sampleID) && z.gens.get(G.sampleID)! < samples.length) });
  }

  const phdr = records('phdr', 38);
  const presets: SfPreset[] = [];
  for (let i = 0; i < phdr.count - 1; i++) {
    const at = phdr.at + i * 38;
    const from = v.getUint16(at + 24, true);
    const to = v.getUint16(at + 38 + 24, true);
    const zones = readZones('pbag', 'pgen', 'pmod', from, to);
    const global = zones.length && !zones[0].gens.has(G.instrument) ? zones.shift()! : null;
    const regions: SfRegion[] = [];
    for (const pz of zones) {
      const instrument = instruments[pz.gens.get(G.instrument) ?? -1];
      if (!instrument) continue;
      for (const iz of instrument.zones) {
        const keyLo = Math.max(pz.keyLo, iz.keyLo, global?.keyLo ?? 0, instrument.global?.keyLo ?? 0);
        const keyHi = Math.min(pz.keyHi, iz.keyHi, global?.keyHi ?? 127, instrument.global?.keyHi ?? 127);
        const velLo = Math.max(pz.velLo, iz.velLo, global?.velLo ?? 0, instrument.global?.velLo ?? 0);
        const velHi = Math.min(pz.velHi, iz.velHi, global?.velHi ?? 127, instrument.global?.velHi ?? 127);
        if (keyLo > keyHi || velLo > velHi) continue;
        // The instrument's values (its zone over its global zone over the defaults)…
        const gen = DEFAULTS.slice();
        for (const z of [instrument.global, iz]) if (z) for (const [k, x] of z.gens) gen[k] = x;
        // …then the preset's, which add to them
        const add = new Map<number, number>(global?.gens ?? []);
        for (const [k, x] of pz.gens) add.set(k, x);
        for (const [k, x] of add) if (!INSTRUMENT_ONLY.has(k)) gen[k] += x;
        // Modulators: the instrument's replace the defaults; the preset's add to them
        const mods = [...overlay(overlay(DEFAULT_MODS, instrument.global?.mods ?? []), iz.mods), ...overlay(global?.mods ?? [], pz.mods)];
        regions.push({ keyLo, keyHi, velLo, velHi, sample: gen[G.sampleID], gen, mods });
      }
    }
    presets.push({ name: text(bytes, at, 20), program: v.getUint16(at + 20, true), bank: v.getUint16(at + 22, true), regions });
  }
  const smpl = part('smpl');
  return { presets, samples, data: bytes.subarray(smpl.at, smpl.at + smpl.size) };
}

/** A preset by bank and program (the first bank's, or the first preset, when it's missing). */
export function findPreset(sf: SoundFont, bank: number, program: number): SfPreset | undefined {
  return sf.presets.find((p) => p.bank === bank && p.program === program) ?? sf.presets.find((p) => p.bank === (bank >= 128 ? 128 : 0) && p.program === program);
}

/** The regions that sound for a note at a velocity (1–127). */
export function regionsFor(p: SfPreset, key: number, vel: number): SfRegion[] {
  return p.regions.filter((r) => key >= r.keyLo && key <= r.keyHi && vel >= r.velLo && vel <= r.velHi);
}

/** A modulator source's value (0–1, or -1–1 when bipolar) for a note, or null for sources Beatline doesn't have. */
function sourceValue(src: number, key: number, vel: number): number | null {
  const index = src & 0x7f;
  // MIDI controllers (mod wheel, expression…) aren't played, so their modulators do nothing
  if (src & 0x80) return null;
  let x: number;
  if (index === 0) return 1;
  if (index === 2) x = vel / 127;
  else if (index === 3) x = key / 127;
  else return null;
  if (src & 0x100) x = 1 - x;
  const bipolar = (src & 0x200) !== 0;
  const curve = (src >> 10) & 0x3f;
  const shape = (t: number) => {
    if (curve === 1) return t >= 1 ? 1 : Math.min(1, (-5 / 12) * Math.log10(1 - t));
    if (curve === 2) return t <= 0 ? 0 : 1 - Math.min(1, (-5 / 12) * Math.log10(t));
    if (curve === 3) return t >= 0.5 ? 1 : 0;
    return t;
  };
  if (!bipolar) return shape(x);
  return x >= 0.5 ? shape(2 * x - 1) : -shape(1 - 2 * x);
}

/** What a region's modulators add to each generator for a note (key 0–127, velocity 1–127). */
export function modulated(r: SfRegion, key: number, vel: number): Float64Array {
  const add = new Float64Array(GEN_COUNT);
  for (const m of r.mods) {
    const a = sourceValue(m.src, key, vel);
    const b = m.amtSrc ? sourceValue(m.amtSrc, key, vel) : 1;
    if (a === null || b === null) continue;
    const v = m.amount * a * b;
    add[m.dest] += m.trans === 2 ? Math.abs(v) : v;
  }
  return add;
}

/** Generator time (timecents) to seconds. */
export const tcToSecs = (tc: number) => Math.pow(2, tc / 1200);

/** Absolute cents to Hz. */
export const centsToHz = (c: number) => 8.176 * Math.pow(2, c / 1200);
