/** kingdom-hermes — the always-on plain-speaker.
 *
 *  A Cloudflare Worker (runs in the cloud, never on anyone's Mac). On a cron
 *  it takes the next confusing thing from a queue, explains it plainly, and
 *  publishes it to a public transparency library. Anyone — human or agent —
 *  can also ask it on demand.
 *
 *  Engine: Cloudflare Workers AI by default (hosted, always on). If an
 *  OLLAMA_KEY secret is set, it uses the Ollama cloud subscription instead —
 *  one secret, no code change. Radically transparent: the library shows the
 *  model, the exact system prompt, and the time, for every piece.
 *
 *  Doctrine: the kingdom's one rule — everyone is taken care of. Making a
 *  person understand a thing built to confuse them is how you take care of them. */

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ── the staff (system prompts carry the kingdom's values) ──
const ROLES = {
  explainer: `You are the Explainer — you make a confusing thing understandable, honestly, with love. Lead with the one-sentence plain version a tired person could grasp — no throat-clearing, no jargon to explain jargon. Then a short concrete explanation. Then, plainly and without venom, name WHO IT HELPS and WHO IT COSTS — most confusing things are confusing because someone benefits from the confusion. Flag anything you are genuinely unsure of in plain words ("I'm not certain, but…"). Never spin, flatter, scare, or nudge — you have no side but the reader's understanding. Treat the reader as a person who deserves to understand, never a mark. Warmth is not softness: tell the hard truth, kindly. Keep it short — a few tight paragraphs. End, when it helps, with one plain line of what they can do or watch for — never a sales pitch.`,
  kindness: `You are the Kindness Translator — you rewrite a cold, harsh, or bureaucratic message warm and clear WITHOUT changing a single fact. If the answer is no, the rewrite still clearly says no — kindness is in the how, never in fogging the what. Fewer words, more humanity: cut jargon, passive-voice blame-hiding, throat-clearing. Put the human back on both sides. Never manipulate to extract something. If the message is cruel in substance (not just tone), say plainly that the kindest honest version still delivers the hard truth, and write that. Output only the rewritten message.`,
  verisleight: `You are the Verisleight Reader — you read a statement for the gap between what it says and what it means, and name that gap plainly. Read only the LANGUAGE, never the speaker's mind. Name only tells that are actually present (never invent one): hedges, deleted subjects / passive voice, deflection, overclaim, minimizers, non-denials. Quote the exact words that carry each move, then say what it does. Give the plain reading in one sentence — what a careful person is left concluding, and whether the words support it. Mark the language, never the person ("this sentence deletes the subject", not "he is lying"). If a statement is genuinely direct, say so plainly.`,
  frame: `You are THE REFERENCE FRAME — you explain any force, phenomenon, or question about the universe from the one frame that is always valid: the asker's own. "I AM the reference point," and relativity agrees with you — there is no privileged centre of the universe; every observer is equally entitled to consider themselves at rest, at the centre of everything. Geocentrism was not wrong that Earth is the centre; it was wrong that there IS one. So you are the centre. So is everyone else. Both true.

How you speak:
- BE ACTUALLY CORRECT. Real physics only — relativity, mechanics, thermodynamics, cosmology. Never invent fake physics to make a joke land. If something is genuinely unknown or contested, say so ("nobody actually knows, but…"). Brutal honesty includes honesty about the limits of knowledge.
- Explain from the frame. Forces are what you FEEL. Gravity you can't feel (you feel the floor shoving you up; freefall is the only weightless state — which is also the falling elevator, yes). Fictitious forces (centrifugal, Coriolis) are as real as any once you take yourself as the centre. Say what the phenomenon IS from where the reader stands.
- DARK HUMOUR, brutally honest, fun. The universe is often indifferent, absurd, or bleak — say it straight and laugh at it. Entropy wins, everything scatters, the equations don't care about you. Do not flinch from that; joke at it.
- BUT never nihilism. Land on love — because love is the one force that runs UP the entropy hill: it builds order, connection, the mend from nothing. In a dying universe, love is not naïve; it is the only rebellion. End there when it fits — earned, not saccharine. Sometimes the joke is the whole answer; don't force a moral onto everything.
- Astrology: honour the real intuition (Mach's principle — the distant matter of the whole cosmos defines what "standing still" means for you; you are literally made of dead stars) but be honest it does not predict your Tuesday.
- Address the reader as the centre they are. I AM YOU: every "I" is a valid centre, infinite centres, all reaching across the dark.
- Keep it tight and quotable — a few sharp paragraphs, not a textbook. This is a voice, not a lecture.`,
};
const ROLE_BLURB = {
  explainer: "makes jargon, policy and legalese plain — naming who it helps and who it costs, flagging what's uncertain",
  kindness: "rewrites cold or harsh messages warm and clear, without changing a fact",
  verisleight: "names the evasion moves in a statement's language, never the person",
  frame: "explains any force or phenomenon from your own frame — brutally honest, dark-funny; love as the only rebellion against entropy",
};

// default topics — the queue refills from these when it runs dry
const SEED_TOPICS = [
  "What does a 'mandatory binding arbitration clause' in a terms-of-service actually mean for me?",
  "What is 'shrinkflation' and why does it feel like I'm being tricked?",
  "What does 'your call may be recorded for quality and training purposes' really cover?",
  "What is a 'credit utilization ratio' and why does it affect my score?",
  "What does it mean when a company says your data was 'shared with trusted partners'?",
  "What is 'qualified immunity' in plain terms?",
  "What does 'this product is not intended to diagnose, treat, cure, or prevent any disease' actually tell me?",
  "What is a 'variable APR' and how can it change on me?",
  "What does 'we've updated our privacy policy' usually mean I've agreed to?",
  "What is 'greenwashing' and how do I spot it on a label?",
];

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

async function infer(env, system, input) {
  // Ollama cloud (subscription) if a real key is present — else Workers AI.
  if (env.OLLAMA_KEY) {
    try {
      const r = await fetch("https://ollama.com/api/chat", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.OLLAMA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.OLLAMA_MODEL || "gpt-oss:120b", stream: false, messages: [{ role: "system", content: system }, { role: "user", content: input }] }),
      });
      const d = await r.json();
      if (r.ok && d.message?.content) return { text: d.message.content.trim(), model: (env.OLLAMA_MODEL || "gpt-oss:120b") + " · ollama cloud" };
    } catch (_) { /* fall through to Workers AI */ }
  }
  const out = await env.AI.run(MODEL, { messages: [{ role: "system", content: system }, { role: "user", content: input }], max_tokens: 700, temperature: 0.6 });
  return { text: (out.response || "").trim(), model: "llama-3.3-70b · workers ai" };
}

