/** hermes.mjs — call a kingdom Hermes agent.
 *
 *  Runs Hermes 3 LOCALLY by default (free, on-device, private) via Ollama's
 *  chat API. Pass { cloud:true } to use the Ollama subscription's cloud roster
 *  instead (for heavy lifting; not Hermes — the subscription has no Hermes).
 *
 *  A "role" is a system prompt in ../roles/<role>.md that carries the kingdom's
 *  values: read straight, never manipulate, flag what's uncertain, treat the
 *  reader as a person who deserves to understand. Transparency and love, in a
 *  prompt. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const LOCAL = "http://localhost:11434/api/chat";
const CLOUD = "https://ollama.com/api/chat";
const DEFAULT_LOCAL = "hermes3:8b";
const DEFAULT_CLOUD = "gpt-oss:120b"; // a strong open cloud model on the subscription

export function loadRole(role) {
  return readFileSync(join(HERE, "..", "roles", `${role}.md`), "utf8");
}

export async function ask({ role, system, input, model, cloud = false, temperature = 0.6, timeoutMs = 120000 }) {
  const sys = system ?? (role ? loadRole(role) : "You are a helpful, honest assistant.");
  const headers = { "Content-Type": "application/json" };
  if (cloud) {
    const key = process.env.OLLAMA_KEY;
    if (!key) throw new Error("cloud requested but OLLAMA_KEY not set (keychain: `ollama`).");
    headers.Authorization = "Bearer " + key;
  }
  const body = {
    model: model || (cloud ? DEFAULT_CLOUD : DEFAULT_LOCAL),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: input },
    ],
    stream: false,
    options: { temperature },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(cloud ? CLOUD : LOCAL, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `hermes ${r.status}`);
    return { text: (d.message?.content ?? "").trim(), model: body.model, cloud };
  } finally {
    clearTimeout(t);
  }
}
