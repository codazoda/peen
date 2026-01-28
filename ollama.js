import { setTimeout as sleep } from "timers/promises";

export async function checkOllama(host) {
  const url = new URL("/api/tags", host);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Ollama not reachable (${res.status})`);
  }
  const data = await res.json();
  const tags = Array.isArray(data?.models) ? data.models : [];
  return tags;
}

export async function streamChat({ host, model, messages, onToken, debug }) {
  const url = new URL("/api/chat", host);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama chat error (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let chunk;
      try {
        chunk = JSON.parse(trimmed);
      } catch (err) {
        if (debug) process.stderr.write(`\n[debug] bad json chunk: ${trimmed}\n`);
        continue;
      }

      const delta = chunk?.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        onToken?.(delta);
        fullText += delta;
      }

      if (chunk?.done) {
        if (chunk?.done_reason === "length") {
          if (debug) process.stderr.write("\n[debug] done_reason=length\n");
        }
      }
    }
  }

  if (buffer.trim().length > 0) {
    try {
      const chunk = JSON.parse(buffer.trim());
      const delta = chunk?.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        onToken?.(delta);
        fullText += delta;
      }
    } catch (err) {
      if (debug) process.stderr.write(`\n[debug] trailing bad json: ${buffer.trim()}\n`);
    }
  }

  await sleep(0);
  return fullText;
}
