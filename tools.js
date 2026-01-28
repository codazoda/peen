import { spawn } from "child_process";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

const DENYLIST = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bdiskutil\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};\s*:/,
];

export function isDenied(cmd) {
  return DENYLIST.some((re) => re.test(cmd));
}

export async function runCommand({
  cmd,
  cwd,
  dangerous = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (!dangerous && isDenied(cmd)) {
    return {
      blocked: true,
      stdout: "",
      stderr: "Command blocked by denylist. Use --dangerous to bypass.",
      exitCode: 1,
      timedOut: false,
      truncated: false,
    };
  }

  return await new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", cmd], { cwd });
    let stdout = "";
    let stderr = "";
    let total = 0;
    let timedOut = false;
    let truncated = false;
    let killed = false;

    const kill = () => {
      if (killed) return;
      killed = true;
      child.kill("SIGKILL");
    };

    const onData = (chunk, target) => {
      total += chunk.length;
      if (total > maxOutputBytes) {
        truncated = true;
        kill();
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf-8");
      if (target === "stderr") stderr += chunk.toString("utf-8");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => onData(chunk, "stdout"));
    child.stderr.on("data", (chunk) => onData(chunk, "stderr"));

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        blocked: false,
        stdout,
        stderr,
        exitCode: code ?? (signal ? `signal:${signal}` : null),
        timedOut,
        truncated,
      });
    });
  });
}

export function formatToolResult(result) {
  const lines = [];
  if (result.blocked) lines.push("blocked: true");
  if (result.timedOut) lines.push("timedOut: true");
  if (result.truncated) lines.push("truncated: true");
  lines.push(`exitCode: ${result.exitCode}`);
  lines.push("stdout:");
  lines.push(result.stdout || "");
  lines.push("stderr:");
  lines.push(result.stderr || "");
  return lines.join("\n");
}
