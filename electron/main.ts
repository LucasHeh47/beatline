// Electron main process: windows, native dialogs, the media:// protocol that streams audio files to
// the UI, sample folders, saving projects, recordings and exports, recovery copies and the suite.
import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { MediaFileInfo, SampleFolder, SaveKind } from '../src/shared/api';
import { launchSuiteApp, registerSelf, safeLaunchArgs, suiteApps, type SuiteAppId } from './suite';
import { setupUpdates } from './updater';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SMOKE_SCREENSHOT = process.env.BEATLINE_SCREENSHOT;
/** Tests of an unpackaged build: save dialogs answer with this folder instead of asking. */
const TEST_SAVE_DIR = !app.isPackaged ? process.env.BEATLINE_TEST_SAVE_DIR : undefined;

const AUDIO_EXT = ['wav', 'mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aif', 'aiff', 'webm'];
const AUDIO = new RegExp(`\\.(${AUDIO_EXT.join('|')})$`, 'i');
const MIDI = /\.(mid|midi)$/i;
const PROJECT = /\.beatline$/i;

const MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  webm: 'audio/webm',
};

/** Files the UI may read: chosen in a dialog, dropped, opened from Explorer, or used by an opened project. */
const allowedPaths = new Set<string>();
/** Sample folders the user added: audio files inside them may be read. */
const allowedFolders = new Set<string>();
/** Files and folders the UI may write: chosen in a save dialog. */
const writable = new Set<string>();
const dirty = new Map<number, boolean>();
const closing = new Set<number>();

const key = (p: string) => path.resolve(p).toLowerCase();

function allow(p: string): string {
  const full = path.resolve(p);
  allowedPaths.add(full.toLowerCase());
  return full;
}

const inFolder = (p: string) => [...allowedFolders].some((f) => key(p).startsWith(f + path.sep));
const isAllowed = (p: unknown): p is string => typeof p === 'string' && (allowedPaths.has(key(p)) || (AUDIO.test(p) && inFolder(p)));

async function info(p: string): Promise<MediaFileInfo | null> {
  const st = await fs.stat(p).catch(() => null);
  return st?.isFile() ? { path: path.resolve(p), name: path.basename(p), size: st.size, modified: st.mtimeMs } : null;
}

// ---------- media:// (streams audio files to the UI) ----------

protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

function serveMedia(): void {
  protocol.handle('media', async (req) => {
    let p: string;
    try {
      p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    } catch {
      return new Response('Bad address', { status: 400 });
    }
    if (!isAllowed(p)) return new Response('Not allowed', { status: 403 });
    const st = await fs.stat(p).catch(() => null);
    if (!st?.isFile()) return new Response('Not found', { status: 404 });
    const type = MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';
    const common = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (range) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
      if (!range[1] && range[2]) {
        start = Math.max(0, st.size - parseInt(range[2], 10));
        end = st.size - 1;
      }
      if (start >= st.size || end < start) return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${st.size}` } });
      const body = Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream;
      return new Response(body, { status: 206, headers: { ...common, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}` } });
    }
    const body = Readable.toWeb(createReadStream(p)) as ReadableStream;
    return new Response(body, { status: 200, headers: { ...common, 'Content-Length': String(st.size) } });
  });
}

// ---------- recent projects ----------

const recentPath = () => path.join(app.getPath('userData'), 'recent.json');
interface Recent {
  path: string;
  name: string;
  openedAt: number;
  pinned?: boolean;
}

async function readRecent(): Promise<Recent[]> {
  try {
    const list = JSON.parse(await fs.readFile(recentPath(), 'utf8')) as Recent[];
    return list.filter((r) => typeof r.path === 'string' && existsSync(r.path));
  } catch {
    return [];
  }
}

async function writeRecent(list: Recent[]): Promise<void> {
  let unpinned = 0;
  const kept = list.filter((r) => r.pinned || unpinned++ < 30);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(recentPath(), JSON.stringify(kept, null, 2));
}

