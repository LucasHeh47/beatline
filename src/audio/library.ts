// The sounds the project uses, decoded and ready to play: built-in drums, imported samples and
// recordings, and the recorded instruments. Files load in the background; waveforms (peaks) are
// worked out for the playlist.
import { drumById } from '../core/instruments';
import type { Project, Sample, SampleRef } from '../core/project';
import { platform } from '../ui/platform';
import { drumBuffer } from './drums';
import { SoundFontBank } from './soundfont';

export interface Peaks {
  /** Samples of audio per peak. */
  per: number;
  /** Largest absolute value in each slot (both channels), 0–1. */
  data: Float32Array;
}

const PEAK_SIZE = 256;

export class SampleLibrary {
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private peaks = new Map<string, Peaks>();
  /** Samples whose file couldn't be read. */
  readonly missing = new Set<string>();
  private listeners = new Set<() => void>();
  /** The recorded instruments and drum kits. */
  readonly sf: SoundFontBank;

  constructor(private sampleRate: () => number, private decoder: () => BaseAudioContext) {
    this.sf = new SoundFontBank(() => platform.readSoundFont(), decoder);
    this.sf.onReady = () => this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private key(ref: SampleRef): string | null {
    return ref.builtin ? `b:${ref.builtin}` : ref.sampleId ? `s:${ref.sampleId}` : null;
  }

  /** The decoded sound, or null while it loads (asking for it starts loading). */
  buffer(ref: SampleRef, project: Project | null): AudioBuffer | null {
    const k = this.key(ref);
    if (!k) return null;
    const b = this.buffers.get(k);
    if (b) return b;
    void this.load(ref, project);
    return null;
  }

  /** Loads a sound (built-in or a file of the project). */
  load(ref: SampleRef, project: Project | null): Promise<AudioBuffer | null> {
    const k = this.key(ref);
    if (!k) return Promise.resolve(null);
    const have = this.buffers.get(k);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(k);
    if (p) return p;
    const kit = drumById(ref.builtin);
    // Recorded drums come from the instrument library's kits
    if (kit?.kit !== undefined && kit.key !== undefined) p = this.sf.renderHit(kit.kit, kit.key, this.sampleRate());
    else if (ref.builtin) p = drumBuffer(ref.builtin, this.sampleRate()) ?? Promise.resolve(null);
    else {
      const s = project?.samples.find((x) => x.id === ref.sampleId);
      p = s ? this.decodeFile(s) : Promise.resolve(null);
    }
    p = p
      .then((b) => {
        if (b) {
          this.buffers.set(k, b);
          this.changed();
        }
        return b;
      })
      .finally(() => this.loading.delete(k));
    this.loading.set(k, p);
    return p;
  }

  private async decodeFile(s: Sample): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(platform.mediaUrl(s.path));
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.arrayBuffer();
      const b = await this.decoder().decodeAudioData(data);
      this.missing.delete(s.id);
      return b;
    } catch {
      this.missing.add(s.id);
      this.changed();
      return null;
    }
  }

  /** A recording made in Beatline goes straight in (no need to read the file back). */
  put(sampleId: string, b: AudioBuffer): void {
    this.buffers.set(`s:${sampleId}`, b);
    this.peaks.delete(sampleId);
    this.changed();
  }

  /** Everything a project uses, loaded (before exporting). */
  async loadAll(p: Project): Promise<void> {
    const refs: SampleRef[] = [];
    for (const c of p.channels) if (c.kind === 'sampler' && c.sampler) refs.push(c.sampler.sample);
    for (const t of p.tracks) for (const c of t.clips) if (c.kind === 'audio' && c.sampleId) refs.push({ sampleId: c.sampleId });
    const instruments = p.channels.filter((c) => c.kind === 'instrument' && c.instrument).map((c) => this.sf.prepare(c.instrument!.bank, c.instrument!.program));
    await Promise.all([...refs.map((r) => this.load(r, p)), ...instruments]);
  }

  /** Forgets a sample (relinked to another file). */
  forget(sampleId: string): void {
    this.buffers.delete(`s:${sampleId}`);
    this.peaks.delete(sampleId);
    this.missing.delete(sampleId);
  }

  /** The waveform of a sample, for drawing (null until it's loaded). */
  peaksOf(ref: SampleRef, project: Project | null): Peaks | null {
    const k = ref.sampleId ?? `builtin:${ref.builtin}`;
    const have = this.peaks.get(k);
    if (have) return have;
    const b = this.buffer(ref, project);
    if (!b) return null;
    const n = Math.ceil(b.length / PEAK_SIZE);
    const data = new Float32Array(n);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        let m = data[i];
        const end = Math.min(d.length, (i + 1) * PEAK_SIZE);
        for (let j = i * PEAK_SIZE; j < end; j++) {
          const v = d[j] < 0 ? -d[j] : d[j];
          if (v > m) m = v;
        }
        data[i] = m;
      }
    }
    const p = { per: PEAK_SIZE, data };
    this.peaks.set(k, p);
    return p;
  }
}
