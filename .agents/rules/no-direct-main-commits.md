# Git Workflow Guardrail: No Direct Commits to Main

> **CRITICAL INVARIANT**: Never push commits directly to the `main` branch under any circumstances.

## Requirements

1. **Branch Isolation**:
   - Always create a dedicated, descriptive feature branch for any task (e.g. `feat/...`, `fix/...`, `chore/...`).
2. **Pull Request Protocol**:
   - Push feature branches to `origin` and submit changes via GitHub Pull Requests (`gh pr create`).
3. **No Direct `git push origin main`**:
   - Direct pushes to `origin main` are strictly forbidden.
