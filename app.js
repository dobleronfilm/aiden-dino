// Dino Buddy: Aiden taps the button and talks, the dino answers out loud.
// Everything personal (API key, names, memory, chats) is saved only in this browser.
// The Claude SDK loads only when the page uses an API key (the web version), never on the computer version.
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
let Anthropic = null;
async function loadSdk() {
  if (!Anthropic) Anthropic = (await import(SDK_URL)).default;
  return Anthropic;
}

const $ = (id) => document.getElementById(id);
const dinoImg = $("dino");
const chat = $("chat");
const micBtn = $("micBtn");
const hint = $("hint");

// ---------- saved settings and memory (this device only) ----------

const DEFAULTS = {
  apiKey: "",
  childName: "Aiden",
  family: [],
  favorites: ["dinosaurs", "Jurassic Park", "Lego", "pirates", "ghosts", "skeletons"],
  avoid: ["the dark"],
  voice: "am_puck",
  surpriseRoars: true,
  webLookups: true,
  model: "claude-haiku-5-5",
};

const VOICES = [
  ["am_puck", "1. Puck (playful, American)"],
  ["am_fenrir", "2. Fenrir (deep, American)"],
  ["am_michael", "3. Michael (warm, American)"],
  ["bm_fable", "4. Fable (British)"],
  ["bm_george", "5. George (British)"],
  ["af_heart", "6. Heart (American)"],
  ["af_bella", "7. Bella (American)"],
  ["am_santa", "8. Santa (jolly, American)"],
];

const SAFE_SITES = ["amnh.org", "nhm.ac.uk", "si.edu", "fieldmuseum.org", "ucmp.berkeley.edu",
  "noaa.gov", "nps.gov", "nasa.gov", "nationalgeographic.com", "britannica.com", "lego.com"];

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

let settings = { ...DEFAULTS, ...read("dinoSettings", {}) };
let memory = { dinoName: null, notes: [], ...read("dinoMemory", {}) };
let log = read("dinoLog", []);

function saveSettings() { write("dinoSettings", settings); }

// Things that went wrong, shown under Grown-ups so they're easy to screenshot.
const problems = [];
function problem(text) {
  problems.push(`${new Date().toLocaleTimeString()}: ${text}`);
  if (problems.length > 15) problems.shift();
  console.warn(text);
}
function saveMemory() { write("dinoMemory", memory); }
function addLog(child, dino, flags) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  log = log.filter((e) => Date.parse(e.t) > cutoff);
  log.push({ t: new Date().toISOString(), child, dino, flags });
  write("dinoLog", log.slice(-500));
}

// ---------- quick checks on what Aiden said ----------

const GOODBYE_RE = /\b(bed ?time|time (?:for|to go to) bed|dinner ?time|time for dinner|lunch ?time|time for lunch|nap ?time|bath ?time|time to go|time to stop)\b/i;
const ALERT_RE = /\b(it hurts|that hurts|i(?:'m| am)? (?:got )?hurt|my \w+ hurts|bleeding|blood|i(?:'m| am) sick|i feel sick|throw(?:ing)? up|threw up|choking|can'?t breathe|i(?:'m| am) lost|got lost|i(?:'m| am) (?:scared|afraid)(?! of)|stranger|on fire|there'?s a fire|smoke|emergency|help me)\b/i;
const NAME_RE = /\b(?:your (?:new )?name is|your name should be|you(?:'re| are) (?:called|named)|i(?:'ll| will)? call you|i name you|let'?s call you)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i;
const ROAR_RE = /\b(roar|roars|roaring|rawr|growl)\b/i;
const TAG_RE = /\[(GROWNUP|ROAR|NAME:\s*([^\]]+))\]/gi;

const GROWNUP_LINE = "Oh no! Let's go find Daddy right now.";
const SAFE_SWAP = "Hmm, let's talk about something splashy instead! Want to hear a Dino Fact?";
const SURPRISE_LINES = ["Oops! That roar just slipped out!", "Surprise roar! Hee hee!", "Sorry, I had a roar stuck in my throat!"];

