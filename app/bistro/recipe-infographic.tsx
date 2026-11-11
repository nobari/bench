import { AlertTriangle, BookOpen, Clock3, CookingPot, ListOrdered, Scale, Settings2 } from "lucide-react";
import type { Recipe } from "@/lib/bistro/types";

const finish = {
  machine: "Completed in the machine",
  oven: "Separate oven required",
  separate: "Separate preparation or cooking",
  dough: "Dough preparation · follow the documented finishing steps",
};
const documents = { manual: "Instruction manual", recipes: "Recipe book", menu: "Menu sheet" };

/** Uses the same reviewed, evidence-adjusted recipe as the detailed method. */
export function RecipeInfographic({ recipe: r }: { recipe: Recipe }) {
  const blocked = r.referenceOnly || r.reviewRequired || !r.steps.length;
  const groups = new Map<string, Recipe["ingredients"]>();
  for (const ingredient of r.ingredients) {
    const placement = ingredient.placement || "Placement not specified";
    groups.set(placement, [...(groups.get(placement) || []), ingredient]);
  }
  const sources = [r.source, ...(r.extraSources || [])].filter((source, index, all) =>
    all.findIndex(other => other.document === source.document && other.page === source.page && other.pdfPage === source.pdfPage) === index);
  return (
    <section className="b-infographic" aria-labelledby="cooking-guide-title" id="cooking-guide">
      <header className="b-infographic-heading">
        <div><p className="b-eyebrow">Your visual recipe guide</p><h2 id="cooking-guide-title">How to make {r.name}</h2></div>
        <span className="b-infographic-finish"><CookingPot aria-hidden="true" size={20} />{finish[r.completion]}</span>
      </header>
      {blocked ? (
        <div className="b-infographic-blocked">
          <AlertTriangle aria-hidden="true" size={28} />
          <div><h3>Cooking guide awaiting source clarification</h3><p>A complete cooking sequence is unavailable for this recipe. Resolve these source dependencies before cooking.</p>
            <ul>{(r.verificationNotes?.length ? r.verificationNotes : ["The documented quantities or method still require review. Consult the original source below."]).map((note, i) => <li key={i}>{note}</li>)}</ul>
          </div>
        </div>
      ) : (
        <>
          <dl className="b-infographic-facts">
            {r.yield && <div><dt><Scale aria-hidden="true" size={18} />Yield</dt><dd>{r.yield}</dd></div>}
            {r.machineRequired !== false && r.program && <div><dt><Settings2 aria-hidden="true" size={18} />Program</dt><dd>{r.program}</dd></div>}
            {r.machineTime && <div><dt><Clock3 aria-hidden="true" size={18} />Machine cycle</dt><dd>{r.machineTime}</dd></div>}
            {r.otherTime && <div><dt><Clock3 aria-hidden="true" size={18} />Other preparation / finishing</dt><dd>{r.otherTime}</dd></div>}
          </dl>
          <p className="b-infographic-caption">Machine cycle time is not total preparation time. Quantities are preserved as documented; follow all conditions below.</p>
          <div className="b-infographic-layout">
            <aside className="b-infographic-prep" aria-label="Ingredients and equipment for the visual guide">
              <h3><Scale aria-hidden="true" size={22} />Measure & separate</h3>
              <p>Keep ingredients in their documented placement groups. Follow the method for when to add them.</p>
              {Array.from(groups, ([placement, ingredients]) => (
                <section className="b-infographic-ingredients" key={placement}>
                  <h4>{placement}</h4>
                  <ul>{ingredients.map((ingredient, index) => <li key={index}><span>{ingredient.name}</span><strong>{ingredient.quantity}</strong></li>)}</ul>
                </section>
              ))}
              {(r.blade || r.equipment?.length) && <section className="b-infographic-equipment"><h4>Equipment</h4><ul>{r.blade && <li>{r.blade}</li>}{r.equipment?.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
            </aside>
            <div className="b-infographic-method">
              <h3><ListOrdered aria-hidden="true" size={22} />Follow the sequence</h3>
              <ol className="b-infographic-flow">{r.steps.map((step, index) => (
                <li key={index}><span className="b-infographic-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div className="b-infographic-step"><h4>{step.title}</h4><p>{step.text}</p></div></li>
              ))}</ol>
            </div>
          </div>
          {r.notes.length > 0 && <section className="b-infographic-conditions"><h3><AlertTriangle aria-hidden="true" size={22} />Conditions & recipe notes</h3><ul>{r.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></section>}
        </>
      )}
      <footer className="b-infographic-sources"><BookOpen aria-hidden="true" size={19} /><span>Guide sources:</span>{sources.map(source => <a key={`${source.document}-${source.page}-${source.pdfPage}`} href={`/bistro/sources/${source.document}.pdf#page=${source.pdfPage}`} target="_blank" rel="noreferrer">{documents[source.document]} · p. {source.page}<span className="b-sr-only"> (opens in a new tab)</span></a>)}</footer>
    </section>
  );
}
