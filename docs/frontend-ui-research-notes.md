# Frontend UI Research Notes

Date: 2026-05-24

## Sources Reviewed

- Material Design 3: foundations for layout, interaction, navigation, motion, color, and accessibility.
- Apple Human Interface Guidelines: clarity, deference to content, feedback, consistency, navigation, and platform conventions.
- Nielsen Norman Group: ten usability heuristics, especially visibility of system status, user control, error prevention, and recognition over recall.
- W3C WCAG 2.2: perceivable, operable, understandable, robust interfaces; focus visibility, labels, contrast, keyboard access, and target sizing.
- Microsoft Fluent 2: coherent product systems, accessibility, cross-platform behavior, and interaction patterns.
- IBM Carbon Design System: enterprise UI shell, data tables, forms, dense operational dashboards, and status-heavy product surfaces.
- Atlassian Design System: product navigation, content clarity, interaction feedback, and pragmatic component use.
- web.dev: responsive design and accessibility fundamentals for robust web apps.

## Distilled Practice for MLAgent

MLAgent should behave like a professional AI/data/ML workbench, not a marketing site:

- Start with the task surface: project, active file, mode, workspace, contextual results, and status.
- Close visible controls end-to-end. A button should select, navigate, mutate, refresh, cancel, retry, or explain its staged state.
- Make source and result objects inspectable: files, runs, lessons, artifacts, graph nodes, logs, and GPU tasks.
- Keep dense layouts calm through consistent spacing, panels, dividers, active states, and typography scale.
- Use direct navigation between related objects: graph evidence to file/run, experiment list to run detail, artifacts to file preview.
- Give users clear feedback: loading, empty, selected, success, warning, error, and disabled states.
- Preserve accessibility: semantic controls, accessible icon labels, keyboard activation, visible focus, and non-color-only states.

## Project Asset Created

The distilled knowledge is now captured as the project skill:

```text
docs/skills/mlagent-frontend-product-designer/SKILL.md
```

Detailed principles live in:

```text
docs/skills/mlagent-frontend-product-designer/references/product-ui-principles.md
```

The project-level agent rule is in:

```text
AGENTS.md
```