async function addRecent(p: string): Promise<void> {
  const all = await readRecent();
  const prev = all.find((r) => key(r.path) === key(p));
  const list = all.filter((r) => r !== prev);
  list.unshift({ path: p, name: path.basename(p), openedAt: Date.now(), pinned: prev?.pinned || undefined });
  await writeRecent(list);
  app.addRecentDocument(p);
}

// ---------- sample folders ----------

const foldersPath = () => path.join(app.getPath('userData'), 'sample-folders.json');

async function readFolders(): Promise<string[]> {
  try {
    const list = JSON.parse(await fs.readFile(foldersPath(), 'utf8')) as string[];
    return list.filter((p) => typeof p === 'string');
  } catch {
    return [];
  }
}

/** The audio files in a folder and its subfolders (at most a few thousand). */
async function scanFolder(dir: string): Promise<SampleFolder> {
  const files: MediaFileInfo[] = [];
  const walk = async (d: string, depth: number) => {
    if (depth > 6 || files.length >= 5000) return;
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (AUDIO.test(e.name)) {
        const st = await fs.stat(full).catch(() => null);
        if (st) files.push({ path: full, name: path.relative(dir, full), size: st.size, modified: st.mtimeMs });
      }
    }
  };
  await walk(dir, 0);
  return { path: dir, name: path.basename(dir), files };
}

// ---------- projects ----------

/** A project's audio files become readable when the project is opened (where they are, or next to it). */
function allowProjectMedia(projectPath: string, text: string): void {
  try {
    const p = JSON.parse(text) as { samples?: { path?: string }[]; relative?: Record<string, string> };
    for (const s of p.samples ?? []) if (typeof s.path === 'string' && AUDIO.test(s.path)) allow(s.path);
    for (const rel of Object.values(p.relative ?? {})) if (typeof rel === 'string' && AUDIO.test(rel)) allow(path.resolve(path.dirname(projectPath), rel));
  } catch {
    // an unreadable project fails later with a clear message
  }
}

async function readProjectFile(p: string) {
  const full = allow(p);
  const text = await fs.readFile(full, 'utf8');
  allowProjectMedia(full, text);
  writable.add(key(full));
  await addRecent(full);
  return { path: full, name: path.basename(full), text };
}

