// Access to the desktop shell. In a plain browser (development only) audio comes from blob: URLs of
// files picked or dropped, and nothing can be saved except by downloading.
import type { BeatlineApi, MediaFileInfo, SaveResult } from '../shared/api';

declare global {
  interface Window {
    beatline?: BeatlineApi;
  }
}

/** Browser-only: picked files by their made-up paths. */
const blobs = new Map<string, string>();
const files = new Map<string, File>();

function asInfo(f: File): MediaFileInfo {
  const p = `browser:/${f.name}`;
  if (!blobs.has(p)) blobs.set(p, URL.createObjectURL(f));
  files.set(p, f);
  return { path: p, name: f.name, size: f.size, modified: f.lastModified };
}

function pick(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

function download(name: string, data: Uint8Array | string): SaveResult {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.split(/[\\/]/).pop() || 'download';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { ok: true };
}

const webFallback: Omit<BeatlineApi, 'isDesktop'> & { isDesktop: boolean } = {
  platform: 'web',
  isDesktop: false,
  mediaUrl: (p) => blobs.get(p) ?? p,
  readSoundFont: async () => {
    const res = await fetch('soundfonts/FluidR3Mono_GM.sf3');
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  },
  importDialog: async () => (await pick('audio/*', true)).map(asInfo),
  droppedFiles: async (list) => list.map(asInfo),
  checkMedia: async (paths) => Object.fromEntries(paths.map((p) => [p, blobs.has(p) ? { path: p, name: p.slice(9), size: 0, modified: 0 } : null])),
  relinkDialog: async () => (await pick('audio/*', false)).map(asInfo)[0] ?? null,
  openMidiDialog: async () => {
    const [f] = await pick('.mid,.midi', false);
    return f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null;
  },
  readMidi: async (p) => {
    const f = files.get(p);
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  },
  sampleFolders: { add: async () => null, list: async () => [], remove: async () => undefined },
  openProjectDialog: async () => {
    const [f] = await pick('.beatline', false);
    return f ? { path: f.name, name: f.name, text: await f.text() } : null;
  },
  openProject: async () => null,
  saveProjectDialog: async (name) => name,
  saveProject: async (p, text) => download(p, text),
  saveDialog: async (name) => name,
  saveFile: async (p, data) => download(p, data),
  stemsFolderDialog: async (name) => name,
  saveInFolder: async (folder, name, data) => download(`${folder} - ${name}`, data),
  saveRecording: async (data, name) => asInfo(new File([data as BlobPart], `${name}.wav`, { type: 'audio/wav' })),
  recovery: { save: async () => undefined, list: async () => [], read: async () => null, remove: async () => undefined },
  suite: { apps: async () => [], launch: async () => false },
  recentFiles: async () => [],
  clearRecentFiles: async () => undefined,
  removeRecentFile: async () => undefined,
  pinRecentFile: async () => undefined,
  setTitle: (t) => {
    document.title = t;
  },
  setDirty: () => undefined,
  setTheme: () => undefined,
  newWindow: () => window.open(location.href, '_blank'),
  openExternal: (url) => {
    if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener');
  },
  showInFolder: () => undefined,
  confirmClose: () => undefined,
  onRequestClose: () => undefined,
  onOpenPaths: () => undefined,
  onNewProject: () => undefined,
  keepAwake: () => undefined,
  toggleDevTools: () => undefined,
  appVersion: async () => __APP_VERSION__,
  setZoomFactor: () => undefined,
  updates: {
    check: async () => ({ status: 'unsupported', current: __APP_VERSION__, error: 'Updates are available in the desktop app.' }),
    state: async () => ({ status: 'unsupported', current: __APP_VERSION__ }),
    download: async () => ({ status: 'unsupported', current: __APP_VERSION__ }),
    install: async () => false,
    openPage: async () => undefined,
    onState: () => undefined,
  },
};

export const platform: BeatlineApi = (window.beatline ?? webFallback) as BeatlineApi;
export const isDesktop = !!window.beatline;
