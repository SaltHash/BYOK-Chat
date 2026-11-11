## agents_storage

Scratch space for agent-produced material, split by what belongs in the repository:

- `agents_storage/screenshots/` — screenshots and other image captures. Ignored by git, never committed.
- `CODEBASE_AUDIT.md`, `FEATURE_AUDIT.md` and `FEATURE_BACKLOG.md` (repository root) — audit notes and the feature list. Tracked and committed like normal documentation.

Put anything meant to survive a clone in the root or another tracked directory; put only throwaway capture output in `agents_storage/screenshots/`.