async function writeAtomic(full: string, data: Uint8Array | string) {
  const tmp = `${full}.beatline-${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, typeof data === 'string' ? data : Buffer.from(data));
    await fs.rename(tmp, full);
    return { ok: true };
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return { ok: false, error: 'The file is locked — it may be open in another program. Close it there and try again, or save somewhere else.' };
    return { ok: false, error: (err as Error).message };
  }
}

const senderWindow = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender);

const AUDIO_FILTERS: Electron.FileFilter[] = [{ name: 'Audio', extensions: AUDIO_EXT }];

const SAVE_FILTERS: Record<SaveKind, Electron.FileFilter> = {
  wav: { name: 'WAV audio', extensions: ['wav'] },
  mp3: { name: 'MP3 audio', extensions: ['mp3'] },
  m4a: { name: 'M4A audio (AAC)', extensions: ['m4a'] },
  ogg: { name: 'OGG audio (Opus)', extensions: ['ogg'] },
  flac: { name: 'FLAC audio (lossless)', extensions: ['flac'] },
  mid: { name: 'MIDI file', extensions: ['mid'] },
  project: { name: 'Beatline project', extensions: ['beatline'] },
  json: { name: 'Beatline settings', extensions: ['json'] },
};

/** A file name that can't climb out of its folder. */
const safeName = (n: string) => path.basename(String(n)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'file';

// ---------- IPC ----------

ipcMain.handle('media:import-dialog', async (e) => {
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: 'Import audio', properties: ['openFile', 'multiSelections'], filters: AUDIO_FILTERS });
  if (res.canceled) return [];
  const out: MediaFileInfo[] = [];
  for (const p of res.filePaths) {
    const i = await info(allow(p));
    if (i) out.push(i);
  }
  return out;
});

ipcMain.handle('media:dropped', async (_e, paths: unknown) => {
  if (!Array.isArray(paths)) return [];
  const out: MediaFileInfo[] = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    if (AUDIO.test(p) || MIDI.test(p)) {
      const i = await info(allow(p));
      if (i) out.push(i);
    } else if (PROJECT.test(p)) allow(p);
  }
  return out;
});

ipcMain.handle('media:check', async (_e, paths: unknown) => {
  const out: Record<string, MediaFileInfo | null> = {};
  if (!Array.isArray(paths)) return out;
  for (const p of paths) if (isAllowed(p)) out[p] = await info(p);
  return out;
});

ipcMain.handle('media:relink-dialog', async (e, name: string) => {
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: `Where is ${String(name).slice(0, 80)}?`, properties: ['openFile'], filters: AUDIO_FILTERS });
  if (res.canceled || !res.filePaths[0]) return null;
  return info(allow(res.filePaths[0]));
});

ipcMain.handle('midi:open-dialog', async (e) => {
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: 'Import MIDI', properties: ['openFile'], filters: [{ name: 'MIDI files', extensions: ['mid', 'midi'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const st = await fs.stat(res.filePaths[0]);
  if (st.size > 16 * 1024 * 1024) throw new Error('That MIDI file is too big.');
  return { name: path.basename(res.filePaths[0]), data: new Uint8Array(await fs.readFile(res.filePaths[0])) };
});

ipcMain.handle('midi:read', async (_e, p: string) => {
  if (!isAllowed(p) || !MIDI.test(p)) return null;
  return new Uint8Array(await fs.readFile(p));
});

ipcMain.handle('folders:add', async (e) => {
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: 'Add a folder of samples', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = path.resolve(res.filePaths[0]);
  allowedFolders.add(key(dir));
  const list = await readFolders();
  if (!list.some((f) => key(f) === key(dir))) {
    list.push(dir);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(foldersPath(), JSON.stringify(list, null, 2));
  }
  return scanFolder(dir);
});

ipcMain.handle('folders:list', async () => {
  const out: SampleFolder[] = [];
  for (const f of await readFolders()) {
    if (!existsSync(f)) continue;
    allowedFolders.add(key(f));
    out.push(await scanFolder(f));
  }
  return out;
});

ipcMain.handle('folders:remove', async (_e, p: string) => {
  if (typeof p !== 'string') return;
  allowedFolders.delete(key(p));
  await fs.writeFile(foldersPath(), JSON.stringify((await readFolders()).filter((f) => key(f) !== key(p)), null, 2)).catch(() => undefined);
});

ipcMain.handle('project:open-dialog', async (e) => {
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: 'Open project', properties: ['openFile'], filters: [{ name: 'Beatline projects', extensions: ['beatline'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  return readProjectFile(res.filePaths[0]);
});

ipcMain.handle('project:open', async (_e, p: string) => {
  if (typeof p !== 'string' || !PROJECT.test(p)) return null;
  const recent = await readRecent();
  if (!isAllowed(p) && !recent.some((r) => key(r.path) === key(p))) throw new Error('That project can only be opened from the Open dialog.');
  if (!existsSync(p)) throw new Error(`${path.basename(p)} isn't there any more.`);
  return readProjectFile(p);
});

ipcMain.handle('project:save-dialog', async (e, defaultName: string) => {
  if (TEST_SAVE_DIR) {
    const full = path.resolve(TEST_SAVE_DIR, safeName(defaultName || 'Untitled.beatline'));
    writable.add(key(full));
    return allow(full);
  }
  const res = await dialog.showSaveDialog(senderWindow(e)!, { title: 'Save project', defaultPath: String(defaultName || 'Untitled.beatline'), filters: [SAVE_FILTERS.project] });
  if (res.canceled || !res.filePath) return null;
  writable.add(key(res.filePath));
  return allow(res.filePath);
});