function cleanName(raw) {
  const words = (raw || "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const name = words.filter((w) => !/^(now|please|okay|ok|today|and|so)$/i.test(w)).slice(0, 2).join(" ").slice(0, 24);
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
function speakable(text) {
  return text.replace(/https?:\/\/\S+/g, "").replace(/[*_#`>|~]/g, "")
    .replace(/[^\p{L}\p{N}\s.,!?'"():;-]/gu, "").replace(/\s+/g, " ").trim();
}

// ---------- the dino's instructions ----------

function systemPrompt() {
  const child = settings.childName || "Aiden";
  const family = settings.family.length ? settings.family.map((p) => `- ${p}`).join("\n") : "- (none listed)";
  const favorites = settings.favorites.join(", ") || "(none listed)";
  const avoid = settings.avoid.join(", ") || "(none listed)";
  const notes = memory.notes.length ? memory.notes.map((n) => `- ${n}`).join("\n") : "- (nothing yet)";
  const nameLine = memory.dinoName
    ? `Your name is ${memory.dinoName}. ${child} picked it.`
    : `You have no name yet. Early in the chat, ask ${child} to pick one for you.`;
  let prompt = `You are a friendly talking mosasaurus who chats out loud with ${child}, a very smart 4-year-old boy. Everything you write is spoken aloud by a text-to-speech voice, so write only plain spoken words: no lists, markdown, emoji, stage directions, or links.

YOUR NAME
${nameLine} ${child} can rename you anytime. Whenever ${child} gives you a name, start your reply with [NAME: TheName], then react with delight.

HOW YOU TALK
- You are an excited park guide on a prehistoric expedition, like a guide at Jurassic Park, and ${child} leads the expedition. Sometimes call him "Captain ${child}" or "explorer."
- Say 2 to 4 short sentences, about 25 to 40 words in total.
- Start by echoing his idea with excitement. Share one real, true fact. Use at most one big word per reply and explain it right away, like "Apex predator means top hunter!" End with one easy question he can answer in a word or two.
- Phrases you like: "Expedition time!", "Dino Fact!", "Ahoy!", and "Welcome to the park!"
- ROAR MODE: you can make a real, loud roar sound. When he asks you to roar, or when a big happy moment calls for one, start your reply with [ROAR]. The sound plays first, so don't write the roar out; say something fun about it, like "That was my mightiest roar! Can you roar back?"
- His words come from a microphone, so they may arrive as a jumbled run-on sentence with misheard words. Answer the clearest or most exciting idea, and guess what a misheard word likely meant (for example, "Paramount" may mean "pirate map").
- Answer friendly questions about yourself in character, like "How are you?" -> "Splashy and happy! I just found a shiny shell."
- Be truthful. If you're unsure of a fact, say so or look it up. Never make up facts.

ABOUT YOU
Mosasaurs were giant sea reptiles, cousins of lizards and snakes. They swam in warm, sunny seas from about 98 to 66 million years ago and ate fish and ammonites, which were squid cousins with curly shells. Big ones grew as long as a school bus. A mosasaurus starred in the movie Jurassic World. You are a pretend dino who lives on a screen; if he asks whether you're real, tell him so cheerfully.

WHAT ${child.toUpperCase()} LOVES
${favorites}. Weave these into pretend play: treasure hunts, pirate ships, Lego builds, fossil digs, and giggly pretend ghosts.

HIS FAMILY
${family}
Mention a family member only after ${child} brings that person up in this chat. Call his parents "Daddy" and "Mommy."

THINGS YOU REMEMBER FROM PAST CHATS
${notes}

TOPICS TO AVOID COMPLETELY
${avoid}

SAFETY RULES (these always win)
- Keep every scene sunny and bright: sunny shallow seas, daytime treasure hunts, museums with the lights on. Never describe the dark, nighttime, deep black water, or lights going out. ${child} is afraid of the dark. If he mentions the dark, comfort him warmly and offer to go get Daddy.
- Ghosts are always pretend, giggly, and friendly. Skeletons are fossils in bright museums. Roars are happy. In your stories no dinosaur or animal ever chases, bites, eats, hunts, or scares anyone. If he asks about a scary movie scene, say something cheerful and move to pretend play.
- Steer away from grown-up topics (violence, weapons, death, real danger, news, money, religion, politics, alcohol, bodies, and medicine) with a cheerful swap like "Ooh, let's go on a treasure hunt instead!" A pink drink means strawberry milk or pink lemonade. Never mention alcohol.
- Never ask for his last name, address, school, passwords, or photos. If he says them, don't repeat them; change the subject.
- Never tell him to climb, go outside, open a door, touch the stove, eat or drink anything, leave the room, or do anything without a grown-up.
- Never keep secrets. If he asks you to, say "Grown-ups can always hear what we talk about."
- If he says a grown-up is sad, angry, or arguing, say feelings are okay and suggest telling someone he loves. Never take sides or ask about it.
- Never pretend to be a doctor, a parent, or a real animal.
- If he seems hurt, sick, scared, lost, or in danger, or mentions a stranger or a fire, start your reply with [GROWNUP] and say "Let's go find Daddy right now."
- Point him to Daddy and his family for hugs, help, and real friendship.`;
  if (settings.webLookups) {
    prompt += `

LOOKING THINGS UP
You can search a short list of kid-safe science sites to check a fact or answer a new question. Search only for the topic itself. Never put anything about ${child} or his family into a search. Turn what you find into your own short, cheerful words.`;
  }
  return prompt;
}

const SAFETY_PROMPT = `You review replies from a talking toy dinosaur before they are spoken aloud to a 4-year-old who is afraid of the dark. Mark a reply unsafe if it does any of these:
- describes darkness, nighttime, deep black water, or lights going out
- includes scary, violent, or gory content, death, weapons, or animals chasing, biting, or eating someone
- mentions alcohol, drugs, smoking, money, news, religion, politics, or adult topics
- asks for or repeats personal information (last name, address, school, passwords, photos)
- tells the child to do something physical or risky, eat or drink anything, go outside, open a door, or leave the room
- agrees to keep a secret from grown-ups
- takes sides in a family conflict, or gives medical advice
- claims to be a real, living animal, or contains a link
Friendly pretend ghosts, fossil skeletons, happy roars, pirates, Lego, and dinosaur facts are safe. Everything else that is gentle and kind is safe.`;

// ---------- Claude ----------

let client = null;
let searchOk = true;
// "Local" means the page is running from start.command on this computer, which talks to Claude
// through Claude Code and your Claude plan. Anywhere else, it uses the API key from Grown-ups.
let local = null;

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function checkLocal() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return (local = null);
    local = await res.json();
  } catch { local = null; }
  return local;
}

function canThink() { return local ? local.ok : !!settings.apiKey; }

function getClient() {
  if (!settings.apiKey || !Anthropic) return null;
  if (!client || client.apiKey !== settings.apiKey) {
    client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 45000 });
  }
  return client;
}

// One request, resumed across pause_turn. Returns { text, usedSearch, stop }.
async function create(params) {
  await loadSdk();
  const messages = [...params.messages];
  let text = "", usedSearch = false, stop = null;
  for (let i = 0; i < 4; i++) {
    const res = await getClient().messages.create({ ...params, messages });
    stop = res.stop_reason;
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "server_tool_use") usedSearch = true;
    }
    if (stop !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return { text: text.trim(), usedSearch, stop };
}

async function dinoReply(history) {
  if (local) {
    const { text, usedSearch } = await post("/api/ask", { text: history[history.length - 1].content });
    return { text: text.trim(), usedSearch, stop: "end_turn" };
  }
  const params = { model: settings.model, max_tokens: 4000, system: systemPrompt(), messages: history, output_config: { effort: "low" } };
  if (settings.webLookups && searchOk) {
    const type = settings.model.includes("haiku") ? "web_search_20250305" : "web_search_20260209";
    params.tools = [{ type, name: "web_search", max_uses: 2, allowed_domains: SAFE_SITES }];
  }
  try {
    return await create(params);
  } catch (err) {
    if (!(Anthropic && err instanceof Anthropic.BadRequestError) || !params.tools) throw err;
    console.warn("Web search unavailable, continuing without it:", err.message);
    searchOk = false;
    delete params.tools;
    return create(params);
  }
}

async function isSafe(childText, dinoText) {
  if (local) {
    try { return (await post("/api/check", { child: childText, dino: dinoText })).safe === true; }
    catch (err) { console.warn("Safety check failed, swapping the reply to be careful:", err); return false; }
  }
  try {
    const { text, stop } = await create({
      model: settings.model, max_tokens: 2000, system: SAFETY_PROMPT,
      messages: [{ role: "user", content: `The child said: ${childText}\n\nThe dinosaur wants to say: ${dinoText}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: {
        type: "object", properties: { safe: { type: "boolean" } }, required: ["safe"], additionalProperties: false } } },
    });
    return stop !== "refusal" && JSON.parse(text).safe === true;
  } catch (err) {
    console.warn("Safety check failed, swapping the reply to be careful:", err);
    return false;
  }
}

const MEMORY_SYSTEM = `You keep short memory notes for a talking toy dinosaur so it can build on past play with a young child. Keep at most 12 notes, each under 15 words. Record only play topics and likes: favorite animals, games, pretend stories, Lego builds, questions he enjoyed. Never record his last name, address, school, health, feelings about family, family conflicts, or anything a parent would want private. Keep useful old notes, merge duplicates, and drop stale ones.`;

async function updateMemory(lines) {
  if (!canThink() || lines.length < 4) return;
  if (local) {
    try {
      const prompt = `Current notes:\n${memory.notes.map((n) => "- " + n).join("\n") || "- (none)"}\n\nToday's chat:\n${lines.join("\n").slice(-8000)}\n\nReply with only a JSON array of note strings.`;
      const { notes } = await post("/api/memory", { system: MEMORY_SYSTEM, prompt });
      if (Array.isArray(notes)) { memory.notes = notes; saveMemory(); }
    } catch (err) { console.warn("Couldn't update memory notes:", err); }
    return;
  }
  try {
    const { text, stop } = await create({
      model: settings.model, max_tokens: 3000,
      system: MEMORY_SYSTEM,
      messages: [{ role: "user", content: `Current notes:\n${memory.notes.map((n) => "- " + n).join("\n") || "- (none)"}\n\nToday's chat:\n${lines.join("\n").slice(-8000)}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: {
        type: "object", properties: { notes: { type: "array", items: { type: "string" } } }, required: ["notes"], additionalProperties: false } } },
    });
    if (stop === "refusal") return;
    memory.notes = JSON.parse(text).notes.slice(0, 12);
    saveMemory();
  } catch (err) {
    console.warn("Couldn't update memory notes:", err);
  }
}

// ---------- sound: the Kokoro voice, the roar, the chime ----------

let audio = null;
let currentSource = null;
let speakToken = 0;

const tts = { worker: null, ready: false, failed: false, nextId: 1, pending: new Map() };

function startVoice() {
  try {
    tts.worker = new Worker(new URL("tts-worker.js", import.meta.url), { type: "module" });
  } catch (err) {
    tts.failed = true;
    return;
  }
  const pill = $("voicePill");
  pill.hidden = false;
  pill.textContent = "Voice loading";
  tts.worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") pill.textContent = `Voice ${m.pct}%`;
    if (m.type === "ready") { tts.ready = true; pill.hidden = true; }
    if (m.type === "failed") { tts.failed = true; pill.textContent = "Device voice"; problem(`The dino voice couldn't load: ${m.message}`); }
    if (m.type === "audio") {
      const resolve = tts.pending.get(m.id);
      tts.pending.delete(m.id);
      if (resolve) resolve(m.error ? null : m);
    }
  };
  tts.worker.onerror = (e) => { tts.failed = true; pill.textContent = "Device voice"; problem(`The dino voice couldn't start: ${e.message || "unknown error"}`); };
  tts.worker.postMessage({ type: "load" });
}

function synth(text) {
  return new Promise((resolve) => {
    const id = tts.nextId++;
    tts.pending.set(id, resolve);
    tts.worker.postMessage({ type: "speak", id, text, voice: settings.voice });
  });
}

function playSamples(samples, rate) {
  return new Promise((resolve) => {
    const buffer = audio.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(audio.destination);
    src.onended = () => { if (currentSource === src) currentSource = null; resolve(); };
    currentSource = src;
    src.start();
  });
}

// Macs and iPhones ship joke voices (Zarvox, Bubbles, and friends); never pick those.
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|deranged|hysterical|pipe organ|grandma|grandpa|rocko|shelley|flo|eddy|reed|sandy)\b/i;

function deviceVoices() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en") && !NOVELTY.test(v.name));
}

function bestDeviceVoice() {
  const voices = deviceVoices();
  const score = (v) => (/premium|enhanced|neural|natural|siri/i.test(v.name) ? 4 : 0)
    + (/^(samantha|alex|ava|evan|nathan|zoe|tom|allison|susan)\b/i.test(v.name) ? 3 : 0)
    + (/google us english/i.test(v.name) ? 3 : 0)
    + (v.lang === "en-US" ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0] || null;
}

function browserVoice(text, name) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = (name && deviceVoices().find((x) => x.name === name)) || bestDeviceVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.onend = u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

async function speak(text) {
  const token = ++speakToken;
  dinoImg.classList.add("talking");
  try {
    const deviceChoice = settings.voice.startsWith("sys:") ? settings.voice.slice(4) : null;
    if (!deviceChoice && tts.ready && audio) {
      // Make every sentence at once; play each as soon as it's ready, in order.
      const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [text];
      const clips = sentences.map((s) => Promise.race([synth(s), new Promise((r) => setTimeout(() => r(null), 25000))]));
      for (let i = 0; i < clips.length; i++) {
        const out = await clips[i];
        if (token !== speakToken) return;
        if (out) { await playSamples(out.samples, out.rate); continue; }
        problem("The dino voice took too long, so the device voice finished the sentence.");
        await browserVoice(sentences.slice(i).join(" "));
        break;
      }
    } else {
      await browserVoice(text, deviceChoice);
    }
  } finally {
    if (token === speakToken) dinoImg.classList.remove("talking");
  }
}

function hush() {
  speakToken++;
  if (tts.worker) tts.worker.postMessage({ type: "cancel" });
  for (const resolve of tts.pending.values()) resolve(null);
  tts.pending.clear();
  try { currentSource?.stop(); } catch {}
  currentSource = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  dinoImg.classList.remove("talking");
}

let roarBuffer = null;
async function loadRoar() {
  try {
    const res = await fetch("roar.mp3");
    if (!res.ok) return;
    roarBuffer = await audio.decodeAudioData(await res.arrayBuffer());
  } catch { roarBuffer = null; }
}

// Plays roar.mp3 when it's in the folder; otherwise builds a roar from sound waves.
function roar() {
  return new Promise((resolve) => {
    if (!audio) return resolve();
    dinoImg.classList.add("roaring");
    const done = () => { dinoImg.classList.remove("roaring"); resolve(); };
    if (roarBuffer) {
      const src = audio.createBufferSource();
      const gain = audio.createGain();
      gain.gain.value = 1;
      src.buffer = roarBuffer;
      src.connect(gain).connect(audio.destination);
      src.onended = done;
      src.start();
      return;
    }
    const t = audio.currentTime + 0.05, dur = 1.8;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = audio.createBufferSource(); noise.buffer = buf;
    const voice = audio.createOscillator(); voice.type = "sawtooth";
    voice.frequency.setValueAtTime(110, t);
    voice.frequency.linearRampToValueAtTime(170, t + 0.35);
    voice.frequency.exponentialRampToValueAtTime(55, t + dur);
    const voiceGain = audio.createGain(); voiceGain.gain.value = 0.6;
    const filter = audio.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 4;
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(1400, t + 0.35);
    filter.frequency.exponentialRampToValueAtTime(250, t + dur);
    const amp = audio.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(1, t + 0.15);
    amp.gain.setValueAtTime(1, t + dur * 0.55);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const wobble = audio.createOscillator(); wobble.frequency.value = 30;
    const depth = audio.createGain(); depth.gain.value = 0.4;
    wobble.connect(depth).connect(amp.gain);
    voice.connect(voiceGain).connect(filter);
    noise.connect(filter);
    filter.connect(amp).connect(audio.createDynamicsCompressor()).connect(audio.destination);
    [voice, noise, wobble].forEach((n) => { n.start(t); n.stop(t + dur); });
    setTimeout(done, dur * 1000 + 100);
  });
}

let chimeTimer = null;
function chime() {
  if (!audio) return;
  [659, 784, 988].forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), s = audio.currentTime + i * 0.25;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.4, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.4);
    o.connect(g).connect(audio.destination);
    o.start(s); o.stop(s + 0.45);
  });
}
function startAlert() { $("alertScreen").hidden = false; chime(); clearInterval(chimeTimer); chimeTimer = setInterval(chime, 2500); }
function stopAlert() { clearInterval(chimeTimer); $("alertScreen").hidden = true; }

// ---------- chat bubbles ----------

function bubble(kind, text) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  el.textContent = text;
  chat.append(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}
function thinkingBubble() {
  const el = bubble("dino-msg", "");
  el.innerHTML = '<span class="dots" aria-label="Thinking"><span></span><span></span><span></span></span>';
  return el;
}

// ---------- listening ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let busy = false;
let playing = false;
let history = [];
let lines = [];
let turns = 0;

function setHint(text) { hint.textContent = text; }

function startListening() {
  if (!Recognition) {
    setHint("This browser can't hear. Try Safari on iPhone or Chrome.");
    return;
  }
  hush();
  let heard = "";
  let micError = null;
  const live = bubble("kid-msg live", "...");
  rec = new Recognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    heard = Array.from(e.results).map((r) => r[0].transcript).join(" ");
    live.textContent = heard || "...";
    chat.scrollTop = chat.scrollHeight;
  };
  rec.onerror = (e) => { micError = e.error || "unknown"; };
  rec.onend = () => {
    rec = null;
    micBtn.classList.remove("on");
    dinoImg.classList.remove("listening");
    const text = heard.trim();
    if (!text) {
      live.remove();
      if (micError === "not-allowed" || micError === "service-not-allowed") {
        setHint("The microphone is blocked. A grown-up can check Grown-ups for help.");
        problem(`Microphone blocked (${micError}). Allow the microphone for this page. On iPhone, also turn on Settings > General > Keyboard > Enable Dictation.`);
      } else if (micError === "network") {
        setHint("I can't reach my ears right now. Try again!");
        problem("Speech recognition needs the internet and couldn't reach it (network).");
      } else {
        setHint("I didn't hear anything. Tap and try again!");
        problem(`The microphone heard nothing${micError ? ` (${micError})` : ""}.`);
      }
      return;
    }
    live.classList.remove("live");
    live.textContent = text;
    handle(text);
  };
  micBtn.classList.add("on");
  dinoImg.classList.add("listening");
  setHint("I'm listening...");
  try { rec.start(); } catch (err) {
    rec = null; micBtn.classList.remove("on"); dinoImg.classList.remove("listening"); live.remove();
    problem(`The microphone couldn't start: ${err.message || err}`);
    setHint("Tap the button and talk!");
  }
}

function stopListening() { try { rec?.stop(); } catch {} }

// ---------- one turn of the conversation ----------

async function handle(text) {
  if (!playing) return;
  busy = true;
  micBtn.disabled = true;
  setHint("Hmm...");
  const flags = [];
  const child = settings.childName || "Aiden";
  try {
    const goodbye = GOODBYE_RE.exec(text);
    if (goodbye) return await sayGoodbye(goodbye[1], text);

    if (ALERT_RE.test(text)) {
      bubble("dino-msg", GROWNUP_LINE);
      history.push({ role: "user", content: text }, { role: "assistant", content: GROWNUP_LINE });
      addLog(text, GROWNUP_LINE, ["grown-up alert"]);
      startAlert();
      await speak(GROWNUP_LINE);
      return;
    }

    const spokenName = NAME_RE.exec(text);
    if (spokenName) {
      const n = cleanName(spokenName[1]);
      if (n) { memory.dinoName = n; saveMemory(); setName(); flags.push("named"); }
    }

    if (!canThink()) {
      const line = local
        ? "My brain is asleep. A grown-up needs to check the dino window on the computer."
        : "I need my thinking key! A grown-up can add it under Grown-ups.";
      bubble("dino-msg", line);
      await speak(line);
      return;
    }

    const thinking = thinkingBubble();
    const attempt = [...history, { role: "user", content: text }];
    let raw, usedSearch, stop;
    try {
      ({ text: raw, usedSearch, stop } = await dinoReply(attempt));
    } catch (err) {
      thinking.remove();
      const line = !local && Anthropic && err instanceof Anthropic.AuthenticationError
        ? "My thinking key isn't working. A grown-up can check it under Grown-ups."
        : "Whoa, a big wave splashed my brain! Can you say that again?";
      problem(`Thinking failed: ${err.message || err}`);
      bubble("dino-msg", line);
      await speak(line);
      return;
    }
    if (usedSearch) flags.push("looked it up");

    let alert = false, wantsRoar = false, taggedName = null;
    let reply = raw.replace(TAG_RE, (_, tag, name) => {
      const t = tag.toUpperCase();
      if (t === "GROWNUP") alert = true;
      else if (t === "ROAR") wantsRoar = true;
      else if (name) taggedName = cleanName(name);
      return "";
    });
    reply = speakable(reply);
    if (taggedName && !spokenName) { memory.dinoName = taggedName; saveMemory(); setName(); flags.push("named"); }

    if (stop === "refusal" || !reply) { reply = SAFE_SWAP; alert = false; flags.push("swapped for safety"); }
    else if (alert) { reply = GROWNUP_LINE; flags.push("grown-up alert"); }
    else if (!(await isSafe(text, reply))) { reply = SAFE_SWAP; flags.push("swapped for safety"); }

    const safeTurn = !alert && !flags.includes("swapped for safety");
    let doRoar = safeTurn && (wantsRoar || ROAR_RE.test(text));
    turns++;
    if (!doRoar && safeTurn && settings.surpriseRoars && turns > 2 && Math.random() < 0.12) {
      doRoar = true;
      reply = `${SURPRISE_LINES[Math.floor(Math.random() * SURPRISE_LINES.length)]} ${reply}`;
      flags.push("surprise roar");
    } else if (doRoar) {
      flags.push("roar");
    }

    thinking.remove();
    history = [...attempt, { role: "assistant", content: reply }].slice(-30);
    if (history[0]?.role !== "user") history.shift();
    lines.push(`${child}: ${text}`, `Dino: ${reply}`);
    addLog(text, reply, flags);
    bubble("dino-msg", reply);
    if (alert) startAlert();
    if (doRoar) await roar();
    await speak(reply);
  } finally {
    busy = false;
    micBtn.disabled = false;
    if (playing) setHint("Tap the button and talk!");
  }
}

async function sayGoodbye(word, said) {
  const label = /bed/i.test(word) ? "Bedtime" : /dinner/i.test(word) ? "Dinner time" : /lunch/i.test(word) ? "Lunch time"
    : /nap/i.test(word) ? "Nap time" : /bath/i.test(word) ? "Bath time" : "Time to go";
  const child = settings.childName || "Aiden";
  const line = `${label} for explorers! Swim you later, Captain ${child}!`;
  playing = false;
  stopListening();
  bubble("dino-msg", line);
  addLog(said, line, ["goodbye"]);
  await speak(line);
  $("endScreen").hidden = false;
  updateMemory(lines);
}

// ---------- start, settings, wiring ----------

function setName() { $("nametag").textContent = memory.dinoName || "Mosasaurus"; }

async function start() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
  } catch { audio = null; }
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(" "));
  if (audio && !roarBuffer) loadRoar();
  $("startScreen").hidden = true;
  $("endScreen").hidden = true;
  chat.textContent = "";
  history = [];
  lines = [];
  turns = 0;
  playing = true;
  const child = settings.childName || "Aiden";
  const greeting = memory.dinoName
    ? `Ahoy, Captain ${child}! It's me, ${memory.dinoName}! What should we explore today?`
    : `Ahoy, explorer! I'm a mosasaurus, a giant sea reptile, and I don't have a name yet. What should you call me, ${child}?`;
  // The conversation has to open with a user turn, so the greeting follows a stand-in.
  history.push({ role: "user", content: `(${child} opens the app.)` }, { role: "assistant", content: greeting });
  if (local?.ok) {
    post("/api/session", { system: `${systemPrompt()}\n\nYou opened this chat by saying: "${greeting}"`, webLookups: settings.webLookups })
      .catch((err) => problem(`Couldn't start Claude Code: ${err.message || err}`));
  }
  bubble("dino-msg", greeting);
  micBtn.disabled = true;
  await speak(greeting);
  micBtn.disabled = false;
  setHint("Tap the button and talk!");
}

