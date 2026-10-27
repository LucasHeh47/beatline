// WAV files: recordings are saved as 24-bit WAV, and exports can be 16 or 24-bit. Reading is for
// tests and quick checks (Chromium decodes files for playback).

export interface PcmAudio {
  sampleRate: number;
  /** One array per channel, -1…1. */
  channels: Float32Array[];
}

export function encodeWav(a: PcmAudio, bits: 16 | 24 | 32 = 24): Uint8Array {
  const ch = a.channels.length;
  const len = a.channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataSize = len * ch * bytes;
  const out = new Uint8Array(44 + dataSize);
  const dv = new DataView(out.buffer);
  const w = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  // 3 = floating point (32-bit), 1 = integer PCM
  dv.setUint16(20, bits === 32 ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, a.sampleRate, true);
  dv.setUint32(28, a.sampleRate * ch * bytes, true);
  dv.setUint16(32, ch * bytes, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, dataSize, true);
  let at = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, a.channels[c][i]));
      if (bits === 32) dv.setFloat32(at, v, true);
      else if (bits === 16) dv.setInt16(at, Math.round(v < 0 ? v * 32768 : v * 32767), true);
      else {
        const x = Math.round(v < 0 ? v * 8388608 : v * 8388607);
        out[at] = x & 255;
        out[at + 1] = (x >> 8) & 255;
        out[at + 2] = (x >> 16) & 255;
      }
      at += bytes;
    }
  }
  return out;
}

export function decodeWav(data: Uint8Array): PcmAudio {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const str = (at: number) => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
  if (str(0) !== 'RIFF' || str(8) !== 'WAVE') throw new Error("This isn't a WAV file.");
  let pos = 12;
  let fmt = 1;
  let ch = 1;
  let rate = 44100;
  let bits = 16;
  while (pos + 8 <= data.length) {
    const id = str(pos);
    const size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      fmt = dv.getUint16(pos + 8, true);
      ch = dv.getUint16(pos + 10, true);
      rate = dv.getUint32(pos + 12, true);
      bits = dv.getUint16(pos + 22, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format
      if (fmt === 0xfffe && size >= 26) fmt = dv.getUint16(pos + 32, true);
    } else if (id === 'data') {
      const bytes = bits / 8;
      const n = Math.floor(Math.min(size, data.length - pos - 8) / (bytes * ch));
      const out = Array.from({ length: ch }, () => new Float32Array(n));
      let at = pos + 8;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
          let v: number;
          if (fmt === 3) v = bits === 64 ? dv.getFloat64(at, true) : dv.getFloat32(at, true);
          else if (bits === 16) v = dv.getInt16(at, true) / 32768;
          else if (bits === 24) v = (((data[at + 2] << 24) | (data[at + 1] << 16) | (data[at] << 8)) >> 8) / 8388608;
          else if (bits === 32) v = dv.getInt32(at, true) / 2147483648;
          else v = (data[at] - 128) / 128;
          out[c][i] = v;
          at += bytes;
        }
      }
      return { sampleRate: rate, channels: out };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error('The WAV file has no sound in it.');
}
