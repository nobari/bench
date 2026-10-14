/**
 * Painting annotations into the rendered Markdown preview. The preview's text is read as one string from its text
 * nodes (top-level blocks separated by one newline; copy bars, heading anchors, drawn diagrams and the annotation
 * markers themselves are skipped), so an annotation's offsets name the same characters whatever the markup around
 * them; marks are then wrapped around exactly those characters, splitting text nodes where a stretch starts or ends.
 */

import type { MarkColor } from "@/lib/tools/text/annotations";

/** Parts of the preview whose text is not the document's. */
const SKIP = ".md-code-bar, .md-anchor, .md-mermaid, .md-ann-n";
export const MARK_CLASS = "md-ann";
export const MARKER_CLASS = "md-ann-n";

export interface TextRun {
  node: Text;
  start: number;
  end: number;
}

/** The preview's text and the runs (text nodes) that make it up. */
export function textRuns(root: HTMLElement): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      // Whitespace between top-level blocks is layout, not text; the newline added between blocks stands for it.
      if (n.parentNode === root && !/\S/.test((n as Text).data)) return NodeFilter.FILTER_REJECT;
      return (n.parentElement?.closest(SKIP) ?? null) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const block = blockOf(root, n);
    if (lastBlock && block !== lastBlock) text += "\n";
    lastBlock = block;
    const start = text.length;
    text += n.data;
    runs.push({ node: n, start, end: text.length });
  }
  return { text, runs };
}

function blockOf(root: HTMLElement, n: Node): Element | null {
  let el: Node | null = n;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof Element ? el : null;
}

/** The offsets a selection covers in the preview's text, or null when it is empty or outside the preview. */
export function rangeOffsets(root: HTMLElement, range: Range, runs: TextRun[]): { start: number; end: number } | null {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const start = pointOffset(root, runs, range.startContainer, range.startOffset, false);
  const end = pointOffset(root, runs, range.endContainer, range.endOffset, true);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** A boundary point as an offset: inside a text node directly, otherwise the nearest run after (or before) it. */
function pointOffset(root: HTMLElement, runs: TextRun[], node: Node, offset: number, isEnd: boolean): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const run = runs.find((r) => r.node === node);
    if (run) return run.start + Math.min(offset, run.node.data.length);
    // A text node that is skipped (inside a copy bar, say): fall through to its position among the runs.
  }
  // The point sits between nodes: compare it against every run and take the first run after it (or last before, for an end).
  const probe = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) probe.setStart(node, 0);
  else probe.setStart(node, Math.min(offset, node.childNodes.length));
  probe.collapse(true);
  let before: TextRun | null = null;
  for (const r of runs) {
    const c = document.createRange();
    c.selectNodeContents(r.node);
    // run entirely after the point
    if (probe.compareBoundaryPoints(Range.START_TO_START, c) <= 0) return isEnd ? (before ? before.end : r.start) : r.start;
    before = r;
  }
  return before ? before.end : null;
}

export interface MarkSpec {
  id: string;
  start: number;
  end: number;
  color: MarkColor;
  n: number;
  done: boolean;
}

/** Removes every mark and marker, joining the text nodes back together. */
export function unwrapMarks(root: HTMLElement) {
  for (const marker of Array.from(root.querySelectorAll(`.${MARKER_CLASS}`))) marker.remove();
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll(`.${MARK_CLASS}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parents.add(parent);
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  for (const p of parents) p.normalize();
}

/**
 * Wraps the given stretches in marks (nested where they overlap, the earlier one outside) and puts a numbered marker
 * after each stretch's last character. Expects a preview without marks (see unwrapMarks).
 */
export function wrapMarks(root: HTMLElement, specs: MarkSpec[]) {
  if (!specs.length) return;
  const { runs } = textRuns(root);
  const sorted = [...specs].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const run of runs) {
    const covering = sorted.filter((s) => s.start < run.end && s.end > run.start);
    if (!covering.length) continue;
    // Every boundary that falls inside this run, as an absolute offset.
    const cuts = new Set<number>();
    for (const s of covering) {
      if (s.start > run.start && s.start < run.end) cuts.add(s.start);
      if (s.end > run.start && s.end < run.end) cuts.add(s.end);
    }
    // Split the node into pieces at those boundaries, keeping their absolute offsets.
    const pieces: { node: Text; start: number; end: number }[] = [];
    let node = run.node, base = run.start;
    for (const cut of [...cuts].sort((a, b) => a - b)) {
      const rest = node.splitText(cut - base);
      pieces.push({ node, start: base, end: cut });
      node = rest;
      base = cut;
    }
    pieces.push({ node, start: base, end: run.end });
    for (const piece of pieces) {
      const over = covering.filter((s) => s.start <= piece.start && s.end >= piece.end);
      if (!over.length) continue;
      let wrapped: Node = piece.node;
      // Innermost mark belongs to the latest-starting annotation; wrap outwards.
      for (const s of [...over].reverse()) {
        const mark = document.createElement("mark");
        mark.className = MARK_CLASS;
        mark.dataset.ann = s.id;
        mark.dataset.color = s.color;
        if (s.done) mark.dataset.done = "true";
        wrapped.parentNode?.replaceChild(mark, wrapped);
        mark.appendChild(wrapped);
        wrapped = mark;
      }
      for (const s of over) {
        if (s.end !== piece.end) continue;
        const marker = document.createElement("sup");
        marker.className = MARKER_CLASS;
        marker.dataset.ann = s.id;
        marker.dataset.color = s.color;
        marker.textContent = String(s.n);
        marker.title = "Annotation " + s.n;
        wrapped.parentNode?.insertBefore(marker, wrapped.nextSibling);
      }
    }
  }
}
