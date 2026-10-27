# Developing Beatline

Beatline is an [Electron](https://www.electronjs.org/) app written in TypeScript, with no UI framework. Sound is made and mixed with the Web Audio API (synths, samplers and effects as audio nodes, with two AudioWorklets for recording and the noise gate); exports are rendered offline through the same graph and encoded with [Mediabunny](https://mediabunny.dev/) (and its MP3 encoder). There's no native audio code.

## Getting started

You need [Node.js](https://nodejs.org/) 22 or newer.

```
git clone https://github.com/LucasHeh47/beatline.git
cd beatline
npm install
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app with hot reload |
| `npm start` | Builds, then runs the production app |
| `npm test` | Runs the test suite (Vitest) |
| `npm run typecheck` | Type-checks the app and the Electron code |
| `npm run build` | Builds `dist/` (UI) and `dist-electron/` (main + preload) |
| `npm run dist` | Builds the Windows installer and portable exe into `release/` |

## Project layout

| Path | Contents |
| --- | --- |
| `src/core/` | The model, with no UI or audio: projects, channels, patterns, the playlist and the mixer (`project.ts`), what plays when (`sequence.ts`), note tools (`notes.ts`), playlist editing (`arrange.ts`), music theory (`theory.ts`: scales, chords, progressions, voice leading), instruments and effects definitions, drum patterns, templates, MIDI and WAV files, the tuner's pitch detection and loudness (LUFS) |
| `src/audio/` | The sound: the graph of channels, mixer tracks and effects (`graph.ts`), synth and sampler voices (`voices.ts`), the built-in drum kit made at startup (`drums.ts`), effects (`effects.ts`), the player and its scheduler (`engine.ts`), recording (`recorder.ts`), samples (`library.ts`), exports (`render.ts`) and the worklets |
| `src/ui/` | The interface: the app shell (`app.ts`), layout and workspaces, the transport, menus, commands and shortcuts, the computer and MIDI keyboards, start page |
| `src/ui/panels/` | Browser, Channel Rack, Piano Roll, Playlist, Mixer, Recording (with the tuner), Channel settings |
| `src/ui/dialogs/` | Export (and stems), chord progressions |
| `electron/` | Main process (windows, files, the `media://` protocol, sample folders, recordings, recovery, updates) and the preload bridge |
| `tests/` | Unit tests for the model |

## How it fits together

- **One model, everywhere.** `core/sequence.ts` says which notes and audio clips start in any stretch of the song (swing, clip offsets, loops, mutes and solos). The player schedules them a fraction of a second ahead; the exporter takes them a few seconds at a time while it renders, through the same `Graph`, so the export sounds like playback.
- **Positions are ticks** (96 per beat). Audio clips start at a tick and play at their own speed; their place in the file is in seconds.
- **Every change is undoable**: `App.edit(label, fn)` copies the project, runs the change and records the copy. Drags and knobs use `App.liveEdit` / `App.turning` (one undo step each); while they run, panels get a `live` event so canvases redraw without rebuilding the controls being used.
- **Recordings** are captured sample-exact by an AudioWorklet, placed using the frame they were captured at minus the sound card's input and output delay, and saved as 24-bit WAV next to the project. Loop recording splits one file into takes.
- **Files** reach the UI through the `media://` protocol. The main process only serves files the user picked, dropped, recorded, keeps in an added sample folder, or that an opened project uses.

## Testing without dialogs

Running an unpackaged build with `BEATLINE_TEST_SAVE_DIR=<folder>` makes save dialogs (projects, exports, stems) and recordings use that folder instead of asking. Use a separate profile so your own settings aren't touched; Chromium's fake input device stands in for a guitar:

```
npx electron . --user-data-dir=%TEMP%\beatline-test --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
```

`window.beatline_app` is the app, for poking at from DevTools.

## Releases

Pushes to `develop` publish a development build (a pre-release like `v0.1.0-beta.3`); tags like `v0.1.0` on `main` publish a release. Installed copies update themselves from these.
