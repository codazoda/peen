# peen

A deliberately minimalist “Claude Code / OpenCode”-style CLI written in Node.js that talks to **Ollama** over HTTP and can **run shell commands** so the model can inspect and modify your project using tools like `cat`, `ls`, `grep`, and `echo > file`.

## Why this exists

Most code agents grow lots of UI and infrastructure quickly. This repo aims for the smallest useful core:

- **Streaming** model output so it never feels stuck
- A single capability: **run commands** locally and feed results back
- A few practical slash commands: `/exit`, `/reset`, `/model`

## How it will work

- Configure Ollama via `OLLAMA_HOST` (defaults to `http://127.0.0.1:11434`).
- On startup, the CLI checks that Ollama is reachable (`/api/tags`) and exits if not.
- You type a request; the assistant response streams live.
- If the model needs to inspect or edit files, it requests a tool call by outputting one-line JSON like:

```json
{"tool":"run","cmd":"ls -la"}
```

The CLI executes the command (with basic time/output limits) and sends the result back to the model.

## Install

Quick install (pulls raw files from `main`, no build step):

```bash
curl -fsSL https://raw.githubusercontent.com/codazoda/peen/main/install.sh | bash
```

## Repo docs

- See **PLAN.md** for the concrete build plan and design constraints.
