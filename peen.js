#!/usr/bin/env node
import readline from "readline";
import { readFileSync } from "fs";
import { checkOllama, streamChat } from "./ollama.js";
import { runCommand, formatToolResult } from "./tools.js";

const SYSTEM_PROMPT = readFileSync(new URL("./prompt/system.txt", import.meta.url), "utf-8").trim();

function parseArgs(argv) {
  const args = { model: null, dangerous: false, root: null, debug: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--dangerous") {
      args.dangerous = true;
      continue;
    }
    if (arg === "--root" && argv[i + 1]) {
      args.root = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--debug") {
      args.debug = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
  }
  return args;
}

function parseToolJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj?.tool === "run" && typeof obj?.cmd === "string") return obj;
  } catch (err) {
    return null;
  }
  return null;
}

function isToolJson(text) {
  const raw = text.trim();
  if (!raw) return null;

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1) {
    const tool = parseToolJsonLine(lines[0]);
    return tool ? { tool, extra: 0 } : null;
  }

  // Allow a fenced JSON block: ```json { ... } ```
  if (lines.length === 3) {
    const [start, middle, end] = lines;
    if ((start === "```json" || start === "```") && end === "```") {
      const tool = parseToolJsonLine(middle);
      return tool ? { tool, extra: 0 } : null;
    }
  }

  // Allow multiple JSON tool lines with no other text.
  const tools = [];
  for (const line of lines) {
    const tool = parseToolJsonLine(line);
    if (!tool) return null;
    tools.push(tool);
  }
  if (tools.length > 0) return { tool: tools[0], extra: tools.length - 1 };

  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node peen.js [--model <name>] [--root <path>] [--dangerous] [--debug]\n"
    );
    process.exit(0);
  }

  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

  let tags;
  try {
    tags = await checkOllama(host);
  } catch (err) {
    process.stderr.write("Ollama not reachable. Is it running?\n");
    process.exit(1);
  }

  let model = args.model || process.env.MODEL || null;
  if (!model) {
    const preferred = "llama3.1:latest";
    const hasPreferred = tags.some((t) => t?.name === preferred);
    model = hasPreferred ? preferred : tags[0]?.name || "llama3";
    process.stdout.write(`Using model: ${model}\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on("close", () => {
    rlClosed = true;
  });
  process.stdin.on("end", () => {
    rl.close();
  });
  const question = (q) =>
    new Promise((resolve) => {
      if (rlClosed) return resolve(null);
      rl.question(q, (answer) => resolve(answer));
    });

  const systemMessage = { role: "system", content: SYSTEM_PROMPT };
  let messages = [systemMessage];
  let currentModel = model;

  process.on("SIGINT", () => {
    process.stdout.write("\n");
    rl.close();
    process.exit(0);
  });

  while (true) {
    const input = await question("> ");
    if (input === null) break;
    if (!input) continue;

    if (input.startsWith("/")) {
      if (input === "/exit") {
        rl.close();
        process.exit(0);
      }
      if (input === "/reset") {
        messages = [systemMessage];
        process.stdout.write("(reset)\n");
        continue;
      }
      if (input.startsWith("/model ")) {
        const next = input.slice("/model ".length).trim();
        if (!next) {
          process.stdout.write("Usage: /model <name>\n");
        } else {
          currentModel = next;
          messages = [systemMessage];
          process.stdout.write(`(model: ${currentModel})\n`);
        }
        continue;
      }
      process.stdout.write("Unknown command. Try /exit, /reset, /model <name>.\n");
      continue;
    }

    messages.push({ role: "user", content: input });

    while (true) {
      let assistantText = "";
      try {
        assistantText = await streamChat({
          host,
          model: currentModel,
          messages,
          onToken: (token) => process.stdout.write(token),
          debug: args.debug,
        });
      } catch (err) {
        process.stderr.write(`\nError: ${err.message}\n`);
        break;
      }

      if (!assistantText.endsWith("\n")) process.stdout.write("\n");

      const toolResult = isToolJson(assistantText);
      if (!toolResult) {
        messages.push({ role: "assistant", content: assistantText });
        break;
      }

      const { tool, extra } = toolResult;
      if (extra > 0) {
        process.stdout.write(`(note) ignoring ${extra} additional tool call(s)\n`);
      }
      process.stdout.write(`(tool request) run: ${tool.cmd}\n`);
      const approve = await question("Run? [y/N] ");
      if (approve === null) break;
      if (!/^y(es)?$/i.test(approve.trim())) {
        const content = "Command not run (user denied).";
        messages.push({ role: "tool", name: "run", content });
        continue;
      }

      const result = await runCommand({
        cmd: tool.cmd,
        cwd: args.root || process.cwd(),
        dangerous: args.dangerous,
      });
      const content = formatToolResult(result);
      messages.push({ role: "tool", name: "run", content });
      break;
    }
  }
}

main();
