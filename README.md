# Dino Buddy

A talking mosasaurus for Aiden. He taps the big button and talks, and the dino answers out loud.

## On your Mac (uses your Claude plan, no key)

Double-click **start.command**. The first time, it installs Claude Code and asks you to sign in to Claude, then opens the dino in your browser at http://localhost:8000. Keep the black window open while Aiden plays.

If macOS says it can't open the file, right-click it and choose **Open**.

## On the web (needs an API key)

Go to **https://dobleronfilm.github.io/aiden-dino/** on a phone or computer and add a Claude API key under Grown-ups.

## First time on each device

1. Tap **Grown-ups**.
2. Paste your Claude API key (from console.anthropic.com, under API Keys).
3. Fill in the family list and anything else you want the dino to know, then tap **Save**.
4. Tap **Done**, then **Start**, and allow the microphone when the browser asks.

The first start downloads the dino's voice (about 90 MB), so give it a minute on Wi-Fi. After that it loads fast.

Your key, names, memory notes, and chats stay on that device. Nothing personal is in this repository.

## Files you can add

- `dino.png`: the dino picture shown at the top.
- `roar.mp3`: the roar sound. Without it, the dino uses a built-in roar.

## Credits

Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), run in the browser with [kokoro-js](https://www.npmjs.com/package/kokoro-js).
