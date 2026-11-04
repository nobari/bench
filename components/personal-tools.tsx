"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, Clock3 } from "lucide-react";
import { TOOLS } from "@/lib/tools/registry";
import { toolShortTitle } from "@/lib/tools/types";
import {
  clearRecentTools,
  rememberTool,
  toggleFavorite,
  usePersonalTools,
} from "@/lib/personal-tools";

export function PersonalToolControls({ path }: { path: string }) {
  const { favorites } = usePersonalTools();
  const [error, setError] = useState(false);
  useEffect(() => {
    rememberTool(path);
  }, [path]);
  const favorite = favorites.includes(path);
  return (
    <div>
      <button
        type="button"
        aria-pressed={favorite}
        onClick={() => setError(!toggleFavorite(path))}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted hover:text-accent"
      >
        <Star size={14} fill={favorite ? "currentColor" : "none"} />
        {favorite ? "Favorited" : "Favorite"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Browser storage is unavailable. Favorites could not be saved.
        </p>
      )}
    </div>
  );
}

export function PersonalTools() {
  const { favorites, recent } = usePersonalTools();
  const [error, setError] = useState(false);
  const groups = [
    { title: "Favorites", paths: favorites, icon: Star },
    {
      title: "Recently used",
      paths: recent.filter((p) => !favorites.includes(p)),
      icon: Clock3,
    },
  ];
  return (
    <section
      aria-label="Your tools"
      className="mt-6 rounded-[var(--radius)] border border-edge bg-surface p-4"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map(({ title, paths, icon: Icon }) => (
          <div key={title}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={14} />
                {title}
              </h2>
              {title === "Recently used" && recent.length > 0 && (
                <button
                  onClick={() => setError(!clearRecentTools())}
                  className="text-xs text-muted hover:text-ink"
                >
                  Clear recent
                </button>
              )}
            </div>
            {!paths.length && (
              <p className="text-xs text-muted">
                {title === "Favorites"
                  ? "Star a tool to keep it here."
                  : "Tools you open appear here. Inputs are never saved in this list."}
              </p>
            )}
            <ul className="flex flex-wrap gap-2">
              {paths.map((path) => {
                const tool = TOOLS.find(
                  (t) => `/${t.category}/${t.slug}` === path,
                );
                return tool ? (
                  <li
                    key={path}
                    className="flex items-center rounded border border-edge"
                  >
                    <Link
                      href={path}
                      className="px-3 py-2 text-[13px] hover:text-accent"
                    >
                      {toolShortTitle(tool)}
                    </Link>
                    {title === "Favorites" && (
                      <button
                        aria-label={`Remove ${toolShortTitle(tool)} from favorites`}
                        onClick={() => setError(!toggleFavorite(path))}
                        className="p-2 text-accent"
                      >
                        <Star size={13} fill="currentColor" />
                      </button>
                    )}
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Could not update browser storage.
        </p>
      )}
    </section>
  );
}
