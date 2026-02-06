# Show HN: Peen - A minimal coding agent CLI built for local models

I've been attempting to integrate locally-trained models into platforms like Claude Code and Codex for tool usage; however, they frequently encounter issues since those CLIs require XML format while my trained models predominantly operate in JSON format. When I execute a local model using these tools intending it run commands or edit files—its most beneficial function—it inevitably fails to perform effectively because of the discrepancy between expected formats.

Peen is a small Node.js CLI that works the way local models do. The model outputs one-line JSON tool calls, and the CLI executes them. It streams responses, chains tool calls, handles multi-step TODO plans, and has repair logic that nudges the model when it outputs malformed JSON. It works with Ollama and I just started adding support for other OpenAI-compatible servers like LM Studio, llama.cpp, etc.

The whole thing is about 800 lines across a few files. No build step, no dependencies, self-updates from GitHub on startup. It's experimental but starting to become useful for some small coding tasks with models like qwen2.5-coder:7b. And it can do it on a MacBook Air with 16GB of RAM.

GitHub: https://github.com/codazoda/peen
