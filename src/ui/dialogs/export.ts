// Export: the song (or the loop, or the pattern) as WAV, MP3, M4A, OGG or FLAC, with an optional
// loudness target for streaming sites; or stems — every mixer track as its own file.
import { barTicks, patternEnd, songEnd, type Project } from '../../core/project';
import { canExport, encode, normalize, renderProject, type ExportFormat } from '../../audio/render';
import type { SaveKind } from '../../shared/api';
import type { App } from '../app';
import { h } from '../dom';
import { isDesktop, platform } from '../platform';
import { dialog, toast } from '../widgets';
import { checkbox, field, progressDialog, row, select } from './common';

const FORMATS: [ExportFormat, string, string, SaveKind][] = [
  ['wav', 'WAV, 24-bit', 'Best quality, for mastering or other software.', 'wav'],
  ['wav16', 'WAV, 16-bit (CD)', 'CD quality, plays everywhere.', 'wav'],
  ['mp3', 'MP3', 'Small files that play everywhere: share and upload.', 'mp3'],
  ['m4a', 'M4A (AAC)', 'Small files, a little better than MP3 at the same size.', 'm4a'],
  ['ogg', 'OGG (Opus)', 'The smallest files at good quality.', 'ogg'],
  ['flac', 'FLAC', 'Lossless and smaller than WAV.', 'flac'],
];

const ext = (f: ExportFormat) => (f === 'wav16' ? 'wav' : f);

