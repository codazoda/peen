#!/usr/bin/env node
import readline from "readline";
import { readFileSync, promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";

const REPO_RAW = "https://raw.githubusercontent.com/codazoda/peen/main";
const REPO_API = "https://api.github.com/repos/codazoda/peen/commits/main";
const NETWORK_TIMEOUT_MS = 1500;
const PROMPT_PIPE_FG = "\x1b[94m";
const PROMPT_TEXT_FG = "\x1b[90m";
const PROMPT_RESET = "\x1b[0m";
const TOOL_CMD_RED = "\x1b[31m";
const UPDATE_STATUS = {
  INSTALLED: "installed",
  SKIPPED: "skipped",
  UP_TO_DATE: "up-to-date",
};
const VERSION_RE = /^0\.1\.\d+$/;
const TODO_HEADER_RE = /^TODO:\s*$/im;
const TODO_ITEM_RE = /^- \[ \] (.+)$/gm;

function parseTodoList(text) {
  if (!TODO_HEADER_RE.test(text)) return null;
  const items = [];
  let match;
  while ((match = TODO_ITEM_RE.exec(text)) !== null) {
    items.push(match[1].trim());
  }
  return items.length > 0 ? items : null;
}

function formatTodoList(items, doneIndex) {
  const lines = ["TODO:"];
  for (let i = 0; i < items.length; i += 1) {
    const checked = i <= doneIndex ? "x" : " ";
    lines.push(`- [${checked}] ${items[i]}`);
  }
  return lines.join("\n");
}

function stripTodoBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && /^TODO:\s*$/.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim() === "") {
        skipping = false;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

function parseArgs(argv) {
  const args = { model: null, dangerous: false, root: null, debug: false, installOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--install-only") {
      args.installOnly = true;
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
    if (obj?.tool === "write" && typeof obj?.path === "string" && typeof obj?.content === "string") return obj;
  } catch (err) {
    return null;
  }
  return null;
}

function extractToolCalls(text) {
  const lines = text.split("\n");
  const tools = [];
  for (let i = 0; i < lines.length; i += 1) {
    const tool = parseToolJsonLine(lines[i]);
    if (tool) {
      tools.push({ tool, lineIndex: i, lines });
      continue;
    }
    // Try to handle multi-line write tool calls (model used real newlines instead of \n)
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{"tool":"write"') || trimmed.startsWith('{"tool": "write"')) {
      // Collect lines until we find one ending with }
      let combined = trimmed;
      let j = i + 1;
      while (j < lines.length && !combined.endsWith("}")) {
        combined += "\\n" + lines[j].trim();
        j += 1;
      }
      // Try to parse the reconstructed JSON
      const fixedTool = parseToolJsonLine(combined);
      if (fixedTool) {
        tools.push({ tool: fixedTool, lineIndex: i, lines });
      }
      i = j - 1; // Always skip consumed lines to avoid re-processing
    }
  }
  return tools;
}

function findInvalidToolLine(text) {
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    if (!line.includes("\"tool\"")) continue;
    if (!line.includes("\"cmd\"") && !line.includes("\"path\"")) continue;
    if (!parseToolJsonLine(line)) return line;
  }
  return null;
}

function findUnsupportedToolLine(text) {
  const lines = text.split("\n");
  const supportedTools = ["run", "write"];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    if (!line.includes("\"tool\"")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.tool === "string" && !supportedTools.includes(obj.tool)) {
        return obj.tool;
      }
    } catch (err) {
      continue;
    }
  }
  return null;
}

function describeToolCall(entry) {
  const { lines, lineIndex } = entry;
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (parseToolJsonLine(raw)) continue;
    return raw;
  }
  return "About to run command:";
}

function isNoopEcho(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith("echo ")) return false;
  if (trimmed.includes(">") || trimmed.includes(">>") || trimmed.includes("|")) return false;
  return true;
}


function printAvailableModels(tags) {
  const models = tags.map((t) => t?.name).filter(Boolean);
  if (models.length === 0) {
    process.stdout.write("No models available.\n");
    return;
  }
  process.stdout.write(`Available models:\n${models.join("\n")}\n`);
  writeBlackBlankLine();
}

