# Matt Pocock Skills Integration

MLAgent has installed selected skills from `mattpocock/skills` into the local Codex skills directory:

- `setup-matt-pocock-skills`
- `grill-with-docs`
- `tdd`
- `diagnose`
- `improve-codebase-architecture`
- `zoom-out`
- `handoff`
- `write-a-skill`
- `review` (experimental upstream bucket)

Codex must be restarted before these newly installed skills appear in the runtime skill list.

## Mapped Self-Evolution Protocols

These skills are not copied blindly into the product. Their engineering mechanics are mapped into MLAgent evolution protocols exposed by:

```text
GET /api/projects/{project_id}/evolution/protocols
```

The current built-in protocol set is:

| Protocol | Source skill | Purpose |
|---|---|---|
| `grill-with-docs` | `grill-with-docs` | Clarify fuzzy data/ML tasks and preserve resolved terminology. |
| `diagnose-loop` | `diagnose` | Build a reproducible feedback loop before fixing failed analysis, training, or UI flows. |
| `tdd-vertical-slice` | `tdd` | Add tools and workflow capabilities one behavior-tested vertical slice at a time. |
| `two-axis-review` | `review` | Review Agent outputs separately for project standards and original task intent. |
| `architecture-deepening` | `improve-codebase-architecture` | Detect shallow modules, repeated failures, and weak seams from historical tasks. |
| `handoff-compression` | `handoff` | Compact long-running project context for next-session continuation. |

## Product Rule

The evolution Agent may recommend or inject these protocols, but it should not automatically mutate prompts, tools, or project rules without review. Stable protocols can be injected into default Agent context. Experimental protocols should remain visible in the UI and require explicit adoption.
