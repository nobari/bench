"use client";
/**
 * The Parts panel of the TGS studio: the layers and parts of the sticker as a tree, the selected part or layer with
 * its paints, opacity, order and transform, the removed parts to restore, and the Add menu that arms the stage to
 * place a new shape. Pure presentation: every change goes back as an op; the studio owns the edits and the stage.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Circle, Copy, Eye, EyeOff, Hexagon, Layers, Minus, PenTool, Plus, Redo2, RotateCcw, RotateCw, Scaling, Square, Star, Trash2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOTIONS, type Addr, type Edits, type LayerInfo, type MotionKind, type Op, type PaintInfo, type PartInfo, type ShapeKind } from "@/lib/tools/image/tgs-edit";

const BTN = "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 font-mono text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-edge disabled:hover:text-muted";
const ICON = "flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-faint hover:bg-raised hover:text-ink disabled:opacity-30";
const FIELD = "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[11px] text-ink outline-none focus:border-accent";

/** What the stage is placing: a shape kind with its options, or a path being drawn point by point. */
export interface AddMode {
  kind: ShapeKind;
  fill: string | null;
  stroke: string | null;
  width: number;
  motion: MotionKind;
  points: number;
  corner: number;
  smooth: boolean;
  closed: boolean;
}
export const DEFAULT_ADD: AddMode = { kind: "ellipse", fill: "#5ab3d6", stroke: null, width: 8, motion: "none", points: 5, corner: 24, smooth: true, closed: true };

const SHAPES: { kind: ShapeKind; name: string; Icon: typeof Circle; hint: string }[] = [
  { kind: "ellipse", name: "Circle", Icon: Circle, hint: "Drag on the sticker to draw an ellipse" },
  { kind: "rect", name: "Rectangle", Icon: Square, hint: "Drag on the sticker to draw a rounded rectangle" },
  { kind: "star", name: "Star", Icon: Star, hint: "Drag on the sticker to draw a star" },
  { kind: "polygon", name: "Polygon", Icon: Hexagon, hint: "Drag on the sticker to draw a polygon" },
  { kind: "line", name: "Line", Icon: Minus, hint: "Drag on the sticker from one end to the other" },
  { kind: "path", name: "Path", Icon: PenTool, hint: "Click the corners on the sticker; double-click or Enter finishes, Esc cancels" },
];

const kindLabel = (p: PaintInfo) => (p.kind === "fill" ? "Fill" : p.kind === "stroke" ? "Stroke" : p.kind === "gradient" ? "Gradient" : "Gradient stroke");

