// Runs the Kokoro voice off the main thread so the page stays smooth while it talks.
// The first load downloads the free Kokoro model (about 90 MB) from Hugging Face; the browser caches it after that.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;
const queue = [];
let working = false;

async function load() {
  try {
    tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress" && p.file && p.file.endsWith(".onnx")) {
          self.postMessage({ type: "progress", pct: Math.round(p.progress || 0) });
        }
      },
    });
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "failed", message: String(err && err.message || err) });
  }
}

async function drain() {
  if (working) return;
  working = true;
  while (queue.length) {
    const { id, text, voice } = queue.shift();
    try {
      const out = await tts.generate(text, { voice });
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
