import evidence from "./book-evidence.json";
import type { Recipe } from "./types";

type Evidence = {
  blocks: string[];
  outline?: string[];
  shaping?: boolean;
  gentleMix?: boolean;
  yield?: string;
  referenceText?: string;
};

export const bookEvidence: Record<string, Evidence> = evidence;

export function applyRecipeBookEvidence(recipe: Recipe): Recipe {
  const entry = bookEvidence[recipe.id];
  if (!entry) return recipe;
  return {
    ...recipe,
    yield: entry.yield ?? recipe.yield,
    steps: entry.gentleMix
      ? recipe.steps.map((step) => ({
          ...step,
          text: step.text.replace("Yes ♪ / Normal mixing", "Yes ♪ / Gentle mixing"),
        }))
      : recipe.steps,
  };
}
