"use client";
/**
 * The music of one short in Short mode: the song, where in it the short starts (a strip of the whole song with the
 * part that plays as a window to drag), the gain and fades, and the ways to spread one song over a series of shorts.
 * Also the waveform bars the timeline lane draws. Pure presentation over callbacks; the editor owns the project and
 * the decoded songs.
 */
import { useEffect, useRef, useState } from "react";
import { Music, Plus, Repeat, Share2, SkipBack, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtTime, musicLength, type MediaRef, type MusicTrack, type Short } from "@/lib/tools/video/project";
import { describeShortMusic, usedSeconds } from "@/lib/tools/video/short-music";
import { peaksBetween, wavePath } from "@/lib/tools/video/waveform";
import { Slider } from "./shorts-parts";
import { GHOST, SEL } from "./video-styles";

/** Beats snap a drag this close (pixels). */
const SNAP_PX = 6;

/**
 * The waveform of a stretch of a song as SVG bars, one column per two pixels, mirrored around the middle. Drawn in a
 * fixed box and stretched to the element, so the lane may be any height.
 */
export function WaveBars({ peaks, songSeconds, from, to, width, className, dim }: { peaks: Float32Array | null; songSeconds: number; from: number; to: number; width: number; className?: string; dim?: boolean }) {
  if (!peaks || !(width > 0)) return null;
  const cols = Math.max(2, Math.floor(width / 2));
  const d = wavePath(peaksBetween(peaks, songSeconds, from, to, cols), width, 100);
  return (
    <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} aria-hidden data-waveform>
      <path d={d} fill="currentColor" opacity={dim ? 0.45 : 0.85} />
    </svg>
  );
}

/**
 * The whole song as a strip with the part the short plays as a window: drag the window (or click elsewhere to put it
 * there) to choose where in the song the short starts, snapping to the drop and the downbeats once the beat is known.
 */
