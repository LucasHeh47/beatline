// Every setting in Beatline. `apply` runs when it changes (and at startup); `refresh` lists the parts
// of the UI that redraw.
import * as L from 'lucide';
import type { App } from '../app';
import { platform } from '../platform';
import { uiOptions } from '../widgets';
import type { SectionDef, SettingDef, SettingOption } from './store';

export const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: 'Appearance', icon: L.Palette, description: 'Theme, colors and what is shown on screen.' },
  { id: 'playback', label: 'Playing', icon: L.Play, description: 'The metronome and what happens when you play.' },
  { id: 'record', label: 'Recording', icon: L.Mic, description: 'Recording audio and notes, MIDI keyboards.' },
  { id: 'files', label: 'Files & saving', icon: L.Save, description: 'Projects, automatic saving and recovery.' },
  { id: 'keyboard', label: 'Keyboard & search', icon: L.Keyboard, description: 'Command search and shortcuts.' },
  { id: 'updates', label: 'Updates', icon: L.RefreshCw, description: 'Version and automatic updates.' },
];

const opts = (...pairs: [string, string][]): SettingOption[] => pairs.map(([value, label]) => ({ value, label }));

export const ACCENTS: Record<string, [string, string]> = {
  teal: ['#2dd4bf', '#0d9488'],
  indigo: ['#818cf8', '#4f46e5'],
  violet: ['#a98bff', '#7c4dff'],
  blue: ['#4ea1ff', '#1a73e8'],
  green: ['#3fcf8e', '#188038'],
  orange: ['#ffa94d', '#d9480f'],
  red: ['#ff5c6c', '#d6283a'],
  gold: ['#ffd43b', '#b08800'],
};