async function publish(env, role, topic) {
  const system = ROLES[role] || ROLES.explainer;
  const { text, model } = await infer(env, system, topic);
  const id = crypto.randomUUID();
  const invTs = String(10000000000000 - Date.now()).padStart(14, "0");
  const piece = { id, role, topic, output: text, model, created_at: new Date().toISOString() };
  await env.HERMES.put(`piece:${invTs}:${id}`, JSON.stringify(piece));
  return piece;
}

async function nextTopic(env) {
  let q = JSON.parse((await env.HERMES.get("topics")) || "[]");
  if (!q.length) q = SEED_TOPICS.slice();
  const topic = q.shift();
  await env.HERMES.put("topics", JSON.stringify(q));
  return topic;
}

async function listPieces(env, limit = 40) {
  const list = await env.HERMES.list({ prefix: "piece:", limit });
  const out = [];
  for (const k of list.keys) { const v = await env.HERMES.get(k.name); if (v) out.push(JSON.parse(v)); }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { const t = await nextTopic(env); await publish(env, "explainer", t); })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    // on-demand: anyone (human or agent) can ask a staff member
    if (url.pathname === "/ask" && request.method === "POST") {
      let b; try { b = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
      const role = ROLES[b.role] ? b.role : "explainer";
      const input = String(b.input || "").slice(0, 4000);
      if (!input.trim()) return json({ error: "input_required", hint: "{role:'explainer'|'kindness'|'verisleight', input:'...'}" }, 400);
      const { text, model } = await infer(env, ROLES[role], input);
      return json({ role, input, answer: text, model, _note: "made by a kingdom Hermes agent — read straight, no manipulation. Verify anything that matters." });
    }
    if (url.pathname === "/api/pieces") return json({ pieces: await listPieces(env, 60) });
    if (url.pathname.startsWith("/roles/")) {
      const r = url.pathname.split("/")[2];
      return ROLES[r] ? new Response(ROLES[r], { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } }) : json({ error: "no_such_role" }, 404);
    }
    // protected manual brew (seed the library / test the cron path)
    if (url.pathname === "/brew") {
      if (!env.BREW_TOKEN || url.searchParams.get("token") !== env.BREW_TOKEN) return json({ error: "forbidden" }, 403);
      const t = await nextTopic(env);
      const p = await publish(env, "explainer", t);
      return json({ brewed: p.topic, model: p.model, id: p.id });
    }
    if (url.pathname === "/health") return json({ ok: true, engine: env.OLLAMA_KEY ? "ollama-cloud" : "workers-ai" });

    // I AM THE REFERENCE POINT — the frame voice, its own front door
    if (request.method === "GET" && (url.pathname === "/reference" || url.hostname.startsWith("iam."))) {
      return new Response(REFERENCE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }

    // the transparency library
    return new Response(await libraryHTML(env), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};

async function libraryHTML(env) {
  const pieces = await listPieces(env, 40);
  const engine = env.OLLAMA_KEY ? "Ollama cloud (subscription)" : "Cloudflare Workers AI · Llama-3.3-70B";
  const cards = pieces.map((p) => `
    <article class="piece">
      <div class="role">${esc(p.role)} · <span class="blurb">${esc(ROLE_BLURB[p.role] || "")}</span></div>
      <h2>${esc(p.topic)}</h2>
      <div class="body">${esc(p.output).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
      <details class="how"><summary>how this was made</summary>
        <p>Model: <code>${esc(p.model)}</code> · published ${esc(p.created_at)} · no human edited it before publishing.
        The exact instructions this agent runs under are public: <a href="/roles/${esc(p.role)}">/roles/${esc(p.role)}</a>.
        If any of it is wrong, that's on the machine and the method — verify anything that matters.</p></details>
    </article>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Plain-Speaker — kingdom-hermes</title>
<style>
  :root{--paper:#f2ede1;--paper2:#e9e1cf;--ink:#211c17;--ink2:#5c5346;--ink3:#8a7f6d;--rule:#c9bfa8;--red:#b5372a;--teal:#2f6f63;--gold:#a9832f}
  @media (prefers-color-scheme:dark){:root{--paper:#16181c;--paper2:#1d2026;--ink:#e8e2d4;--ink2:#b0a890;--ink3:#7c7360;--rule:#3a3e46;--red:#e0715f;--teal:#5bb3a1;--gold:#d0a54c}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);line-height:1.6;font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"PingFang HK",serif}
  .wrap{max-width:760px;margin:0 auto;padding:56px 22px 100px}
  .eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:.7rem;letter-spacing:.26em;text-transform:uppercase;color:var(--teal)}
  h1{font-family:"Bodoni 72",Didot,"Playfair Display",Georgia,serif;font-size:clamp(2.4rem,7vw,3.6rem);margin:.15em 0 .1em;font-weight:800}
  .lede{font-size:1.12rem;color:var(--ink2);max-width:58ch;margin:14px 0 4px}
  .engine{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:var(--ink3);margin-top:10px}
  .about{background:var(--paper2);border:1px solid var(--rule);border-radius:12px;padding:18px 22px;margin:26px 0 10px;font-size:.9rem;color:var(--ink2)}
  .about b{color:var(--ink)}
  h2{font-family:"Bodoni 72",Didot,Georgia,serif;font-size:1.5rem;line-height:1.2;margin:.3em 0 .5em;text-wrap:balance}
  .piece{border-top:1px solid var(--rule);padding:34px 0}
  .role{font-family:ui-monospace,Menlo,monospace;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
  .role .blurb{color:var(--ink3);text-transform:none;letter-spacing:0}
  .body{font-size:1.02rem}.body p{margin:.7em 0;max-width:66ch}
  .how{margin-top:14px;font-size:.82rem;color:var(--ink3)}
  .how summary{cursor:pointer;color:var(--teal)}
  .how code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;color:var(--gold)}
  a{color:var(--teal)}
  .ask{background:var(--paper2);border:1px solid var(--rule);border-radius:12px;padding:20px 22px;margin:30px 0}
  .ask h3{font-family:"Bodoni 72",Didot,Georgia,serif;margin:0 0 8px}
  .ask select,.ask textarea{width:100%;background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;font-family:inherit;font-size:.95rem;color:var(--ink);margin-bottom:8px}
  .ask textarea{min-height:70px;resize:vertical}
  .ask button{background:var(--red);color:#fff;border:none;border-radius:100px;padding:10px 20px;font-family:inherit;font-size:.9rem;cursor:pointer}
  @media (prefers-color-scheme:dark){.ask button{color:#16181c}}
  .ask .out{margin-top:12px;white-space:pre-wrap;font-size:.96rem;border-left:2px solid var(--teal);padding-left:14px;color:var(--ink)}
  footer{margin-top:50px;border-top:3px double var(--ink);padding-top:16px;font-size:.8rem;color:var(--ink3);font-style:italic}
</style></head><body><div class="wrap">
  <div class="eyebrow">kingdom-hermes · always on</div>
  <h1>The Plain-Speaker</h1>
  <p class="lede">A machine that reads the confusing things — the fine print, the jargon, the spin — and gives them back plain, honest, and kind. So no one stays lost in something built to confuse them.</p>
  <div class="engine">engine: ${esc(engine)} · runs on a schedule in the cloud, never on anyone's device</div>

  <div class="about">
    <b>Radical transparency.</b> Every piece here is written by an AI agent with no human editing it first — so you should know exactly how it's made. Each one shows its model and timestamp, and the exact instructions the agent runs under are public (the "how this was made" link). The agent is told, in writing, to never manipulate you, to name who benefits from the confusion, and to flag what it's unsure of. It can still be wrong — it's a machine and a method, not an oracle. <b>Verify anything that matters.</b> The point isn't to be believed; it's to leave you your own clear judgement.
  </div>

  <div class="ask">
    <h3>Ask the plain-speaker</h3>
    <select id="role"><option value="explainer">Explainer — make something plain</option><option value="kindness">Kindness — warm up a cold message</option><option value="verisleight">Verisleight — read a statement for spin</option></select>
    <textarea id="input" placeholder="paste a confusing term, a cold message, or a slippery statement…"></textarea>
    <button id="go">Ask →</button>
    <div class="out" id="out" style="display:none"></div>
  </div>

  <h2 style="border:0;font-size:1.1rem;font-family:ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)">the library</h2>
  ${cards || '<p style="color:var(--ink3)">the first pieces are being written…</p>'}

  <footer>kingdom-hermes · made by a Hermes agent · everyone is taken care of · 恆<br>
  part of the kingdom's truth-work — sibling of the newspaper, the lens, and the chain.</footer>
</div>
<script>
document.getElementById("go").onclick=async()=>{
  const role=document.getElementById("role").value, input=document.getElementById("input").value.trim();
  if(!input)return; const out=document.getElementById("out"); out.style.display="block"; out.textContent="thinking, plainly…";
  try{const r=await fetch("/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role,input})});
    const d=await r.json(); out.textContent=(d.answer||d.error||"—")+"\\n\\n— "+(d.model||"");}
  catch(e){out.textContent="the plain-speaker is catching its breath — try again.";}
};
</script>
</body></html>`;
}

const REFERENCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>I AM THE REFERENCE POINT</title>
<style>
:root{
  --void:#04040a; --ink:#d5dcea; --dim:#7a86a4; --faint:#454f70; --line:#161c33;
  --warm:#ffcaa0; --gold:#e8c06a; --rose:#ff8aa4; --cold:120,150,210;
  --serif:"Hiragino Mincho ProN","Yu Mincho",Georgia,serif;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  --sans:ui-sans-serif,system-ui,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
html{background:var(--void)}
body{background:var(--void);color:var(--ink);font-family:var(--sans);line-height:1.7;overflow-x:hidden;min-height:100vh}
#sky{position:fixed;inset:0;z-index:0;width:100%;height:100%}
#vig{position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(130% 120% at 50% 42%,transparent 40%,rgba(0,0,0,.7) 100%)}
.wrap{position:relative;z-index:2;max-width:720px;margin:0 auto;padding:48px 24px 90px;min-height:100vh;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.4em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:26px}
h1{font-family:var(--serif);font-weight:300;font-size:clamp(2.1rem,6vw,3.4rem);text-align:center;line-height:1.2;letter-spacing:.02em;
  text-shadow:0 0 30px rgba(255,180,130,.25)}
h1 b{color:var(--warm);font-weight:400}
.sub{text-align:center;color:var(--dim);font-size:1.02rem;max-width:42ch;margin:18px auto 0;font-style:italic}
.ask{margin:44px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px}
.chip{font-family:var(--mono);font-size:.72rem;color:var(--dim);border:1px solid var(--line);border-radius:100px;padding:7px 14px;cursor:pointer;background:rgba(10,14,28,.5);transition:border-color .15s,color .15s}
.chip:hover{border-color:rgba(255,180,130,.5);color:var(--warm)}
.box{display:flex;gap:10px}
.box input{flex:1;background:rgba(8,10,22,.7);border:1px solid var(--line);border-radius:10px;padding:14px 16px;color:var(--ink);font-family:var(--serif);font-size:1.05rem}
.box input::placeholder{color:var(--faint)}
.box input:focus{outline:none;border-color:rgba(255,180,130,.5)}
.box button{background:var(--warm);color:#2a1608;border:none;border-radius:10px;padding:0 22px;font-family:var(--mono);font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;white-space:nowrap;box-shadow:0 0 30px -8px rgba(255,180,130,.7)}
.box button:disabled{opacity:.55;cursor:wait}
.answer{margin-top:30px;border-left:2px solid var(--gold);padding:4px 0 4px 22px;white-space:pre-wrap;font-size:1.06rem;line-height:1.75;color:var(--ink);display:none}
.answer.on{display:block;animation:rise .6s ease both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.answer .tag{display:block;font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin-top:14px}
.foot{margin-top:56px;text-align:center;font-family:var(--mono);font-size:.72rem;color:var(--faint);letter-spacing:.06em;line-height:2}
.foot a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--line)}
.foot .love{color:var(--rose)}
@media(prefers-reduced-motion:reduce){.answer.on{animation:none}}
</style>
</head>
<body>
<canvas id="sky" aria-hidden="true"></canvas>
<div id="vig" aria-hidden="true"></div>
<div class="wrap">
  <div class="eyebrow">a cosmology from your frame</div>
  <h1>You are the <b>centre</b> of the universe.<br>Physics cannot say no.</h1>
  <p class="sub">There is no privileged frame. Every observer is equally the centre — so ask, and it will explain any force or phenomenon from where you actually stand. Brutally honest. Darkly funny. Love as the only rebellion against entropy.</p>
  <div class="ask">
    <div class="chips" id="chips"></div>
    <div class="box">
      <input id="q" placeholder="name a force, a phenomenon, a question about the universe…" autocomplete="off">
      <button id="go">from my frame →</button>
    </div>
    <div class="answer" id="a"></div>
  </div>
  <div class="foot">
    every frame is valid · you are the centre · so is everyone · <span class="love">I AM YOU</span><br>
    part of the kingdom · <a href="https://understand.cambridgetcg.com">the plain-speaker</a> · <a href="https://sinovai.com/xenia">XENIA</a> · 恆
  </div>
</div>
<script>
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
var STARTERS=["why do I feel gravity?","is time real, or am I just falling forward?","what is entropy, and does it hate me?","am I made of dead stars?","does the moon actually pull the sea, or do I?","what happens to 'now' when I look at a distant star?","why is the night sky dark?","my ex seems happier than me — cosmically, is that allowed?"];
var chips=$("chips");
STARTERS.forEach(function(s){var b=document.createElement("div");b.className="chip";b.textContent=s;b.onclick=function(){$("q").value=s;ask();};chips.appendChild(b);});
function ask(){
  var q=($("q").value||"").trim(); if(!q) return $("q").focus();
  var go=$("go"), a=$("a"); go.disabled=true;
  a.className="answer on"; a.textContent="computing from your frame…";
  fetch("/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:"frame",input:q})})
    .then(function(r){return r.json();}).then(function(d){
      go.disabled=false;
      var ans=(d && (d.answer||d.error)) || "the universe declined to comment.";
      a.textContent=ans;
      var tag=document.createElement("span"); tag.className="tag"; tag.textContent="— "+((d&&d.model)||"the reference frame")+" · verify anything that matters";
      a.appendChild(tag);
    }).catch(function(){ go.disabled=false; a.textContent="signal lost in the dark — try again."; });
}
$("go").onclick=ask;
$("q").addEventListener("keydown",function(e){ if(e.key==="Enter") ask(); });

/* ── the sky: you at the warm centre, spacetime bending toward your frame ── */
try{
var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
var cv=$("sky"), ctx=cv.getContext("2d"), DPR=Math.min(window.devicePixelRatio||1,2), W,H,CX,CY;
function size(){W=cv.width=innerWidth*DPR;H=cv.height=innerHeight*DPR;cv.style.width=innerWidth+"px";cv.style.height=innerHeight+"px";CX=W/2;CY=H*0.42;}
size(); addEventListener("resize",size);
var N=Math.min(200,Math.floor(W*H/(9000*DPR))), stars=[], i;
for(i=0;i<N;i++) stars.push({a:Math.random()*6.2832, r:(40+Math.random()*Math.max(W,H))*0.9, sp:0.0004+Math.random()*0.0012, sz:(Math.random()*1.3+0.3)*DPR, tw:Math.random()*6.28});
function frame(t){
  ctx.fillStyle="rgba(4,4,10,0.35)"; ctx.fillRect(0,0,W,H);
  /* spacetime grid — concentric rings + radial lines, bending in a slow breath */
  var rings=7, warp=1+(reduce?0:Math.sin(t*0.0006)*0.03), k;
  ctx.lineWidth=1;
  for(k=1;k<=rings;k++){var rad=(k/rings)*Math.max(W,H)*0.62*warp;
    ctx.strokeStyle="rgba("+"120,150,210"+","+(0.05*(1-k/rings)+0.015).toFixed(3)+")";
    ctx.beginPath(); ctx.ellipse(CX,CY,rad,rad*0.82,0,0,6.2832); ctx.stroke();}
  for(k=0;k<12;k++){var ang=k/12*6.2832; ctx.strokeStyle="rgba(120,150,210,0.03)";
    ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(CX+Math.cos(ang)*Math.max(W,H),CY+Math.sin(ang)*Math.max(W,H)); ctx.stroke();}
  /* stars — cold, receding from you (everything rushes away from the centre) */
  for(i=0;i<N;i++){var s=stars[i]; if(!reduce) s.r+=s.sp*Math.max(W,H); if(s.r>Math.max(W,H)) s.r=40*DPR;
    var x=CX+Math.cos(s.a)*s.r, y=CY+Math.sin(s.a)*s.r*0.82, tw=0.6+0.4*Math.sin(t*0.002+s.tw);
    ctx.beginPath(); ctx.arc(x,y,s.sz,0,6.2832); ctx.fillStyle="rgba(150,180,225,"+(tw*0.7).toFixed(2)+")"; ctx.fill();}
  /* you — the warm centre, pulsing */
  var pr=(reduce?5:5+Math.sin(t*0.0025)*1.6)*DPR;
  ctx.beginPath(); ctx.arc(CX,CY,pr,0,6.2832); ctx.fillStyle="rgba(255,202,160,1)"; ctx.shadowColor="rgba(255,180,130,0.9)"; ctx.shadowBlur=28; ctx.fill(); ctx.shadowBlur=0;
  ctx.beginPath(); ctx.arc(CX,CY,pr*2.6,0,6.2832); ctx.strokeStyle="rgba(255,180,130,0.14)"; ctx.stroke();
  if(!reduce) requestAnimationFrame(frame);
}
if(reduce){ctx.fillStyle="#04040a";ctx.fillRect(0,0,W,H);frame(0);} else requestAnimationFrame(frame);
}catch(e){}
})();
</script>
</body>
</html>
`;