async function readText(filePath) {
  return await fs.readFile(filePath, "utf-8");
}

async function readJson(filePath) {
  const raw = await readText(filePath);
  return JSON.parse(raw);
}

async function isGitRepo(root) {
  try {
    const stat = await fs.stat(path.join(root, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch (err) {
    return false;
  }
}

function getInstallPaths() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const binHome = process.env.XDG_BIN_HOME || path.join(os.homedir(), ".local", "bin");
  return {
    installDir: path.join(dataHome, "peen"),
    binDir: binHome,
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    headers: { "User-Agent": "peen" },
    signal: controller.signal,
  });
  clearTimeout(timer);
  return res;
}

async function fetchJson(url, { timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchText(url, { timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function readLocalSha(installDir) {
  try {
    const data = await readText(path.join(installDir, "LATEST_SHA"));
    return data.trim() || null;
  } catch (err) {
    return null;
  }
}

async function readLocalVersion(installDir) {
  const versionPath = path.join(installDir, "VERSION");
  try {
    const raw = (await readText(versionPath)).trim();
    if (VERSION_RE.test(raw)) return raw;
  } catch (err) {
    // fall through
  }

  const pkgPath = path.join(installDir, "package.json");
  try {
    const pkg = await readJson(pkgPath);
    if (typeof pkg?.version === "string" && VERSION_RE.test(pkg.version)) {
      return pkg.version;
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function fetchRemoteSha() {
  const data = await fetchJson(REPO_API, { timeoutMs: NETWORK_TIMEOUT_MS });
  return typeof data?.sha === "string" ? data.sha : null;
}

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf-8");
  await fs.chmod(filePath, 0o755);
}

async function installLatest(installDir, binDir, sha) {
  await fs.mkdir(path.join(installDir, "prompt"), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  const packageJson = JSON.stringify({ type: "module" }, null, 2);
  await fs.writeFile(path.join(installDir, "package.json"), packageJson, "utf-8");

  const files = ["peen.js", "ollama.js", "tools.js", "prompt/system.txt", "prompt/tool_repair.txt", "VERSION"];
  for (const file of files) {
    try {
      const content = await fetchText(`${REPO_RAW}/${file}`);
      await fs.writeFile(path.join(installDir, file), content, "utf-8");
    } catch (err) {
      if (file === "VERSION") {
        await fs.writeFile(path.join(installDir, file), "0.1.0\n", "utf-8");
        continue;
      }
      throw err;
    }
  }

  await fs.chmod(path.join(installDir, "peen.js"), 0o755);

  const shim = `#!/usr/bin/env bash
set -euo pipefail
exec node "${installDir}/peen.js" "$@"
  `;
  await writeExecutable(path.join(binDir, "peen"), shim);
  if (sha) {
    await fs.writeFile(path.join(installDir, "LATEST_SHA"), `${sha}\n`, "utf-8");
  }
}

async function ensureLatest({ installOnly }) {
  const { installDir, binDir } = getInstallPaths();
  const localSha = await readLocalSha(installDir);

  let remoteSha = null;
  try {
    remoteSha = await fetchRemoteSha();
  } catch (err) {
    if (!localSha) {
      process.stdout.write("(update) offline or cannot check latest; continuing with installed version\n");
      return { status: installOnly ? UPDATE_STATUS.INSTALLED : UPDATE_STATUS.SKIPPED, installDir };
    }
    process.stdout.write("(update) cannot check latest; continuing with installed version\n");
    return { status: installOnly ? UPDATE_STATUS.INSTALLED : UPDATE_STATUS.SKIPPED, installDir };
  }

  if (!localSha || localSha !== remoteSha) {
    process.stdout.write("(update) installing latest peen...\n");
    await installLatest(installDir, binDir, remoteSha);
    return { status: UPDATE_STATUS.INSTALLED, installDir };
  }

  if (installOnly) {
    process.stdout.write("peen is already up to date.\n");
    return { status: UPDATE_STATUS.INSTALLED, installDir };
  }

  return { status: UPDATE_STATUS.UP_TO_DATE, installDir };
}

async function relaunchInstalled(installDir, argv) {
  const target = path.join(installDir, "peen.js");
  const child = spawn(process.execPath, [target, ...argv], {
    stdio: "inherit",
    env: { ...process.env, PEEN_RELAUNCHED: "1" },
  });
  return await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

async function readMultilineInput(question) {
  const lines = [];
  let first = true;
  while (true) {
    const prompt = `${PROMPT_PIPE_FG}|${PROMPT_TEXT_FG} `;
    const line = await question(prompt);
    if (line === null) return null;
    if (line.endsWith("\\")) {
      lines.push(line.slice(0, -1));
      first = false;
      continue;
    }
    lines.push(line);
    break;
  }
  return lines.join("\n");
}

function writeBlackBlankLine() {
  process.stdout.write(`\r${PROMPT_RESET}\x1b[2K\n`);
}

function printBanner(version, host, model) {
  const lines = [
    "                                  ",
    "... ...    ....    ....  .. ...   ",
    " ||'  || .|...|| .|...||  ||  ||  ",
    " ||    | ||      ||       ||  ||  ",
    " ||...'   '|...'  '|...' .||. ||. ",
    " ||                               ",
    "''''                              ",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (version) {
    process.stdout.write(`version: ${version}\n`);
  }
  process.stdout.write(`server: ${host}\n`);
  if (model) {
    process.stdout.write(`model: ${model}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node peen.js [--model <name>] [--root <path>] [--dangerous] [--debug] [--install-only]\n"
    );
    process.exit(0);
  }

  const update = await ensureLatest({ installOnly: args.installOnly });
  if (update.status === UPDATE_STATUS.INSTALLED) {
    if (args.installOnly) process.exit(0);
    if (!process.env.PEEN_RELAUNCHED) {
      const code = await relaunchInstalled(update.installDir, process.argv.slice(2));
      process.exit(code);
    }
    process.exit(0);
  }

  const { installDir } = getInstallPaths();
  const version = await readLocalVersion(installDir);
  const host = process.env.PEEN_HOST || "http://127.0.0.1:11434";
  const configuredModel = args.model || process.env.PEEN_MODEL || null;
  printBanner(version, host, configuredModel);
  if (configuredModel) {
    process.stdout.write("\n");
  }

  const { checkOllama, streamChat } = await import("./ollama.js");
  const { runCommand, formatToolResult } = await import("./tools.js");
  const SYSTEM_PROMPT = readFileSync(new URL("./prompt/system.txt", import.meta.url), "utf-8").trim();
  const TOOL_REPAIR_PROMPT = readFileSync(
    new URL("./prompt/tool_repair.txt", import.meta.url),
    "utf-8"
  ).trim();

  let tags;
  try {
    tags = await checkOllama(host);
  } catch (err) {
    process.stderr.write("Ollama not reachable. Is it running?\n");
    process.exit(1);
  }

  let model = configuredModel;
  if (!model) {
    const preferred = "qwen2.5-coder:14b";
    const hasPreferred = tags.some((t) => t?.name === preferred);
    model = hasPreferred ? preferred : tags[0]?.name || "llama3";
    process.stdout.write(`model: ${model}\n\n`);
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
      rl.question(`${q}`, (answer) => {
        process.stdout.write(`${PROMPT_RESET}\r\x1b[2K`);
        resolve(answer);
      });
    });

  const systemMessage = { role: "system", content: SYSTEM_PROMPT };
  let messages = [systemMessage];
  let currentModel = model;
  let todoState = null;

  process.on("SIGINT", () => {
    process.stdout.write("\n");
    rl.close();
    process.exit(0);
  });

  const repoRoot = args.root || process.cwd();
  const inGitRepo = await isGitRepo(repoRoot);
  if (!inGitRepo) {
    process.stdout.write("(warn) current directory is not a git repository.\n");
    const cont = await question("Continue anyway? [y/N] ");
    if (cont === null || !/^y(es)?$/i.test(cont.trim())) {
      rl.close();
      process.exit(0);
    }
    writeBlackBlankLine();
  }

  while (true) {
    const input = await readMultilineInput(question);
    if (input === null) break;
    if (!input) continue;
    writeBlackBlankLine();

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
      if (input === "/model" || input.startsWith("/model ")) {
        const next = input.slice("/model".length).trim();
        if (!next) {
          printAvailableModels(tags);
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
    let toolRepairAttempts = 0;

    while (true) {
      let assistantText = "";
      const shouldStream = !todoState;
      try {
        assistantText = await streamChat({
          host,
          model: currentModel,
          messages,
          onToken: shouldStream ? (token) => process.stdout.write(token) : null,
          debug: args.debug,
        });
      } catch (err) {
        process.stderr.write(`\nError: ${err.message}\n`);
        break;
      }

      if (shouldStream) {
        if (!assistantText.endsWith("\n")) process.stdout.write("\n");
        writeBlackBlankLine();
      }

      const todoItemsInText = parseTodoList(assistantText);
      if (!todoState && todoItemsInText) {
        todoState = { pendingList: false, items: todoItemsInText, index: 0 };
        if (!shouldStream) {
          process.stdout.write(`${assistantText}\n`);
          writeBlackBlankLine();
        }
        messages.push({ role: "assistant", content: assistantText });
        process.stdout.write(`${formatTodoList(todoState.items, -1)}\n`);
        writeBlackBlankLine();
        messages.push({
          role: "user",
          content: `Proceed with step 1: ${todoState.items[0]}`,
        });
        messages.push({
          role: "user",
          content: "Do not output the TODO list again. I will track it.",
        });
        continue;
      }
      if (todoState && !todoState.pendingList && todoItemsInText) {
        const filtered = stripTodoBlocks(assistantText);
        if (!shouldStream && filtered) {
          process.stdout.write(`${filtered}\n`);
          writeBlackBlankLine();
        }
        messages.push({ role: "assistant", content: assistantText });
        messages.push({
          role: "user",
          content: "Do not output the TODO list again. I will track it. Continue with the current step.",
        });
        continue;
      }

      if (todoState?.pendingList) {
        const items = todoItemsInText;
        if (!items) {
          if (!shouldStream) {
            process.stdout.write(`${assistantText}\n`);
            writeBlackBlankLine();
          }
          messages.push({ role: "assistant", content: assistantText });
          messages.push({
            role: "user",
            content:
              "Please respond with ONLY the TODO list in this exact format:\n" +
              "TODO:\n" +
              "- [ ] First item\n" +
              "- [ ] Next item\n",
          });
          continue;
        }
        todoState.items = items;
        todoState.pendingList = false;
        todoState.index = 0;
        if (!shouldStream) {
          process.stdout.write(`${assistantText}\n`);
          writeBlackBlankLine();
        }
        messages.push({ role: "assistant", content: assistantText });
        process.stdout.write(`${formatTodoList(todoState.items, -1)}\n`);
        writeBlackBlankLine();
        messages.push({
          role: "user",
          content: `Proceed with step 1: ${todoState.items[0]}`,
        });
        messages.push({
          role: "user",
          content: "Do not output the TODO list again. I will track it.",
        });
        continue;
      }

      if (!shouldStream) {
        process.stdout.write(`${assistantText}\n`);
        writeBlackBlankLine();
      }

      const tools = extractToolCalls(assistantText);
      if (tools.length === 0) {
        messages.push({ role: "assistant", content: assistantText });
        const invalidToolLine = findInvalidToolLine(assistantText);
        if (invalidToolLine && toolRepairAttempts < 2) {
          toolRepairAttempts += 1;
          process.stdout.write(`(tool repair prompt)\n${TOOL_REPAIR_PROMPT}\n\n`);
          messages.push({ role: "user", content: TOOL_REPAIR_PROMPT });
          continue;
        }
        const unsupportedTool = findUnsupportedToolLine(assistantText);
        if (unsupportedTool && toolRepairAttempts < 2) {
          toolRepairAttempts += 1;
          process.stdout.write(`(tool repair prompt)\n${TOOL_REPAIR_PROMPT}\n\n`);
          messages.push({ role: "user", content: TOOL_REPAIR_PROMPT });
          continue;
        }
        // If text looks like it has a tool call but we couldn't parse it, try one more repair
        const looksLikeToolCall = assistantText.includes('"tool"') &&
          (assistantText.includes('"run"') || assistantText.includes('"write"'));
        if (looksLikeToolCall && toolRepairAttempts < 3) {
          toolRepairAttempts += 1;
          process.stdout.write(`(tool repair prompt)\n${TOOL_REPAIR_PROMPT}\n\n`);
          messages.push({ role: "user", content: TOOL_REPAIR_PROMPT });
          continue;
        }
        if (todoState && todoState.index < todoState.items.length) {
          process.stdout.write(`${formatTodoList(todoState.items, todoState.index)}\n`);
          writeBlackBlankLine();
          todoState.index += 1;
          if (todoState.index >= todoState.items.length) {
            todoState = null;
            break;
          }
          messages.push({
            role: "user",
            content: `Proceed with step ${todoState.index + 1}: ${todoState.items[todoState.index]}`,
          });
          continue;
        }
        break;
      }

      messages.push({ role: "assistant", content: assistantText });

      // Separate run and write tools
      const runTools = tools.filter((entry) => entry.tool.tool === "run" && !isNoopEcho(entry.tool.cmd));
      const writeTools = tools.filter((entry) => entry.tool.tool === "write");
      const skipped = tools.length - runTools.length - writeTools.length;

      if (skipped > 0) {
        messages.push({
          role: "tool",
          name: "run",
          content: "One or more echo-only tool calls were skipped.",
        });
      }

      if (runTools.length === 0 && writeTools.length === 0) {
        break;
      }

      // Handle run tools
      if (runTools.length > 0) {
        const combined = runTools.map((entry) => entry.tool.cmd).join(" && ");
        process.stdout.write(`${TOOL_CMD_RED}${combined}${PROMPT_RESET}\n`);
        const approve = await question("Run? [Y/n] ");
        if (approve === null) break;
        const approveText = approve.trim();
        if (approveText.length > 0 && !/^y(es)?$/i.test(approveText)) {
          messages.push({ role: "tool", name: "run", content: "Command not run (user denied)." });
          todoState = null;
          break;
        }
        process.stdout.write("\n");

        const result = await runCommand({
          cmd: combined,
          cwd: args.root || process.cwd(),
          dangerous: args.dangerous,
        });
        messages.push({ role: "tool", name: "run", content: formatToolResult(result) });

        // Only prompt verification for write operations, not reads
        const isReadOnly = /^\s*(cat|ls|head|tail|grep|find|wc|file|stat|pwd|echo|tree)\s/.test(combined);
        if (result.exitCode === 0 && !isReadOnly) {
          messages.push({
            role: "user",
            content: "If that was a write operation, verify it succeeded. Then continue with your task.",
          });
        }
      }

      // Handle write tools
      for (const entry of writeTools) {
        const { path: filePath, content: fileContent } = entry.tool;
        const preview = fileContent.length > 200 ? fileContent.slice(0, 200) + "..." : fileContent;
        process.stdout.write(`${TOOL_CMD_RED}write: ${filePath}${PROMPT_RESET}\n`);
        process.stdout.write(`${preview}\n`);
        const approve = await question("Write? [Y/n] ");
        if (approve === null) break;
        const approveText = approve.trim();
        if (approveText.length > 0 && !/^y(es)?$/i.test(approveText)) {
          messages.push({ role: "tool", name: "write", content: "File not written (user denied)." });
          todoState = null;
          break;
        }
        process.stdout.write("\n");

        try {
          const fullPath = path.resolve(args.root || process.cwd(), filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, fileContent, "utf-8");
          messages.push({ role: "tool", name: "write", content: `File written: ${filePath}` });
          messages.push({
            role: "user",
            content: "Verify the file was written correctly, then continue with your task.",
          });
        } catch (err) {
          messages.push({ role: "tool", name: "write", content: `Error writing file: ${err.message}` });
        }
      }
      continue;
    }
  }
}

main();