function SongStrip({ track, song, shortLen, peaks, onSlip, onJump }: { track: MusicTrack; song: MediaRef; shortLen: number; peaks: Float32Array | null; onSlip: (inPoint: number) => void; onJump: (songT: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ pointerId: number; grabAt: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const songLen = Math.max(0.01, song.duration);
  const used = usedSeconds(track, shortLen);
  const pxPerSec = width / songLen;
  const songAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(songLen, (clientX - r.left) / pxPerSec));
  };
  const snapped = (inPoint: number) => {
    const g = track.beats;
    if (!g) return inPoint;
    const within = SNAP_PX / pxPerSec;
    const marks = g.drop !== null ? [g.drop, ...g.beats.filter((_, i) => i % 4 === g.downbeatPhase)] : g.beats.filter((_, i) => i % 4 === g.downbeatPhase);
    let best: number | null = null;
    for (const b of marks) if (Math.abs(b - inPoint) <= within && (best === null || Math.abs(b - inPoint) < Math.abs(best - inPoint))) best = b;
    return best ?? inPoint;
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !width) return;
    e.preventDefault();
    const at = songAt(e.clientX);
    const inside = at >= track.in && at <= track.in + used;
    e.currentTarget.setPointerCapture(e.pointerId);
    // A grab inside the window keeps the pointer on the same song moment; a click elsewhere centres the window there.
    const grabAt = inside ? at - track.in : used / 2;
    drag.current = { pointerId: e.pointerId, grabAt, moved: false };
    if (!inside) onSlip(snapped(at - grabAt));
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved = true;
    onSlip(snapped(songAt(e.clientX) - d.grabAt));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) onJump(songAt(e.clientX));
  };
  const g = track.beats;
  return (
    <div
      ref={ref}
      className="relative h-11 cursor-ew-resize touch-none overflow-hidden rounded-[var(--radius-sm)] border border-edge bg-raised select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      title="The whole song — drag the bright part to choose where the short starts in it; click anywhere to move it there; the playhead goes to that moment"
      data-song-strip
      data-song-in={track.in}
    >
      <WaveBars peaks={peaks} songSeconds={songLen} from={0} to={songLen} width={width} className="text-faint" dim />
      {width > 0 && (
        <div className="pointer-events-none absolute inset-y-0 overflow-hidden rounded-[3px] border border-accent bg-accent/15" style={{ left: track.in * pxPerSec, width: Math.max(3, used * pxPerSec) }} data-song-window>
          <div className="absolute inset-y-0" style={{ left: -track.in * pxPerSec, width }}>
            <WaveBars peaks={peaks} songSeconds={songLen} from={0} to={songLen} width={width} className="text-accent" />
          </div>
        </div>
      )}
      {width > 0 && track.in + used < songLen - 0.05 && track.in + used > 0 && track.out < songLen - 1e-3 && <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/40" style={{ left: track.out * pxPerSec }} title="The track is trimmed here" />}
      {g && width > 0 && (
        <>
          {g.beats.map((b, i) => (i % 4 === g.downbeatPhase ? <span key={b} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-ink/30" style={{ left: b * pxPerSec }} /> : null))}
          {g.drop !== null && (
            <span className="pointer-events-none absolute top-0 -translate-x-1/2 text-[9px] leading-none text-warn" style={{ left: g.drop * pxPerSec }} title={`The drop, at ${fmtTime(g.drop)} of the song`} data-song-drop>
              ▼
            </span>
          )}
        </>
      )}
      {!peaks && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10.5px] text-faint">reading the song…</span>}
    </div>
  );
}

export function ShortMusicBlock({ short, shorts, songs, media, tracks, peaks, landscapeHasMusicHere, busy, onPick, onAdd, onStartAt, onSlip, onPatch, onUseForAll, onCarry, onFromLandscape, onJump }: {
  short: Short;
  shorts: Short[];
  songs: MediaRef[];
  media: Record<string, MediaRef>;
  tracks: MusicTrack[];
  peaks: (mediaId: string) => Float32Array | null;
  landscapeHasMusicHere: boolean;
  busy: boolean;
  onPick: (mediaId: string | null) => void;
  onAdd: () => void;
  onStartAt: (how: "start" | "drop" | "continue") => void;
  onSlip: (inPoint: number) => void;
  onPatch: (patch: Partial<MusicTrack>) => void;
  onUseForAll: () => void;
  onCarry: () => void;
  onFromLandscape: () => void;
  onJump: (songT: number) => void;
}) {
  const track = tracks[0] ?? null;
  const song = track ? media[track.media] : undefined;
  const shortLen = Math.max(0, short.to - short.from);
  const index = shorts.findIndex((s) => s.id === short.id);
  const prev = (() => {
    for (let i = index - 1; i >= 0; i--) if (shorts[i].music?.length) return shorts[i];
    return null;
  })();
  const later = shorts.length - index - 1;
  const picker = (
    <select value={track?.media ?? ""} onChange={(e) => onPick(e.target.value || null)} className={cn(SEL, "h-7 min-w-0 max-w-[14rem] text-[12px]")} aria-label="The short's song" title="The song this short plays; every song the project knows is listed" data-short-song>
      <option value="">{track ? "No music" : "No music — pick a song"}</option>
      {songs.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} · {fmtTime(s.duration)}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2" data-short-music-block>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-muted">
          <Music size={12} /> Music
        </span>
        {picker}
        <button type="button" onClick={onAdd} disabled={busy} className={cn(GHOST, "h-7 text-[12px]")} title="A song from your files, for this short (remembered with the project; nothing is copied)" data-short-add-song>
          <Plus size={12} /> Add a song…
        </button>
        {!track && prev && (
          <button type="button" onClick={() => onStartAt("continue")} className={cn(GHOST, "h-7 text-[12px]")} title={`The song of ${prev.name}, carried on from where it stopped there`} data-song-continue>
            <Repeat size={12} /> Continue from {prev.name}
          </button>
        )}
        {!track && landscapeHasMusicHere && (
          <button type="button" onClick={onFromLandscape} className={cn(GHOST, "h-7 text-[12px]")} title="A copy of what the landscape edit plays under this span — then it is this short's own" data-song-from-landscape>
            What the landscape plays here
          </button>
        )}
      </div>
      {track && song ? (
        <>
          <SongStrip track={track} song={song} shortLen={shortLen} peaks={peaks(song.id)} onSlip={onSlip} onJump={onJump} />
          <p className="text-[12px] text-muted" title={song.name} data-short-music-note>
            {describeShortMusic(track, song, shortLen)}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span className="text-faint">Start the short at</span>
            <span className="flex items-center gap-1" role="group" aria-label="Start the song">
              <button type="button" onClick={() => onStartAt("start")} disabled={track.in < 0.01} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title="Start the short at the song's beginning" data-song-from-start>
                <SkipBack size={11} /> the song&apos;s start
              </button>
              <button type="button" onClick={() => onStartAt("drop")} disabled={track.beats?.drop == null} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title={track.beats ? (track.beats.drop !== null ? `Start the short at the drop, ${fmtTime(track.beats.drop)} into the song` : "This song has no clear drop") : "Analyse the beat first (the Beat row below)"} data-song-at-drop>
                <Zap size={11} /> the drop
              </button>
              {prev && (
                <button type="button" onClick={() => onStartAt("continue")} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title={`Carry on from where ${prev.name} left the song`} data-song-continue>
                  <Repeat size={11} /> where {prev.name} left it
                </button>
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Slider label="Gain" value={track.gainDb} min={-60} max={12} step={0.5} onChange={(v) => onPatch({ gainDb: v })} format={(v) => (v <= -60 ? "off" : `${v > 0 ? "+" : ""}${v} dB`)} hook="song-gain" />
            <Slider label="Fade in" value={track.fadeIn} min={0} max={5} step={0.1} onChange={(v) => onPatch({ fadeIn: v })} format={(v) => `${v.toFixed(1)} s`} hook="song-fade-in" />
            <Slider label="Fade out" value={track.fadeOut} min={0} max={5} step={0.1} onChange={(v) => onPatch({ fadeOut: v })} format={(v) => `${v.toFixed(1)} s`} hook="song-fade-out" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <label className="flex items-center gap-1" title="Keep the track but silence it">
              <input type="checkbox" checked={track.muted} onChange={(e) => onPatch({ muted: e.target.checked })} className="accent-[var(--accent)]" data-song-mute /> mute
            </label>
            {track.out < song.duration - 1e-3 && <span className="text-faint" title="Drag the bar's right edge to the short's end on the timeline to undo it">trimmed to {fmtTime(musicLength(track))}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <button type="button" onClick={onUseForAll} disabled={shorts.length < 2} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title="Every short takes this song as it is set here — the same part of it, gain and fades" data-song-for-all>
                <Share2 size={11} /> Use for every short
              </button>
              <button type="button" onClick={onCarry} disabled={later < 1} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title={later ? `The ${later} short${later === 1 ? "" : "s"} after this one carry the song on, each from where the one before it stopped (starting over when it runs out)` : "No short after this one"} data-song-carry>
                <Repeat size={11} /> Carry on through the shorts
              </button>
            </span>
          </div>
        </>
      ) : (
        <p className="text-[12px] text-faint" data-short-music-note>
          {track ? "The song's file is not at hand — Locate it in the missing-files notice." : "No music in this short — pick a song above, add one, or drop an audio file on the preview. The landscape's lanes play no part in a short."}
        </p>
      )}
    </div>
  );
}