ipcMain.handle('project:save', async (_e, p: string, text: string) => {
  if (typeof p !== 'string' || typeof text !== 'string' || !writable.has(key(p)) || !PROJECT.test(p)) return { ok: false, error: "Beatline isn't allowed to write there. Use Save As." };
  const res = await writeAtomic(path.resolve(p), text);
  if (res.ok) {
    allowProjectMedia(p, text);
    await addRecent(path.resolve(p));
  }
  return res;
});

ipcMain.handle('file:save-dialog', async (e, defaultName: string, kind: SaveKind) => {
  const filter = SAVE_FILTERS[kind];
  if (!filter) return null;
  if (TEST_SAVE_DIR) {
    const full = path.resolve(TEST_SAVE_DIR, safeName(defaultName));
    writable.add(key(full));
    return full;
  }
  const res = await dialog.showSaveDialog(senderWindow(e)!, { title: kind === 'mid' ? 'Export MIDI' : 'Export', defaultPath: String(defaultName), filters: [filter] });
  if (res.canceled || !res.filePath) return null;
  const full = path.resolve(res.filePath);
  writable.add(key(full));
  return full;
});

ipcMain.handle('file:save', async (_e, p: string, data: Uint8Array | string) => {
  if (typeof p !== 'string' || !writable.has(key(p))) return { ok: false, error: 'Choose where to save it first.' };
  if (!(data instanceof Uint8Array) && typeof data !== 'string') return { ok: false, error: 'Nothing to save.' };
  const res = await writeAtomic(path.resolve(p), data);
  if (res.ok && AUDIO.test(p)) allow(p);
  return res;
});

ipcMain.handle('file:stems-dialog', async (e, defaultName: string) => {
  if (TEST_SAVE_DIR) {
    const dir = path.resolve(TEST_SAVE_DIR, safeName(defaultName || 'Stems'));
    await fs.mkdir(dir, { recursive: true });
    writable.add(key(dir));
    return dir;
  }
  const res = await dialog.showOpenDialog(senderWindow(e)!, { title: 'Choose a folder for the stems', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = path.resolve(res.filePaths[0]);
  writable.add(key(dir));
  return dir;
});

ipcMain.handle('file:save-in-folder', async (_e, folder: string, name: string, data: Uint8Array) => {
  if (typeof folder !== 'string' || !writable.has(key(folder)) || !(data instanceof Uint8Array)) return { ok: false, error: 'Choose a folder first.' };
  return writeAtomic(path.join(path.resolve(folder), safeName(name)), data);
});

// Recordings go in a folder next to the project ("Song recordings"), or Music\Beatline recordings
ipcMain.handle('recording:save', async (_e, data: Uint8Array, name: string, projectPath: string | null) => {
  if (!(data instanceof Uint8Array) || !data.length) return null;
  let dir: string;
  if (TEST_SAVE_DIR) dir = path.join(TEST_SAVE_DIR, 'recordings');
  else if (typeof projectPath === 'string' && PROJECT.test(projectPath) && writable.has(key(projectPath))) dir = path.join(path.dirname(projectPath), `${path.basename(projectPath).replace(PROJECT, '')} recordings`);
  else dir = path.join(app.getPath('music'), 'Beatline recordings');
  await fs.mkdir(dir, { recursive: true });
  const base = safeName(String(name || 'Recording')).replace(/\.wav$/i, '');
  let full = path.join(dir, `${base}.wav`);
  for (let n = 2; existsSync(full); n++) full = path.join(dir, `${base} (${n}).wav`);
  const res = await writeAtomic(full, data);
  return res.ok ? info(allow(full)) : null;
});

// Unsaved projects kept safe in case Beatline closes unexpectedly
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const recoveringNow = new Set<string>();
const RECOVERY_ID = /^[a-z0-9-]{1,40}$/;
ipcMain.handle('recovery:save', async (_e, id: string, text: string, meta: unknown) => {
  if (typeof id !== 'string' || !RECOVERY_ID.test(id) || typeof text !== 'string') return;
  recoveringNow.add(id);
  await fs.mkdir(recoveryDir(), { recursive: true });
  await writeAtomic(path.join(recoveryDir(), `${id}.beatline`), text);
  await fs.writeFile(path.join(recoveryDir(), `${id}.json`), JSON.stringify({ ...(meta as object), savedAt: Date.now() }));
});
ipcMain.handle('recovery:list', async () => {
  const out: Record<string, unknown>[] = [];
  for (const f of await fs.readdir(recoveryDir()).catch(() => [] as string[])) {
    if (!f.endsWith('.json') || recoveringNow.has(f.replace(/\.json$/, ''))) continue;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(recoveryDir(), f), 'utf8')) as Record<string, unknown>;
      if (existsSync(path.join(recoveryDir(), f.replace(/\.json$/, '.beatline')))) out.push({ ...meta, id: f.replace(/\.json$/, '') });
    } catch {
      // a damaged entry is skipped
    }
  }
  return out;
});
ipcMain.handle('recovery:read', async (_e, id: string) => {
  if (typeof id !== 'string' || !RECOVERY_ID.test(id)) return null;
  const file = path.join(recoveryDir(), `${id}.beatline`);
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text) allowProjectMedia(file, text);
  return text;
});
ipcMain.handle('recovery:remove', async (_e, id: string) => {
  if (typeof id !== 'string' || !RECOVERY_ID.test(id)) return;
  await fs.rm(path.join(recoveryDir(), `${id}.beatline`), { force: true });
  await fs.rm(path.join(recoveryDir(), `${id}.json`), { force: true });
});