export const SETTINGS: SettingDef[] = [
  // ---------- Appearance ----------
  { id: 'appearance.theme', section: 'appearance', group: 'Theme', label: 'Theme', description: 'Dark is easiest on the eyes in a studio; "Match Windows" follows your system setting.', type: 'select', default: 'dark', options: opts(['dark', 'Dark'], ['light', 'Light'], ['system', 'Match Windows']), refresh: ['theme'], keywords: 'dark mode light mode' },
  { id: 'appearance.accent', section: 'appearance', group: 'Theme', label: 'Accent color', description: 'Used for buttons, the playhead and highlights.', type: 'select', default: 'teal', options: Object.keys(ACCENTS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), refresh: ['theme'], keywords: 'color highlight' },
  { id: 'appearance.uiZoom', section: 'appearance', group: 'Layout', label: 'Interface size', description: 'Scales menus, panels and buttons.', type: 'number', default: 100, min: 80, max: 150, step: 10, unit: '%', desktopOnly: true, apply: (v: number) => platform.setZoomFactor(v / 100), keywords: 'zoom scale bigger smaller' },
  { id: 'appearance.reduceMotion', section: 'appearance', group: 'Layout', label: 'Reduce motion', description: 'Turns off interface animations.', type: 'toggle', default: false, refresh: ['chrome'], keywords: 'animation accessibility' },
  { id: 'appearance.showStatusBar', section: 'appearance', group: 'Show on screen', label: 'Status bar', type: 'toggle', default: true, refresh: ['chrome'] },
  { id: 'appearance.showSearch', section: 'appearance', group: 'Show on screen', label: 'Search box in the title bar', description: 'Ctrl+Shift+P works either way.', type: 'toggle', default: true, refresh: ['titlebar'] },
  { id: 'appearance.titlePath', section: 'appearance', group: 'Show on screen', label: 'Show the project’s location in the window title', type: 'toggle', default: false, refresh: ['titlebar'], keywords: 'path folder' },
  { id: 'appearance.tooltips', section: 'appearance', group: 'Tooltips & messages', label: 'Tooltips', description: 'Short descriptions when you hover over a button.', type: 'toggle', default: true, apply: (v: boolean) => (uiOptions.tooltips = v) },
  { id: 'appearance.tooltipDelay', section: 'appearance', group: 'Tooltips & messages', label: 'Tooltip delay', type: 'number', default: 450, min: 0, max: 2000, step: 50, unit: 'ms', apply: (v: number) => (uiOptions.tooltipDelay = v) },
  { id: 'appearance.tooltipKeys', section: 'appearance', group: 'Tooltips & messages', label: 'Show keyboard shortcuts in tooltips', type: 'toggle', default: true, apply: (v: boolean) => (uiOptions.tooltipShortcuts = v) },
  { id: 'appearance.toastSeconds', section: 'appearance', group: 'Tooltips & messages', label: 'How long messages stay on screen', type: 'number', default: 4.5, min: 2, max: 20, step: 0.5, unit: 'seconds', apply: (v: number) => (uiOptions.toastMs = v * 1000), keywords: 'toast notification' },

  // ---------- Playing ----------
  { id: 'playback.metronomeVolume', section: 'playback', group: 'Metronome', label: 'Metronome volume', type: 'number', default: 50, min: 0, max: 100, step: 5, unit: '%', apply: (v: number, app: App) => app.engine?.setMetronomeVolume(v / 100), keywords: 'click' },

  // ---------- Recording ----------
  { id: 'record.quantize', section: 'record', group: 'Notes', label: 'Put recorded notes on the grid', description: 'Notes played on a keyboard while recording snap to 16th notes.', type: 'toggle', default: true, keywords: 'quantize midi timing' },
  { id: 'record.midi', section: 'record', group: 'MIDI keyboards', label: 'Use MIDI keyboards', description: 'Keyboards and pads plugged in play the selected channel.', type: 'toggle', default: true, apply: (v: boolean, app: App) => v && void app.keyboard?.enableMidi(), keywords: 'controller usb piano' },

  // ---------- Files ----------
  { id: 'files.restore', section: 'files', group: 'Starting', label: 'Show the start page when Beatline opens', type: 'toggle', default: true },
  { id: 'files.autosaveMinutes', section: 'files', group: 'Saving', label: 'Save the project automatically every', description: 'Only projects that were saved once, and never while recording. 0 turns it off.', type: 'number', default: 5, min: 0, max: 60, step: 1, unit: 'minutes', apply: (_v: number, app: App) => app.startAutosave?.(), keywords: 'autosave' },
  { id: 'files.recoveryMinutes', section: 'files', group: 'Saving', label: 'Keep a recovery copy every', description: 'If Beatline closes unexpectedly, the start page offers your unsaved work. 0 turns it off.', type: 'number', default: 2, min: 0, max: 30, step: 1, unit: 'minutes', apply: (_v: number, app: App) => app.startRecovery?.(), keywords: 'crash backup' },
  { id: 'files.undoSteps', section: 'files', group: 'Undo', label: 'Undo steps kept', type: 'number', default: 200, min: 20, max: 1000, step: 10, apply: (v: number, app: App) => app.history && (app.history.limit = v) },

  // ---------- Keyboard ----------
  { id: 'keyboard.remember', section: 'keyboard', group: 'Command search', label: 'Remember recently used commands', type: 'toggle', default: true },
  { id: 'keyboard.shortcuts', section: 'keyboard', group: 'Shortcuts', label: 'Keyboard shortcuts', type: 'action', action: { label: 'Show all', run: (app) => app.commands.run('help.shortcuts') } },

  // ---------- Updates ----------
  { id: 'updates.version', section: 'updates', group: 'Version', label: 'Installed version', type: 'info', info: async () => {
    const v = await platform.appVersion();
    return v.includes('-') ? `Beatline ${v} (development build)` : `Beatline ${v}`;
  } },
  { id: 'updates.check', section: 'updates', group: 'Version', label: 'Check for a newer version', type: 'action', desktopOnly: true, action: { label: 'Check now', run: (app) => app.updates.check(false) } },
  { id: 'updates.whatsNew', section: 'updates', group: 'Version', label: "What's new in this version", type: 'action', action: { label: 'Show', run: (app) => app.updates.showWhatsNew() } },
  { id: 'updates.onStartup', section: 'updates', group: 'Automatic updates', label: 'Check for updates when Beatline starts', type: 'toggle', default: true, desktopOnly: true },
  { id: 'updates.autoDownload', section: 'updates', group: 'Automatic updates', label: 'Download updates in the background', description: "You're still asked before anything is installed.", type: 'toggle', default: false, desktopOnly: true },
  { id: 'updates.devBranch', section: 'updates', group: 'Automatic updates', label: 'Developer branch', description: 'Get development builds as soon as they are made. They have the newest features first, but may have bugs.', type: 'toggle', default: false, desktopOnly: true, keywords: 'beta preview development pre-release channel', apply: (v: boolean, app: App) => app.updates?.devBranchChanged(v) },
  { id: 'updates.showNotes', section: 'updates', group: 'Automatic updates', label: "Show what's new after updating", type: 'toggle', default: true },
];
