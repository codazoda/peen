import { setTimeout as sleep } from "timers/promises";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function checkOllama(host) {
  const url = new URL("/api/tags", host);
  try {
    const { stdout } = await execPromise(`curl -s "${url.toString()}"`);
    const data = JSON.parse(stdout);
    const tags = Array.isArray(data?.models) ? data.models : [];
    return tags;
  } catch (err) {
    throw new Error(`Ollama not reachable: ${err.message}`);
  }
}

function hasToolCall(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.tool === "run" && typeof obj?.cmd === "string") {
        return true;
      }
    } catch (err) {
      // Not valid JSON
    }
  }
  return false;
}

export async function streamChat({ host, model, messages, onToken, debug }) {
  const url = new URL("/api/chat", host);
  const bodyData = JSON.stringify({ model, messages, stream: true });

  return new Promise((resolve, reject) => {
    const curl = spawn("curl", [
      "-s",
      "-N",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-d", bodyData,
      url.toString(),
    ]);

    let fullText = "";
    let buffer = "";
    let stopped = false;

    curl.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let jsonChunk;
        try {
          jsonChunk = JSON.parse(trimmed);
        } catch (err) {
          if (debug) process.stderr.write(`\n[debug] bad json chunk: ${trimmed}\n`);
          continue;
        }

        const delta = jsonChunk?.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          onToken?.(delta);
          fullText += delta;

          // Stop early if we detect a tool call
          if (!stopped && hasToolCall(fullText)) {
            stopped = true;
            curl.kill();
            resolve(fullText);
            return;
          }
        }

        if (jsonChunk?.done) {
          if (jsonChunk?.done_reason === "length") {
            if (debug) process.stderr.write("\n[debug] done_reason=length\n");
          }
        }
      }
    });

    curl.stderr.on("data", (chunk) => {
      if (debug) process.stderr.write(`\n[debug] curl stderr: ${chunk}\n`);
    });

    curl.on("close", (code) => {
      if (stopped) return; // Already resolved due to tool call

      if (buffer.trim().length > 0) {
        try {
          const jsonChunk = JSON.parse(buffer.trim());
          const delta = jsonChunk?.message?.content;
          if (typeof delta === "string" && delta.length > 0) {
            onToken?.(delta);
            fullText += delta;
          }
        } catch (err) {
          if (debug) process.stderr.write(`\n[debug] trailing bad json: ${buffer.trim()}\n`);
        }
      }

      if (code !== 0) {
        reject(new Error(`Ollama chat error: curl exited with code ${code}`));
      } else {
        resolve(fullText);
      }
    });

    curl.on("error", (err) => {
      if (stopped) return; // Already resolved due to tool call
      reject(new Error(`Ollama connection failed: ${err.message}`));
    });
  });
}
