# Recipe infographic coverage

Every recipe detail page now includes a responsive, source-linked cooking infographic, rendered from the same evidence-adjusted recipe object as its detailed method.

- 270 entries: 78 instruction manual, 189 recipe book, 3 menu sheet.
- 249 cooking guides show documented quantities and ingredient placement groups, equipment, yield, program, separate cycle and other timing fields, ordered method, and all recipe notes.
- 21 unresolved entries show their source clarification notes and citations instead of a cooking sequence. Existing guided-baking restrictions remain intact.
- No quantities, settings, timings, temperatures, or instructions were generated or scaled. Gentle-mixing corrections and evidence-based yield corrections continue to apply.
- Live HTML text supports selection, zoom and screen readers; desktop/tablet use preparation and method columns, mobile stacks them. Source links have 44px minimum touch height.
- Existing photographs, checklists, favorites, personal notes and baking progress remain unchanged.

Validation: rendered all 270 recipe infographics with React server rendering; checked all ingredient names, quantities, placements, ordered step text, notes, and primary source links; confirmed no complete flow for blocked entries. Both changed TSX files passed TypeScript syntax diagnostics.

Unresolved: the existing 21 source dependencies remain unresolved. This release does not claim additional verification against the original Japanese PDF. The visual guide is a presentation of existing reviewed recipe data, not newly inferred cooking instructions.
