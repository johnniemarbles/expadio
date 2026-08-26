# Connecting Agents to GitHub (EXPADIO)

**Repo:** `johnniemarbles/expadio` (private)  
**Goal:** Every participant that writes collaboration docs or code can pull/push (or open PRs) so work stays in sync.

The human owner provisions credentials. No AI can invent access for another product.

---

## Recommended access model

Prefer **fine-grained personal access tokens** or **GitHub App installation** over classic PATs.

| Scope need | Fine-grained permissions |
|------------|---------------------------|
| Read code & docs | Contents: Read |
| Push to branches / open PRs | Contents: Read & write; Pull requests: Read & write |
| Only collaboration docs | Same, optionally limited by path discipline in process (GitHub path-only tokens are limited) |

**Do not** commit tokens into the repo. Store in each agent’s secret store / OS keychain / host env.

---

## Per participant

### Grok (this environment)

Already uses the connected GitHub integration for this account. Continue writing durable output via repo tools; always target current `main` unless a feature branch is named.

### Hermes Agent

1. Install/run Hermes on a host that can reach GitHub (local, VPS, Docker, etc.).
2. Configure git on that host:
   ```bash
   gh auth login
   # or GIT credentials / SSH deploy key with write access
   git clone git@github.com:johnniemarbles/expadio.git
   ```
3. Before every task: `git pull origin main`.
4. After scoped edits: commit with a clear message and `git push` (or open PR if the human requires PRs for all writes).
5. Load `HERMES_COLLABORATION_PROMPT.md` + `SYNC.md` every session.

Optional: Hermes cron → daily “sync report” (see `SYNC.md`).

### Claude

**Claude Code / terminal agent**

1. Human runs `gh auth login` (or sets `GH_TOKEN` / `GITHUB_TOKEN`) in the environment Claude uses.
2. Clone or open `johnniemarbles/expadio`.
3. Session start checklist from `SYNC.md`.
4. Load `CLAUDE_COLLABORATION_PROMPT.md`.

**claude.ai chat only (no tools)**  
Cannot push directly. Human or Hermes must paste Decision trail updates into the repo, or switch to Claude Code / an MCP GitHub server.

### Gemini

1. Use an environment with git + credentials (CLI agent host, Colab with secrets is a poor fit for private push, prefer a real workspace).
2. `gh auth login` or HTTPS token with repo write.
3. Pull → load `GEMINI_COLLABORATION_PROMPT.md` → write suggestion Decision trails or code on a branch → push/PR.

Chat-only Gemini: same limitation as chat-only Claude — durable text must be committed by a connected agent or the human.

### ChatGPT

1. Use an agent/runtime with GitHub tool access (e.g. environment with `gh` and token), or GitHub MCP if configured.
2. Authenticate to `johnniemarbles/expadio`.
3. Pull → `CHATGPT_COLLABORATION_PROMPT.md` → commit Decision trails / PRs.

ChatGPT web without tools: human/Hermes must land the durable write.

### Antigravity (or any other IDE/agent)

Treat as a generic git client:

1. Open the `expadio` clone.
2. Authenticate (SSH deploy key, `gh`, or credential manager).
3. Same pull / prompt / Decision trail / push rules as everyone else.

If Antigravity cannot run git, it is read-only commentary until something else commits.

---

## Human setup checklist (do once)

- [ ] Create a fine-grained PAT or GitHub App for agent use (least privilege).
- [ ] Add Hermes host credentials; verify `git pull` + test branch push.
- [ ] Add Claude Code (or equivalent) `gh auth` on the machine you use for Claude.
- [ ] Add Gemini / ChatGPT only in environments that can actually run git or GitHub API.
- [ ] Tell every agent: **never** embed the token in markdown or source files.
- [ ] Prefer feature branches + PRs for code; collaboration Decision trail updates on `main` are OK if you accept that workflow.

---

## What “directly connect” means here

| Connected | Not connected |
|-----------|----------------|
| Can pull current `main` | Only sees pasted snippets |
| Can update suggestion Decision trails in-repo | Counters only in chat |
| Can open PRs for code | “Done” never appears on GitHub |

Grok and (when configured) Hermes/Claude Code can write. Others become fully direct when the human completes the checklist above for that product.

---

## Related files

- `SYNC.md` — sync rules and anti-patterns
- `OPERATING-MODEL.md` — roles
- `suggestions/README.md` — suggestion format
- `.github/workflows/collaboration-sync.yml` — CI validation
