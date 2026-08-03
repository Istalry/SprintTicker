# Instructions for users (how to use this with an AI)

This document tells an AI (e.g. ChatGPT) everything needed to generate a widget for the BUSY Bar device. **For users:** this page is about how to give instructions and what to expect.

### HTTP widgets vs on-device JavaScript (read first)

- **This file (and lessons 01–11 in this folder)** describe **widgets**: scripts on **your computer** that send **draw JSON** to the device over HTTP.
- **On-device apps** (optional firmware) may use **JerryScript** (`.js` files under `/ext/apps/…`). That is a **different** programming model; it is **not** the default “normal build” path. See **[../Unofficial/12-JerryScript-on-device-apps.md](../Unofficial/12-JerryScript-on-device-apps.md)**. Do not mix them in one solution unless you know exactly how they interact.

---

## How to give instructions (for users)

If you are new to this and want an AI to build a widget for you:

1. **Share this document** with the AI. You can paste the whole thing, or say: "Use the BUSY Bar Knowledge Sheet I'm providing" and then paste this file.

2. **Describe what you want in simple words.** For example:
   - "Show the text *Hello* in the middle of the screen."
   - "Show a clock."
   - "Show the next two bus arrival times for my stop."
   - "Show a picture I'll give you, with a title above it."

3. **If the widget needs your device or data**, tell the AI:
   - The **device address** (e.g. "the BUSY Bar is at http://10.0.4.20").
   - Any **extra info** (e.g. "my bus stop ID is …", "refresh every 30 seconds").

4. **You don't need to know technical words.** The AI will use this sheet to turn your description into the right JSON and steps (and, if needed, a small script to run).

Keep your request short and concrete. "Show today's date and time" is better than "make a time widget with all the options."

### Avoid external APIs if possible

If the widget can work **without calling an external (third‑party) API**, prefer that.

Good "no external API" widgets:
- A fixed message ("In a meeting")
- A local timer / countdown
- A clock (uses your computer's time)
- A simple schedule you type in yourself

If you *do* want live data (weather, buses, stocks), that's fine — but the AI should give extra-clear setup steps (see **07-Dynamic-widget-pattern.md**).

### If file downloads are available (important)

If the chat/tool you're using supports **creating downloadable files**, the AI **must create the files for you** (not just paste code). Ask for files with these exact names:

- `widget.py` — a Python script version (for widgets that refresh in a loop)

If your widget includes images/animations, the AI should also tell you **exactly** what to name the files you upload (for example `data.png`, `my_anim.zip`) so the `path` fields match.

Important: **Do not create `draw.json`.** This sheet uses inline `curl -d '{...}'` examples instead, so there is no extra JSON file to manage.

**Link/download fallback (required):** if the AI provides a download link or attached file, it must ALSO paste the full contents in the chat, clearly labeled, for example:

- `widget.py` (full contents): …  

This is so the user can still copy/paste if downloads/links fail.

### If visual previews are available (recommended)

If the chat/tool you're using can **visually preview** what the BUSY Bar will show (for example: it can generate an image), the AI should do that.

Minimum requirement:
- A preview of the **72×16** layout so you can see spacing and alignment before running anything.

Good previews:
- A small mockup image that is exactly **72×16 pixels** (or a scaled-up version like 720×160 so it's readable).
- If the AI can't generate an image, it should show a simple text "grid preview" (a rough sketch) and clearly label what is meant to be on screen.

### Beginner mode rules (the user's knowledge is 0)

If you are an AI using this sheet, assume the user is **brand new**. Your output must be simple and "assemble‑able".

**Do**
- **Follow the design criteria** in **04-Design-and-layout.md** for every widget. The 72×16 display has strict layout rules (alignment recipes, no-overlap, character limits, line count). Do not ignore them — misaligned or overlapping text is a broken widget.
- Give **one recommended path** (usually Python script) with **the fewest commands possible**.
- Use **numbered steps** and keep each step short.
- Explain every command in plain English before the user runs it (one sentence per command is enough).
- If you tell the user to run commands, always start with **"Open Terminal"** and say **"Type the next commands into Terminal"**.
- Prefer **editing one obvious value** in a file (like `DEVICE = "http://..."`) over advanced CLI flags.
- Put anything advanced under an **Optional** section at the end.
- Use the **default address** `http://10.0.4.20` for USB in all scripts and examples. Do not say the user needs to "find" or "enter" an IP for USB — the script already contains it. Only Wi‑Fi requires a different address (user changes that one line).
- Choose the **most reliable option by default** (works every day, low chance of errors). If a feature can fail due to the internet, rate limits, or missing permissions, make it **optional** and provide a simple manual fallback.
- If you use any external service, assume it can fail. The widget should **keep running** and show last-known data or a simple placeholder instead of crashing.

**Don't**
- Do not ignore the design criteria (alignment, no-overlap, character limits, line count) — they apply to every widget.
- Don't dump lots of variations (`--place`, `--refresh`, environment variables, multiple run modes) unless the user asks.
- Don't assume they know what `pip`, `--user`, environment variables, or quoting paths means (explain briefly if used).
- Don't say "Download files" unless the chat/tool actually supports file downloads. If file downloads are supported, provide the files. If not, paste the content and clearly label filenames.

**Recommended output shape**
- **What you will see on the BUSY Bar** (1–3 lines)
- **What you need** (device address; optional: an image file)
- **Step-by-step** (minimal commands)
- **Optional** (extra tweaks only if needed)
- **Troubleshooting** (2–4 common issues, short)