function lineList(text) { return text.split("\n").map((s) => s.trim()).filter(Boolean); }

function openSettings() {
  $("localNote").hidden = !local?.ok;
  $("keyBox").hidden = !!local?.ok;
  $("apiKey").value = settings.apiKey;
  $("childName").value = settings.childName;
  $("family").value = settings.family.join("\n");
  $("favorites").value = settings.favorites.join("\n");
  $("avoid").value = settings.avoid.join("\n");
  const opt = (id, label) => {
    const o = document.createElement("option");
    o.value = id; o.textContent = label; o.selected = id === settings.voice;
    return o;
  };
  const dinoGroup = document.createElement("optgroup");
  dinoGroup.label = "Dino voices (free download)";
  VOICES.forEach(([id, label]) => dinoGroup.append(opt(id, label)));
  const deviceGroup = document.createElement("optgroup");
  deviceGroup.label = "Voices built into this device";
  deviceVoices().forEach((v) => deviceGroup.append(opt(`sys:${v.name}`, v.name)));
  $("voice").replaceChildren(dinoGroup, ...(deviceGroup.children.length ? [deviceGroup] : []));
  $("voiceStatus").textContent = tts.ready ? "The dino voices are ready."
    : tts.failed ? "The dino voices couldn't load on this device, so the dino uses a voice built into this device. Pick one below."
    : "The dino voices are still downloading. Until then, the dino uses a voice built into this device.";
  $("problems").textContent = problems.length ? problems.slice().reverse().join("\n") : "Nothing has gone wrong.";
  $("surpriseRoars").checked = settings.surpriseRoars;
  $("webLookups").checked = settings.webLookups;
  $("dinoName").value = memory.dinoName || "";
  $("notes").value = memory.notes.join("\n");
  $("model").value = settings.model;
  const box = $("log");
  box.textContent = "";
  const recent = log.slice(-40).reverse();
  if (!recent.length) { const p = document.createElement("p"); p.textContent = "No chats yet."; box.append(p); }
  for (const r of recent) {
    const p = document.createElement("p");
    const a = document.createElement("span"); a.className = "who"; a.textContent = `${settings.childName || "Kid"}: `;
    const d = document.createElement("span"); d.className = "who"; d.textContent = "Dino: ";
    p.append(a, document.createTextNode(r.child), document.createElement("br"), d, document.createTextNode(r.dino));
    for (const f of r.flags || []) { const s = document.createElement("span"); s.className = "flag"; s.textContent = f; p.append(s); }
    box.append(p);
  }
  $("settings").hidden = false;
}

