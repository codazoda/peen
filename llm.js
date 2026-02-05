import { exec, spawn } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function listModels(host) {
  const url = new URL("/v1/models", host);
  try {
    const { stdout } = await execPromise(`curl -s --connect-timeout 5 --max-time 10 "${url.toString()}"`);
    const data = JSON.parse(stdout);
    const models = Array.isArray(data?.data) ? data.data : [];
    return models.map((m) => ({ name: m.id, ...m }));
  } catch (err) {
    throw new Error(`Server not reachable: ${err.message}`);
  }
}

function convertToolMessages(messages) {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      const label = msg.name ? `[Tool Result (${msg.name})]` : "[Tool Result]";
      return { role: "user", content: `${label}: ${msg.content}` };
    }
    return msg;
  });
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
      if (obj?.tool === "write" && typeof obj?.path === "string" && typeof obj?.content === "string") {
        return true;
      }
    } catch (err) {
      // Not valid JSON
    }
  }
  return false;
}

export async function streamChat({ host, model, messages, onToken, debug }) {
  const url = new URL("/v1/chat/completions", host);
  const bodyData = JSON.stringify({ model, messages, stream: true });

  return new Promise((resolve, reject) => {
    const curl = spawn("curl", [
      "-s",
      "-N",
      "--connect-timeout", "5",
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
        if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
          if (!stopped) {
            stopped = true;
            curl.kill();
            resolve(fullText);
          }
          return;
        }

        let jsonStr;
        if (trimmed.startsWith("data: ")) {
          jsonStr = trimmed.slice(6);
        } else if (trimmed.startsWith("data:")) {
          jsonStr = trimmed.slice(5);
        } else {
          // Not an SSE line — check for a JSON error response from the server
          if (trimmed.startsWith("{")) {
            try {
              const errObj = JSON.parse(trimmed);
              if (errObj?.error) {
                const msg = errObj.error.message || JSON.stringify(errObj.error);
                if (!stopped) {
                  stopped = true;
                  curl.kill();
                  reject(new Error(`Server error: ${msg}`));
                }
                return;
              }
            } catch (e) {
              // not JSON, ignore
            }
          }
          if (debug) process.stderr.write(`\n[debug] non-SSE line: ${trimmed}\n`);
          continue;
        }

        let jsonChunk;
        try {
          jsonChunk = JSON.parse(jsonStr);
        } catch (err) {
          if (debug) process.stderr.write(`\n[debug] bad json chunk: ${jsonStr}\n`);
          continue;
        }

        const delta = jsonChunk?.choices?.[0]?.delta?.content;
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

        const finishReason = jsonChunk?.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
          if (debug) process.stderr.write("\n[debug] finish_reason=length\n");
        }
        if (finishReason === "stop" || finishReason === "length") {
          if (!stopped) {
            stopped = true;
            curl.kill();
            resolve(fullText);
          }
          return;
        }
      }
    });

    curl.stderr.on("data", (chunk) => {
      if (debug) process.stderr.write(`\n[debug] curl stderr: ${chunk}\n`);
    });

    curl.on("close", (code) => {
      if (stopped) return; // Already resolved due to tool call

      if (buffer.trim().length > 0) {
        const trimmed = buffer.trim();
        let trailingJson;
        if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
          trailingJson = trimmed.slice(6);
        } else if (trimmed.startsWith("data:") && trimmed !== "data:[DONE]") {
          trailingJson = trimmed.slice(5);
        } else if (trimmed.startsWith("{")) {
          // Possible non-SSE error response
          try {
            const errObj = JSON.parse(trimmed);
            if (errObj?.error) {
              const msg = errObj.error.message || JSON.stringify(errObj.error);
              reject(new Error(`Server error: ${msg}`));
              return;
            }
          } catch (e) {
            // not JSON
          }
        }
        if (trailingJson) {
          try {
            const jsonChunk = JSON.parse(trailingJson);
            const delta = jsonChunk?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              onToken?.(delta);
              fullText += delta;
            }
          } catch (err) {
            if (debug) process.stderr.write(`\n[debug] trailing bad json: ${trimmed}\n`);
          }
        }
      }

      if (code !== 0) {
        reject(new Error(`Chat error: curl exited with code ${code}`));
      } else {
        resolve(fullText);
      }
    });

    curl.on("error", (err) => {
      if (stopped) return; // Already resolved due to tool call
      reject(new Error(`Connection failed: ${err.message}`));
    });
  });
}
