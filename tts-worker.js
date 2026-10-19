// Runs the Kokoro voice off the main thread so the page stays smooth while it talks.
// The first load downloads the free Kokoro model from Hugging Face (about 330 MB with a graphics chip, 90 MB without);
// the browser caches it after that.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;
const queue = [];
let working = false;

const progress_callback = (p) => {
  if (p.status === "progress" && p.file && p.file.endsWith(".onnx")) {
    self.postMessage({ type: "progress", pct: Math.round(p.progress || 0) });
  }
};

// The graphics chip (WebGPU) makes speech several times faster. Chrome on a Mac has it;
// anything without it uses the smaller model on the processor.
async function hasGpu() {
  try { return !!(self.navigator && navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

async function load() {
  try {
    if (await hasGpu()) {
      try {
        tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "webgpu", progress_callback });
        self.postMessage({ type: "ready", device: "webgpu" });
        return;
      } catch (err) {
        console.warn("Graphics chip voice failed, using the processor instead:", err);
      }
    }
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback });
    self.postMessage({ type: "ready", device: "wasm" });
  } catch (err) {
    self.postMessage({ type: "failed", message: String(err && err.message || err) });
  }
}

async function drain() {
  if (working) return;
  working = true;
  while (queue.length) {
    const { id, text, voice, speed } = queue.shift();
    try {
      const out = await tts.generate(text, { voice, speed: speed || 1 });
      const samples = out.audio;
      self.postMessage({ type: "audio", id, samples, rate: out.sampling_rate }, [samples.buffer]);
    } catch (err) {
      self.postMessage({ type: "audio", id, error: String(err && err.message || err) });
    }
  }
  working = false;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "load") load();
  if (msg.type === "speak") { queue.push(msg); drain(); }
  if (msg.type === "cancel") queue.length = 0;
};