/** A paint's chips: its colour (or stops) as small squares. */
function Chips({ paints }: { paints: PaintInfo[] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {paints.map((p) => (
        <span key={p.addr} className={cn("flex h-3.5 items-center overflow-hidden rounded-[3px] border border-edge", p.hidden && "opacity-30")} title={`${kindLabel(p)} ${p.hex ?? "(animated)"}`}>
          {(p.stops.length ? p.stops : [p.hex ?? "#888888"]).map((h, i) => (
            <span key={i} className={cn("h-full", p.kind === "stroke" || p.kind === "gradientStroke" ? "w-2 border-x-[1.5px] border-x-transparent" : "w-3.5")} style={{ background: h }} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function PartsPanel({ layers, edits, selected, hot, canUndo, canRedo, addMode, pathPoints, busy, onSelect, onHover, onOp, onDropOps, onUndo, onRedo, onAddMode, onFinishPath, onCancelPath }: {
  layers: LayerInfo[];
  edits: Edits;
  /** The selected part or layer, and the part under the pointer on the stage. */
  selected: Addr | null;
  hot: Addr | null;
  canUndo: boolean;
  canRedo: boolean;
  addMode: AddMode | null;
  /** Points placed so far while a path is drawn. */
  pathPoints: number;
  busy: boolean;
  onSelect: (addr: Addr | null) => void;
  onHover: (addr: Addr | null) => void;
  onOp: (op: Op) => void;
  /** Drop the ops a predicate names (restoring a paint's own colour, for instance). */
  onDropOps: (keep: (op: Op) => boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddMode: (mode: AddMode | null) => void;
  onFinishPath: () => void;
  onCancelPath: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [removedOpen, setRemovedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addOpts, setAddOpts] = useState<AddMode>(DEFAULT_ADD);
  const parts = layers.flatMap((l) => l.parts);
  const selectedPart = parts.find((p) => p.addr === selected) ?? null;
  const selectedLayer = layers.find((l) => l.addr === selected) ?? null;
  const removed = [...parts.filter((p) => p.hidden), ...parts.flatMap((p) => p.paints.filter((x) => x.hidden && !p.hidden).map((x) => ({ ...p, addr: x.addr, name: `${kindLabel(x)} of ${p.name}`, paints: [x] })))];
  const removedLayers = layers.filter((l) => l.hidden);
  const isOpen = (l: LayerInfo) => open[l.addr] ?? (layers.length <= 6 || l.parts.some((p) => p.addr === selected || p.addr === hot));
  const visible = parts.filter((p) => !p.hidden).length;
  const arm = (kind: ShapeKind) => {
    const next = { ...addOpts, kind };
    setAddOpts(next);
    onAddMode(next);
  };
  const patchAdd = (patch: Partial<AddMode>) => {
    const next = { ...addOpts, ...patch };
    setAddOpts(next);
    if (addMode) onAddMode(next);
  };
  return (
    <div className="panel registered p-4" data-tgs-parts>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <p className="readout">
          Parts · {visible} in {layers.filter((l) => !l.hidden).length} layer{layers.length === 1 ? "" : "s"}
        </p>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onUndo} disabled={!canUndo || busy} className={ICON} title="Undo (⌘Z)" aria-label="Undo" data-tgs-undo>
            <Undo2 size={13} />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo || busy} className={ICON} title="Redo (⇧⌘Z)" aria-label="Redo" data-tgs-redo>
            <Redo2 size={13} />
          </button>
          <button type="button" onClick={() => setAddOpen((v) => !v)} className={cn(BTN, (addOpen || addMode) && "border-accent text-accent")} title="Add a new part: a shape drawn on the sticker" data-tgs-add-toggle>
            <Plus size={12} /> Add
          </button>
        </span>
      </div>

      {(addOpen || addMode) && (
        <div className="mb-3 space-y-2 rounded-[var(--radius-sm)] border border-edge p-2" data-tgs-add>
          <div className="flex flex-wrap gap-1">
            {SHAPES.map(({ kind, name, Icon, hint }) => (
              <button key={kind} type="button" onClick={() => arm(kind)} className={cn(BTN, addMode?.kind === kind && "border-accent text-accent")} title={hint} data-tgs-add-kind={kind}>
                <Icon size={12} /> {name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-muted">
            <label className="flex items-center gap-1" title="Fill colour; untick for an outline only">
              <input type="checkbox" checked={addOpts.fill !== null} onChange={(e) => patchAdd({ fill: e.target.checked ? "#5ab3d6" : null })} className="accent-[var(--accent)]" data-tgs-add-fill-on />
              fill
              {addOpts.fill !== null && <input type="color" value={addOpts.fill} onChange={(e) => patchAdd({ fill: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Fill colour" data-tgs-add-fill />}
            </label>
            <label className="flex items-center gap-1" title="Stroke colour and width">
              <input type="checkbox" checked={addOpts.stroke !== null} onChange={(e) => patchAdd({ stroke: e.target.checked ? "#2b2b2b" : null })} className="accent-[var(--accent)]" data-tgs-add-stroke-on />
              stroke
              {addOpts.stroke !== null && (
                <>
                  <input type="color" value={addOpts.stroke} onChange={(e) => patchAdd({ stroke: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Stroke colour" data-tgs-add-stroke />
                  <input type="number" min={0.5} max={120} step={0.5} value={addOpts.width} onChange={(e) => patchAdd({ width: Math.max(0.5, Number(e.target.value) || 1) })} className={cn(FIELD, "w-14")} aria-label="Stroke width" data-tgs-add-width />
                </>
              )}
            </label>
            {(addOpts.kind === "star" || addOpts.kind === "polygon") && (
              <label className="flex items-center gap-1">
                points
                <input type="number" min={3} max={24} value={addOpts.points} onChange={(e) => patchAdd({ points: Math.max(3, Math.min(24, Math.round(Number(e.target.value) || 5))) })} className={cn(FIELD, "w-14")} aria-label="Points" data-tgs-add-points />
              </label>
            )}
            {addOpts.kind === "rect" && (
              <label className="flex items-center gap-1">
                corners
                <input type="number" min={0} max={256} value={addOpts.corner} onChange={(e) => patchAdd({ corner: Math.max(0, Number(e.target.value) || 0) })} className={cn(FIELD, "w-14")} aria-label="Corner radius" data-tgs-add-corner />
              </label>
            )}
            {addOpts.kind === "path" && (
              <>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={addOpts.smooth} onChange={(e) => patchAdd({ smooth: e.target.checked })} className="accent-[var(--accent)]" data-tgs-add-smooth /> smooth
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={addOpts.closed} onChange={(e) => patchAdd({ closed: e.target.checked })} className="accent-[var(--accent)]" data-tgs-add-closed /> closed
                </label>
              </>
            )}
            <label className="flex items-center gap-1" title="A motion of its own, looping over the sticker's length">
              motion
              <select value={addOpts.motion} onChange={(e) => patchAdd({ motion: e.target.value as MotionKind })} className={cn(FIELD, "pr-6")} aria-label="Motion" data-tgs-add-motion>
                {MOTIONS.map((m) => (
                  <option key={m.id} value={m.id} title={m.hint}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="font-mono text-[11px] text-faint" data-tgs-add-hint>
            {addMode
              ? addMode.kind === "path"
                ? pathPoints
                  ? `${pathPoints} point${pathPoints === 1 ? "" : "s"} — click to add more; double-click or Enter finishes, Esc cancels`
                  : "Click the sticker where the path should start"
                : SHAPES.find((s) => s.kind === addMode.kind)?.hint
              : "Pick a shape, then drag it onto the sticker. New parts go on a layer of their own on top; move them with the handles afterwards."}
            {addMode && addMode.kind === "path" && pathPoints >= 2 && (
              <>
                {" "}
                <button type="button" onClick={onFinishPath} className="text-accent hover:underline" data-tgs-path-finish>
                  Finish
                </button>
              </>
            )}
            {addMode && (
              <>
                {" · "}
                <button type="button" onClick={() => { onCancelPath(); onAddMode(null); }} className="text-muted hover:underline" data-tgs-add-cancel>
                  Stop adding
                </button>
              </>
            )}
          </p>
        </div>
      )}

      <ul className="max-h-[300px] space-y-0.5 overflow-y-auto pr-1" data-tgs-tree>
        {layers.map((l) => {
          const shown = !l.hidden;
          const opened = isOpen(l);
          return (
            <li key={l.addr} data-tgs-layer={l.addr} data-hidden={l.hidden ? "" : undefined}>
              <div className={cn("flex items-center gap-1 rounded-[3px] px-1", selected === l.addr && "bg-raised ring-1 ring-accent")}>
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [l.addr]: !opened }))} className={cn(ICON, !l.parts.length && "invisible")} aria-label={opened ? "Collapse" : "Expand"}>
                  {opened ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button type="button" onClick={() => onSelect(l.addr)} className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11.5px]", l.hidden ? "text-faint line-through" : "text-ink")} title={`${l.name} · ${l.parts.length} part${l.parts.length === 1 ? "" : "s"}${l.type !== 4 ? " · not a shape layer" : ""}`} data-tgs-layer-name>
                  <Layers size={11} className="shrink-0 text-faint" />
                  <span className="truncate">{l.name}</span>
                  <span className="shrink-0 text-faint">{l.parts.length ? `· ${l.parts.length}` : l.type === 0 ? "· precomp" : l.type === 1 ? "· solid" : l.type === 2 ? "· image" : l.type === 5 ? "· text" : ""}</span>
                </button>
                <button type="button" onClick={() => onOp({ t: shown ? "hide" : "show", at: l.addr })} className={ICON} title={shown ? "Hide this layer" : "Show this layer"} aria-label={shown ? "Hide layer" : "Show layer"} data-tgs-layer-eye>
                  {shown ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
              {opened && l.parts.length > 0 && (
                <ul className="ml-5 space-y-0.5 border-l border-edge pl-1">
                  {l.parts.map((p) => (
                    <li key={p.addr} onMouseEnter={() => onHover(p.addr)} onMouseLeave={() => onHover(null)} className={cn("flex items-center gap-1 rounded-[3px] px-1", selected === p.addr ? "bg-raised ring-1 ring-accent" : hot === p.addr && "bg-raised")} style={{ marginLeft: Math.min(3, p.depth) * 8 }} data-tgs-part={p.addr} data-hidden={p.hidden ? "" : undefined} data-selected={selected === p.addr ? "" : undefined}>
                      <button type="button" onClick={() => onSelect(p.addr)} className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px]", p.hidden ? "text-faint line-through" : "text-muted")} title={`${p.name} — ${p.paints.map(kindLabel).join(", ")} · click to edit it`} data-tgs-part-name>
                        <Chips paints={p.paints} />
                        <span className="truncate">{p.name}</span>
                        {p.added && <span className="shrink-0 rounded bg-accent/15 px-1 text-[9px] text-accent">new</span>}
                      </button>
                      <button type="button" onClick={() => onOp({ t: p.hidden ? "show" : "hide", at: p.addr })} className={ICON} title={p.hidden ? "Restore this part" : "Remove this part (it can be restored)"} aria-label={p.hidden ? "Restore part" : "Remove part"} data-tgs-part-eye>
                        {p.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {(removed.length > 0 || removedLayers.length > 0) && (
        <div className="mt-2 border-t border-edge pt-2" data-tgs-removed>
          <button type="button" onClick={() => setRemovedOpen((v) => !v)} className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-ink">
            {removedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Removed · {removed.length + removedLayers.length}
          </button>
          {removedOpen && (
            <ul className="mt-1 space-y-0.5">
              {[...removedLayers.map((l) => ({ addr: l.addr, name: `${l.name} (layer)` })), ...removed.map((p) => ({ addr: p.addr, name: p.name }))].map((r) => (
                <li key={r.addr} className="flex items-center gap-1 px-1 font-mono text-[11px] text-faint" data-tgs-removed-item={r.addr}>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <button type="button" onClick={() => onOp({ t: "show", at: r.addr })} className={BTN} data-tgs-restore>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedPart && <PartEditor part={selectedPart} layer={layers[selectedPart.layer]} edits={edits} onOp={onOp} onDropOps={onDropOps} onClose={() => onSelect(null)} />}
      {selectedLayer && <LayerEditor layer={selectedLayer} total={layers.length} onOp={onOp} onClose={() => onSelect(null)} />}
      {!selectedPart && !selectedLayer && <p className="readout mt-2 text-[10px]">Click a part on the sticker or in the list to edit it: its colours, outline, opacity, order and place. The eye removes a part; Removed brings it back.</p>}
    </div>
  );
}

function PartEditor({ part, layer, edits, onOp, onDropOps, onClose }: { part: PartInfo; layer: LayerInfo | undefined; edits: Edits; onOp: (op: Op) => void; onDropOps: (keep: (op: Op) => boolean) => void; onClose: () => void }) {
  const own = new Set(edits.ops.filter((o): o is Extract<Op, { t: "color" }> => o.t === "color").map((o) => o.at));
  return (
    <div className="mt-3 space-y-2 border-t border-edge pt-3" data-tgs-part-editor={part.addr}>
      <div className="flex items-center gap-2">
        <input value={part.name} onChange={(e) => onOp({ t: "name", at: part.addr, v: e.target.value })} className={cn(FIELD, "min-w-0 flex-1")} aria-label="Part name" data-tgs-part-rename />
        <span className="shrink-0 font-mono text-[10px] text-faint">{layer?.name}</span>
        <button type="button" onClick={onClose} className={ICON} aria-label="Done" title="Done">
          <X size={12} />
        </button>
      </div>
      <div className="space-y-1.5">
        {part.paints.map((p) => (
          <div key={p.addr} className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted" data-tgs-paint={p.addr}>
            <span className="w-16 shrink-0">{kindLabel(p)}</span>
            {p.animated ? (
              <span className="text-faint">animated colour</span>
            ) : p.stops.length ? (
              <span className="flex items-center gap-1">
                {p.stops.map((h, i) => (
                  <input key={`${i}-${h}`} type="color" defaultValue={h} onChange={(e) => onOp({ t: "color", at: p.addr, v: e.target.value, stop: i })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label={`Stop ${i + 1}`} title={`Stop ${i + 1}: ${h}`} data-tgs-paint-stop={i} />
                ))}
              </span>
            ) : (
              <>
                <input type="color" defaultValue={p.hex ?? "#000000"} onChange={(e) => onOp({ t: "color", at: p.addr, v: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label={`${kindLabel(p)} colour`} data-tgs-paint-color />
                <span className="tabular">{p.hex}</span>
              </>
            )}
            {(p.kind === "stroke" || p.kind === "gradientStroke") && (
              <label className="flex items-center gap-1" title="Stroke width">
                width
                <input type="number" min={0} max={200} step={0.5} value={p.width ?? 0} onChange={(e) => onOp({ t: "width", at: p.addr, v: Math.max(0, Number(e.target.value) || 0) })} className={cn(FIELD, "w-16")} aria-label="Stroke width" data-tgs-paint-width />
              </label>
            )}
            {own.has(p.addr) && (
              <button type="button" onClick={() => onDropOps((o) => !(o.t === "color" && o.at === p.addr))} className={BTN} title="Back to the palette's colour for this paint" data-tgs-paint-merge>
                shared again
              </button>
            )}
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => onOp({ t: p.hidden ? "show" : "hide", at: p.addr })} className={ICON} title={p.hidden ? "Show this paint" : "Hide this paint alone (a fill without its outline, say)"} aria-label={p.hidden ? "Show paint" : "Hide paint"} data-tgs-paint-eye>
                {p.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </span>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
        <span className="w-16 shrink-0">Opacity</span>
        <input type="range" min={0} max={100} step={1} value={part.opacity} onChange={(e) => onOp({ t: "opacity", at: part.addr, v: Number(e.target.value) })} className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" aria-label="Opacity" data-tgs-part-opacity />
        <span className="w-10 text-right tabular text-ink">{Math.round(part.opacity)}%</span>
      </label>
      <div className="flex flex-wrap items-center gap-1" data-tgs-part-actions>
        <button type="button" onClick={() => onOp({ t: "order", at: part.addr, d: -1 })} className={BTN} title="Draw this part over the one before it" data-tgs-part-forward>
          <ArrowUp size={11} /> Forward
        </button>
        <button type="button" onClick={() => onOp({ t: "order", at: part.addr, d: 1 })} className={BTN} title="Draw this part under the one after it" data-tgs-part-back>
          <ArrowDown size={11} /> Back
        </button>
        <button type="button" onClick={() => onOp({ t: "scale", at: part.addr, f: 1.1 })} className={BTN} title="10 % larger (the corner handles on the sticker scale freely)" data-tgs-part-grow>
          <Scaling size={11} /> +10 %
        </button>
        <button type="button" onClick={() => onOp({ t: "scale", at: part.addr, f: 1 / 1.1 })} className={BTN} title="10 % smaller" data-tgs-part-shrink>
          <Scaling size={11} /> −10 %
        </button>
        <button type="button" onClick={() => onOp({ t: "rotate", at: part.addr, deg: -15 })} className={BTN} title="Turn 15° to the left" data-tgs-part-ccw>
          <RotateCcw size={11} />
        </button>
        <button type="button" onClick={() => onOp({ t: "rotate", at: part.addr, deg: 15 })} className={BTN} title="Turn 15° to the right" data-tgs-part-cw>
          <RotateCw size={11} />
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onOp({ t: "dup", at: part.addr, id: "" })} className={BTN} title="A copy on top of this part (⌘D)" data-tgs-part-dup>
            <Copy size={11} /> Duplicate
          </button>
          {part.hidden ? (
            <button type="button" onClick={() => onOp({ t: "show", at: part.addr })} className={cn(BTN, "border-accent text-accent")} title="Bring this part back" data-tgs-part-restore>
              <Eye size={11} /> Restore
            </button>
          ) : (
            <button type="button" onClick={() => onOp({ t: "hide", at: part.addr })} className={cn(BTN, "hover:border-danger hover:text-danger")} title="Remove this part (Delete); Removed or Restore brings it back" data-tgs-part-remove>
              <Trash2 size={11} /> Remove
            </button>
          )}
        </span>
      </div>
      <p className="font-mono text-[10px] text-faint">{part.hidden ? "This part is removed: it is left out of the export. Restore brings it back." : "Drag the part on the sticker to move it (arrow keys nudge, ⇧ for 10 px), its corner handles to scale it, the handle above to turn it."}</p>
    </div>
  );
}

function LayerEditor({ layer, total, onOp, onClose }: { layer: LayerInfo; total: number; onOp: (op: Op) => void; onClose: () => void }) {
  return (
    <div className="mt-3 space-y-2 border-t border-edge pt-3" data-tgs-layer-editor={layer.addr}>
      <div className="flex items-center gap-2">
        <Layers size={12} className="shrink-0 text-faint" />
        <input value={layer.name} onChange={(e) => onOp({ t: "name", at: layer.addr, v: e.target.value })} className={cn(FIELD, "min-w-0 flex-1")} aria-label="Layer name" data-tgs-layer-rename />
        <button type="button" onClick={onClose} className={ICON} aria-label="Done" title="Done">
          <X size={12} />
        </button>
      </div>
      <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
        <span className="w-16 shrink-0">Opacity</span>
        <input type="range" min={0} max={100} step={1} value={layer.opacity} onChange={(e) => onOp({ t: "opacity", at: layer.addr, v: Number(e.target.value) })} className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" aria-label="Layer opacity" data-tgs-layer-opacity />
        <span className="w-10 text-right tabular text-ink">{Math.round(layer.opacity)}%</span>
      </label>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onOp({ t: "order", at: layer.addr, d: -1 })} disabled={layer.index === 0} className={BTN} title="Draw this layer over the one above it" data-tgs-layer-forward>
          <ArrowUp size={11} /> Forward
        </button>
        <button type="button" onClick={() => onOp({ t: "order", at: layer.addr, d: 1 })} disabled={layer.index >= total - 1} className={BTN} title="Draw this layer under the one below it" data-tgs-layer-back>
          <ArrowDown size={11} /> Back
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onOp({ t: "dup", at: layer.addr, id: "" })} className={BTN} title="A copy of the whole layer" data-tgs-layer-dup>
            <Copy size={11} /> Duplicate
          </button>
          <button type="button" onClick={() => onOp({ t: layer.hidden ? "show" : "hide", at: layer.addr })} className={cn(BTN, !layer.hidden && "hover:border-danger hover:text-danger")} data-tgs-layer-remove>
            {layer.hidden ? <Eye size={11} /> : <Trash2 size={11} />} {layer.hidden ? "Restore" : "Remove"}
          </button>
        </span>
      </div>
      <p className="font-mono text-[10px] text-faint">A layer&apos;s parts are listed under it; drag a part on the sticker to move it. Moving a whole layer uses the arrow keys with the layer selected.</p>
    </div>
  );
}
