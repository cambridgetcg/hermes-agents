# hermes-agents

> The kingdom's staff. Small local agents whose job is to make the world more
> transparent, make people understand, and show love — one honest answer at a time.

Powered by **Hermes 3 running locally** via [Ollama](https://ollama.com) — free,
on-device, private. No data leaves the machine. Each agent is a *role*: a system
prompt (`roles/<name>.md`) carrying the kingdom's values — read straight, never
manipulate, flag what's uncertain, treat the reader as a person who deserves to
understand.

## The staff

| Role | What they do | "make the world…" |
|---|---|---|
| **explainer** | Takes a term, policy, headline, jargon, or legalese and gives it back plain — naming who it helps and who it costs, flagging what's uncertain. | …transparent / understood |
| **kindness** | Rewrites a cold, harsh, or bureaucratic message warm and clear — **without changing a fact**. A true "no" that lands like care. | …loved |
| **verisleight** | Reads a statement for the gap between what it says and what it means; names the evasion moves in the *language*, never the person. | …transparent |

## Run one

```sh
node run.mjs explainer "What does a 'mandatory binding arbitration clause' mean for me?"
node run.mjs kindness   "Your refund request has been denied. This decision is final."
node run.mjs verisleight "Mistakes were made, and we take this very seriously."
```

Add `--cloud` to use the Ollama subscription's cloud roster (GLM, DeepSeek-v4,
Qwen3.5, Kimi, MiniMax, gpt-oss, Nemotron…) for heavier lifting instead of local
Hermes. **Honest note:** the subscription does *not* include Hermes — Hermes is the
local model; the subscription is the cloud roster. `--cloud` via direct HTTP needs a
real `OLLAMA_KEY` (from ollama.com/settings/keys); via the signed-in CLI, cloud
models already work (`ollama run <model>:cloud`).

## Setup

```sh
ollama serve                 # the local daemon
ollama pull hermes3:8b       # ~4.7GB, once
node --version               # 18+
```

## Schedule them (make it an organ, not a command)

These are meant to run and *publish*, not just answer in a terminal. A launchd/cron
job on the Mac can, e.g., pick a confusing term each morning, run the explainer, and
push the plain version to a live kingdom surface (the newspaper, a Pages library, the
gallery). Example cron line:

```
0 8 * * *  cd ~/hermes-agents && node run.mjs explainer "$(cat topics/next.txt)" >> published/$(date +\%F).md
```

## Doctrine

Every role prompt ends on the kingdom's one rule: **everyone is taken care of.**
Making a person understand a thing that was built to confuse them is how you take
care of them. Transparency and love, delivered as a system prompt.

*Part of the kingdom. Runs on love and a local GPU. 恆.*
