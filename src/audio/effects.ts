// The mixer's effects as Web Audio nodes. Each builds an input and an output, can take new settings
// while playing, and works the same in the live mixer and in an offline export.
import { boolParam, noteSeconds, numParam, strParam } from '../core/effects';
import type { Effect } from '../core/project';

export interface FxNode {
  input: AudioNode;
  output: AudioNode;
  /** Applies changed settings (the effect's type stays the same). */
  update(e: Effect, bpm: number): void;
  dispose(): void;
}

const db = (v: number) => Math.pow(10, v / 20);

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7, gain = 0): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = freq;
  b.Q.value = q;
  b.gain.value = gain;
  return b;
}

function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
}

/** Smoothly sets an AudioParam (no clicks while dragging a knob). */
function set(p: AudioParam, v: number, ctx: BaseAudioContext): void {
  if (ctx instanceof OfflineAudioContext) p.value = v;
  else p.setTargetAtTime(v, ctx.currentTime, 0.02);
}

/** Dry and wet paths mixed. */
function mixer(ctx: BaseAudioContext): { input: GainNode; output: GainNode; dry: GainNode; wet: GainNode; setMix(m: number): void } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return {
    input,
    output,
    dry,
    wet,
    setMix(m) {
      // Equal-power crossfade
      set(dry.gain, Math.cos((m * Math.PI) / 2), ctx);
      set(wet.gain, Math.sin((m * Math.PI) / 2), ctx);
    },
  };
}

// ---------- curves ----------

/** Distortion curves (oversampled by the shaper). */
export function driveCurve(kind: string, drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = 1 + drive * drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    if (kind === 'fuzz') y = Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k * 2));
    else if (kind === 'hard') y = Math.max(-1, Math.min(1, x * k * 0.5));
    else if (kind === 'bit') {
      const steps = Math.max(2, Math.round(2 ** (8 - drive * 6)));
      y = Math.round(x * steps) / steps;
    }
    // Overdrive: a little asymmetric, like a tube
    else y = Math.tanh(x * k) * (x >= 0 ? 1 : 0.92);
    c[i] = y;
  }
  return c;
}

/** A reverb's sound: decaying stereo noise that gets darker as it fades. */
export function reverbImpulse(ctx: BaseAudioContext, decay: number, damping: number): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * Math.min(10, decay * 1.2));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 12345;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const r = ((s >>> 0) / 4294967296) * 2 - 1;
      const t = i / ctx.sampleRate;
      // Higher frequencies die away faster when damped
      const a = Math.min(0.98, damping * (0.3 + t / decay));
      lp = lp * a + r * (1 - a);
      d[i] = lp * Math.exp((-6.9 * t) / decay) * (1 + damping);
    }
  }
  return b;
}

// ---------- the effects ----------

type Build = (ctx: BaseAudioContext, e: Effect, bpm: number) => FxNode;