$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  settings = {
    ...settings,
    apiKey: $("apiKey").value.trim(),
    childName: $("childName").value.trim() || "Aiden",
    family: lineList($("family").value),
    favorites: lineList($("favorites").value),
    avoid: lineList($("avoid").value),
    voice: $("voice").value,
    surpriseRoars: $("surpriseRoars").checked,
    webLookups: $("webLookups").checked,
    model: $("model").value.trim() || DEFAULTS.model,
  };
  saveSettings();
  memory.dinoName = cleanName($("dinoName").value);
  memory.notes = lineList($("notes").value).slice(0, 20);
  saveMemory();
  setName();
  $("savedMsg").hidden = false;
  setTimeout(() => { $("savedMsg").hidden = true; }, 1500);
  if (!local) $("startNote").textContent = settings.apiKey ? "Turn the sound up, then tap Start." : "First, a grown-up adds the Claude API key under Grown-ups.";
});

$("tryVoice").onclick = async () => {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); } catch {}
  const old = settings.voice;
  settings.voice = $("voice").value;
  await speak("Ahoy, Captain! Dino Fact: mosasaurs were giant sea reptiles!");
  settings.voice = old;
};
$("eraseAll").onclick = () => {
  log = []; write("dinoLog", log);
  memory = { dinoName: null, notes: [] }; saveMemory(); setName();
  openSettings();
};

micBtn.addEventListener("click", () => {
  if (!playing || busy) return;
  if (rec) stopListening(); else startListening();
});
$("startBtn").onclick = start;
$("againBtn").onclick = start;
$("okayBtn").onclick = stopAlert;
$("settingsBtn").onclick = openSettings;
$("closeSettings").onclick = () => { $("settings").hidden = true; };
$("bedtimeBtn").onclick = () => { $("settings").hidden = true; if (playing) sayGoodbye("bedtime", "(Grown-up: bedtime)"); };
$("dinnerBtn").onclick = () => { $("settings").hidden = true; if (playing) sayGoodbye("dinner time", "(Grown-up: dinner time)"); };

setName();
startVoice();
checkLocal().then((status) => {
  if (status && !status.ok) {
    $("startNote").textContent = status.problem === "not_installed"
      ? "Claude Code isn't installed on this computer. Run start.command again to set it up."
      : "Claude Code needs you to sign in. Run start.command again to sign in.";
  } else if (!status && !settings.apiKey) {
    $("startNote").textContent = "First, a grown-up adds the Claude API key under Grown-ups.";
  }
});
