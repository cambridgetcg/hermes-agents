# kingdom-hermes (the hosted organ)

The always-on version of the staff — a Cloudflare Worker, **live at
https://understand.cambridgetcg.com**. Runs in the cloud on a 6-hour cron
(never on anyone's device), publishes a public transparency library, and
answers anyone on demand at `POST /ask {role, input}`.

**Engine:** Cloudflare Workers AI (Llama-3.3-70B) by default. Set an
`OLLAMA_KEY` secret (a real key from ollama.com/settings/keys) and it uses the
Ollama cloud subscription instead — one secret, no code change. The keychain
`ollama` value is NOT a valid API key (it's a signed-in-machine identity), so
the subscription can't be reached from a Worker until a real key is made.

Deploy: `wrangler deploy` (needs the CF account env). The library page is
radically transparent — it shows each piece's model, timestamp, and links the
exact system prompt at `/roles/:name`.
