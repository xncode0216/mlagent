# MLAgent Agent Rules

## Frontend Optimization Agent

For any task that designs, reviews, implements, or polishes the frontend UI/UX, first use the project skill at:

```text
docs/skills/mlagent-frontend-product-designer/SKILL.md
```

Treat this as the dedicated MLAgent frontend product design agent. It owns product-grade UI decisions for navigation, panels, data/ML workflows, knowledge graph interactions, settings, accessibility, responsive behavior, and visual polish.

Expected workflow:

1. Load `mlagent-frontend-product-designer`.
2. Read the relevant product plan/progress docs and affected React/CSS/API files.
3. Implement one testable, product-usable vertical slice.
4. Verify with frontend lint/tests/build and browser QA when visible UI changes.
5. Update project progress/planning docs when behavior or priorities change.

