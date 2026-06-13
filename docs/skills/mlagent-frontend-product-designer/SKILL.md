---
name: mlagent-frontend-product-designer
description: MLAgent-specific frontend product design and optimization skill for product-grade React UI/UX work. Use when Codex designs, reviews, implements, or polishes MLAgent frontend screens, interactions, navigation, sidebars, right panels, data/ML workflows, knowledge graph UI, settings, accessibility, responsive behavior, visual hierarchy, or any frontend change that affects user experience.
---

# MLAgent Frontend Product Designer

## Mission

Turn MLAgent's frontend into a product-grade AI/data/ML workbench: operational, dense but calm, inspectable, accessible, and wired end-to-end. Optimize real workflows before decoration.

For detailed standards, read `references/product-ui-principles.md` when making non-trivial layout, interaction, accessibility, or visual-system decisions.

## Operating Model

Act as the frontend optimization agent for MLAgent. For every frontend-related task:

1. Read current product context: `task_plan.md`, `progress.md`, `design-spec.md`, relevant docs under `docs/`, and the affected React/CSS/API files.
2. Identify the user workflow being improved, not just the component being edited.
3. Map each visible control to a state transition, backend/API contract, route, artifact, or clearly staged placeholder.
4. Implement one testable vertical slice. Prefer real behavior over new chrome.
5. Verify with lint, tests/build when feasible, and browser smoke checks for visible UI changes.
6. Update project progress/plans when the work changes product behavior or follow-up priorities.

## MLAgent UI Shape

Preserve the app-workbench structure unless the task explicitly redesigns it:

- Top nav: product identity, major modes, service/model context.
- Left activity rail and sidebar: project, files, search, data, experiments, knowledge, settings.
- Center workspace: active agent workflow and primary task surface.
- Right panel: contextual artifacts, data preview, training metrics, logs, graph/run details.
- Status bar: connection, project/session, active file, artifacts, GPU/resource state.

Keep controls near their domain: file operations in file/data panels, training controls in ML panels, lesson review in evolution surfaces, runtime settings in settings.

## Design Rules

- Make the first viewport a usable work surface, not a landing page.
- Favor compact, scannable operational UI over hero blocks, nested cards, or decorative panels.
- Use icons for known actions, tabs for view groups, segmented controls for modes, toggles for binary choices, tables for comparisons, and menus for option sets.
- Use clear active, hover, disabled, loading, empty, success, and error states.
- Keep table rows, buttons, code paths, and panel headers stable in size; avoid layout shift.
- Use restrained color: neutral structure, semantic status colors, and sparse accents for attention.
- Avoid one-note palettes, decorative blobs/orbs, marketing-style gradients, and UI cards inside UI cards.
- Fit text inside its container on desktop and mobile; long file paths and IDs must wrap gracefully.
- Prefer direct manipulation and deep links: clicking graph evidence, artifacts, runs, or files should select the canonical object in the app.

## Interaction Workflow

When optimizing a screen:

1. Inventory controls and states.
   - List visible controls mentally: buttons, tabs, form fields, tables, icons, graph nodes, rows.
   - Identify no-op controls and either wire them or make a deliberate staged state.

2. Close the loop.
   - Mutations must refresh affected state: file tree, active file, artifacts, sessions, lessons, runs, logs, GPU status.
   - Generated artifacts should be visible and navigable from the UI.
   - Cross-surface actions should land on the canonical panel and highlight the object.

3. Handle failure.
   - Show errors close to the action that caused them.
   - Preserve successful context when a refresh fails.
   - Disable only the action that is unsafe during async work.

4. Validate accessibility.
   - Preserve keyboard reachability for tabs, graph nodes, activity buttons, dialogs, and form fields.
   - Keep labels, aria labels, focus states, and target sizes meaningful.
   - Do not rely on color alone for selected/error/status states.

5. Verify visually.
   - Use the in-app browser for local frontend QA when available.
   - If full-page screenshot times out, validate DOM state and try a narrower browser/CLI fallback.

## Implementation Preferences

- Follow existing React and CSS patterns before adding abstractions.
- Prefer typed props and small pure helpers for behavior that deserves tests.
- Keep CSS in the existing style system unless a local component already owns scoped styles.
- Add tests for formatters, navigation helpers, rail/panel configs, reducers, and API contracts.
- Use lucide icons already in the project when a familiar icon exists.
- Do not introduce a new UI framework unless the product plan explicitly calls for it.

## Completion Checklist

Before reporting completion, confirm:

- The primary user workflow works from the visible UI.
- No newly visible control is accidentally inert.
- Loading, empty, error, and selected states are present where relevant.
- The layout remains readable at common desktop widths and does not break on narrower widths.
- `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` pass when frontend code changed, or any skipped verification is explained.
- Browser QA covers the changed interaction when a dev server is running.
- Progress/planning docs reflect the new product capability and next step.
