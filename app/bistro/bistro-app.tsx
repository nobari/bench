/* eslint-disable @next/next/no-img-element -- Original manual assets and browser-local photo URLs are already optimized. */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Heart,
  Home,
  Search,
  Settings2,
  Wheat,
  Wrench,
  X,
  Camera,
  Trash2,
  ExternalLink,
  AlertTriangle,
  ChefHat,
} from "lucide-react";
import rawRecipes from "@/lib/bistro/recipes.json";
import rawHelp from "@/lib/bistro/help.json";
import type {
  Recipe,
  Source,
  Personal,
  Entry,
  HelpTopic,
} from "@/lib/bistro/types";
import {
  emptyPersonal,
  readPersonal,
  writePersonal,
  photoStore,
  preparePhoto,
  FLOW_VERSION,
} from "@/lib/bistro/storage";

const recipes = rawRecipes as Recipe[];
const topics = rawHelp.topics as HelpTopic[];
const docs = {
  manual: "Instruction manual",
  recipes: "Recipe book",
  menu: "Menu sheet",
};
const finishLabels = {
  machine: "Finished in the machine",
  oven: "External oven",
  separate: "Separate preparation / cooking",
  dough: "Dough · finish separately",
};
const nav = [
  { id: "home", label: "Home", icon: Home },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  { id: "bake", label: "Bake", icon: ChefHat },
  { id: "help", label: "Help & Care", icon: Wrench },
  { id: "my-baking", label: "My Baking", icon: Heart },
];
const href = (view: string, id?: string) =>
  `/bistro?view=${view}${id ? `&recipe=${encodeURIComponent(id)}` : ""}`;
