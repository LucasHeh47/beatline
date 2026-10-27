// Ready-made drum beats for the channel rack: a style's kick, snare, hats and percussion as steps.
// Rows use the built-in sounds; "X" is an accent, "o" a softer hit.

export interface DrumRow {
  sound: string;
  steps: string;
}

export interface DrumPattern {
  id: string;
  name: string;
  /** A tempo that suits it. */
  bpm: number;
  swing: number;
  rows: DrumRow[];
}

export const DRUM_PATTERNS: DrumPattern[] = [
  {
    id: 'fourFloor',
    name: 'House (four on the floor)',
    bpm: 124,
    swing: 0,
    rows: [
      { sound: 'kickHouse', steps: 'X...X...X...X...' },
      { sound: 'clap', steps: '....X.......X...' },
      { sound: 'hatClosed', steps: 'o.o.o.o.o.o.o.o.' },
      { sound: 'hatOpen', steps: '..x...x...x...x.' },
    ],
  },
  {
    id: 'rock',
    name: 'Rock',
    bpm: 110,
    swing: 0,
    rows: [
      { sound: 'kickPunch', steps: 'X.......X.x.....' },
      { sound: 'snare', steps: '....X.......X...' },
      { sound: 'hatClosed', steps: 'x.x.x.x.x.x.x.x.' },
      { sound: 'crash', steps: 'x...............' },
    ],
  },
  {
    id: 'boomBap',
    name: 'Hip-hop boom bap',
    bpm: 90,
    swing: 0.35,
    rows: [
      { sound: 'kickPunch', steps: 'X.........x..x..' },
      { sound: 'snare', steps: '....X.......X...' },
      { sound: 'hatClosed', steps: 'x.x.x.x.x.x.x.xo' },
    ],
  },
  {
    id: 'trap',
    name: 'Trap',
    bpm: 140,
    swing: 0,
    rows: [
      { sound: 'kick808', steps: 'X......x..x.....' },
      { sound: 'clap', steps: '........X.......' },
      { sound: 'hatClosed', steps: 'xoxoxoxoxxxoxoxo' },
      { sound: 'hatOpen', steps: '..............x.' },
    ],
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    bpm: 82,
    swing: 0.45,
    rows: [
      { sound: 'kickLofi', steps: 'X......x..x.....' },
      { sound: 'snareLofi', steps: '....X.......X...' },
      { sound: 'hatClosed', steps: 'x.xox.x.x.xox.x.' },
      { sound: 'shaker', steps: '..o...o...o...o.' },
    ],
  },
  {
    id: 'reggaeton',
    name: 'Reggaeton (dembow)',
    bpm: 95,
    swing: 0,
    rows: [
      { sound: 'kickPunch', steps: 'X...X...X...X...' },
      { sound: 'snareTight', steps: '...x..x....x..x.' },
      { sound: 'hatClosed', steps: 'x.x.x.x.x.x.x.x.' },
    ],
  },
  {
    id: 'funk',
    name: 'Funk',
    bpm: 102,
    swing: 0.15,
    rows: [
      { sound: 'kickPunch', steps: 'X..x..x...x..x..' },
      { sound: 'snare', steps: '....X..o.o..X..o' },
      { sound: 'hatClosed', steps: 'xxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'dnb',
    name: 'Drum & bass',
    bpm: 174,
    swing: 0,
    rows: [
      { sound: 'kickPunch', steps: 'X.........X.....' },
      { sound: 'snare', steps: '....X.......X...' },
      { sound: 'hatClosed', steps: 'x.x.x.x.x.x.x.x.' },
      { sound: 'ride', steps: '..o...o...o...o.' },
    ],
  },
  {
    id: 'disco',
    name: 'Disco',
    bpm: 118,
    swing: 0,
    rows: [
      { sound: 'kickHouse', steps: 'X...X...X...X...' },
      { sound: 'snare', steps: '....X.......X...' },
      { sound: 'hatOpen', steps: '..x...x...x...x.' },
      { sound: 'hatClosed', steps: 'o...o...o...o...' },
      { sound: 'tambourine', steps: 'x.x.x.x.x.x.x.x.' },
    ],
  },
  {
    id: 'halfTime',
    name: 'Half-time groove',
    bpm: 75,
    swing: 0.2,
    rows: [
      { sound: 'kickPunch', steps: 'X.....x.........' },
      { sound: 'snare', steps: '........X.......' },
      { sound: 'hatClosed', steps: 'x.x.x.x.x.x.x.x.' },
      { sound: 'rim', steps: '...o.......o....' },
    ],
  },
];

export const drumPatternById = (id: string) => DRUM_PATTERNS.find((d) => d.id === id);
