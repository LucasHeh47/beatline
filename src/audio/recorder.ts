// Recording from an audio input (a guitar through an audio interface, a microphone): the input is
// opened, can be heard through its track's effects (an amp, a reverb) while playing, feeds the
// tuner and the input meter, and is captured sample-exact while recording. Takes are lined up with
// the song, allowing for the delay of the sound card in and out.
import type { AudioEngine } from './engine';

export interface InputDevice {
  id: string;
  label: string;
}

export type InputChannel = 'left' | 'right' | 'stereo' | 'mono';

export interface Take {
  /** One array per channel. */
  channels: Float32Array[];
  sampleRate: number;
  /** The song tick the first sample belongs at (after latency compensation). */
  startTick: number;
  /** Real time (context seconds) the first sample belongs at. */
  startTime: number;
}

export class InputRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** The chosen channel(s), as a mono or stereo signal. */
  private picked: AudioNode | null = null;
  private inputGain: GainNode;
  readonly analyser: AnalyserNode;
  private monitorGain: GainNode;
  private monitorTo: AudioNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private chunks: Float32Array[][] = [];
  private started: { frame: number; sampleRate: number } | null = null;
  device = '';
  channel: InputChannel = 'mono';
  /** Extra correction for the sound card's delay (ms; positive moves takes earlier). */
  offsetMs = 0;
  recording = false;

  constructor(private engine: AudioEngine) {
    const ctx = engine.ctx;
    this.inputGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.inputGain.connect(this.analyser);
    this.inputGain.connect(this.monitorGain);
  }

  get open(): boolean {
    return !!this.stream;
  }

  /** The audio inputs the computer has (names show once access was allowed). */
  static async devices(): Promise<InputDevice[]> {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  /** Opens an input (asking for access the first time). */
  async openInput(device = this.device, channel = this.channel): Promise<void> {
    this.close();
    const stereo = channel !== 'mono';
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: device ? { exact: device } : undefined,
        // Instruments need the raw signal: no voice processing
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: stereo ? { ideal: 2 } : { ideal: 1 },
        latency: { ideal: 0.005 },
      } as MediaTrackConstraints,
    });
    this.device = device;
    this.channel = channel;
    const ctx = this.engine.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    if (channel === 'left' || channel === 'right') {
      // One side of a stereo input (guitar in input 1, a mic in input 2)
      const split = ctx.createChannelSplitter(2);
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      this.source.connect(split);
      split.connect(mono, channel === 'left' ? 0 : 1);
      this.picked = mono;
    } else if (channel === 'mono') {
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      this.source.connect(mono);
      this.picked = mono;
    } else this.picked = this.source;
    this.picked.connect(this.inputGain);
  }

  close(): void {
    this.picked?.disconnect();
    this.source?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.source = null;
    this.picked = null;
  }

  /** The input's gain (dB). */
  gainDb = 0;

  setInputGain(db: number): void {
    this.gainDb = db;
    this.inputGain.gain.value = Math.pow(10, db / 20);
  }

  /** Hear the input through a mixer track (its effects), or not. */
  monitor(to: AudioNode | null): void {
    if (this.monitorTo) this.monitorGain.disconnect();
    this.monitorTo = to;
    if (to) {
      this.monitorGain.connect(to);
      this.monitorGain.gain.setTargetAtTime(1, this.engine.ctx.currentTime, 0.01);
    } else this.monitorGain.gain.value = 0;
  }

  /** How loud the input is (peak, 0–1+). */
  level(): number {
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v));
    return p;
  }

  /** The latest samples (for the tuner). */
  samples(into: Float32Array<ArrayBuffer>): void {
    this.analyser.getFloatTimeDomainData(into);
  }

  /** The delay between the song being played and the sound coming back in (seconds). */
  latency(): number {
    const ctx = this.engine.ctx;
    const out = ctx.outputLatency || ctx.baseLatency || 0;
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    const inp = settings?.latency ?? 0.01;
    return out + inp + this.offsetMs / 1000;
  }

  /** Starts capturing (call just before playback starts). */
  async start(): Promise<void> {
    await this.engine.ready;
    if (!this.picked) throw new Error('No input is open.');
    const ctx = this.engine.ctx;
    this.chunks = [];
    this.started = null;
    if (!this.worklet) {
      this.worklet = new AudioWorkletNode(ctx, 'beatline-recorder', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.worklet.port.onmessage = (e: MessageEvent<{ type: string; channels?: Float32Array[]; frame?: number; sampleRate?: number }>) => {
        if (e.data.type === 'data' && e.data.channels) this.chunks.push(e.data.channels);
        else if (e.data.type === 'started') this.started = { frame: e.data.frame!, sampleRate: e.data.sampleRate! };
        else if (e.data.type === 'stopped') this.onStopped?.();
      };
      this.inputGain.connect(this.worklet);
    }
    this.worklet.port.postMessage({ type: 'start', channels: this.channel === 'stereo' ? 2 : 1 });
    this.recording = true;
  }

  private onStopped: (() => void) | null = null;

  /** Stops capturing; returns the take (null when nothing came in). */
  async stop(): Promise<Take | null> {
    if (!this.worklet || !this.recording) return null;
    this.recording = false;
    await new Promise<void>((resolve) => {
      this.onStopped = resolve;
      this.worklet!.port.postMessage({ type: 'stop' });
      setTimeout(resolve, 1500);
    });
    this.onStopped = null;
    if (!this.started || !this.chunks.length) return null;
    const n = this.chunks.reduce((a, c) => a + c[0].length, 0);
    const chans = this.chunks[0].length;
    const out = Array.from({ length: chans }, () => new Float32Array(n));
    let at = 0;
    for (const c of this.chunks) {
      for (let ch = 0; ch < chans; ch++) out[ch].set(c[ch], at);
      at += c[0].length;
    }
    this.chunks = [];
    const startTime = this.started.frame / this.started.sampleRate - this.latency();
    return { channels: out, sampleRate: this.started.sampleRate, startTime, startTick: this.engine.tickAtTime(startTime) };
  }
}
