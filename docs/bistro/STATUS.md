# My Bistro implementation status

Route: `/bistro` in Bench. Production: https://bench.bozmoz.com/bistro.

## Available

- Responsive home, recipe collection, guided baking, Help & Care, and My Baking.
- All 270 catalog entries reviewed against the supplied English sources: 249 guided flows; 21 source-reference entries blocked for specific ambiguities listed in [SOURCE-REVIEW.md](SOURCE-REVIEW.md).
- Browser-local favorites, ingredient checklists, confirmed progress, completed-bake history, personal notes, IndexedDB photos, and deletion confirmation.
- Separate ingredient placement for starters, fillings, late additions, glazing, frying, and manual modes. Recipes requiring no machine have separate preparation instructions.
- Source links distinguish printed pages from PDF pages. The three supplied English PDFs are included unchanged.

## Validation

Seven data/persistence tests, TypeScript, scoped ESLint, and a clean production Webpack build pass. The existing font integration requires `next build --webpack`.

Browser QA passes at 375, 768, 1024, and 1440 px with no horizontal overflow or page errors. Five complete flows cover pain de mie, brioche, pizza, manual-function white bread, and prepared amazake lemon soda. Checks cover ingredient gating, reload/resume, notes, photo upload/reload/removal, deletion and replacement dialogs, keyboard focus, favorites, filters, and blocked recipes. Re-run with `BISTRO_QA_URL=http://localhost:3013/bistro node scripts/check-bistro-browser.cjs` using an installed Chrome browser.

## Remaining source questions

The 21 blocked entries need source clarification; Japanese originals were not supplied. No Japanese machine labels are invented. These checks compare documents and application behavior; they are not physical cooking trials.

Machine state is never inferred from elapsed time. This site cannot start, stop, monitor, or receive alerts from the bread maker.

## Recovery provenance

Recovered application code and images from GitHub blobs and original generation commands. All 150 image files match the earlier commit’s blob hashes. Restored original PDFs instead of the unavailable optimized derivatives. Regenerated the unreviewed recipe-book extraction draft using the original scripts; its file hash differs from the cloud artifact, so it remains unreviewed. Recreated the recovery tests; the prior test file could not be retrieved. Recipe extraction drafts remain unreviewed and are not application inputs.
