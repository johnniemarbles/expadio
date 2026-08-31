# Mandatory Pre-Task Remote Sync Protocol

Before executing any user task, code edit, proposal review, or test run:

1. **Check Remote State**:
   - Always run `git fetch --all --prune` to check for incoming commits or branches from `origin`.
2. **Synchronize Local Branch**:
   - Ensure the working branch is cleanly aligned with `origin/main` (or the respective remote tracking branch) before beginning work.
3. **Verify Clean Working Tree**:
   - Confirm `git status` before making edits or branching to prevent accidental drift or merge conflicts.
