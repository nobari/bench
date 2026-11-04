/** Metadata only. Existing editors remain the owners of their draft content. */
export const DRAFT_EVENT = "bench:drafts";
const TIME_PREFIX = "bench:draft-time:";
export const TEXT_DRAFTS = [
  {
    id: "markdown",
    title: "Markdown",
    path: "/web/markdown",
    keys: ["bench:markdown:draft", "bench:markdown:annotations"],
  },
  {
    id: "code",
    title: "Code editor",
    path: "/web/code",
    keys: ["bench:code:draft", "bench:code:lang"],
  },
  {
    id: "mermaid",
    title: "Mermaid",
    path: "/web/mermaid",
    keys: ["bench:mermaid:draft", "bench:mermaid:annotations"],
  },
  {
    id: "track-changes",
    title: "Track changes",
    path: "/web/track-changes",
    keys: ["bench:track-changes:draft"],
  },
] as const;
export function noteDraftSaved(id: string, present: boolean) {
  try {
    if (present) localStorage.setItem(TIME_PREFIX + id, String(Date.now()));
    else localStorage.removeItem(TIME_PREFIX + id);
    window.dispatchEvent(new Event(DRAFT_EVENT));
  } catch {
    /* Content was saved; metadata is optional. */
  }
}
export interface DraftEntry {
  id: string;
  title: string;
  path: string;
  savedAt: number | null;
  detail: string;
}
export async function listDrafts(): Promise<DraftEntry[]> {
  const entries: DraftEntry[] = [];
  for (const draft of TEXT_DRAFTS) {
    if (localStorage.getItem(draft.keys[0]))
      entries.push({
        ...draft,
        savedAt: Number(localStorage.getItem(TIME_PREFIX + draft.id)) || null,
        detail: "Draft stored in this browser",
      });
  }
  const { loadRecoveryInfo } = await import("@/lib/tools/files/pdf/store");
  const pdf = await loadRecoveryInfo();
  if (pdf)
    entries.push({
      id: "pdf",
      title: "PDF Studio",
      path: "/files/pdf",
      savedAt: pdf.savedAt,
      detail: `${pdf.name} · working copy in this browser`,
    });
  const raw = localStorage.getItem("bench:video:recovery");
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (typeof v.savedAt === "number")
        entries.push({
          id: "video",
          title: "Video editor",
          path: "/media/editor",
          savedAt: v.savedAt,
          detail:
            "Project saved in your folder · reselect your project folder if prompted",
        });
    } catch {
      /* old or invalid metadata */
    }
  }
  return entries.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}
export async function deleteDraft(id: string) {
  const text = TEXT_DRAFTS.find((d) => d.id === id);
  if (text) for (const key of text.keys) localStorage.removeItem(key);
  else if (id === "pdf") {
    const { deleteRecoveryCopy } = await import("@/lib/tools/files/pdf/store");
    await deleteRecoveryCopy();
  } else if (id === "video") {
    const { forgetVideoRecovery } = await import("@/lib/tools/video/store");
    await forgetVideoRecovery();
  }
  localStorage.removeItem(TIME_PREFIX + id);
  window.dispatchEvent(new Event(DRAFT_EVENT));
}
