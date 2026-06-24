/** Line-level diff (LCS) for the Diff Checker. */

export type DiffType = "eq" | "add" | "del";

export interface DiffOp {
  type: DiffType;
  text: string;
  /** 1-based line number in the original (del/eq). */
  aLine?: number;
  /** 1-based line number in the changed text (add/eq). */
  bLine?: number;
}

export interface DiffResult {
  ops: DiffOp[];
  added: number;
  removed: number;
}

export function diffLines(aText: string, bText: string): DiffResult {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const ops: DiffOp[] = [];

  // Guard against pathological memory use on very large inputs.
  if (a.length * b.length > 4_000_000) {
    return naiveDiff(a, b);
  }

  const n = a.length, m = b.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i], aLine: i + 1, bLine: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i], aLine: i + 1 });
      removed++; i++;
    } else {
      ops.push({ type: "add", text: b[j], bLine: j + 1 });
      added++; j++;
    }
  }
  while (i < n) { ops.push({ type: "del", text: a[i], aLine: i + 1 }); removed++; i++; }
  while (j < m) { ops.push({ type: "add", text: b[j], bLine: j + 1 }); added++; j++; }

  return { ops, added, removed };
}

function naiveDiff(a: string[], b: string[]): DiffResult {
  const ops: DiffOp[] = [];
  let added = 0, removed = 0;
  const max = Math.max(a.length, b.length);
  for (let k = 0; k < max; k++) {
    if (k < a.length && k < b.length && a[k] === b[k]) {
      ops.push({ type: "eq", text: a[k], aLine: k + 1, bLine: k + 1 });
    } else {
      if (k < a.length) { ops.push({ type: "del", text: a[k], aLine: k + 1 }); removed++; }
      if (k < b.length) { ops.push({ type: "add", text: b[k], bLine: k + 1 }); added++; }
    }
  }
  return { ops, added, removed };
}
