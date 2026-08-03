## BUSY Bar Start Listener — How It Works

This document explains how `busybar_start_listener.py` works and how it integrates with `busybar_typing_wpm.py` and the BUSY Bar U5 CLI.

---

### Overview

- **Goal**: Start the local typing-speed script (`busybar_typing_wpm.py`) automatically when you press the **Start** button on the BUSY Bar.
- **Mechanism**: A Python script runs on your Mac, opens a telnet CLI session to the BUSY Bar, runs `input dump` to watch input events, and when it sees the `InputKeyStart` press event, it launches the WPM script.

There are two main pieces:

- `busybar_typing_wpm.py`: draws the typing-speed UI on the BUSY Bar and tracks your keystrokes.
- `busybar_start_listener.py`: listens for the BUSY Bar’s Start button and starts `busybar_typing_wpm.py`.

---

### What the BUSY Bar CLI does

The BUSY Bar exposes a simple CLI over telnet:

- You connect with `telnet 10.0.4.20`.
- After the banner and prompt (`>:`), you can run `input dump`.
- While `input dump` is active, pressing the physical Start button prints lines like:

  ```text
  key: InputKeyStart type: InputTypePress
  key: InputKeyStart type: InputTypeShort
  key: InputKeyStart type: InputTypeRelease
  ```

These lines are what the listener script watches for.

---

### What `busybar_start_listener.py` does

Key configuration at the top of the script:

- **`BUSYBAR_HOST`**: IP/hostname of the BUSY Bar CLI (same host you telnet to).
- **`TRIGGER_KEY_NAME`**: `"InputKeyStart"` — the logical key name from `input dump`.
- **`TRIGGER_EVENT_TYPE`**: `"InputTypePress"` — the event type that triggers the action.
- **`TYPING_SCRIPT`**: `"busybar_typing_wpm.py"` — the local Python script to run.

The script runs an infinite loop:

1. **Start telnet and enter `input dump`**
   - Spawns the system `telnet` client:
     ```text
     telnet 10.0.4.20
     ```
   - Waits briefly for the banner.
   - Sends:
     - a blank line (simulates you pressing Enter to reach the `>:` prompt)
     - `input dump` followed by Enter
   - This produces the same sequence you see manually:
     ```text
     >:
     >: input dump
     Press CTRL+C to stop
     ```

2. **Read telnet output line-by-line**
   - Continuously reads lines from telnet’s stdout.
   - Logs each line for debugging with:
     ```text
     [listener] RAW LINE: ...
     ```

3. **Parse input events**
   - For each line, it looks for the pattern:
     ```text
     key: <name> type: <type>
     ```
   - It splits out:
     - `key` → for example `InputKeyStart`
     - `type` → for example `InputTypePress`
   - If both match the configured trigger:
     - `TRIGGER_KEY_NAME == "InputKeyStart"`
     - `TRIGGER_EVENT_TYPE == "InputTypePress"`
     then it treats that as a **Start button press**.

4. **Launch the typing-speed script**
   - On the first matching event, it prints:
     ```text
     [listener] Trigger event detected!
     Start key detected — launching typing script...
     ```
   - Then starts:
     ```text
     python3 busybar_typing_wpm.py
     ```
   - The typing script:
     - Connects to the BUSY Bar’s HTTP API.
     - Draws the WPM meter and text on the display.
     - Tracks keystrokes on your Mac to calculate WPM.

5. **Avoids starting multiple copies**
   - The script remembers the `Popen` object for the currently running typing script.
   - If you press Start again while `busybar_typing_wpm.py` is still running, it prints:
     ```text
     Start key pressed, but typing script is already running.
     ```
   - It **does not** start another copy in that case.

6. **Reconnects on errors**
   - If telnet closes or errors, it waits briefly and:
     - Starts a fresh telnet session.
     - Sends `input dump` again.
   - This keeps the listener robust if the device or network briefly resets.

---

### How to use it

1. **Make sure you can use the CLI manually**
   - From your Mac:
     ```bash
     telnet 10.0.4.20
     ```
   - At the `>:` prompt, run:
     ```text
     input dump
     ```
   - Press the physical Start button and confirm you see:
     ```text
     key: InputKeyStart type: InputTypePress
     ```

2. **Run the listener**
   - In the `CLI` project directory:
     ```bash
     cd "/Users/barker/Documents/General/Random Tests/CLI"
     python3 busybar_start_listener.py
     ```
   - You should see:
     ```text
     BUSY Bar start-key listener
     - Waiting for 'InputKeyStart' 'InputTypePress' on 10.0.4.20:23
     - Will start: busybar_typing_wpm.py
     [listener] Sent 'input dump' via telnet
     [listener] Telnet started, waiting for input events...
     ```

3. **Press the Start button**
   - The listener should log something like:
     ```text
     [listener] RAW LINE: >: input dump
     [listener] RAW LINE: Press CTRL+C to stop
     [listener] RAW LINE: key: InputKeyStart type: InputTypePress
     [listener] Trigger event detected!
     Start key detected — launching typing script...
     ```
   - A new terminal window or process will show:
     ```text
     BUSY Bar Typing Speed Tracker
     ...
     Connecting to BUSY Bar…
     ```

4. **Stop everything**
   - To stop the typing-speed script: press `Ctrl+C` in its terminal.
   - To stop the listener: press `Ctrl+C` in the listener terminal.

---

### Changing the trigger or script

- **Different button or event**
  - Edit:
    - `TRIGGER_KEY_NAME`
    - `TRIGGER_EVENT_TYPE`
  - Use `input dump` manually first to see the exact strings printed for your desired button and event.

- **Different script**
  - Change:
    ```python
    TYPING_SCRIPT = "busybar_typing_wpm.py"
    ```
  - to point to any other Python file (e.g. `"my_custom_app.py"`).

---

### Summary

- `busybar_start_listener.py` automates what you were doing by hand:
  - Open telnet to the BUSY Bar.
  - Run `input dump`.
  - Watch for the Start button event.
  - Launch the typing-speed UI when that event happens.
- The listener is designed to be robust:
  - Uses the system `telnet` so it behaves like your manual CLI session.
  - Reconnects if the CLI drops.
  - Prevents multiple copies of the typing-speed script from stacking up.