const recipeById = (id: string) => recipes.find((r) => r.id === id);
function SourceLink({ source }: { source: Source }) {
  return (
    <a
      className="b-source"
      href={`/bistro/sources/${source.document}.pdf#page=${source.pdfPage}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <BookOpen size={14} />
      {docs[source.document]} · printed p. {source.page}
      <ExternalLink size={12} />
    </a>
  );
}
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="b-notice">
      <AlertTriangle size={18} />
      <div>{children}</div>
    </div>
  );
}
function Photo({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    photoStore("get", id)
      .then((blob) => {
        if (blob && alive) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url ? <img className="b-result-photo" src={url} alt={alt} /> : null;
}

function Empty({
  title,
  text,
  action = "Browse recipes",
}: {
  title: string;
  text: string;
  action?: string;
}) {
  return (
    <div className="b-empty">
      <Wheat size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      <Link className="b-text-link" href={href("recipes")}>
        {action}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}

export function BistroApp() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view") || "home";
  const selected = recipeById(params.get("recipe") || "");
  const [personal, setPersonal] = useState<Personal>(emptyPersonal);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [docFilter, setDocFilter] = useState("all");
  const [guidedOnly, setGuidedOnly] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const [message, setMessage] = useState("");
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const latestPersonal = useRef(personal);
  useEffect(() => {
    try {
      // Hydrate browser-only persisted state after the server render.
      const restored = readPersonal();
      latestPersonal.current = restored;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser storage after SSR.
      setPersonal(restored);
      setReady(true);
    } catch (e) {
      setStorageError(
        e instanceof Error
          ? e.message
          : "Browser storage is unavailable. Progress cannot be saved.",
      );
    }
  }, []);

  useEffect(() => {
    if (!replaceId && !deleteId) return;
    const before = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setReplaceId(null);
        setDeleteId(null);
      }
      if (event.key === "Tab" && buttons?.length) {
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [replaceId, deleteId]);
  useEffect(() => {
    if (view === "bake")
      document.querySelector<HTMLElement>(".b-current-step h2")?.focus();
  }, [view, personal.session?.step]);
  function save(next: Personal) {
    try {
      writePersonal(next);
      latestPersonal.current = next;
      setPersonal(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "Your changes could not be saved. Browser storage may be full or unavailable. Keep this page open and free space before continuing.",
      );
      return false;
    }
  }
  const favorites = recipes.filter((r) => personal.favorites.includes(r.id));
  const recent = [...new Set(personal.history.map((e) => e.recipeId))]
    .map(recipeById)
    .filter((r): r is Recipe => !!r)
    .slice(0, 3);
  const active = personal.session
    ? recipeById(personal.session.recipeId)
    : undefined;
  function favorite(id: string) {
    save({
      ...personal,
      favorites: personal.favorites.includes(id)
        ? personal.favorites.filter((x) => x !== id)
        : [...personal.favorites, id],
    });
  }
  function start(r: Recipe) {
    if (r.reviewRequired || r.referenceOnly) return;
    if (personal.session && personal.session.recipeId !== r.id) {
      setReplaceId(r.id);
      return;
    }
    if (personal.session) {
      router.push(href("bake"));
      return;
    }
    createSession(r.id);
  }
  function createSession(id: string) {
    const now = new Date().toISOString();
    if (
      save({
        ...personal,
        session: {
          flowVersion: FLOW_VERSION,
          id: crypto.randomUUID(),
          recipeId: id,
          startedAt: now,
          updatedAt: now,
          step: 0,
          weighed: [],
          confirmed: [],
        },
      })
    ) {
      setReplaceId(null);
      router.push(href("bake"));
    }
  }
  function Card({ recipe: r }: { recipe: Recipe }) {
    return (
      <article className="b-recipe-card">
        <Link href={href("recipes", r.id)} className="b-card-image">
          {r.image ? (
            <img src={r.image} alt={r.imageAlt || r.name} loading="lazy" />
          ) : (
            <div className="b-image-empty">
              <Wheat size={44} />
              <span>
                {r.machineRequired === false
                  ? "Mix separately"
                  : r.program
                    ? `Program ${r.program}`
                    : "Recipe book"}
              </span>
            </div>
          )}
          <span className="b-image-label">{finishLabels[r.completion]}</span>
        </Link>
        <button
          disabled={!ready}
          className={`b-heart ${personal.favorites.includes(r.id) ? "is-favorite" : ""}`}
          aria-label={`${personal.favorites.includes(r.id) ? "Unfavorite" : "Favorite"} ${r.name}`}
          onClick={() => favorite(r.id)}
        >
          <Heart
            size={19}
            fill={personal.favorites.includes(r.id) ? "currentColor" : "none"}
          />
        </button>
        <div className="b-card-content">
          <p className="b-eyebrow">
            {r.machineRequired === false
              ? "Separate preparation"
              : r.program
                ? `Program ${r.program}`
                : "Manual functions"}
          </p>
          <Link href={href("recipes", r.id)}>
            <h3>{r.name}</h3>
          </Link>
          <div className="b-card-meta">
            <Clock3 size={14} />
            <span>{r.machineTime || "Machine time unspecified"}</span>
          </div>
          {r.reviewRequired && (
            <span className="b-review-label">Source clarification needed</span>
          )}
          {!r.reviewRequired && (
            <span className="b-review-label">
              {r.referenceOnly
                ? "Original-source recipe"
                : "Guided baking available"}
            </span>
          )}
        </div>
      </article>
    );
  }
  function Cards({ items }: { items: Recipe[] }) {
    return (
      <div className="b-cards">
        {items.map((r) => (
          <div key={r.id}>{Card({ recipe: r })}</div>
        ))}
      </div>
    );
  }
  function Resume() {
    return active && personal.session ? (
      <div className="b-resume">
        <div className="b-resume-icon">
          <ChefHat size={27} />
        </div>
        <div>
          <p className="b-eyebrow">Your bake is saved</p>
          <h3>{active.name}</h3>
          <p>
            Pick up at step {personal.session.step + 1}. Confirm progress on
            your machine.
          </p>
        </div>
        <Link className="b-primary" href={href("bake")}>
          Resume baking
          <ArrowRight size={17} />
        </Link>
      </div>
    ) : null;
  }
  function Ingredients({
    r,
    interactive = false,
  }: {
    r: Recipe;
    interactive?: boolean;
  }) {
    const groups = [...new Set(r.ingredients.map((i) => i.placement))];
    return (
      <div className="b-ingredients">
        {groups.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            {r.ingredients.map((i, index) =>
              i.placement === group ? (
                <label
                  key={index}
                  className={`b-ingredient ${interactive && personal.session?.weighed.includes(index) ? "is-weighed" : ""}`}
                >
                  {interactive && (
                    <input
                      type="checkbox"
                      checked={
                        personal.session?.weighed.includes(index) || false
                      }
                      onChange={() => {
                        const s = personal.session!;
                        save({
                          ...personal,
                          session: {
                            ...s,
                            updatedAt: new Date().toISOString(),
                            weighed: s.weighed.includes(index)
                              ? s.weighed.filter((n) => n !== index)
                              : [...s.weighed, index],
                            confirmed: s.confirmed.filter((n) => n < 1),
                          },
                        });
                      }}
                    />
                  )}
                  <span>{i.name}</span>
                  <strong>{i.quantity || "Unspecified"}</strong>
                </label>
              ) : null,
            )}
          </section>
        ))}
        {!r.ingredients.length && (
          <Notice>
            Ingredient quantities are specified in the source instructions
            below. Read the linked source before preparing.
          </Notice>
        )}
      </div>
    );
  }
  function Notes({ r }: { r: Recipe }) {
    return r.notes.length ? (
      <div className="b-recipe-notes">
        <h3>Before you begin</h3>
        <ul>
          {r.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        <SourceLink source={r.source} />
        {r.extraSources?.map((source, i) => (
          <SourceLink key={i} source={source} />
        ))}
      </div>
    ) : null;
  }
  function Detail({ r }: { r: Recipe }) {
    return (
      <>
        <Link className="b-back" href={href("recipes")}>
          <ArrowLeft size={16} />
          All recipes
        </Link>
        <div className="b-detail-hero">
          <div>
            <p className="b-eyebrow">
              {r.machineRequired === false
                ? "Separate preparation · "
                : r.program
                  ? `Program ${r.program} · `
                  : ""}
              {finishLabels[r.completion]}
            </p>
            <h1 ref={heading}>{r.name}</h1>
            <p className="b-detail-description">
              {r.referenceOnly
                ? "Open the original recipe page for its quantities, settings and method."
                : `A recipe from ${docs[r.source.document].toLowerCase()}, with original quantities and instructions kept close at hand.`}
            </p>
            <SourceLink source={r.source} />
            {r.extraSources?.map((source, i) => (
              <SourceLink key={i} source={source} />
            ))}
            <div className="b-actions">
              <button
                disabled={!ready || r.reviewRequired || r.referenceOnly}
                className="b-primary"
                onClick={() => start(r)}
              >
                {r.referenceOnly
                  ? "Guided checklist under review"
                  : active?.id === r.id
                    ? "Resume guided baking"
                    : "Start guided baking"}
                <ArrowRight size={17} />
              </button>
              <button
                disabled={!ready}
                className="b-secondary"
                onClick={() => favorite(r.id)}
              >
                <Heart
                  size={18}
                  fill={
                    personal.favorites.includes(r.id) ? "currentColor" : "none"
                  }
                />
                {personal.favorites.includes(r.id) ? "Saved" : "Favorite"}
              </button>
            </div>
          </div>
          {r.image && (
            <img
              className="b-detail-photo"
              src={r.image}
              alt={r.imageAlt || r.name}
            />
          )}
        </div>
        {r.reviewRequired && (
          <Notice>
            <strong>Source clarification needed.</strong> The supplied English
            translation contains an unresolved quantity or instruction. Verify
            the highlighted issue against the Japanese original before using
            this recipe. {(r.verificationNotes || []).join(" ")}
          </Notice>
        )}
        {r.referenceOnly ? (
          <section className="b-source-library">
            <h2>Follow the original recipe</h2>
            <p>
              This recipe is in your collection. Its extracted ingredient
              checklist and guided steps are still under review. Use the linked
              original page for quantities, settings and the complete method.
            </p>
            <SourceLink source={r.source} />
            <iframe
              className="b-source-preview"
              title={`${r.name}: original source page`}
              src={`/bistro/sources/${r.source.document}.pdf#page=${r.source.pdfPage}`}
              loading="lazy"
            />
            <p className="b-small">
              If your browser cannot display the PDF here, use the source link
              above.
            </p>
          </section>
        ) : (
          <>
            <div className="b-facts">
              <div>
                <span>Documented yield</span>
                <strong>{r.yield || "Unspecified"}</strong>
              </div>
              <div>
                <span>Machine cycle</span>
                <strong>{r.machineTime || "Unspecified"}</strong>
              </div>
              <div>
                <span>Preparation / resting / oven</span>
                <strong>{r.otherTime || "Unspecified"}</strong>
              </div>
            </div>
            <div className="b-detail-grid">
              <aside>
                <h2>Ingredients</h2>
                <p className="b-muted">
                  Exact source quantities. No automatic scaling.
                </p>
                {Ingredients({ r })}
                <div className="b-equipment">
                  <h3>Blade & equipment</h3>
                  {r.blade && <p>{r.blade}</p>}
                  {r.equipment?.length ? (
                    <ul>
                      {r.equipment.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      Use the blade and equipment specified in the instructions
                      below. Other equipment: unspecified.
                    </p>
                  )}
                </div>
              </aside>
              <div>
                {Notes({ r })}
                <h2>The method</h2>
                <ol className="b-method">
                  {r.steps.map((step, i) => (
                    <li key={i}>
                      <span className="b-step-number">{i + 1}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <SourceLink source={r.source} />
                {r.extraSources?.map((source, i) => (
                  <SourceLink key={i} source={source} />
                ))}
                {r.sourceText && (
                  <details className="b-disclosure">
                    <summary>Read the source transcription</summary>
                    <p className="b-source-text">{r.sourceText}</p>
                  </details>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }
  function Bake() {
    const s = personal.session;
    const r = active;
    if (!s || !r)
      return (
        <>
          <div className="b-page-title">
            <p className="b-eyebrow">One step at a time</p>
            <h1>Let’s bake something good.</h1>
            <p>
              Choose a recipe to begin. Your checklist and confirmed steps will
              be saved in this browser.
            </p>
          </div>
          <Empty
            title="Your next bake starts here"
            text="No baking session in progress. Find a recipe, gather your ingredients, and we’ll keep your place."
          />
        </>
      );
    const steps = [
      {
        title: "Get ready",
        text:
          r.machineRequired === false
            ? "Read the recipe notes and measure the listed ingredients. This recipe uses prepared ingredients and does not require a bread-machine cycle."
            : "Read the recipe notes and source instructions below. Measure ingredients accurately with a digital scale (1 g increments or smaller). Use a stable surface, keep the appliance clear of walls and furniture, and use a dedicated 100 V AC outlet rated at 15 A or higher.",
      },
      {
        title: "Weigh your ingredients",
        text: "Weigh each exact quantity, observing all temperature and conditional instructions below. Check off each ingredient as you prepare it. Keep reserved additions separate.",
      },
      ...r.steps,
      {
        title: "Finish & care",
        text:
          r.machineRequired === false
            ? "Confirm that the mixing and serving instructions are complete. Clean the utensils used for this recipe."
            : "Confirm that all finishing instructions above are complete. Unplug the appliance and allow it to cool before cleaning. Do not immerse the appliance in water. Follow the cleaning instructions linked below for the pan, blade and dispensers.",
      },
    ];
    const current = steps[Math.min(s.step, steps.length - 1)];
    const allWeighed = r.ingredients.every((_, i) => s.weighed.includes(i));
    const last = s.step === steps.length - 1;
    const completeBefore = steps
      .slice(0, -1)
      .every((_, i) => s.confirmed.includes(i));
    function advance() {
      if (!s) return;
      const confirmed = [...new Set([...s.confirmed, s.step])];
      if (last) {
        const entry: Entry = {
          id: crypto.randomUUID(),
          recipeId: r!.id,
          completedAt: new Date().toISOString(),
          notes: "",
        };
        if (
          // eslint-disable-next-line react-hooks/refs -- advance is a click handler; save updates the latest persisted state.
          save({
            ...personal,
            history: [entry, ...personal.history],
            session: null,
          })
        ) {
          router.push(href("my-baking"));
          setMessage("Bake completed and saved to your history.");
        }
      } else
        save({
          ...personal,
          session: {
            ...s,
            confirmed,
            step: s.step + 1,
            updatedAt: new Date().toISOString(),
          },
        });
    }
    return (
      <>
        <div className="b-bake-top">
          <div>
            <p className="b-eyebrow">
              Guided baking ·{" "}
              {r.machineRequired === false
                ? "Mix separately"
                : `Program ${r.program}`}
            </p>
            <h1>{r.name}</h1>
          </div>
          <Link className="b-text-link" href={href("recipes", r.id)}>
            Recipe details
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="b-session-note">
          <CheckCircle2 size={16} />
          Progress saved on this device. The website does not control or monitor
          your machine.
        </div>
        <div className="b-bake-layout">
          <aside className="b-step-nav" aria-label="Baking steps">
            {steps.map((step, i) => (
              <button
                key={i}
                aria-current={i === s.step ? "step" : undefined}
                disabled={
                  i > s.step &&
                  !steps.slice(0, i).every((_, n) => s.confirmed.includes(n))
                }
                onClick={() =>
                  save({
                    ...personal,
                    session: {
                      ...s,
                      step: i,
                      updatedAt: new Date().toISOString(),
                    },
                  })
                }
              >
                <span>
                  {s.confirmed.includes(i) ? (
                    <Check size={14} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span>{step.title}</span>
              </button>
            ))}
          </aside>
          <section className="b-current-step">
            <p className="b-eyebrow">
              Step {s.step + 1} of {steps.length}
            </p>
            <h2 tabIndex={-1}>{current.title}</h2>
            <p className="b-step-copy">{current.text}</p>
            {s.step === 0 && r.machineRequired !== false && (
              <>
                <Notice>
                  Do not touch the steam vent or hot parts. Use dry oven mitts
                  when handling the hot pan. Always measure ingredients and
                  select the program correctly.
                </Notice>
                <SourceLink
                  source={{ document: "manual", page: 4, pdfPage: 3 }}
                />
              </>
            )}
            {s.step === 1 && Ingredients({ r, interactive: true })}
            {s.step <= 1 && Notes({ r })}{" "}
            {s.step > 1 && !last && r.machineRequired !== false && (
              <>
                <Notice>
                  Follow the machine’s display and beeps. Website progress is
                  only a checklist; it is not a live machine status or a machine
                  alert.
                </Notice>
                {Notes({ r })}
                <details className="b-disclosure">
                  <summary>Machine controls</summary>
                  <p>
                    English labels from the supplied manual. Japanese button
                    labels are unverified because the Japanese original was not
                    supplied.
                  </p>
                  <img
                    className="b-controls"
                    src="/bistro/images/controls.webp"
                    alt="Original English control-panel diagram from instruction manual printed page 7"
                  />
                  <SourceLink
                    source={{ document: "manual", page: 7, pdfPage: 4 }}
                  />
                </details>
              </>
            )}
            {last && (
              <>
                <Link className="b-text-link" href={href("help") + "&q=clean"}>
                  Open cleaning instructions
                  <ArrowRight size={16} />
                </Link>
                <SourceLink
                  source={{ document: "manual", page: 86, pdfPage: 44 }}
                />
              </>
            )}
            <div className="b-step-source">
              <SourceLink
                source={
                  s.step < 2
                    ? { document: "manual", page: 12, pdfPage: 7 }
                    : last
                      ? { document: "manual", page: 86, pdfPage: 44 }
                      : r.source
                }
              />
            </div>
            {s.step === 1 && !allWeighed && (
              <p className="b-muted">
                Check every ingredient before continuing.
              </p>
            )}
            {last && !completeBefore && (
              <p className="b-muted">
                Confirm every earlier step before recording this bake as
                complete.
              </p>
            )}
            <div className="b-step-actions">
              <button
                className="b-secondary"
                disabled={s.step === 0}
                onClick={() =>
                  save({ ...personal, session: { ...s, step: s.step - 1 } })
                }
              >
                <ArrowLeft size={16} />
                Back
              </button>
              <button
                className="b-primary"
                disabled={
                  !ready ||
                  (s.step === 1 && !allWeighed) ||
                  (last && !completeBefore)
                }
                onClick={advance}
              >
                {last
                  ? "I’ve finished this bake"
                  : s.step === 0
                    ? "I’m ready"
                    : s.step === 1
                      ? "Ingredients are ready"
                      : "I’ve completed this step"}
                <Check size={17} />
              </button>
            </div>
            <p className="b-small">
              Confirm only after you have performed the action on your machine
              or in your kitchen.
            </p>
          </section>
        </div>
        <button
          className="b-text-link b-danger"
          onClick={() => setDeleteId("session")}
        >
          Discard this session
        </button>
      </>
    );
  }
  async function upload(entry: Entry, file: File) {
    setBusy(true);
    try {
      const blob = await preparePhoto(file);
      const id = crypto.randomUUID();
      await photoStore("put", id, blob);
      const currentPersonal = latestPersonal.current;
      const currentEntry = currentPersonal.history.find(
        (e) => e.id === entry.id,
      );
      if (!currentEntry) {
        await photoStore("delete", id);
        return;
      }
      if (
        save({
          ...currentPersonal,
          history: currentPersonal.history.map((e) =>
            e.id === entry.id ? { ...e, photoId: id } : e,
          ),
        })
      ) {
        if (currentEntry.photoId)
          await photoStore("delete", currentEntry.photoId);
      } else await photoStore("delete", id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save photo.");
    } finally {
      setBusy(false);
    }
  }
  async function deleteEntry() {
    if (deleteId === "session") {
      save({ ...personal, session: null });
      setDeleteId(null);
      return;
    }
    const entry = personal.history.find((e) => e.id === deleteId);
    if (!entry) return;
    if (
      save({
        ...personal,
        history: personal.history.filter((e) => e.id !== deleteId),
      })
    ) {
      if (entry.photoId)
        await photoStore("delete", entry.photoId).catch(() => {});
      setDeleteId(null);
    }
  }
  const normalized = (v: string) =>
    v
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "");
  const shown = recipes.filter(
    (r) =>
      (!guidedOnly || (!r.referenceOnly && !r.reviewRequired)) &&
      (filter === "all" || r.completion === filter) &&
      (docFilter === "all" || r.source.document === docFilter) &&
      normalized(
        [
          r.name,
          r.program,
          ...(r.searchIngredients || []),
          ...r.ingredients.map((i) => i.name),
        ].join(" "),
      ).includes(normalized(query)),
  );
  const helpSearch = helpQuery || params.get("q") || "";
  const shownTopics = topics.filter((t) =>
    normalized([t.title, t.text, ...t.keywords].join(" ")).includes(
      normalized(helpSearch),
    ),
  );
  return (
    <div className="bistro">
      <a className="b-skip" href="#b-main">
        Skip to content
      </a>
      <header className="b-header">
        <Link href="/bistro" className="b-brand">
          <span className="b-brand-icon">
            <Wheat size={23} />
          </span>
          <span>
            My Bistro<small>A LITTLE HELP. A LOVELY LOAF.</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.id}
              aria-current={view === n.id ? "page" : undefined}
              href={href(n.id)}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.id === "bake" && active && <i className="b-active-dot" />}
            </Link>
          ))}
        </nav>
        <Link href="/" className="b-bench-link">
          Back to Bench
          <ArrowRight size={13} />
        </Link>
      </header>
      <main id="b-main" className="b-main">
        {storageError && (
          <div role="alert">
            <Notice>{storageError}</Notice>
          </div>
        )}
        {message && (
          <div role="status" className="b-message">
            {message}
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "home" && (
          <>
            <div className="b-home-hero">
              <div className="b-hero-copy">
                <p className="b-eyebrow">
                  <span />
                  YOUR SD-MDX4, MADE SIMPLE
                </p>
                <h1>
                  Good bread.
                  <br />A little less effort.
                </h1>
                <p>
                  Find your recipe, gather the ingredients,
                  <br className="b-desktop-break" /> and take it one step at a
                  time.
                </p>
                <Link className="b-primary" href={href("recipes")}>
                  Find your next bake
                  <ArrowRight size={18} />
                </Link>
                <div className="b-hero-foot">
                  <BookOpen size={15} />
                  Grounded in your Panasonic manuals
                </div>
              </div>
              <div className="b-hero-image">
                <img
                  src="/bistro/images/hero.webp"
                  alt="Bread from the supplied Panasonic recipe collection"
                  fetchPriority="high"
                />
                <div className="b-hero-caption">
                  <span>THE EVERYDAY RITUAL</span>
                  <p>Freshly baked. Entirely yours.</p>
                </div>
              </div>
            </div>
            {Resume()}
            <div className="b-section-heading">
              <div>
                <p className="b-eyebrow">A GOOD PLACE TO BEGIN</p>
                <h2>Something for your table</h2>
              </div>
              <Link className="b-text-link" href={href("recipes")}>
                All recipes
                <ArrowRight size={16} />
              </Link>
            </div>
            {Cards({
              items:
                recipes.filter((r) =>
                  [
                    "manual-pain-de-mie",
                    "manual-brioche",
                    "book-pizza-19",
                  ].includes(r.id),
                ).length === 3
                  ? recipes.filter((r) =>
                      [
                        "manual-pain-de-mie",
                        "manual-brioche",
                        "book-pizza-19",
                      ].includes(r.id),
                    )
                  : recipes.slice(0, 3),
            })}
            <div className="b-home-bottom">
              <section>
                <div className="b-section-heading">
                  <h2>Your favorites</h2>
                  <Heart size={19} />
                </div>
                {favorites.length ? (
                  Cards({ items: favorites.slice(0, 3) })
                ) : (
                  <Empty
                    title="Make yourself at home"
                    text="Tap the heart on a recipe to keep it here for next time."
                  />
                )}
              </section>
              <section className="b-help-callout">
                <span className="b-icon-circle">
                  <Wrench size={24} />
                </span>
                <p className="b-eyebrow">A LITTLE REASSURANCE</p>
                <h2>
                  Here to help,
                  <br />
                  from first loaf to last crumb.
                </h2>
                <p>
                  Machine controls, care instructions and answers from your
                  manual.
                </p>
                <Link className="b-text-link" href={href("help")}>
                  Help & Care
                  <ArrowRight size={17} />
                </Link>
              </section>
            </div>
            {recent.length > 0 && (
              <>
                <div className="b-section-heading">
                  <h2>Recently baked</h2>
                  <Link className="b-text-link" href={href("my-baking")}>
                    Your baking history
                    <ArrowRight size={16} />
                  </Link>
                </div>
                {Cards({ items: recent })}
              </>
            )}
          </>
        )}
        {view === "recipes" &&
          (selected ? (
            Detail({ r: selected })
          ) : (
            <>
              <div className="b-page-title">
                <p className="b-eyebrow">THE RECIPE COLLECTION</p>
                <h1>What will you make today?</h1>
                <p>
                  Browse your manual collection, or choose a checked guided
                  recipe.
                </p>
              </div>
              <div className="b-search">
                <Search size={20} />
                <input
                  aria-label="Search recipes"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a recipe or ingredient…"
                />
                {query && (
                  <button
                    aria-label="Clear recipe search"
                    onClick={() => setQuery("")}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="b-filters">
                <label>
                  <input
                    type="checkbox"
                    checked={guidedOnly}
                    onChange={(e) => setGuidedOnly(e.target.checked)}
                  />{" "}
                  Guided recipes only
                </label>
                <div role="group" aria-label="Filter by finish">
                  {[
                    ["all", "All recipes"],
                    ["machine", "In the machine"],
                    ["oven", "External oven"],
                    ["dough", "Dough"],
                    ["separate", "Other cooking"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={filter === id}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  <Settings2 size={16} />
                  <select
                    aria-label="Source document"
                    value={docFilter}
                    onChange={(e) => setDocFilter(e.target.value)}
                  >
                    <option value="all">All source documents</option>
                    {Object.entries(docs).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="b-results-label">
                {shown.length} {shown.length === 1 ? "recipe" : "recipes"}
                <span>
                  Machine cycle times shown · other preparation listed in each
                  recipe
                </span>
              </div>
              {shown.length ? (
                Cards({ items: shown })
              ) : (
                <div className="b-empty">
                  <Search size={27} />
                  <h2>No recipes found</h2>
                  <p>
                    Try a different name or ingredient, or clear the filters.
                  </p>
                  <button
                    className="b-secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setDocFilter("all");
                      setGuidedOnly(false);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <p className="b-small">
                English source names are searchable. Japanese names and button
                labels are not included because the Japanese originals were not
                supplied. Recipes requiring clarification are marked.
              </p>
            </>
          ))}
        {view === "bake" && Bake()}
        {view === "help" && (
          <>
            <div className="b-page-title">
              <p className="b-eyebrow">HELP & CARE</p>
              <h1>A little guidance goes a long way.</h1>
              <p>
                Find an error code, troubleshoot a loaf, or keep your machine
                ready for the next bake.
              </p>
            </div>
            <div className="b-search">
              <Search size={20} />
              <input
                aria-label="Search help"
                placeholder="Try “U50”, “not rising” or “clean”…"
                value={helpSearch}
                onChange={(e) => {
                  setHelpQuery(e.target.value);
                  if (params.get("q")) router.replace(href("help"));
                }}
              />
            </div>
            <div className="b-help-shortcuts">
              {["clean", "control", "rise", "U50"].map((q) => (
                <button
                  key={q}
                  className="b-secondary"
                  onClick={() => setHelpQuery(q)}
                >
                  {q === "clean"
                    ? "Cleaning"
                    : q === "control"
                      ? "Machine controls"
                      : q === "rise"
                        ? "Bread appearance"
                        : q}
                </button>
              ))}
              <button
                className="b-text-link"
                onClick={() => {
                  setHelpQuery("");
                  router.replace(href("help"));
                }}
              >
                Show all
              </button>
            </div>
            <div className="b-help-list">
              {shownTopics.map((t) => (
                <details key={t.id} className="b-help-topic">
                  <summary>
                    {t.title}
                    <ChevronRight size={18} />
                  </summary>
                  <p className="b-source-text">{t.text}</p>
                  {/control|panel/i.test(t.title) && (
                    <>
                      <img
                        className="b-controls"
                        src="/bistro/images/controls.webp"
                        alt="English control-panel diagram from the supplied manual"
                      />
                      <p>
                        Japanese button labels are unverified; Japanese
                        originals were not supplied.
                      </p>
                    </>
                  )}
                  <SourceLink source={t.source} />
                </details>
              ))}
              {!shownTopics.length && (
                <div className="b-empty">
                  <h3>No matching guidance</h3>
                  <p>
                    Try a shorter phrase or open the instruction manual below.
                  </p>
                </div>
              )}
            </div>
            <div className="b-source-library">
              <h2>Your source documents</h2>
              <p>
                These copies preserve the supplied English text; images are
                optimized for the web. Printed pages differ from PDF page
                numbers.
              </p>
              {Object.entries(docs).map(([id, label]) => (
                <a
                  key={id}
                  href={`/bistro/sources/${id}.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BookOpen size={21} />
                  <div>
                    <strong>{label}</strong>
                    <span>SD-MDX4 · English PDF</span>
                  </div>
                  <ExternalLink size={17} />
                </a>
              ))}
            </div>
          </>
        )}
        {view === "my-baking" && (
          <>
            <div className="b-page-title">
              <p className="b-eyebrow">YOUR KITCHEN NOTEBOOK</p>
              <h1>My Baking</h1>
              <p>
                The recipes you love, the loaves you’ve made, and a few notes
                for next time.
              </p>
            </div>
            {Resume()}
            <div className="b-section-heading">
              <h2>Favorite recipes</h2>
              <span>{favorites.length} saved</span>
            </div>
            {favorites.length ? (
              Cards({ items: favorites })
            ) : (
              <Empty
                title="A place for your favorites"
                text="Save recipes with the heart button. They’ll be waiting here."
              />
            )}
            <div className="b-section-heading">
              <h2>Baking history</h2>
              <span>Only bakes you confirm as complete</span>
            </div>
            {personal.history.length ? (
              <div className="b-history">
                {personal.history.map((entry) => {
                  const r = recipeById(entry.recipeId);
                  return (
                    <article key={entry.id} className="b-history-entry">
                      <div className="b-history-heading">
                        <div>
                          <p className="b-eyebrow">
                            {new Date(entry.completedAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              },
                            )}
                          </p>
                          <h3>{r?.name || "Recipe unavailable"}</h3>
                        </div>
                        <button
                          className="b-icon-button"
                          aria-label={`Delete ${r?.name || "baking"} entry`}
                          onClick={() => setDeleteId(entry.id)}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                      <label className="b-note-label">
                        Your personal notes & modifications
                        <span>
                          Separate from Panasonic’s original instructions
                        </span>
                        <textarea
                          aria-label={`Personal notes for ${r?.name}`}
                          placeholder="How did it turn out? What would you like to remember?"
                          value={entry.notes}
                          onChange={(e) =>
                            save({
                              ...personal,
                              history: personal.history.map((item) =>
                                item.id === entry.id
                                  ? { ...item, notes: e.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      {entry.photoId && (
                        <Photo
                          id={entry.photoId}
                          alt={`Your result: ${r?.name}`}
                        />
                      )}
                      <div className="b-actions">
                        <label className="b-upload">
                          <Camera size={17} />
                          {busy
                            ? "Saving photo…"
                            : entry.photoId
                              ? "Replace result photo"
                              : "Add a result photo"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void upload(entry, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {entry.photoId && (
                          <button
                            className="b-text-link"
                            onClick={async () => {
                              if (
                                save({
                                  ...personal,
                                  history: personal.history.map((item) =>
                                    item.id === entry.id
                                      ? { ...item, photoId: undefined }
                                      : item,
                                  ),
                                })
                              )
                                await photoStore(
                                  "delete",
                                  entry.photoId!,
                                ).catch(() => {});
                            }}
                          >
                            Remove photo
                          </button>
                        )}
                        {r && (
                          <Link
                            className="b-text-link"
                            href={href("recipes", r.id)}
                          >
                            Original recipe
                            <ArrowRight size={15} />
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Your first bake belongs here"
                text="Complete a guided bake to start your history. Nothing is added until you confirm it’s finished."
              />
            )}
            <p className="b-small">
              Favorites, progress, notes and photos stay in this browser on this
              device. Clearing browser data removes them. There is no account
              sync.
            </p>
          </>
        )}
        {!["home", "recipes", "bake", "help", "my-baking"].includes(view) && (
          <Empty
            title="Page not found"
            text="Choose a section from the navigation to continue."
          />
        )}
      </main>
      <footer className="b-footer">
        <div className="b-footer-brand">
          <Wheat size={21} />
          <span>My Bistro</span>
          <span>Made for everyday baking.</span>
        </div>
        <p>
          An independent personal companion for the Panasonic Bistro SD-MDX4.
          <br />
          Not affiliated with Panasonic. No remote control or live machine
          monitoring.
        </p>
        <Link href={href("help")}>
          Sources & care
          <ArrowRight size={14} />
        </Link>
      </footer>
      {(replaceId || deleteId) && (
        <div className="b-modal-backdrop" role="presentation">
          <section
            className="b-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="b-dialog-title"
          >
            <h2 id="b-dialog-title">
              {replaceId
                ? "Replace your unfinished session?"
                : deleteId === "session"
                  ? "Discard this session?"
                  : "Delete this baking entry?"}
            </h2>
            <p>
              {replaceId
                ? "Your current checklist will be removed. Completed baking history is kept."
                : deleteId === "session"
                  ? "This removes the saved checklist. It does not stop your bread maker."
                  : "This permanently removes the personal notes and result photo for this entry."}
            </p>
            <div className="b-actions">
              <button
                autoFocus
                className="b-secondary"
                onClick={() => {
                  setReplaceId(null);
                  setDeleteId(null);
                }}
              >
                Keep it
              </button>
              <button
                className="b-primary"
                onClick={() =>
                  replaceId ? createSession(replaceId) : void deleteEntry()
                }
              >
                {replaceId ? "Start new session" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
