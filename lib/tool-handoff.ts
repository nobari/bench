"use client";
import { compressToEncodedURIComponent } from "lz-string";
import { useEffect, useRef, useState } from "react";

export type HandoffTarget = "json" | "schema" | "text";
export const HANDOFF_PATHS: Record<HandoffTarget, string> = {
  json: "/json/viewer",
  schema: "/json/schema",
  text: "/text/base64",
};
const PREFIX = "bench:handoff:";
const MAX_CHARS = 1_000_000;
export function createHandoff(target: HandoffTarget, text: string): string {
  if (!text || text.length > MAX_CHARS)
    throw new Error(
      "This result is too large to pass between tools. Download or copy it instead.",
    );
  // Discard expired transfers without touching any other browser data.
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith(PREFIX)) {
      try {
        if (
          Date.now() - JSON.parse(sessionStorage.getItem(key)!).createdAt >
          30 * 60_000
        )
          sessionStorage.removeItem(key);
      } catch {
        sessionStorage.removeItem(key);
      }
    }
  const id = crypto.randomUUID();
  sessionStorage.setItem(
    PREFIX + id,
    JSON.stringify({ target, text, createdAt: Date.now() }),
  );
  return `${HANDOFF_PATHS[target]}?handoff=${id}`;
}
export function useToolHandoff(
  target: HandoffTarget,
  receive: (text: string) => void,
) {
  const receiveRef = useRef(receive);
  useEffect(() => {
    receiveRef.current = receive;
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("handoff");
      if (!id) return;
      try {
        const raw = sessionStorage.getItem(PREFIX + id);
        const data = raw ? JSON.parse(raw) : null;
        if (
          !data ||
          data.target !== target ||
          typeof data.text !== "string" ||
          data.text.length > MAX_CHARS ||
          !Number.isFinite(data.createdAt) ||
          Date.now() - data.createdAt > 30 * 60_000
        )
          throw new Error("expired");
        // Keep the accepted transfer reloadable in this tool's normal URL format.
        const hash = new URLSearchParams(url.hash.slice(1));
        if (target === "json")
          hash.set("doc", compressToEncodedURIComponent(data.text));
        if (target === "schema") {
          hash.set("j", compressToEncodedURIComponent(data.text));
          hash.set("d", compressToEncodedURIComponent(data.text));
          url.searchParams.set("m", "design");
        }
        if (target === "text") url.searchParams.set("i", data.text);
        url.hash = hash.toString();
        receiveRef.current(data.text);
        sessionStorage.removeItem(PREFIX + id);
        setMessage(
          "Result received locally. Your original is still available with Back.",
        );
      } catch {
        setMessage(
          "This transfer expired or is unavailable in this tab. Return to the source tool and try again.",
        );
      }
      url.searchParams.delete("handoff");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [target]);
  return message;
}
