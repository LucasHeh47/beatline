// Audio worklet processors (they run on the audio thread):
// - beatline-recorder: passes the input's samples back to the page while recording, with the frame
//   they were captured at, so takes line up exactly with the song.
// - beatline-gate: a noise gate that silences the input when it drops under a threshold.

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHUNK = 4096;

class Recorder extends AudioWorkletProcessor {
  private on = false;
  private buf: Float32Array[] = [];
  private filled = 0;
  private startFrame = 0;
  private channels = 1;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type: 'start' | 'stop'; channels?: number }>) => {
      if (e.data.type === 'start') {
        this.channels = Math.max(1, Math.min(2, e.data.channels ?? 1));
        this.buf = Array.from({ length: this.channels }, () => new Float32Array(CHUNK));
        this.filled = 0;
        this.on = true;
        this.startFrame = -1;
      } else if (e.data.type === 'stop') {
        this.flush();
        this.on = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  private flush(): void {
    if (!this.filled) return;
    this.port.postMessage({ type: 'data', channels: this.buf.map((b) => b.slice(0, this.filled)) });
    this.buf = Array.from({ length: this.channels }, () => new Float32Array(CHUNK));
    this.filled = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!this.on || !input?.length) return true;
    if (this.startFrame < 0) {
      this.startFrame = currentFrame;
      this.port.postMessage({ type: 'started', frame: currentFrame, sampleRate });
    }
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channels; c++) this.buf[c][this.filled] = (input[c] ?? input[0])[i];
      if (++this.filled === CHUNK) this.flush();
    }
    return true;
  }
}

class Gate extends AudioWorkletProcessor {
  private gain = 1;
  private env = 0;
  private hold = 0;

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.08, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length) return true;
    const thr = Math.pow(10, params.threshold[0] / 20);
    const rel = Math.exp(-1 / (params.release[0] * sampleRate));
    const att = Math.exp(-1 / (0.001 * sampleRate));
    const envRel = Math.exp(-1 / (0.01 * sampleRate));
    const holdFrames = Math.round(0.02 * sampleRate);
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (const ch of input) peak = Math.max(peak, Math.abs(ch[i]));
      this.env = peak > this.env ? peak : this.env * envRel + peak * (1 - envRel);
      if (this.env >= thr) this.hold = holdFrames;
      else if (this.hold > 0) this.hold--;
      const target = this.env >= thr || this.hold > 0 ? 1 : 0;
      // Opens fast, closes over the release time
      this.gain = target > this.gain ? target + (this.gain - target) * att : target + (this.gain - target) * rel;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? input[0])[i] * this.gain;
    }
    return true;
  }
}

registerProcessor('beatline-recorder', Recorder);
registerProcessor('beatline-gate', Gate);
