/**
 * Music & audio math: notes ↔ frequencies ↔ MIDI, tempo ↔ time, chord and
 * key transposition, decibels, pitch ratios and bitrates. Pure and testable.
 */

/* ------------------------------------------------------------- pitch */

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type Accidentals = "sharp" | "flat";

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Semitones above C for a note letter with accidentals (not wrapped, so B# = 12 and Cb = -1). */
function letterSemis(letter: string, acc: string): number {
  let s = LETTER_PC[letter.toUpperCase()];
  for (const c of acc) s += c === "#" || c === "♯" ? 1 : -1;
  return s;
}

/** Pitch class 0–11 of a note name such as "F#", "Bb", "E♭"; null if unreadable. */
export function pitchClass(name: string): number | null {
  const m = name.trim().match(/^([A-Ga-g])([#♯b♭]{0,2})$/);
  return m ? mod12(letterSemis(m[1], m[2])) : null;
}

export function pcName(pc: number, prefer: Accidentals = "sharp"): string {
  return (prefer === "flat" ? FLAT_NAMES : SHARP_NAMES)[mod12(Math.round(pc))];
}

export function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(hz: number, a4 = 440): number {
  return 69 + 12 * Math.log2(hz / a4);
}

export interface NoteName {
  name: string;
  octave: number;
  label: string;
}

/** Scientific pitch notation for a MIDI number (60 = C4, 69 = A4). */
export function midiToNote(midi: number, prefer: Accidentals = "sharp"): NoteName {
  const m = Math.round(midi);
  const name = pcName(m, prefer);
  const octave = Math.floor(m / 12) - 1;
  return { name, octave, label: `${name}${octave}` };
}

/** "A4", "c#3", "Bb-1", "E♭5"; a bare "A" means A4. Returns the MIDI number. */
export function parseNote(text: string): number | null {
  const m = text.trim().match(/^([A-Ga-g])([#♯b♭]{0,2})(-?\d{1,2})?$/);
  if (!m) return null;
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  const midi = (octave + 1) * 12 + letterSemis(m[1], m[2]);
  return midi >= 0 && midi <= 127 ? midi : null;
}

export interface FrequencyInfo {
  midi: number;
  nearest: number;
  note: NoteName;
  /** Deviation from the nearest equal-tempered note, in cents. */
  cents: number;
  periodMs: number;
  wavelengthM: number;
}

export const SPEED_OF_SOUND = 343;

export function describeFrequency(hz: number, a4 = 440, prefer: Accidentals = "sharp"): FrequencyInfo {
  const midi = frequencyToMidi(hz, a4);
  const nearest = Math.round(midi);
  return { midi, nearest, note: midiToNote(nearest, prefer), cents: (midi - nearest) * 100, periodMs: 1000 / hz, wavelengthM: SPEED_OF_SOUND / hz };
}

export function noteTable(a4 = 440, prefer: Accidentals = "sharp", from = 12, to = 120): { midi: number; label: string; hz: number }[] {
  const rows = [];
  for (let m = from; m <= to; m++) rows.push({ midi: m, label: midiToNote(m, prefer).label, hz: midiToFrequency(m, a4) });
  return rows;
}

export const INTERVAL_NAMES = ["Unison", "Minor 2nd", "Major 2nd", "Minor 3rd", "Major 3rd", "Perfect 4th", "Tritone", "Perfect 5th", "Minor 6th", "Major 6th", "Minor 7th", "Major 7th"];

export function intervalName(semitones: number): string {
  const n = Math.abs(Math.round(semitones));
  if (n === 0) return "Unison";
  const octaves = Math.floor(n / 12), rem = n % 12;
  if (rem === 0) return octaves === 1 ? "Octave" : `${octaves} octaves`;
  const base = INTERVAL_NAMES[rem];
  return octaves === 0 ? base : `${octaves} octave${octaves > 1 ? "s" : ""} + ${base}`;
}

/* ------------------------------------------------------------- tempo */

export const NOTE_VALUES = [
  { id: "1", label: "Whole", beats: 4 },
  { id: "1/2", label: "Half", beats: 2 },
  { id: "1/4", label: "Quarter", beats: 1 },
  { id: "1/8", label: "Eighth", beats: 0.5 },
  { id: "1/16", label: "Sixteenth", beats: 0.25 },
  { id: "1/32", label: "Thirty-second", beats: 0.125 },
  { id: "1/64", label: "Sixty-fourth", beats: 0.0625 },
] as const;

/** Milliseconds per quarter-note beat. */
export const beatMs = (bpm: number) => 60000 / bpm;

export interface DelayRow {
  id: string;
  label: string;
  beats: number;
  straightMs: number;
  dottedMs: number;
  tripletMs: number;
  hz: number;
  samples: number | null;
}

export function delayTable(bpm: number, sampleRate?: number): DelayRow[] {
  return NOTE_VALUES.map((v) => {
    const straightMs = beatMs(bpm) * v.beats;
    return { id: v.id, label: v.label, beats: v.beats, straightMs, dottedMs: straightMs * 1.5, tripletMs: (straightMs * 2) / 3, hz: 1000 / straightMs, samples: sampleRate ? Math.round((straightMs / 1000) * sampleRate) : null };
  });
}

export const msToBpm = (ms: number, beats = 1) => (60000 * beats) / ms;
export const barsToSeconds = (bars: number, bpm: number, beatsPerBar = 4) => (bars * beatsPerBar * 60) / bpm;

export function secondsToBars(seconds: number, bpm: number, beatsPerBar = 4): { bars: number; beats: number; remainderBeats: number; totalBeats: number } {
  const totalBeats = (seconds * bpm) / 60;
  const bars = Math.floor(totalBeats / beatsPerBar);
  const beatsIn = totalBeats - bars * beatsPerBar;
  return { bars, beats: Math.floor(beatsIn), remainderBeats: beatsIn - Math.floor(beatsIn), totalBeats };
}

export function tempoChange(fromBpm: number, toBpm: number): { ratio: number; percent: number; semitones: number; cents: number; durationFactor: number } {
  const ratio = toBpm / fromBpm;
  return { ratio, percent: (ratio - 1) * 100, semitones: 12 * Math.log2(ratio), cents: 1200 * Math.log2(ratio), durationFactor: 1 / ratio };
}

/** Tempo from tap timestamps (ms). Uses up to the last 8 intervals; a gap over 3 s starts a new run. */
export function tapTempo(taps: number[]): { bpm: number; intervalMs: number; count: number } | null {
  let run: number[] = [];
  for (const t of taps) {
    if (run.length && t - run[run.length - 1] > 3000) run = [];
    run.push(t);
  }
  if (run.length < 2) return null;
  const recent = run.slice(-9);
  const intervals = recent.slice(1).map((t, i) => t - recent[i]);
  const intervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return { bpm: 60000 / intervalMs, intervalMs, count: run.length };
}

/* ------------------------------------------------------ transposition */

const CHORD_SUFFIX = /^(?:maj|min|dim|aug|sus|add|alt|no|omit|m|M|Δ|°|ø|\+|-|\d|\(|\)|#|♯|b|♭|\/)*$/;
const CHORD_RE = /^([A-G])([#♯b♭]?)([^/\s]*?)(?:\/([A-G])([#♯b♭]?))?$/;

export function isChordToken(token: string): boolean {
  const m = token.match(CHORD_RE);
  return !!m && CHORD_SUFFIX.test(m[3]);
}

function shift(letter: string, acc: string, semitones: number, prefer: Accidentals | "auto"): string {
  const pc = mod12(letterSemis(letter, acc) + semitones);
  const pref: Accidentals = prefer === "auto" ? (acc === "b" || acc === "♭" ? "flat" : "sharp") : prefer;
  return pcName(pc, pref);
}

/** Transposes a single chord symbol ("F#m7/A" → "Am7/C"); returns null if it isn't a chord. */
export function transposeChord(chord: string, semitones: number, prefer: Accidentals | "auto" = "auto"): string | null {
  const m = chord.match(CHORD_RE);
  if (!m || !CHORD_SUFFIX.test(m[3])) return null;
  const root = shift(m[1], m[2], semitones, prefer);
  const bass = m[4] ? `/${shift(m[4], m[5], semitones, prefer)}` : "";
  return `${root}${m[3]}${bass}`;
}

/** True when most tokens on the line are chord symbols (a chord line above lyrics). */
export function isChordLine(line: string): boolean {
  const tokens = line.split(/[\s|]+/).filter(Boolean);
  if (!tokens.length) return false;
  const chords = tokens.filter(isChordToken).length;
  return chords > 0 && chords / tokens.length >= 0.6;
}

/** Transposes chord symbols in a chord sheet. With `onlyChordLines`, lyric lines are left alone. */
export function transposeText(text: string, semitones: number, prefer: Accidentals | "auto" = "auto", onlyChordLines = true): string {
  return text
    .split("\n")
    .map((line) => {
      if (onlyChordLines && !isChordLine(line)) return line;
      return line.replace(/[^\s|()[\]]+/g, (tok) => transposeChord(tok, semitones, prefer) ?? tok);
    })
    .join("\n");
}

export type Mode = "major" | "minor";

export const CIRCLE_MAJOR = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
/** Key signature: sharps positive, flats negative, indexed by major pitch class (F#/Gb chosen by preference). */
const MAJOR_SIGNATURE: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_TRIADS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MINOR_TRIADS = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

export interface KeyInfo {
  tonic: string;
  mode: Mode;
  label: string;
  notes: string[];
  signature: number;
  signatureLabel: string;
  relative: { tonic: string; mode: Mode; label: string };
  parallel: { tonic: string; mode: Mode; label: string };
  chords: { degree: string; chord: string }[];
  prefer: Accidentals;
}

/** Spelling used inside a key: flat keys spell with flats, sharp keys with sharps. */
export function keyAccidentals(tonicPc: number, mode: Mode, hint: Accidentals | "auto" = "auto"): Accidentals {
  const majorPc = mode === "major" ? tonicPc : mod12(tonicPc + 3);
  const sig = MAJOR_SIGNATURE[majorPc];
  if (majorPc === 6) return hint === "flat" ? "flat" : "sharp";
  return sig < 0 ? "flat" : "sharp";
}

export function keyInfo(tonic: string, mode: Mode, hint: Accidentals | "auto" = "auto"): KeyInfo | null {
  const pc = pitchClass(tonic);
  if (pc === null) return null;
  const prefer = keyAccidentals(pc, mode, hint === "auto" ? (/[b♭]/.test(tonic) ? "flat" : "auto") : hint);
  const steps = mode === "major" ? MAJOR_STEPS : MINOR_STEPS;
  const notes = steps.map((s) => pcName(pc + s, prefer));
  const majorPc = mode === "major" ? pc : mod12(pc + 3);
  let signature = MAJOR_SIGNATURE[majorPc];
  if (majorPc === 6) signature = prefer === "flat" ? -6 : 6;
  const suffix = (m: Mode) => (m === "major" ? " major" : " minor");
  const relPc = mode === "major" ? mod12(pc + 9) : mod12(pc + 3);
  const relMode: Mode = mode === "major" ? "minor" : "major";
  const parMode: Mode = mode === "major" ? "minor" : "major";
  const parPrefer = keyAccidentals(pc, parMode, "auto");
  const triads = mode === "major" ? MAJOR_TRIADS : MINOR_TRIADS;
  const chords = triads.map((degree, i) => {
    const root = notes[i];
    const quality = degree.includes("°") ? "dim" : degree === degree.toLowerCase() ? "m" : "";
    return { degree, chord: `${root}${quality}` };
  });
  return {
    tonic: pcName(pc, prefer),
    mode,
    label: `${pcName(pc, prefer)}${suffix(mode)}`,
    notes,
    signature,
    signatureLabel: signature === 0 ? "no sharps or flats" : `${Math.abs(signature)} ${signature > 0 ? "sharp" : "flat"}${Math.abs(signature) > 1 ? "s" : ""}`,
    relative: { tonic: pcName(relPc, prefer), mode: relMode, label: `${pcName(relPc, prefer)}${suffix(relMode)}` },
    parallel: { tonic: pcName(pc, parPrefer), mode: parMode, label: `${pcName(pc, parPrefer)}${suffix(parMode)}` },
    chords,
    prefer,
  };
}

/** Semitones to move from one key to another (shortest direction, −6..+6 with +6 preferred). */
export function keyDistance(from: string, to: string): number | null {
  const a = pitchClass(from), b = pitchClass(to);
  if (a === null || b === null) return null;
  const d = mod12(b - a);
  return d > 6 ? d - 12 : d;
}

/* ----------------------------------------------------------- decibels */

export const dbToAmplitude = (db: number) => 10 ** (db / 20);
export const amplitudeToDb = (a: number) => 20 * Math.log10(a);
export const dbToPower = (db: number) => 10 ** (db / 10);
export const powerToDb = (p: number) => 10 * Math.log10(p);
export const DBU_REF_VOLTS = 0.7745966692;
export const dbuToVolts = (dbu: number) => DBU_REF_VOLTS * 10 ** (dbu / 20);
export const voltsToDbu = (v: number) => 20 * Math.log10(v / DBU_REF_VOLTS);
export const dbvToVolts = (dbv: number) => 10 ** (dbv / 20);
export const voltsToDbv = (v: number) => 20 * Math.log10(v);
export const DBU_MINUS_DBV = 20 * Math.log10(1 / DBU_REF_VOLTS);
/** Theoretical dynamic range of linear PCM at a bit depth (6.02n + 1.76 dB). */
export const bitDepthDynamicRange = (bits: number) => 6.02 * bits + 1.76;
/** Perceived loudness ratio for a level difference (the ~10 dB = twice-as-loud rule). */
export const loudnessRatio = (db: number) => 2 ** (db / 10);
/** Sound-pressure level at another distance from a point source (inverse-square law). */
export const splAtDistance = (spl: number, fromM: number, toM: number) => spl - 20 * Math.log10(toM / fromM);

/* ------------------------------------------------------- pitch ratios */

export const semitonesToRatio = (s: number) => 2 ** (s / 12);
export const ratioToSemitones = (r: number) => 12 * Math.log2(r);
export const centsToRatio = (c: number) => 2 ** (c / 1200);
export const ratioToCents = (r: number) => 1200 * Math.log2(r);

export const JUST_INTERVALS: { ratio: number; name: string }[] = [
  { ratio: 1, name: "1:1 unison" },
  { ratio: 16 / 15, name: "16:15 minor second" },
  { ratio: 9 / 8, name: "9:8 major second" },
  { ratio: 6 / 5, name: "6:5 minor third" },
  { ratio: 5 / 4, name: "5:4 major third" },
  { ratio: 4 / 3, name: "4:3 perfect fourth" },
  { ratio: 45 / 32, name: "45:32 tritone" },
  { ratio: 3 / 2, name: "3:2 perfect fifth" },
  { ratio: 8 / 5, name: "8:5 minor sixth" },
  { ratio: 5 / 3, name: "5:3 major sixth" },
  { ratio: 9 / 5, name: "9:5 minor seventh" },
  { ratio: 15 / 8, name: "15:8 major seventh" },
  { ratio: 2, name: "2:1 octave" },
];

/** Nearest just-intonation interval within the octave, with the deviation in cents. */
export function nearestJust(ratio: number): { name: string; ratio: number; centsOff: number } {
  const octaves = Math.floor(Math.log2(Math.abs(ratio)));
  const inOctave = ratio / 2 ** octaves;
  let best = JUST_INTERVALS[0];
  for (const j of JUST_INTERVALS) if (Math.abs(ratioToCents(inOctave / j.ratio)) < Math.abs(ratioToCents(inOctave / best.ratio))) best = j;
  return { name: best.name, ratio: best.ratio, centsOff: ratioToCents(inOctave / best.ratio) };
}

/* ------------------------------------------------------- bitrate & size */

export const pcmBitrate = (sampleRate: number, bitDepth: number, channels: number) => sampleRate * bitDepth * channels;
export const sizeBytes = (bitrateBps: number, seconds: number) => (bitrateBps * seconds) / 8;
export const durationSeconds = (bytes: number, bitrateBps: number) => (bytes * 8) / bitrateBps;

export const BITRATE_PRESETS: { label: string; kbps: number }[] = [
  { label: "Opus voice (32 kbps)", kbps: 32 },
  { label: "Opus music (96 kbps)", kbps: 96 },
  { label: "MP3 128 kbps", kbps: 128 },
  { label: "MP3 / AAC 192 kbps", kbps: 192 },
  { label: "AAC 256 kbps", kbps: 256 },
  { label: "MP3 320 kbps", kbps: 320 },
  { label: "FLAC, typical (~850 kbps)", kbps: 850 },
  { label: "CD quality PCM (44.1 kHz · 16-bit · stereo)", kbps: 1411.2 },
  { label: "48 kHz · 24-bit · stereo", kbps: 2304 },
  { label: "96 kHz · 24-bit · stereo", kbps: 4608 },
  { label: "192 kHz · 24-bit · stereo", kbps: 9216 },
];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const ss = s < 10 ? `0${s.toFixed(s % 1 ? 1 : 0)}` : s.toFixed(s % 1 ? 1 : 0);
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Trims float noise for display: up to `digits` decimals, no trailing zeros. */
export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? Math.min(digits, 1) : abs >= 100 ? Math.min(digits, 2) : digits;
  return Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}
