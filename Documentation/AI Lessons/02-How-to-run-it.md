# How to run it (for users)

This is the **most reliable** way to run a widget: use one Python script file (`widget.py`).  
(We avoid extra files like `draw.json`.)

---

## How to run it

**Before you start:** The BUSY Bar must be in **Off** mode or **Apps** mode for the API to work. If the device is in another mode, your widget won't appear. Switch it to Off or Apps on the device (or via the desktop app) before running the script.

1) **Download the script**

- If the chat/tool can provide a file link or attachment, it should be a single Python file (example name: **`widget.py`**).
- If a link/file can't be provided, there should be a **written-out version** in **09-Widget-template.md** that you can copy/paste into a file.

2) **Give the file a unique name (recommended)**

To avoid confusion (and to keep multiple widgets side-by-side), rename the script to something unique and descriptive, for example:

- `busybar_clock.py`
- `busybar_weather.py`
- `busybar_meeting_sign.py`

3) **Put the script in a folder**

- **Downloads is fine**.

4) **Device address**

Over **USB**, the address is **always** `http://10.0.4.20`. The script already has this line near the top — you do **not** need to look up or enter any IP when using USB:

```python
DEVICE = "http://10.0.4.20"
```

Leave it as-is for USB. **Only if** your BUSY Bar is connected over **Wi‑Fi** (not USB) do you need to change that line to your device's Wi‑Fi address (e.g. `http://192.168.1.50`). Wi‑Fi addresses differ per network; USB does not.

5) **Open Terminal**

- macOS: Applications → Utilities → Terminal  
- You will type the next commands into Terminal

6) **Install Python dependencies**

This installs the libraries the script uses to talk to the BUSY Bar and (optionally) generate a small icon.

Copy this into Terminal, then press Enter:

```bash
python3 -m pip install --user requests pillow
```

7) **Run the script (easy way: drag-and-drop)**

This is the easiest and most reliable way because Terminal will use the **exact full path** to the file.

Type `python3 ` (with a trailing space) into Terminal, then **drag your script file from Finder into Terminal**, then press Enter.

How drag-and-drop works (simple):

- Open Finder and locate your `widget.py` file (for example in Downloads).
- Click and hold `widget.py`, then drag it over the Terminal window, then let go.
- Terminal will automatically paste the **full file path** for you (so you don't have to type it).
  - This also avoids problems with **spaces** in folder/file names.
- After you drop the file, press Enter to run it.

It will look like this (example):

```bash
python3 /Users/yourname/Downloads/busybar_clock.py
```

Important: **don't just type** `python3 widget.py` unless you *know* Terminal is already in the same folder as the file. Drag-and-drop avoids that whole problem.

8) **Stop it**

Press `Ctrl+C` in Terminal.

---

## If you need a virtual environment (optional)

Some setups require or prefer a Python virtual environment (venv). Use it only if you need it.

1. **Create and activate a venv** (in the folder where your script lives, or in a folder you'll `cd` to):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
   (On Windows: `venv\Scripts\activate`.)

2. **Install dependencies inside the venv:**
   ```bash
   pip install requests pillow
   ```

3. **Run the script** the same way (e.g. drag-and-drop: `python3 /path/to/widget.py`). Use the same `python3` that's in your path after activating the venv.

When you're done, type `deactivate` to leave the venv. Next time, activate the venv again before running the widget.

---

## Quick "is my device reachable?" test (optional)

Copy this into Terminal (uses the default USB address; if you're on Wi‑Fi, replace with your device IP):

```bash
curl -s http://10.0.4.20/api/version
```

If it prints JSON, your connection is working.

---

## One-off send (no script) (optional)

If you just want to push a quick test message without running a script (default USB address; use your Wi‑Fi IP if needed):

```bash
curl -X POST "http://10.0.4.20/api/display/draw" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"my_app","elements":[{"id":"1","type":"text","text":"Hello, World!","x":36,"y":8,"align":"center","font":"medium","color":"#FFFFFFFF","display":"front"}]}'
```

---

## Local AI in Widget Builder (Ollama)

If you want Widget Builder AI to run locally on your computer:

1) Install Ollama:

- macOS / Windows: follow the installer at Ollama's official site.

2) Download a model (recommended first):

```bash
ollama pull qwen2.5-coder:14b
```

Fallback for lower memory:

```bash
ollama pull qwen2.5-coder:7b
```

3) In Widget Builder settings:

- Provider: **Local**
- Local Base URL: `http://localhost:11434/v1`
- Local Model: `qwen2.5-coder:14b` (or `qwen2.5-coder:7b`)
- If your local endpoint does not require a key, keep **Local endpoint does not require API key** enabled.

4) Optional quick endpoint check:

```bash
curl -s http://localhost:11434/api/tags
```

If this prints JSON with models, local AI is ready.
