// The bridge between the Electron main process and the UI (exposed as window.beatline).

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
  pinned?: boolean;
}

/** What a save dialog is for (decides its file types). */
export type SaveKind = 'wav' | 'mp3' | 'm4a' | 'ogg' | 'flac' | 'mid' | 'project' | 'json';

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface OpenedProject {
  path: string;
  name: string;
  text: string;
}

export interface MediaFileInfo {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface SampleFolder {
  path: string;
  name: string;
  /** Audio files in it (and its subfolders), relative names. */
  files: MediaFileInfo[];
}

export interface BeatlineApi {
  platform: string;
  isDesktop: true;
  /** The address the UI loads an audio file from. */
  mediaUrl(path: string): string;
  /** Picks audio files to import. */
  importDialog(): Promise<MediaFileInfo[]>;
  /** Files dropped on the window (their paths become usable). */
  droppedFiles(files: File[]): Promise<MediaFileInfo[]>;
  /** Which of these files exist (missing ones need relinking). */
  checkMedia(paths: string[]): Promise<Record<string, MediaFileInfo | null>>;
  /** Picks the new location of a missing file. */
  relinkDialog(name: string): Promise<MediaFileInfo | null>;
  /** A MIDI file to import (its bytes). */
  openMidiDialog(): Promise<{ name: string; data: Uint8Array } | null>;
  /** A MIDI file opened from Explorer or dropped (its path became usable). */
  readMidi(path: string): Promise<Uint8Array | null>;
  /** Folders of samples shown in the browser. */
  sampleFolders: SampleFoldersApi;
  openProjectDialog(): Promise<OpenedProject | null>;
  openProject(path: string): Promise<OpenedProject | null>;
  saveProjectDialog(defaultName: string): Promise<string | null>;
  /** Writes a project; its audio file paths stay usable. */
  saveProject(path: string, text: string): Promise<SaveResult>;
  saveDialog(defaultName: string, kind: SaveKind): Promise<string | null>;
  /** Writes a file to a path from saveDialog. */
  saveFile(path: string, data: Uint8Array | string): Promise<SaveResult>;
  /** A folder for exported stems; files can then be written into it by name. */
  stemsFolderDialog(defaultName: string): Promise<string | null>;
  saveInFolder(folder: string, name: string, data: Uint8Array): Promise<SaveResult>;
  /** Saves a recording (WAV) next to the project, or in Music\Beatline recordings. */
  saveRecording(data: Uint8Array, name: string, projectPath: string | null): Promise<MediaFileInfo | null>;
  recovery: RecoveryApi;
  suite: SuiteApi;
  recentFiles(): Promise<RecentFile[]>;
  clearRecentFiles(): Promise<void>;
  removeRecentFile(path: string): Promise<void>;
  pinRecentFile(path: string, pinned: boolean): Promise<void>;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  setTheme(theme: { dark: boolean; bar: string; symbol: string }): void;
  newWindow(path?: string): void;
  openExternal(url: string): void;
  showInFolder(path: string): void;
  confirmClose(): void;
  onRequestClose(cb: () => void): void;
  /** Files opened from outside (Explorer, a second launch): projects, audio or MIDI files. */
  onOpenPaths(cb: (paths: string[]) => void): void;
  /** A new project asked for from outside (Baseline): { new: '1', template?, name?, bpm? }. */
  onNewProject(cb: (opts: Record<string, string>) => void): void;
  /** Keeps the computer awake while playing, recording or exporting. */
  keepAwake(on: boolean): void;
  toggleDevTools(): void;
  appVersion(): Promise<string>;
  setZoomFactor(factor: number): void;
  updates: UpdatesApi;
}

export interface SampleFoldersApi {
  /** Picks a folder to add; returns it with its audio files. */
  add(): Promise<SampleFolder | null>;
  /** The folders added before, read again. */
  list(): Promise<SampleFolder[]>;
  remove(path: string): Promise<void>;
}

export interface RecoveredProject {
  id: string;
  name: string;
  filePath: string | null;
  savedAt: number;
}

export interface RecoveryApi {
  save(id: string, text: string, info: Omit<RecoveredProject, 'id' | 'savedAt'>): Promise<void>;
  list(): Promise<RecoveredProject[]>;
  read(id: string): Promise<string | null>;
  remove(id: string): Promise<void>;
}

export type SuiteAppId = 'baseline' | 'gridline' | 'pixelline' | 'frameline' | 'beatline';

export interface SuiteApp {
  id: SuiteAppId;
  name: string;
  description: string;
  installed: boolean;
  exe: string | null;
  version: string | null;
  download: string;
}

export interface SuiteApi {
  apps(): Promise<SuiteApp[]>;
  launch(id: SuiteAppId, args?: string[]): Promise<boolean>;
}

export interface UpdateCheckOptions {
  /** A background check at startup (no message when there's nothing new). */
  silent?: boolean;
  allowPrerelease?: boolean;
  autoDownload?: boolean;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';
  /** Version currently running. */
  current: string;
  /** Newest version found. */
  version?: string;
  notes?: string;
  percent?: number;
  error?: string;
  /** Portable builds can't update themselves; `url` is the download page. */
  portable?: boolean;
  url?: string;
}

export interface UpdatesApi {
  check(opts: UpdateCheckOptions): Promise<UpdateState>;
  state(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<boolean>;
  openPage(): Promise<void>;
  onState(cb: (s: UpdateState) => void): void;
}
