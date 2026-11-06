"use client";
import { useEffect, useState } from "react";

export function RecipeNotebook({ recipeId }: { recipeId: string }) {
  const key = "bench:my-bistro:recipe-note:" + recipeId;
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) ?? "");
      setReady(true);
    } catch {
      setStatus("Your browser could not open this note.");
    }
  }, [key]);
  return (
    <details className="b-disclosure">
      <summary>My recipe notes</summary>
      <label htmlFor="recipe-note">Personal notes saved in this browser</label>
      <textarea id="recipe-note" rows={4} disabled={!ready} value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          try {
            if (next) localStorage.setItem(key, next);
            else localStorage.removeItem(key);
            setStatus("Saved");
          } catch {
            setStatus("Unable to save. Copy your note before leaving.");
          }
        }}
      />
      <small role="status">{status}</small>
    </details>
  );
}
