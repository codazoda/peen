#!/usr/bin/env node
import readline from "readline";
import { readFileSync, promises as fs } from "fs";
import path from "path";
import os from "os";

const REPO_RAW = "https://raw.githubusercontent.com/codazoda/peen/main";
const REPO_API = "https://api.github.com/repos/codazoda/peen/commits/main";

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
  } catch (err) {
    return null;
  }
  return null;
}

function extractToolCalls(text) {
  const lines = text.split("\n");
  const tools = [];
  for (const line of lines) {
    const tool = parseToolJsonLine(line);
    if (tool) tools.push(tool);
  }
  return tools;
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

async function fetchJson(url, { timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    headers: { "User-Agent": "peen" },
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchText(url, { timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    headers: { "User-Agent": "peen" },
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function readLocalSha(installDir) {
  try {
    const data = await fs.readFile(path.join(installDir, "LATEST_SHA"), "utf-8");
    return data.trim() || null;
  } catch (err) {
    return null;
  }
}

async function readLocalVersion(installDir) {
  const versionPath = path.join(installDir, "VERSION");
  try {
    const raw = (await fs.readFile(versionPath, "utf-8")).trim();
    if (/^0\.1\.\d+$/.test(raw)) return raw;
  } catch (err) {
    // fall through
  }

  const pkgPath = path.join(installDir, "package.json");
  try {
    const pkgRaw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw);
    if (typeof pkg?.version === "string" && /^0\.1\.\d+$/.test(pkg.version)) {
      return pkg.version;
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function fetchRemoteSha() {
  const data = await fetchJson(REPO_API, { timeoutMs: 1500 });
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

  const files = ["peen.js", "ollama.js", "tools.js", "prompt/system.txt", "VERSION"];
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
      return installOnly ? "installed" : "skipped";
    }
    process.stdout.write("(update) cannot check latest; continuing with installed version\n");
    return installOnly ? "installed" : "skipped";
  }

  if (!localSha || localSha !== remoteSha) {
    process.stdout.write("(update) installing latest peen...\n");
    await installLatest(installDir, binDir, remoteSha);
    process.stdout.write("Installed peen. Please start it again.\n");
    return "installed";
  }

  if (installOnly) {
    process.stdout.write("peen is already up to date.\n");
    return "installed";
  }

  return "up-to-date";
}

function printBanner(version) {
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
    process.stdout.write(`version: ${version}\n\n`);
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

  const updateStatus = await ensureLatest({ installOnly: args.installOnly });
  if (updateStatus === "installed") {
    process.exit(0);
  }

  const { installDir } = getInstallPaths();
  const version = await readLocalVersion(installDir);
  printBanner(version);

  const { checkOllama, streamChat } = await import("./ollama.js");
  const { runCommand, formatToolResult } = await import("./tools.js");
  const SYSTEM_PROMPT = readFileSync(new URL("./prompt/system.txt", import.meta.url), "utf-8").trim();

  //const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const host = process.env.OLLAMA_HOST || "http://172.30.200.200:11434";

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

  const repoRoot = args.root || process.cwd();
  const inGitRepo = await isGitRepo(repoRoot);
  if (!inGitRepo) {
    process.stdout.write("(warn) current directory is not a git repository.\n");
    const cont = await question("Continue anyway? [y/N] ");
    if (cont === null || !/^y(es)?$/i.test(cont.trim())) {
      rl.close();
      process.exit(0);
    }
  }

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
      if (input === "/model" || input.startsWith("/model ")) {
        const next = input.slice("/model".length).trim();
        if (!next) {
          const models = tags.map((t) => t?.name).filter(Boolean);
          if (models.length === 0) {
            process.stdout.write("No models available.\n");
          } else {
            process.stdout.write(`Available models:\n${models.join("\n")}\n`);
          }
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

      const tools = extractToolCalls(assistantText);
      if (tools.length === 0) {
        messages.push({ role: "assistant", content: assistantText });
        break;
      }

      messages.push({ role: "assistant", content: assistantText });

      const [tool, ...remaining] = tools;
      if (remaining.length > 0) {
        process.stdout.write(
          `(note) ${remaining.length} additional tool call(s) queued; will let the model decide next step\n`
        );
      }

      process.stdout.write(`(tool request) run: ${tool.cmd}\n`);
      const approve = await question("Run? [Y/n] ");
      if (approve === null) break;
      const approveText = approve.trim();
      if (approveText.length > 0 && !/^y(es)?$/i.test(approveText)) {
        const content = "Command not run (user denied).";
        messages.push({ role: "tool", name: "run", content });
        break;
      }

      const result = await runCommand({
        cmd: tool.cmd,
        cwd: args.root || process.cwd(),
        dangerous: args.dangerous,
      });
      const content = formatToolResult(result);
      messages.push({ role: "tool", name: "run", content });
      continue;
    }
  }
}

main();
