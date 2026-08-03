# DisplayElements and assets (API reference)

## DisplayElements Reference

**Endpoint reminder:** This schema is for BUSY Bar device requests (`http://10.0.4.20` over USB), not local AI server URLs like `localhost:11434`.

**Top-level (request body):**

| Field      | Required | Description |
|-----------|---------|-------------|
| `app_id`  | Yes     | String, pattern `^[a-zA-Z0-9._-]+$` (e.g. `my_app`) |
| `elements`| Yes     | Array of element objects |
| `priority`| No      | Integer 1–10, default 6. Built-in app = 5. Draws with lower priority are ignored while a higher-priority draw is active. |

**Common fields on every element:**

| Field         | Required | Description |
|---------------|----------|-------------|
| `id`          | Yes      | Unique string per element |
| `type`        | Yes      | `text` \| `image` \| `anim` \| `countdown` |
| `x`           | No       | X coordinate of anchor (integer) |
| `y`           | No       | Y coordinate of anchor (integer) |
| `align`       | No       | Anchor: `top_left`, `top_mid`, `top_right`, `mid_left`, `center`, `mid_right`, `bottom_left`, `bottom_mid`, `bottom_right` |
| `display`     | No       | `front` \| `back`, default `front` |
| `timeout`     | No       | Seconds to show (0 = no timeout). Mutually exclusive with `display_until` |
| `display_until` | No     | Unix timestamp (string); element hidden when system time reaches it. Mutually exclusive with `timeout` |

**Text elements (`type: "text"`):**

| Field        | Required | Description |
|--------------|----------|-------------|
| `text`       | Yes      | String to display |
| `font`       | No       | `small` \| `medium` \| `medium_condensed` \| `big` (default in schema: `tiny5_8`; prefer the enum values) |
| `color`      | No       | 8-hex `#RRGGBBAA`, default `#FFFFFFFF` |
| `width`      | No       | Width of the text area (pixels) |
| `scroll_rate`| No       | Scrolling speed in pixels per minute |

**Image elements (`type: "image"`):**

Either:

- `path`: string — filename in the app’s assets (e.g. `"data.png"`), or
- `builtin_image`: string — e.g. `category/name`

**Anim elements (`type: "anim"`):**

Either:

- `path`: string — filename in app assets, or
- `builtin_anim`: string — e.g. `category/name`

Optional: `loop`, `await_previous_end`, `section_name` (e.g. `"default"` for full animation).

**Countdown elements (`type: "countdown"`):**

| Field         | Required | Description |
|---------------|----------|-------------|
| `timestamp`   | Yes      | Unix UTC timestamp in seconds (string) |
| `direction`   | Yes      | `time_left` \| `time_since` |
| `show_hours` | Yes      | `when_non_zero` \| `always` |
| `color`      | No       | 8-hex `#RRGGBBAA` |

---

## Assets

- **Upload:** `POST /api/assets/upload?app_id=<id>&file=<filename>`, body = raw binary. Filename must match pattern `^[a-zA-Z0-9._-]+$` (no slashes).
- **Reference in elements:** Use the same filename as `path` (e.g. `"path": "data.png"`). No directory path for app-scoped assets.
- **Formats:** PNG for images. See below for animation (.anim) rules.
- **Delete all assets for an app:** `DELETE /api/assets/upload?app_id=<id>`.

### Icon pattern for widgets (required)

When a widget includes a custom icon image:

1. Upload icon bytes to device assets:
   - `POST /api/assets/upload?app_id=<APP_ID>&file=<filename>`
2. Reference icon in draw payload with:
   - `"type": "image"`
   - `"path": "<same filename>"`
3. Keep path as **filename only** (example: `"clock.png"`).

#### Do / Don't

- Do: `"path": "clock.png"`
- Don't: `"path": "/assets/clock.png"` or any absolute/local filesystem path
- Do: upload before drawing (or ensure file already exists for that `app_id`)
- Don't: add `width` or `height` to image elements (not part of the API schema)

#### Placement recipe (72×16)

- Safe icon anchor: `x: 0`, `y: 0` (top-left)
- For icon + label/time:
  - icon on left at `x: 0, y: 0`
  - text to the right with a small gap (2–3 px), for example `x: 18, y: 8, align: "mid_left"`
  - avoid `y` values that clip a 15×15 icon on a 16 px-tall display

#### Invalid example

```json
{
  "id": "clock_icon",
  "type": "image",
  "path": "/assets/clock.png",
  "x": 0,
  "y": 8,
  "width": 15,
  "height": 15,
  "display": "front"
}
```

#### Valid example

```json
{
  "id": "clock_icon",
  "type": "image",
  "path": "clock.png",
  "x": 0,
  "y": 0,
  "display": "front"
}
```

#### Do not use .anim unless specifically created

**Rule:** Do **not** use animation (`.anim`) elements in a widget unless the .anim file was **specifically created** for the BUSY Bar device. Otherwise the device will reject the draw request with **400 Bad Request**.

**Explanation:** The device only plays .anim files that match its own binary format. That format is produced by converting a **ZIP** (containing `meta.json` and `frame_0.png`, `frame_1.png`, …) using the project’s conversion tool — not by generating bytes in a script. If you create .anim data in Python (e.g. for a “psychedelic background” or any custom animation), the format will not match. The upload may succeed, but when you call `/api/display/draw` with an `anim` element pointing at that file, the device cannot load it and returns 400.

**What to do instead:** Prefer **text** (with `scroll_rate` for tickers and running lines), **image** (PNG), and **countdown** elements. They work reliably. Use **anim** only when (a) you have a .anim file that was **specifically created** for the device (built from the official ZIP with the conversion tool), or (b) you use **builtin_anim**. For a “running line” or ticker, use a single **text** element with `width: 72` and `scroll_rate` (pixels per minute); no .anim needed.

---

## Fonts and Colors

- **Fonts:** Use enum values: `small`, `medium`, `medium_condensed`, `big`. Schema default is `tiny5_8` if supported.
- **Color:** Always 8-hex with alpha: `#RRGGBBAA` (e.g. `#FFFFFFFF` for white, `#FFC500FF` for orange).

