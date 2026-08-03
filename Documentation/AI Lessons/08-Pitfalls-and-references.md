# Pitfalls and references

## Pitfalls and Constraints

- **Widgets vs JerryScript:** Pitfalls below apply to **HTTP draw JSON** and **widgets**. If you are building an **on-device JS app** (JerryScript, non-default firmware), see **[../Unofficial/12-JerryScript-on-device-apps.md](../Unofficial/12-JerryScript-on-device-apps.md)** — do not use DisplayElements rules for LVGL/gui flows, and do not implement a JS app only as `widget.py` POSTs.
- **Display size:** Always 72×16. Do not assume a larger canvas; keep text width and image dimensions within 72×16.
- **Wrong server URL:** `localhost:11434` is for local AI chat (Ollama), not BUSY Bar drawing. In `widget.py`, draw/upload requests must use `DEVICE = "http://10.0.4.20"` (USB) or the BUSY Bar Wi-Fi IP.
- **Asset path:** For app assets use only the filename in `path` (e.g. `"data.png"`), no leading path or slashes.
- **Timeout:** `timeout: 0` means no timeout (element stays until cleared or replaced by another draw).
- **Priority:** Use `priority` > 5 to override the built-in app (which is 5). When done, clear with `DELETE /api/display/draw?app_id=<id>`.
- **Filenames:** Asset filenames must match `[a-zA-Z0-9._-]` only.
- **Mutually exclusive:** For each element use either `timeout` or `display_until`, not both.
- **Unsupported characters in text:** When text comes from an external source (RSS, API, web), it may include symbols the display cannot render (e.g. smart quotes, em dashes, emoji). Sanitise to a displayable character set (e.g. ASCII) before sending; otherwise you may see blanks or garbled glyphs.
- **400 Bad Request on `/api/display/draw`:** Usually means the request body is invalid or an asset cannot be used. Common causes: (1) Invalid element JSON (missing or wrong `id`, `type`, or required fields). (2) **Animation:** do **not** use .anim unless the file was **specifically created** for the device (see **05-DisplayElements-and-assets.md**). Do not generate .anim in a script — that causes 400. Use **builtin_anim** or stick to text/image/countdown. (3) Wrong `path` or `app_id`.
- **Wrong element keys:** For text elements, use API fields like `id`, `type`, `text`, `x`, `y`, `align`, `font`, `color`, `display`. Do not use UI-style keys like `name` or `value`.
- **Required element id:** Every display element (`text`, `image`, `anim`, `countdown`) needs an `id` field.
- **UI font vs API font confusion:** `# @ui` directives can use UI font names for editor controls, but draw payload `font` must use API enum values (`small`, `medium`, `medium_condensed`, `big`).
- **Icon/image misuse:** If using `"type": "image"` with `"path"`, keep `path` as filename only (for example `clock.png`), upload it via `/api/assets/upload` first (or ensure it already exists), and do not add unsupported `width`/`height` keys.
- **Do not clear with empty POST draw:** Do not send `POST /api/display/draw` with `elements: []` (or helper calls like `draw_elements([])`). Clear using `DELETE /api/display/draw?app_id=<id>`.
- **Scrolling text must overflow the width:** For `width` + `scroll_rate` to produce a scrolling ticker, the text must be **longer** than the width in pixels. "Hello World" (11 chars) in `small` font (~6px/char) fits in 72px, so nothing scrolls. **Workaround:** Pad short text so it overflows, e.g. `text = f"   {message}   "` or `text = message + "  -  " + message` — the device has no "force scroll" option.

---

## References

For **HTTP widgets**, the examples in **06-Examples.md** are the main reference; the AI can copy and adapt them. For **on-device JerryScript**, use **[../Unofficial/12-JerryScript-on-device-apps.md](../Unofficial/12-JerryScript-on-device-apps.md)** instead of guessing draw payloads.

**One complete reference example** (copy-paste ready). This is a valid draw payload you can send to `POST /api/display/draw`:

```json
{
  "app_id": "my_app",
  "elements": [
    {
      "id": "1",
      "type": "text",
      "text": "Hello, World!",
      "x": 36,
      "y": 8,
      "align": "center",
      "font": "medium",
      "color": "#FFFFFFFF",
      "display": "front"
    }
  ]
}
```

For a full working script example (including how to run it), see **02-How-to-run-it.md** and **09-Widget-template.md**.

**Animations:** Do not use .anim unless the file was **specifically created** for the device (see **05-DisplayElements-and-assets.md**). For tickers and running lines, use **text** with `scroll_rate` instead.
