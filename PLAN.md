# PLAN — Minimal Ollama Code CLI (Node)

Goal: a tiny “Claude Code / OpenCode”-style CLI written in Node that talks to Ollama’s HTTP API and can run shell commands so the model can inspect and modify a project using standard Unix tools.

Design principle: **absolute minimalism** — the minimal solution wins.

## What “done” looks like

- `node peen.js` drops you into a prompt.
- You type a task.
- The tool streams the model’s response from Ollama in real time.
- The model can request **one tool**: `run(cmd)`.
- The CLI executes the command locally (e.g., `cat`, `ls`, `grep`, `echo > file`) and feeds results back.
- Loop until the model returns a normal message.

## Non-goals (to stay minimal)

- No TUI panes, file tree, indexing, embeddings.
- No plugin system.
- No multi-agent orchestration.
- No multiline input (for now).
- No Windows support initially (assume macOS/Linux).

## Configuration

- `OLLAMA_HOST` controls the base URL (default: `http://127.0.0.1:11434`).
- `MODEL` (or `--model`) selects the model.
- Optional: `--dangerous` bypasses denylist.
- Optional: `--root <path>` pins the working directory.

## Startup checks

1. Read `OLLAMA_HOST` (default as above).
2. Check Ollama is reachable:
   - `GET {OLLAMA_HOST}/api/tags`
3. If unreachable, print a short fix and exit non-zero.

## REPL UX (single-line)

- Prompt `> `, Enter submits.
- Lines beginning with `/` are slash commands handled locally.

### Slash commands

- `/exit` — quit.
- `/reset` — **Claude Code-style clear**: clear conversation history, keep system message (and keep model selection).
- `/model <name>` — set the current model.
  - Minimal choice: also do a `/reset` automatically to avoid mixed context.

## Streaming (built in first)

Use Ollama chat streaming so the CLI never feels “locked up”.

### Request

- `POST {OLLAMA_HOST}/api/chat`
- Body:
  - `model`: current model
  - `messages`: conversation array
  - `stream: true`

### Response handling

- Ollama streams newline-delimited JSON chunks.
- For each chunk:
  - extract incremental assistant text (commonly `message.content` deltas)
  - write to stdout immediately
  - also accumulate into a buffer for storing into history
- When stream ends, append `{ role: "assistant", content: fullText }` to history.

## Tooling — exactly one tool

### Tool convention (model-agnostic)

To avoid fragile “native tool calling” differences across models/templates, use a simple convention:

- If the model wants to run a command, it outputs **exact JSON on one line**:

```json
{"tool":"run","cmd":"ls -la"}
```

Otherwise it outputs normal assistant text.

### `run(cmd)` behavior

- Execute the command via:
  - `/bin/bash -lc "<cmd>"`
- Use pinned `cwd` (default: process cwd, or `--root`).
- Capture:
  - `stdout`, `stderr`, and `exitCode`
- Enforce minimal safety & reliability limits:
  - max runtime (e.g. 10s) then kill
  - max output bytes (e.g. 64KB combined) then truncate
- Ask user to approve all commands; there will be an override later

### Minimal denylist

Block obvious catastrophic commands unless `--dangerous`:
- `rm -rf /`, `mkfs`, `dd if=`, `shutdown`, `reboot`, `diskutil`, fork bombs, etc.

## Prompting

System prompt should be short and strict:
- You are a coding assistant in a CLI.
- You may use `run(cmd)` to inspect/modify files.
- Don’t hallucinate file contents; use `cat` first.
- Prefer small, reversible changes.
- When writing files, use shell redirection or heredocs.

## Main loop

For each user input:

1. Append `{ role: "user", content: input }`.
2. Repeat:
   - Stream assistant response; print tokens as they arrive.
   - On completion, check if the **entire** assistant text is a tool JSON:
     - If yes: execute `run(cmd)`, append tool result as `{ role: "tool", name: "run", content: result }`, then ask the model again.
     - If no: append assistant message and finish this turn.

## Minimal file structure

- `peen.js` — REPL + slash commands + main loop
- `ollama.js` — `checkOllama()` + `streamChat()`
- `tools.js` — `runCommand()` + limits + denylist

## Build order

1. **Streaming chat** (no tools)
2. Slash commands (`/exit`, `/reset`, `/model`)
3. Tool convention + `run(cmd)`
4. Limits + denylist + `--dangerous`
5. Tiny polish (`--root`, `--debug`, usage)
