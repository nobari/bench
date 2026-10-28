"use client";

/**
 * Page thumbnails drawn by pdf.js on demand: ask for an index when it scrolls into view, get a blob URL back once it
 * is drawn. Two draw at a time; everything is dropped when the document or the view rotation changes.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface Cache {
  doc: PDFDocumentProxy | null;
  rotation: number;
  width: number;
  urls: Map<number, string>;
  wanted: Set<number>;
  inFlight: number;
}

export interface ThumbsApi {
  thumb(index: number): string | null;
  request(index: number): void;
  tick: number;
}

export function useThumbnails(doc: PDFDocumentProxy | null, rotation: number, width = 128): ThumbsApi {
  const cache = useRef<Cache>({ doc: null, rotation: 0, width, urls: new Map(), wanted: new Set(), inFlight: 0 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const c = cache.current;
    c.doc = doc;
    c.rotation = rotation;
    c.width = width;
    return () => {
      for (const u of c.urls.values()) URL.revokeObjectURL(u);
      c.urls = new Map();
      c.wanted = new Set();
      c.inFlight = 0;
      c.doc = null;
    };
  }, [doc, rotation, width]);

  const pump = () => {
    const c = cache.current;
    const d = c.doc;
    if (!d) return;
    while (c.inFlight < 2 && c.wanted.size) {
      const index = c.wanted.values().next().value as number;
      c.wanted.delete(index);
      if (c.urls.has(index)) continue;
      c.inFlight++;
      const urls = c.urls;
      (async () => {
        try {
          const page = await d.getPage(index + 1);
          if (cache.current.doc !== d || cache.current.urls !== urls) return;
          const rot = (page.rotate + c.rotation) % 360;
          const base = page.getViewport({ scale: 1, rotation: rot });
          const scale = (c.width * (window.devicePixelRatio > 1 ? 1.5 : 1)) / base.width;
          const viewport = page.getViewport({ scale, rotation: rot });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await page.render({ canvasContext: ctx, canvas, viewport }).promise;
          if (cache.current.doc !== d || cache.current.urls !== urls) return;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
          if (!blob || cache.current.urls !== urls) return;
          urls.set(index, URL.createObjectURL(blob));
          setTick((t) => t + 1);
        } catch {
          /* a page that fails to draw stays blank */
        } finally {
          c.inFlight--;
          pump();
        }
      })();
    }
  };

  const request = (index: number) => {
    const c = cache.current;
    if (c.urls.has(index) || c.wanted.has(index)) return;
    c.wanted.add(index);
    pump();
  };

  const thumb = (index: number) => cache.current.urls.get(index) ?? null;
  return { thumb, request, tick };
}
