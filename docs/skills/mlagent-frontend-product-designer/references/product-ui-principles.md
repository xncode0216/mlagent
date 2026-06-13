# Product UI Principles for MLAgent

## Source-Informed Foundations

This reference distills stable, broadly accepted frontend UI practice from Material Design, Apple HIG, Nielsen Norman Group heuristics, WCAG, Fluent, Carbon, Atlassian, and web.dev responsive/accessibility guidance. Use it as a design lens, not as a component library.

## Core Product Heuristics

- Visibility of system status: show connection, project, active file, task progress, GPU/resource state, and artifact creation in the right place.
- Match the user's mental model: data analysis, ML training, and knowledge evolution should each have a clear workflow path.
- User control and freedom: provide cancel, retry, refresh, select, and switch-back paths for long-running or cross-panel actions.
- Consistency and standards: reuse existing rail, tabs, tables, panels, buttons, icons, and status language.
- Error prevention and recovery: validate before destructive actions; keep failures local and actionable.
- Recognition over recall: surface files, experiments, lessons, artifacts, and logs as clickable records instead of asking users to remember IDs.
- Flexibility and efficiency: support direct navigation from graph evidence, activity lists, artifacts, and status context.
- Aesthetic minimalism: remove decorative excess; keep operational density organized with hierarchy, spacing, dividers, and active states.

## Product-Grade App Patterns

### Navigation

- Keep major modes globally visible.
- Keep local task views as tabs or segmented controls.
- Keep object selection persistent enough for cross-panel actions: active project, active file, selected run, selected lesson, selected graph node.
- Cross-surface navigation should both switch context and highlight the destination object.

### Workbench Layout

- Left: navigation and object lists.
- Center: task execution and conversation/workspace.
- Right: inspection, metrics, artifacts, logs, and details.
- Bottom: status and environment facts.
- Avoid giant empty sections; useful operational data should appear above the fold.

### Forms and Commands

- Put labels next to inputs and preserve explicit target fields.
- Use disabled states only while an action is unsafe or impossible.
- Show async progress near the command.
- Prefer "refresh", "cancel", "retry", "open", "locate", and "view details" commands over vague verbs.
- Make destructive actions visually distinct and confirm when recovery is hard.

### Tables and Lists

- Use tables for run comparisons, artifacts, files, and audit logs.
- Keep columns stable; avoid row height jumps on selection.
- Show selected rows with more than color: border, inset stripe, icon, or note.
- Put details below or beside the selected table, not in popovers that hide context.
- Long IDs and paths must wrap or truncate with title text.

### Data, ML, and Graph Workflows

- Data: select file -> inspect/profile -> clean/report -> artifact -> handoff.
- ML: choose dataset/target/resource -> train -> compare metrics -> inspect model/artifacts -> extract lesson.
- Evolution: review lesson -> adopt/reject/conflict -> show injection/audit -> graph evidence -> deep-link to source.
- Graph nodes should expose provenance and actions to canonical objects: file, experiment run, lesson, artifact.

## Visual System Rules

- Use a small set of neutrals for surfaces, borders, and text.
- Use accent colors sparingly for active state or graph semantics.
- Use semantic color for status: success, warning, error, info, running.
- Keep typography compact in panels; reserve large type for true page-level headers.
- Prefer 6-8px radii for workbench controls.
- Do not place cards inside cards. Use bands, sections, dividers, or repeated item cards.
- Avoid decorative gradients, blobs, and generic marketing composition in the app workbench.

## Accessibility and Responsiveness

- Every interactive icon needs an accessible name/title.
- Keyboard users must be able to activate tabs, graph nodes, rail buttons, table rows where clickable, and form controls.
- Focus must be visible.
- Do not depend on hover-only disclosure for essential actions.
- Provide text/status alternatives for color-coded states.
- Maintain readable contrast and target sizes.
- Test narrower viewports for text overflow and overlapping panels.

## Verification Prompts

Ask these before finishing a frontend change:

- What real user task can now be completed?
- Which state changes after each visible control is clicked?
- What happens when data is empty, loading, stale, or failed?
- Where does the generated artifact/run/lesson become inspectable?
- Can a user get back to the source object from the result?
- Can this be understood without reading instructions?
