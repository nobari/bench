/**
 * Runs the regex off the main thread so a catastrophically backtracking
 * pattern can be cut off by terminating the worker instead of freezing the tab.
 */
import { runRegex } from "@/lib/tools/web/regex";

export interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  replacement: string | null;
  limit: number;
}

self.onmessage = (e: MessageEvent<RegexRequest>) => {
  const { id, pattern, flags, text, replacement, limit } = e.data;
  const result = runRegex(pattern, flags, text, replacement, limit);
  (self as unknown as Worker).postMessage({ id, result });
};

// Lets the page start its timeout only once the script has loaded and can run.
(self as unknown as Worker).postMessage({ type: "ready" });
