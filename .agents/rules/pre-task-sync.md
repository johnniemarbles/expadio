# Remote GitHub is the Sole Source of Truth

> **FUNDAMENTAL INVARIANT**: Remote GitHub (`https://github.com/johnniemarbles/expadio.git`) is the authoritative source of truth for the entire EXPADIO platform. Local environments, chat windows, and ephemeral memory are clients.

Before executing any task, code edit, proposal review, or test run:

1. **Check Remote State First**:
   - Always run `git fetch --all --prune` to inspect incoming commits or PR merges from `origin`.
2. **Synchronize Local State to Remote**:
   - Ensure local `main` and working branches are updated to match remote state before any action is taken.
3. **Verify Clean Working Tree**:
   - Confirm `git status` to prevent drift, phantom conflicts, or stale assumptions.
4. **Push Completed Work**:
   - All accepted decisions, implementations, and verified tests must be committed and pushed to remote GitHub to maintain persistent shared memory.
