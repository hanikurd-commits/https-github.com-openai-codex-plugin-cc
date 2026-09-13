---
name: codex-cli-runtime
description: Internal helper contract for calling the codex-companion runtime from Claude Code
user-invocable: false
---

# Codex Runtime

Use this skill only inside the `codex:codex-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct Codex CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `codex:codex-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gpt-5-4-prompting` skill to rewrite the user's request into a tighter Codex prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `--effort` unset unless the user explicitly requests a specific effort.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.
- Map `spark` to `--model gpt-5.3-codex-spark`.
- Default to a write-capable Codex run by adding `--write`.
- `--write` selects the SANDBOX, not merely permission to edit files. It chooses `workspace-write` instead of `read-only`.
- NEITHER `read-only` nor `workspace-write` reaches the network or a database. `workspace-write` permits writes inside the workspace only. Verified: the same database script fails with `code: 'EPERM'` both with and without `--write`, and succeeds only under `danger-full-access`.
- When the task must query a database, call a network service, or otherwise measure against a live dependency, pass `--sandbox danger-full-access`. Adding `--write` does NOT achieve this and never will.
- `--sandbox` and `--write` are independent. `--sandbox danger-full-access` without `--write` is the right choice for a measuring review: Codex can run the database script but still cannot edit the repository. Forbid edits in the prompt text as well, for example: "Make no file changes and no commits."
- Never reach for `--sandbox danger-full-access` when reading source files is sufficient. It is for runs that must execute against a live dependency.
- Treat "read-only", "review", "diagnosis" and "research" in the user's wording as a description of the DELIVERABLE, not of the sandbox. They are not by themselves a reason to omit `--write`.
- A Codex run that reports `EPERM` while reaching a database or the network has hit the sandbox boundary. It is not a broken tool, and it is not fixed by adding `--write` — it needs `--sandbox danger-full-access`.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, normalize `spark` to `gpt-5.3-codex-spark` and pass it through to `task`.
- If the forwarded request includes `--effort`, pass it through to `task`.
- If the forwarded request includes `--sandbox`, pass it through to `task`. Accepted values are `read-only`, `workspace-write`, `danger-full-access`.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.
- `--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `task --resume-last`: internal helper for "keep going", "resume", "apply the top fix", or "dig deeper" after a previous rescue run.

Safety rules:
- Default to write-capable Codex work in `codex:codex-rescue`. Drop `--write` only when reading source files is genuinely sufficient. `--write` does not grant database or network access; use `--sandbox danger-full-access` for that, and keep the two decisions separate.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Codex cannot be invoked, return nothing.