const BUILD: Record<string, Build> = {
  eq(ctx, e) {
    const cut = biquad(ctx, 'highpass', 20, 0.7);
    const low = biquad(ctx, 'lowshelf', 120);
    const mid = biquad(ctx, 'peaking', 1000, 1);
    const high = biquad(ctx, 'highshelf', 6000);
    chain(cut, low, mid, high);
    const update = (x: Effect) => {
      set(cut.frequency, numParam(x, 'lowCut'), ctx);
      set(low.gain, numParam(x, 'low'), ctx);
      set(low.frequency, numParam(x, 'lowFreq'), ctx);
      set(mid.gain, numParam(x, 'mid'), ctx);
      set(mid.frequency, numParam(x, 'midFreq'), ctx);
      set(mid.Q, numParam(x, 'midQ'), ctx);
      set(high.gain, numParam(x, 'high'), ctx);
      set(high.frequency, numParam(x, 'highFreq'), ctx);
    };
    update(e);
    return { input: cut, output: high, update, dispose: () => cut.disconnect() };
  },

  compressor(ctx, e) {
    const comp = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    comp.connect(makeup);
    const update = (x: Effect) => {
      set(comp.threshold, numParam(x, 'threshold'), ctx);
      set(comp.ratio, numParam(x, 'ratio'), ctx);
      set(comp.attack, numParam(x, 'attack'), ctx);
      set(comp.release, numParam(x, 'release'), ctx);
      comp.knee.value = 6;
      set(makeup.gain, db(numParam(x, 'makeup')), ctx);
    };
    update(e);
    return { input: comp, output: makeup, update, dispose: () => comp.disconnect() };
  },

  gate(ctx, e) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    let node: AudioWorkletNode | null = null;
    try {
      node = new AudioWorkletNode(ctx, 'beatline-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      chain(input, node, output);
    } catch {
      // The worklet isn't loaded (yet): the sound passes through
      input.connect(output);
    }
    const update = (x: Effect) => {
      if (!node) return;
      node.parameters.get('threshold')!.value = numParam(x, 'threshold');
      node.parameters.get('release')!.value = numParam(x, 'release');
    };
    update(e);
    return { input, output, update, dispose: () => input.disconnect() };
  },

  limiter(ctx, e) {
    const pre = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.08;
    // A soft clipper catches what the compressor lets through. Not oversampled: its filters could
    // ring a little past the ceiling.
    const clip = ctx.createWaveShaper();
    const out = ctx.createGain();
    chain(pre, comp, clip, out);
    const update = (x: Effect) => {
      const ceil = db(numParam(x, 'ceiling'));
      set(pre.gain, db(numParam(x, 'gain')), ctx);
      set(comp.threshold, numParam(x, 'ceiling') - 2, ctx);
      // The curve covers inputs from -1 to 1 (louder input is held at its ends): unchanged up to 80%
      // of the ceiling, then bending smoothly towards it
      const n = 4096;
      const c = new Float32Array(n);
      const knee = ceil * 0.8;
      for (let i = 0; i < n; i++) {
        const v = (i / (n - 1)) * 2 - 1;
        const a = Math.abs(v);
        c[i] = a < knee ? v : Math.sign(v) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
      }
      clip.curve = c;
    };
    update(e);
    return { input: pre, output: out, update, dispose: () => pre.disconnect() };
  },

  reverb(ctx, e) {
    const m = mixer(ctx);
    const pre = ctx.createDelay(1);
    const conv = ctx.createConvolver();
    chain(m.input, pre, conv, m.wet);
    let key = '';
    const update = (x: Effect) => {
      const size = numParam(x, 'size');
      const damp = numParam(x, 'damping');
      const k = `${size.toFixed(2)}|${damp.toFixed(2)}`;
      // Making the impulse takes a moment: only when it really changed
      if (k !== key) {
        key = k;
        conv.buffer = reverbImpulse(ctx, size, damp);
      }
      set(pre.delayTime, numParam(x, 'predelay'), ctx);
      m.setMix(numParam(x, 'mix'));
    };
    update(e);
    return { input: m.input, output: m.output, update, dispose: () => m.input.disconnect() };
  },

  delay(ctx, e, bpm) {
    const m = mixer(ctx);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const dl = ctx.createDelay(4);
    const dr = ctx.createDelay(4);
    const fbl = ctx.createGain();
    const fbr = ctx.createGain();
    const tl = biquad(ctx, 'lowpass', 5000);
    const tr = biquad(ctx, 'lowpass', 5000);
    m.input.connect(split);
    let ping = true;
    const wire = (pingpong: boolean) => {
      for (const n of [split, dl, dr, tl, tr, fbl, fbr]) n.disconnect();
      if (pingpong) {
        // Left echoes feed the right and back: the echoes bounce between the speakers
        split.connect(dl, 0);
        split.connect(dl, 1);
        chain(dl, tl, fbl, dr);
        chain(dr, tr, fbr, dl);
        tl.connect(merge, 0, 0);
        tr.connect(merge, 0, 1);
      } else {
        split.connect(dl, 0);
        split.connect(dr, 1);
        chain(dl, tl, fbl, dl);
        chain(dr, tr, fbr, dr);
        tl.connect(merge, 0, 0);
        tr.connect(merge, 0, 1);
      }
    };
    merge.connect(m.wet);
    const update = (x: Effect, tempo: number) => {
      const t = noteSeconds(strParam(x, 'time'), tempo);
      const pp = boolParam(x, 'pingpong');
      if (pp !== ping) {
        ping = pp;
        wire(pp);
      }
      set(dl.delayTime, t, ctx);
      set(dr.delayTime, t, ctx);
      const fb = numParam(x, 'feedback');
      set(fbl.gain, fb, ctx);
      set(fbr.gain, fb, ctx);
      set(tl.frequency, numParam(x, 'tone'), ctx);
      set(tr.frequency, numParam(x, 'tone'), ctx);
      m.setMix(numParam(x, 'mix'));
    };
    wire(true);
    update(e, bpm);
    return { input: m.input, output: m.output, update, dispose: () => m.input.disconnect() };
  },

  amp(ctx, e) {
    const input = ctx.createGain();
    const tight = biquad(ctx, 'highpass', 60, 0.7);
    const preBoost = biquad(ctx, 'peaking', 900, 0.7, 0);
    const drive = ctx.createGain();
    const shape = ctx.createWaveShaper();
    shape.oversample = '4x';
    const post = ctx.createGain();
    const bass = biquad(ctx, 'lowshelf', 120);
    const mid = biquad(ctx, 'peaking', 700, 0.8);
    const treble = biquad(ctx, 'highshelf', 3000);
    const presence = biquad(ctx, 'highshelf', 5500);
    // The speaker cabinet: no deep lows, a thump around 110 Hz, and a steep roll-off above 5 kHz
    const cabHp = biquad(ctx, 'highpass', 75, 0.8);
    const cabThump = biquad(ctx, 'peaking', 110, 1.2, 3);
    const cabBox = biquad(ctx, 'peaking', 420, 1.5, -3);
    const cabBite = biquad(ctx, 'peaking', 2400, 1.3, 2.5);
    const cabLp1 = biquad(ctx, 'lowpass', 5200, 0.8);
    const cabLp2 = biquad(ctx, 'lowpass', 6500, 0.6);
    const cabIn = ctx.createGain();
    const out = ctx.createGain();
    chain(input, tight, preBoost, drive, shape, post, bass, mid, treble, presence, cabIn);
    let cabOn: boolean | null = null;
    const update = (x: Effect) => {
      const model = strParam(x, 'model');
      const g = numParam(x, 'gain');
      // Each amp's range of gain and how its tone is voiced
      const M: Record<string, { drive: [number, number]; tight: number; boost: number; curve: string; post: number }> = {
        clean: { drive: [1, 4], tight: 60, boost: 0, curve: 'overdrive', post: 0.9 },
        crunch: { drive: [4, 40], tight: 80, boost: 3, curve: 'overdrive', post: 0.6 },
        lead: { drive: [20, 160], tight: 100, boost: 6, curve: 'overdrive', post: 0.45 },
        metal: { drive: [60, 400], tight: 140, boost: 8, curve: 'hard', post: 0.4 },
        bass: { drive: [1, 12], tight: 30, boost: 0, curve: 'overdrive', post: 0.8 },
      };
      const v = M[model] ?? M.crunch;
      const amount = v.drive[0] * Math.pow(v.drive[1] / v.drive[0], g);
      set(drive.gain, amount, ctx);
      set(tight.frequency, v.tight, ctx);
      set(preBoost.gain, v.boost, ctx);
      shape.curve = driveCurve(v.curve, 0.15);
      set(post.gain, v.post / Math.max(1, Math.log10(amount + 1) * 1.2), ctx);
      set(bass.gain, numParam(x, 'bass') + (model === 'bass' ? 4 : 0), ctx);
      set(mid.gain, numParam(x, 'mid'), ctx);
      set(treble.gain, numParam(x, 'treble'), ctx);
      set(presence.gain, numParam(x, 'presence'), ctx);
      set(out.gain, db(numParam(x, 'volume')), ctx);
      const cab = boolParam(x, 'cab');
      if (cab !== cabOn) {
        cabOn = cab;
        cabIn.disconnect();
        if (cab) chain(cabIn, cabHp, cabThump, cabBox, cabBite, cabLp1, cabLp2, out);
        else cabIn.connect(out);
      }
    };
    update(e);
    return { input, output: out, update, dispose: () => input.disconnect() };
  },

  distortion(ctx, e) {
    const m = mixer(ctx);
    const shape = ctx.createWaveShaper();
    shape.oversample = '4x';
    const tone = biquad(ctx, 'lowpass', 4000);
    const level = ctx.createGain();
    chain(m.input, shape, tone, level, m.wet);
    let key = '';
    const update = (x: Effect) => {
      const k = `${strParam(x, 'shape')}|${numParam(x, 'drive').toFixed(3)}`;
      if (k !== key) {
        key = k;
        shape.curve = driveCurve(strParam(x, 'shape'), numParam(x, 'drive'));
      }
      set(tone.frequency, numParam(x, 'tone'), ctx);
      // Louder drive is turned down to about the same level
      set(level.gain, 1 / (1 + numParam(x, 'drive') * 1.5), ctx);
      m.setMix(numParam(x, 'mix'));
    };
    update(e);
    return { input: m.input, output: m.output, update, dispose: () => m.input.disconnect() };
  },

  chorus(ctx, e) {
    const m = mixer(ctx);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const lfo = ctx.createOscillator();
    const depthL = ctx.createGain();
    const depthR = ctx.createGain();
    const dl = ctx.createDelay(0.1);
    const dr = ctx.createDelay(0.1);
    dl.delayTime.value = 0.018;
    dr.delayTime.value = 0.022;
    m.input.connect(split);
    split.connect(dl, 0);
    split.connect(dr, 1);
    dl.connect(merge, 0, 0);
    dr.connect(merge, 0, 1);
    merge.connect(m.wet);
    lfo.connect(depthL);
    depthL.connect(dl.delayTime);
    // The right side moves the other way, for width
    lfo.connect(depthR);
    depthR.connect(dr.delayTime);
    lfo.start();
    const update = (x: Effect) => {
      set(lfo.frequency, numParam(x, 'rate'), ctx);
      const d = numParam(x, 'depth') * 0.006;
      set(depthL.gain, d, ctx);
      set(depthR.gain, -d, ctx);
      m.setMix(numParam(x, 'mix'));
    };
    update(e);
    return {
      input: m.input,
      output: m.output,
      update,
      dispose: () => {
        lfo.stop();
        m.input.disconnect();
      },
    };
  },

  phaser(ctx, e) {
    const m = mixer(ctx);
    const stages = Array.from({ length: 6 }, () => biquad(ctx, 'allpass', 800, 0.5));
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const fb = ctx.createGain();
    // Web Audio only allows a feedback loop that goes through a delay
    const loop = ctx.createDelay(0.01);
    loop.delayTime.value = 0.001;
    chain(m.input, ...stages, m.wet);
    chain(stages[stages.length - 1], fb, loop, stages[0]);
    lfo.connect(depth);
    for (const s of stages) depth.connect(s.detune);
    lfo.start();
    const update = (x: Effect) => {
      set(lfo.frequency, numParam(x, 'rate'), ctx);
      set(depth.gain, numParam(x, 'depth') * 2400, ctx);
      set(fb.gain, numParam(x, 'feedback'), ctx);
      m.setMix(numParam(x, 'mix'));
    };
    update(e);
    return {
      input: m.input,
      output: m.output,
      update,
      dispose: () => {
        lfo.stop();
        m.input.disconnect();
      },
    };
  },

  filter(ctx, e) {
    const f = biquad(ctx, 'lowpass', 8000);
    const update = (x: Effect) => {
      f.type = strParam(x, 'type') as BiquadFilterType;
      set(f.frequency, numParam(x, 'cutoff'), ctx);
      set(f.Q, numParam(x, 'q'), ctx);
    };
    update(e);
    return { input: f, output: f, update, dispose: () => f.disconnect() };
  },

  stereo(ctx, e) {
    const input = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    // L' = a·L + b·R, R' = b·L + a·R with a = (1 + w) / 2, b = (1 - w) / 2
    const ll = ctx.createGain();
    const lr = ctx.createGain();
    const rl = ctx.createGain();
    const rr = ctx.createGain();
    input.connect(split);
    split.connect(ll, 0);
    split.connect(rl, 0);
    split.connect(lr, 1);
    split.connect(rr, 1);
    ll.connect(merge, 0, 0);
    lr.connect(merge, 0, 0);
    rl.connect(merge, 0, 1);
    rr.connect(merge, 0, 1);
    const update = (x: Effect) => {
      const w = numParam(x, 'width');
      set(ll.gain, (1 + w) / 2, ctx);
      set(rr.gain, (1 + w) / 2, ctx);
      set(lr.gain, (1 - w) / 2, ctx);
      set(rl.gain, (1 - w) / 2, ctx);
    };
    update(e);
    return { input, output: merge, update, dispose: () => input.disconnect() };
  },
};

/** The nodes of an effect (a pass-through for unknown types or when it's switched off). */
export function buildEffect(ctx: BaseAudioContext, e: Effect, bpm: number): FxNode {
  const make = BUILD[e.type];
  if (!make) {
    const g = ctx.createGain();
    return { input: g, output: g, update: () => undefined, dispose: () => g.disconnect() };
  }
  return make(ctx, e, bpm);
}
