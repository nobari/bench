import type { Personal } from "./types";
import { z } from "zod";
import recipes from "./recipes.json";
export const FLOW_VERSION = "2026-11-04.1";
const sessionSchema = z.object({
  flowVersion: z.string().optional(),
  id: z.string(),
  recipeId: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  step: z.number().int().nonnegative(),
  weighed: z.array(z.number().int().nonnegative()),
  confirmed: z.array(z.number().int().nonnegative()),
});
const personalSchema = z.object({
  version: z.literal(1),
  favorites: z.array(z.string()),
  session: sessionSchema.nullable(),
  history: z.array(
    z.object({
      id: z.string(),
      recipeId: z.string(),
      completedAt: z.string(),
      notes: z.string(),
      photoId: z.string().optional(),
    }),
  ),
});
export const STORAGE_KEY = "bench:my-bistro:v1";
export const emptyPersonal = (): Personal => ({
  version: 1,
  favorites: [],
  session: null,
  history: [],
});
export function readPersonal(): Personal {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyPersonal();
  const parsed = personalSchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Saved baking data could not be read. It has not been overwritten. Keep a copy of this browser’s stored data before clearing it.",
    );
  const value = parsed.data;
  if (value.session) {
    const recipe = recipes.find((r) => r.id === value.session!.recipeId);
    if (!recipe || recipe.referenceOnly || recipe.reviewRequired)
      throw new Error(
        "The saved recipe is not available for guided baking. Your stored data has not been changed.",
      );
    if (value.session.flowVersion !== FLOW_VERSION) {
      // A changed sequence must never reuse old step-index confirmations.
      value.session = {
        ...value.session,
        flowVersion: FLOW_VERSION,
        step: 0,
        confirmed: [],
        weighed: [],
      };
    }
    const count = recipe.steps.length + 3;
    if (
      value.session.step >= count ||
      value.session.weighed.some((i) => i >= recipe.ingredients.length) ||
      value.session.confirmed.some((i) => i >= count) ||
      Array.from({ length: value.session.step }, (_, i) => i).some(
        (i) => !value.session!.confirmed.includes(i),
      )
    )
      throw new Error(
        "Saved checklist positions are invalid. Your stored data has not been changed.",
      );
  }
  return value;
}
export function writePersonal(value: Personal) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("bench-my-bistro-photos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function photoStore(
  action: "get" | "put" | "delete",
  id: string,
  value?: Blob,
): Promise<Blob | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      "photos",
      action === "get" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("photos");
    const req =
      action === "get"
        ? store.get(id)
        : action === "put"
          ? store.put(value, id)
          : store.delete(id);
    tx.oncomplete = () => {
      resolve(req.result);
      database.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      database.close();
    };
  });
}
export async function preparePhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 15 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not prepare photo."))),
      "image/jpeg",
      0.85,
    ),
  );
}