ipcMain.handle('suite:apps', () => suiteApps());
ipcMain.handle('suite:launch', async (_e, id: SuiteAppId, args: unknown) => {
  if (!['baseline', 'gridline', 'pixelline', 'frameline'].includes(id)) return false;
  return launchSuiteApp(id, safeLaunchArgs(args));
});

ipcMain.handle('file:recent', async () => {
  const list = await readRecent();
  for (const r of list) allow(r.path);
  return list;
});
ipcMain.handle('file:clear-recent', async () => {
  await writeRecent((await readRecent()).filter((r) => r.pinned)).catch(() => undefined);
  app.clearRecentDocuments();
});
ipcMain.handle('file:remove-recent', async (_e, p: string) => {
  if (typeof p !== 'string') return;
  await writeRecent((await readRecent()).filter((r) => key(r.path) !== key(p)));
});
ipcMain.handle('file:pin-recent', async (_e, p: string, pinned: boolean) => {
  if (typeof p !== 'string') return;
  const list = await readRecent();
  for (const r of list) if (key(r.path) === key(p)) r.pinned = pinned ? true : undefined;
  await writeRecent(list);
});

let awake: number | null = null;
ipcMain.on('power:keep-awake', (_e, on: boolean) => {
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
  else if (!on && awake !== null) {
    powerSaveBlocker.stop(awake);
    awake = null;
  }
});

ipcMain.on('win:set-title', (e, title: string) => senderWindow(e)?.setTitle(String(title)));
ipcMain.on('win:set-dirty', (e, value: boolean) => {
  dirty.set(e.sender.id, !!value);
  senderWindow(e)?.setDocumentEdited?.(!!value);
});
ipcMain.on('win:set-theme', (e, t: { dark: boolean; bar: string; symbol: string }) => {
  const win = senderWindow(e);
  try {
    win?.setTitleBarOverlay?.({ color: t.bar, symbolColor: t.symbol, height: 40 });
    win?.setBackgroundColor(t.dark ? '#121417' : '#ffffff');
  } catch {
    // not supported on this platform
  }
});
ipcMain.on('win:new', (_e, p?: string) => {
  if (p && !isAllowed(p)) return;
  createWindow(p);
});
ipcMain.on('win:confirm-close', (e) => {
  closing.add(e.sender.id);
  senderWindow(e)?.close();
});
ipcMain.on('win:devtools', (e) => e.sender.toggleDevTools());
ipcMain.on('shell:open-external', (_e, url: string) => {
  if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
});
ipcMain.on('shell:show-in-folder', (_e, p: string) => {
  if (isAllowed(p) || (typeof p === 'string' && writable.has(key(p)))) shell.showItemInFolder(p);
});
ipcMain.handle('app:version', () => app.getVersion());

