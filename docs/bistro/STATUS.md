# My Bistro implementation status

Route: `/bistro`, inside the existing Bench Next.js application. No new hosting project or production deployment has been created.

## Available

- Responsive home, recipe collection, guided baking, Help & Care, and My Baking.
- 270 searchable source-linked catalog entries: 78 instruction-manual recipes/variations, 189 recipe-book entries/variations, 3 menu-sheet recipes.
- Seven checked guided flows: pain de mie, brioche, pizza dough, complete pizza with external oven finishing, and all three Nogami menu-sheet recipes.
- Other catalog entries open the original PDF page. Their unreviewed extracted ingredient lists and methods are deliberately not exposed as cooking instructions.
- Nine recipe-book entries flag translation questions. Japanese originals were not supplied. No guessed Japanese labels or silent correction of source quantities.
- Browser-local favorites, ingredient checklists, confirmed progress, completed-bake history, personal notes, IndexedDB photos, and deletion confirmation.
- Source links distinguish printed pages from PDF pages. The three supplied English PDFs are included unchanged.

## Accuracy and behavior checks

`node --test scripts/check-bistro.mjs` passes five recovery tests covering catalog IDs and guided-flow count, local image/source links, persistence round trips, stale workflow migration, and corrupt/unreviewed-session rejection.

`node node_modules/typescript/bin/tsc --noEmit` checks application types.

Local recovery verification: TypeScript and scoped ESLint pass. Production build passes with `next build --webpack`; the default Turbopack build fails resolving the existing Google font module. Browser smoke checks pass at 375, 768, 1024, and 1440 px with no horizontal overflow or page errors. Starting and reloading the pain-de-mie guided session preserves progress. Desktop and mobile home screenshots were inspected. Full interactive QA below remains outstanding.

## Remaining before the original full scope is complete

1. Check and normalize the remaining 263 recipe flows against the supplied source pages. Pay particular attention to adjacent-column extraction, alternatives, late additions, manual functions, and ingredients prepared separately. Do not blindly enable the retained extraction drafts.
2. Resolve the nine flagged translation issues against Japanese originals if/when available. Keep those recipes blocked from guided baking until resolved.
3. Browser QA at 375, 768, 1024, and 1440 px; keyboard navigation, modal focus, refreshing/resuming, upload/delete, history edits, filtered discovery, and the full three representative bakes.
4. Only then mark the complete recipe experience ready and deploy through the repository's existing hosting workflow.

Machine state is never inferred from elapsed time. This site cannot start, stop, monitor, or receive alerts from the bread maker.

## Recovery provenance

Recovered application code and images from GitHub blobs and original generation commands. All 150 image files match the earlier commit’s blob hashes. Restored original PDFs instead of the unavailable optimized derivatives. Regenerated the unreviewed recipe-book extraction draft using the original scripts; its file hash differs from the cloud artifact, so it remains unreviewed. Recreated the recovery tests; the prior test file could not be retrieved. Recipe extraction drafts remain unreviewed and are not application inputs.