export async function openExport(app: App, kind: 'mix' | 'stems'): Promise<void> {
  const p = app.project;
  const song = songEnd(p);
  const bar = barTicks(p);
  const last = (app.prefs.export ?? {}) as Partial<{ format: ExportFormat; bitrate: string; loudness: string; tail: boolean; masterFx: boolean }>;
  const available = await Promise.all(FORMATS.map(([f]) => canExport(f)));
  const format = select<ExportFormat>(FORMATS.filter((_, i) => available[i]).map(([v, l]) => [v, l]), last.format && available[FORMATS.findIndex((f) => f[0] === last.format)] ? last.format : 'mp3');
  format.style.width = '100%';
  const formatHint = h('p', { class: 'hint' });
  const bitrate = select([['128000', '128 kbps'], ['192000', '192 kbps'], ['256000', '256 kbps'], ['320000', '320 kbps (best)']], last.bitrate ?? '320000');
  const ranges: [string, string][] = [];
  if (song) ranges.push(['song', `The whole song (${Math.ceil(song / bar)} bars)`]);
  if (p.loop) ranges.push(['loop', `The loop (${((p.loop[1] - p.loop[0]) / bar).toFixed(0)} bars)`]);
  ranges.push(['pattern1', `The pattern “${app.pattern.name}”`], ['pattern4', `The pattern, 4 times`]);
  const range = select(ranges, app.mode === 'song' && song ? 'song' : 'pattern4');
  const tail = checkbox('Let reverb and echoes ring out at the end', last.tail ?? true);
  const loud = select([['off', 'As mixed'], ['-14', '−14 LUFS — Spotify, YouTube, Apple Music'], ['-16', '−16 LUFS — podcasts'], ['-9', '−9 LUFS — loud (club, EDM)']], last.loudness ?? (kind === 'mix' ? '-14' : 'off'));
  const masterFx = checkbox('Include the master’s effects on each stem', last.masterFx ?? false);
  const update = () => {
    const f = format.value as ExportFormat;
    formatHint.textContent = FORMATS.find((x) => x[0] === f)?.[2] ?? '';
    bitrate.closest('label')!.hidden = f === 'wav' || f === 'wav16' || f === 'flac';
  };
  format.addEventListener('change', update);
  const stemsNote = h('p', { class: 'hint' }, `Each mixer track with sound becomes its own file (${p.mixer.length - 1} tracks), lined up from the same start — for mixing elsewhere or sending to someone.`);
  const body = h(
    'div',
    { class: 'form export-form' },
    kind === 'stems' ? stemsNote : null,
    field('Format', format),
    formatHint,
    row(field('Quality', bitrate)),
    field('What to export', range),
    tail.el,
    kind === 'mix' ? field('Loudness', loud, 'Brings the song to the level the services expect, with a limiter so it never clips') : masterFx.el,
  );
  update();
  const ok = await dialog(kind === 'stems' ? 'Export stems' : 'Export song', body, [
    { label: kind === 'stems' ? 'Export stems…' : 'Export…', value: true, primary: true },
    { label: 'Cancel', value: false },
  ]);
  if (!ok) return;
  const f = format.value as ExportFormat;
  app.prefs.export = { format: f, bitrate: bitrate.value, loudness: loud.value, tail: tail.input.checked, masterFx: masterFx.input.checked };
  app.savePrefs();
  // The stretch of ticks and how it plays
  let from = 0;
  let to = song;
  let mode: 'song' | 'pattern' = 'song';
  if (range.value === 'loop' && p.loop) [from, to] = p.loop;
  else if (range.value.startsWith('pattern')) {
    mode = 'pattern';
    const len = Math.max(bar, Math.ceil(patternEnd(app.pattern) / (bar / 4)) * (bar / 4));
    to = len * (range.value === 'pattern4' ? 4 : 1);
  }
  const opts = { from, to, mode, tail: tail.input.checked ? 2.5 : 0.05, sampleRate: 48000 };
  const name = p.name || 'Untitled';
  if (kind === 'mix') {
    const path = await platform.saveDialog(`${name}.${ext(f)}`, FORMATS.find((x) => x[0] === f)![3]);
    if (!path) return;
    await run(app, 'Exporting', async (prog) => {
      let buffer = await renderProject(p, app.engine.library, opts, (x) => prog.set(x * 0.85, `Rendering… ${Math.round(x * 100)}%`), prog.signal);
      let note = '';
      if (loud.value !== 'off') {
        prog.set(0.88, 'Setting the loudness…');
        const n = normalize(buffer, Number(loud.value));
        buffer = n.buffer;
        if (Number.isFinite(n.measured)) note = ` It was ${n.measured.toFixed(1)} LUFS; now ${loud.value} LUFS.`;
      }
      prog.set(0.92, 'Encoding…');
      const data = await encode(buffer, f, Number(bitrate.value));
      const res = await platform.saveFile(path, data);
      if (!res.ok) throw new Error(res.error ?? "Couldn't save the file.");
      toast(`Exported ${path.split(/[\\/]/).pop()}.${note}`, { kind: 'success', ms: 9000, action: isDesktop ? { label: 'Show in folder', run: () => platform.showInFolder(path) } : undefined });
    });
    return;
  }
  // Stems: the mixer tracks something plays through
  const used = new Set([...p.channels.map((c) => c.mixer), ...p.tracks.filter((t) => t.clips.length).map((t) => t.mixer)]);
  const stems = p.mixer.filter((m) => m.id !== 'master' && used.has(m.id));
  if (!stems.length) return toast('Nothing plays through a mixer track yet, so there are no stems to export.');
  const folder = await platform.stemsFolderDialog(`${name} stems`);
  if (!folder) return;
  const proj: Project = structuredClone(p);
  if (!masterFx.input.checked) proj.mixer[0].effects = [];
  await run(app, 'Exporting stems', async (prog) => {
    for (const [i, m] of stems.entries()) {
      const part = (x: number) => (i + x) / stems.length;
      const buffer = await renderProject(proj, app.engine.library, { ...opts, only: m.id }, (x) => prog.set(part(x * 0.9), `${m.name} (${i + 1} of ${stems.length})…`), prog.signal);
      const data = await encode(buffer, f, Number(bitrate.value));
      const res = await platform.saveInFolder(folder, `${name} - ${String(i + 1).padStart(2, '0')} ${m.name}.${ext(f)}`, data);
      if (!res.ok) throw new Error(res.error ?? `Couldn't save ${m.name}.`);
    }
    toast(`Exported ${stems.length} stems.`, { kind: 'success', ms: 9000, action: isDesktop ? { label: 'Show folder', run: () => platform.showInFolder(folder) } : undefined });
  });
}

interface Job {
  set(fraction: number, text?: string): void;
  signal: AbortSignal;
}

async function run(app: App, title: string, job: (j: Job) => Promise<void>): Promise<void> {
  if (app.engine.playing) app.stop();
  const prog = progressDialog(title);
  const ctrl = new AbortController();
  const watch = setInterval(() => prog.canceled && ctrl.abort(), 100);
  platform.keepAwake(true);
  try {
    await job({ set: (x, t) => prog.set(x, t), signal: ctrl.signal });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') toast('Export canceled.');
    else {
      console.error(err);
      toast(`Export failed: ${(err as Error).message ?? err}`, { kind: 'error', ms: 12000 });
    }
  } finally {
    clearInterval(watch);
    prog.close();
    platform.keepAwake(false);
  }
}
