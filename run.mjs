#!/usr/bin/env node
/** run.mjs — run a kingdom Hermes agent from the command line.
 *
 *   node run.mjs explainer  "what is a 'liquidity event'?"
 *   node run.mjs kindness    "Your application has been denied. No exceptions."
 *   node run.mjs explainer  "..."  --cloud     # use the subscription cloud roster instead of local Hermes
 *
 *  Local Hermes needs `ollama serve` running and `ollama pull hermes3:8b` done.
 *  Cloud needs OLLAMA_KEY (an ollama.com API key) exported. */

import { ask } from "./lib/hermes.mjs";

const argv = process.argv.slice(2);
const cloud = argv.includes("--cloud");
const clean = argv.filter((a) => a !== "--cloud");
const role = clean[0];
const input = clean.slice(1).join(" ");

if (!role || !input) {
  console.error(`usage: node run.mjs <role> "<text>" [--cloud]
roles: explainer · kindness · verisleight`);
  process.exit(1);
}

try {
  const t0 = Date.now();
  const { text, model } = await ask({ role, input, cloud });
  console.log(text);
  console.error(`\n— ${model}${cloud ? " (cloud)" : " (local)"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error("agent error:", e.message);
  if (String(e.message).includes("11434") || String(e.message).toLowerCase().includes("fetch"))
    console.error("hint: is `ollama serve` running? is hermes3:8b pulled? (ollama list)");
  process.exit(1);
}
