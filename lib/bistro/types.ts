export type Source = {
  document: "manual" | "recipes" | "menu";
  page: number;
  pdfPage: number;
};
export type Ingredient = { name: string; quantity: string; placement: string };
export type Recipe = {
  id: string;
  name: string;
  program: string;
  source: Source;
  ingredients: Ingredient[];
  steps: { title: string; text: string }[];
  notes: string[];
  yield: string;
  completion: "machine" | "oven" | "separate" | "dough";
  machineTime: string;
  otherTime: string;
  image?: string;
  imageAlt?: string;
  verificationNotes?: string[];
  reviewRequired?: boolean;
  referenceOnly?: boolean;
  searchIngredients?: string[];
  sourceText?: string;
  extraSources?: Source[];
  blade?: string;
  equipment?: string[];
  machineRequired?: boolean;
};
export type HelpTopic = {
  id: string;
  title: string;
  keywords: string[];
  text: string;
  source: Source;
};
export type Session = {
  flowVersion?: string;
  id: string;
  recipeId: string;
  startedAt: string;
  updatedAt: string;
  step: number;
  weighed: number[];
  confirmed: number[];
};
export type Entry = {
  id: string;
  recipeId: string;
  completedAt: string;
  notes: string;
  photoId?: string;
};
export type Personal = {
  version: 1;
  favorites: string[];
  session: Session | null;
  history: Entry[];
};