setupUpdates();

// ---------- windows ----------

/** A new project asked for on the command line (Baseline uses this): --new --template=trap --name=Song --bpm=140 */
function newProjectFromArgv(argv: string[]): Record<string, string> | null {
  if (!argv.some((a) => a === '--new' || a.startsWith('--new='))) return null;
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const out: Record<string, string> = { new: '1' };
  const template = get('template');
  if (template && /^[a-z0-9-]{1,40}$/i.test(template)) out.template = template;
  const bpm = get('bpm');
  if (bpm && /^\d{2,3}(\.\d{1,2})?$/.test(bpm)) out.bpm = bpm;
  const name = get('name');
  if (name) out.name = name.slice(0, 80);
  return out;
}

function filesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('-') && (PROJECT.test(a) || AUDIO.test(a) || MIDI.test(a)) && existsSync(a));
}

function createWindow(filePath?: string, launch = false, newProject?: Record<string, string> | null, extra: string[] = []): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#121417',
    title: 'Beatline',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#16181d', symbolColor: '#c9ced8', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Playback and recording keep going when the window is behind another one
      backgroundThrottling: false,
    },
  });
  const id = win.webContents.id;
  if (filePath) allow(filePath);
  const query: Record<string, string> | undefined = filePath ? { file: path.resolve(filePath) } : newProject ? newProject : launch ? { launch: '1' } : undefined;
  if (DEV_URL) win.loadURL(DEV_URL + (query ? `?${new URLSearchParams(query)}` : ''));
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  if (extra.length) win.webContents.once('did-finish-load', () => sendPaths(win, extra));

  win.once('ready-to-show', () => {
    win.show();
    if (SMOKE_SCREENSHOT) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        await fs.writeFile(SMOKE_SCREENSHOT, img.toPNG());
        app.exit(0);
      }, Number(process.env.BEATLINE_SCREENSHOT_DELAY ?? 2500));
    }
  });
  win.on('close', (e) => {
    if (dirty.get(id) && !closing.has(id)) {
      e.preventDefault();
      win.webContents.send('app:request-close');
    }
  });
  win.on('closed', () => {
    dirty.delete(id);
    closing.delete(id);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && DEV_URL) win.webContents.toggleDevTools();
  });
  return win;
}

/** Lets a window use these files and asks it to open them (projects) or import them (audio, MIDI). */
function sendPaths(win: BrowserWindow, files: string[]): void {
  win.webContents.send('app:open-paths', files.map((f) => allow(f)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const fresh = newProjectFromArgv(argv);
    if (!win) {
      createWindow(files.find((f) => PROJECT.test(f)), !files.length, fresh, files.filter((f) => !PROJECT.test(f)));
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
    if (files.length) sendPaths(win, files);
    if (fresh) win.webContents.send('app:new-project', fresh);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.beatline.app');
    serveMedia();
    // Audio inputs (guitar, microphone — never the camera) and MIDI keyboards (no system-exclusive messages)
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
      const audio = permission === 'media' && 'mediaTypes' in details && (details.mediaTypes ?? []).every((t) => t === 'audio');
      cb(audio || permission === 'midi');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'midi');
    const files = filesFromArgv(process.argv);
    if (process.env.BEATLINE_OPEN && existsSync(process.env.BEATLINE_OPEN)) files.push(process.env.BEATLINE_OPEN);
    const projectFile = files.find((f) => PROJECT.test(f));
    createWindow(projectFile, !files.length, newProjectFromArgv(process.argv), files.filter((f) => !PROJECT.test(f)));
    void registerSelf('beatline');
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
