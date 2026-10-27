// Playing notes: the computer keyboard as a piano (two rows, like FL Studio: Z S X D C… is one
// octave, Q 2 W 3 E… the next) and MIDI keyboards. Notes go to the selected channel; while recording
// in pattern mode they're written into the pattern.
import { STEP, type Note } from '../core/project';
import type { App, LiveEdit } from './app';
import { toast } from './widgets';

/** Key codes to semitones from the base octave's C. */
const CODES: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};

interface Held {
  key: number;
  channel: string;
  /** Pattern tick it started at (when recording). */
  start: number;
}

export class Keyboard {
  private held = new Map<string, Held>();
  private session: LiveEdit | null = null;
  private recordingNotes = false;
  midiNames: string[] = [];

  constructor(private app: App) {}

  get recordNotes(): boolean {
    return this.recordingNotes;
  }

  set recordNotes(on: boolean) {
    this.recordingNotes = on;
    if (!on) {
      this.session?.end();
      this.session = null;
    }
  }

  /** The computer keyboard; returns true when the key played a note (or changed octave). */
  keyDown(e: KeyboardEvent): boolean {
    if (!this.app.prefs.typingKeys || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.code === 'Minus' || e.code === 'Equal') {
      this.app.prefs.octave = Math.max(0, Math.min(8, this.app.prefs.octave + (e.code === 'Minus' ? -1 : 1)));
      this.app.savePrefs();
      this.app.statusbar.flash(`Keyboard octave ${this.app.prefs.octave}`);
      this.app.emit('transport');
      return true;
    }
    const semi = CODES[e.code];
    if (semi === undefined) return false;
    if (e.repeat || this.held.has(e.code)) return true;
    const key = 12 * (this.app.prefs.octave + 1) + semi;
    this.on(e.code, key, 0.8);
    return true;
  }

  keyUp(e: KeyboardEvent): void {
    if (this.held.has(e.code)) this.off(e.code);
  }

  /** Lets go of every key (the window lost focus). */
  releaseAll(): void {
    for (const id of [...this.held.keys()]) this.off(id);
  }

  private on(id: string, key: number, vel: number): void {
    const ch = this.app.channel;
    if (!ch) {
      toast('Pick a channel in the channel rack to play it.');
      return;
    }
    this.app.engine.noteOn(ch, key, vel);
    this.held.set(id, { key, channel: ch, start: this.app.engine.position });
    this.app.emit('channel');
  }

  private off(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    this.app.engine.noteOff(h.channel, h.key);
    if (this.recordingNotes && this.app.engine.playing) this.write(h, this.app.engine.position);
  }

  /** Writes a played note into the pattern, on the grid. */
  private write(h: Held, end: number): void {
    const app = this.app;
    const pt = app.pattern;
    const len = pt.length;
    const grid = app.settings.bool('record.quantize') ? STEP : 1;
    const start = (Math.round(h.start / grid) * grid) % len;
    // The pattern may have looped while the key was down
    let length = end - h.start;
    if (length <= 0) length += len;
    length = Math.max(grid === 1 ? STEP / 4 : STEP, Math.round(length / grid) * grid);
    const note: Note = { key: h.key, start, length: Math.min(length, len), vel: 0.8 };
    this.session ??= app.liveEdit('Record notes');
    this.session.update((p) => {
      const x = p.patterns.find((y) => y.id === pt.id);
      if (!x) return;
      (x.notes[h.channel] ??= []).push(note);
    });
  }

  // ---------- MIDI keyboards ----------

  private access: MIDIAccess | null = null;

  async enableMidi(): Promise<void> {
    if (this.access || !navigator.requestMIDIAccess) return;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return;
    }
    const attach = () => {
      this.midiNames = [];
      for (const input of this.access!.inputs.values()) {
        this.midiNames.push(input.name ?? 'MIDI keyboard');
        input.onmidimessage = (m) => this.onMidi(m);
      }
      this.app.emit('transport');
    };
    this.access.onstatechange = attach;
    attach();
  }

  private onMidi(m: MIDIMessageEvent): void {
    const d = m.data;
    if (!d || d.length < 3) return;
    const type = d[0] & 0xf0;
    const id = `midi:${d[1]}`;
    if (type === 0x90 && d[2] > 0) {
      if (this.held.has(id)) this.off(id);
      this.on(id, d[1], d[2] / 127);
    } else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.off(id);
  }
}
