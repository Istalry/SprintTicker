# Dynamic widget pattern (loops and external APIs)

For widgets that update over time (e.g. bus arrivals, weather):

1. In a loop: get your data (from a local calculation/file, or from an external API if needed).
2. Build the `elements` array from that data.
3. `POST /api/display/draw` with the same `app_id` and new `elements`.
4. Sleep for an interval (e.g. 5 seconds).
5. Repeat.
 
Use the Python example in **“How to run a widget (for users)”** and replace the `elements = [...]` part with your own logic (for example: call a weather API, read a local file, or compute a countdown).

### If an external API is required (must be clear)

If the widget needs an external API, the AI must do all of this (so a beginner can run it):

1. **Ask for the required inputs** (don’t guess):
   - API base URL and endpoint
   - Any API key/token (and where it should be placed: header vs query)
   - Any ID needed (e.g. city name, stop ID)
   - Refresh interval (e.g. every 30s, every 5m)

2. **Give a quick “test the API” command** (so the user knows the key works) before writing a full widget.

3. **Show exactly where the user pastes secrets**, using a simple approach:
   - Put the key in the script as `API_KEY = "..."` (easy but less safe), or
   - Use an environment variable (better): tell them the exact Terminal command to set it and run the script.

4. **Handle errors clearly** (print a helpful message instead of crashing) and keep the widget running.

5. **Be reliable by design (no “surprise failures”)**:
   - Don’t rely on “auto-detect” services by default (for example: location-by-IP lookups). These are commonly rate-limited and can fail without warning.
   - Prefer **manual configuration** (values at the top of the script) as the default.
   - If auto-detect is offered, it must be **Optional**, used **only once**, and saved/cached so it doesn’t get called repeatedly.
   - Assume rate limits happen (HTTP 429 “too many requests”). Add **backoff** (wait longer before retrying) and avoid retry loops that spam the service.
   - Cache the last successful data in memory (and optionally on disk) and continue displaying it if the API fails.

6. **Sanitise text for the display:** Data from RSS, APIs, or web pages often contains characters the BUSY Bar cannot display (smart quotes, em dashes, bullets, emoji, etc.). Before putting any fetched string into a `text` element, **ensure it only uses displayable characters** (e.g. **ASCII** or the device's supported character set). Strip or replace unsupported symbols so the display shows readable text instead of blanks or garbled glyphs.
