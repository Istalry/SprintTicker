# Display and layout (design rules)

- **Resolution:** 72×16 pixels. X range 0–71, Y range 0–15.
- **Origin:** Top-left of the display.
- **Positioning:** For each element, `x` and `y` are the position of the element’s **anchor point**. The anchor is chosen with `align` (e.g. `top_left`, `center`, `bottom_mid`). Keep content and image dimensions within 72×16.

### Design criteria (beginner-friendly, works for any widget) — **must follow**

**The AI must apply these rules to every widget.** They are not optional. Ignoring them causes misaligned or overlapping content on the 72×16 display.

- **Alignment recipes (to avoid “slightly off” layouts)**
  - **Center something horizontally:** use `x: 36` and one of:
    - `align: "top_mid"` (top row)
    - `align: "center"` (middle)
    - `align: "bottom_mid"` (bottom row)
  - **Vertically center a single line of text (recommended when it makes sense):**
    - Use `y: 8` and `align: "mid_left"` / `"mid_right"` / `"center"` depending on your layout.
    - Example: `{"type":"text","x":36,"y":8,"align":"center",...}` or `{"type":"text","x":0,"y":8,"align":"mid_left",...}`.
  - **Right-align something:** use `x: 71` and one of:
    - `align: "top_right"`
    - `align: "mid_right"`
    - `align: "bottom_right"`
  - **Left-align something:** use `x: 0` and one of:
    - `align: "top_left"`
    - `align: "mid_left"`
    - `align: "bottom_left"`
  - **Tip:** pick an alignment pattern and stick to it (e.g. top row = `top_mid`/`top_right`/`top_left`). Mixing anchors is the #1 reason things “look wrong”.

- **No-overlap rule (vertical “slots”)**
  - The display is only **16 pixels tall**, so overlapping happens easily.
  - Think in **slots** and pick **one layout**:
    - **Two-line text layout (recommended):**
      - Top line: `y: 0` with `align: "top_*"` (usually `top_mid`)
      - Bottom line: `y: 15` with `align: "bottom_*"` (usually `bottom_mid`)
    - **One main element layout (recommended for big elements):**
      - Use **one** main element centered (image/anim/countdown), and skip extra lines.
  - **Special case: `countdown`**
    - The `countdown` element is usually a **tall** element (it may take most of the 16px height).
    - To keep it readable and prevent overlap, default to **countdown-only** (or countdown + one short label).
    - If you must add text too, be prepared to remove the footer/header if it overlaps. It’s OK to show less.

- **How many lines of text?**
  - **Best:** 1 line (largest, clearest)
  - **Common:** 2 lines (use `font: "small"` for both)
  - **Avoid:** 3+ lines (it becomes unreadable at 16px tall)
  - **Rule for 2 lines:** if you use two lines, both lines should be `small`.
  - **Spacing between items:** if you’re showing two pieces of info on one line (like a mini list), leave a visible gap (about **two spaces**) between parts when it makes sense (example: `\"A  B\"` instead of `\"AB\"`).

- **Maximum character length (per line)**
  - Because the display is **72 pixels wide**, “max characters” depends on the font and letters used. Use these as **safe starting points** (no scrolling):
    - `font: "small"`: aim for **≤ 12 characters** per line
    - `font: "medium"`: aim for **≤ 8 characters** per line
  - If text might be longer, prefer:
    - **Shorten the text** (abbreviate), or
    - Use **scrolling** (`width: 72` + `scroll_rate`) so it still fits
  - **Avoid overlap:** don’t place multiple long text elements on the same row/area. If you need scrolling, prefer **only one scrolling element at a time**.
  - **Font stacking rule:** `medium`, `medium_condensed`, and `big` should be treated as **single-line fonts**.
    - Don’t stack them above/below other text lines (too tall / likely to overlap on 16px height).
    - They *can* be used **side-by-side** on the same row (for example: an icon + a short `medium` label), but only if the characters fit without touching/overlapping.
  - **Displayable characters (text from external sources):** When the text comes from somewhere else (RSS feed, API, web scrape, etc.), it may contain symbols or characters the display cannot render. **Before sending text to the display**, ensure it only uses characters the device can show (typically **ASCII** or the device's supported character set). Strip or replace unsupported characters (e.g. smart quotes, em dashes, bullets, emoji, or other Unicode symbols) so the display doesn't show blanks or garbled glyphs. In code: sanitise the string (e.g. keep only printable ASCII, or map known symbols to ASCII equivalents) before putting it in the `text` field.

- **When there’s too much information (limit it)**
  - The display is tiny. It’s normal to show only the most important part.
  - Prefer a hard limit like:
    - “Show the first **1** item” or “Show the top **2** items”
    - “Show **only the first 12 characters**”
  - It is OK (and recommended) to tell the user in plain English:
    - “Only the first 2 items are shown because the BUSY Bar display is 72×16.”
  - If you must show more, use one of these patterns:
    - **Rotate pages** every few seconds (show item 1, then item 2, etc.)
    - **Scroll one line** (width 72 + scroll_rate)
    - **Use abbreviations** (e.g. `TEMP 21C`, `SUN 17:41`)

- **Icon box size (max 15×15)**
  - If you use an icon, treat **15×15** as the **maximum** box size (not a requirement).
  - If a smaller icon makes more sense (cleaner layout, more room for text), prefer **smaller** (e.g. 9×9, 11×11, 13×13).
  - Typical layout: icon on the left, **vertically centered** (`x: 0, y: 8, align: "mid_left"`) and text to the right.
  - **Spacing rule (important):** leave a clear gap between icon and text so they don’t touch.
    - Use a **2–3 pixel gap** between the right edge of the icon and the first text pixel.
    - Practical rule: set your text X to `ICON_SIZE + 3` (for a left-aligned icon at `x: 0`).
  - **Use color if possible:** the display is RGB, so icons can be colored. Prefer a simple, high-contrast palette (1–3 colors) so the icon stays readable at tiny sizes.
  - **Use an icon when you can:** if the AI can create an appropriate icon for the widget (e.g. cloud for weather, bell for notifications), it should do so. On a 72×16 display, a small icon communicates meaning faster than words (e.g. a cloud for “cloudy”). If an icon would reduce text length or avoid scrolling, prefer an icon + short label. If the widget is purely text (like a meeting note), skip the icon.

### Creating an icon in a single Python file (generate → upload → draw)

You can create an icon **entirely inside one Python file** by generating a small PNG in memory, uploading it as an asset, then drawing it.

This is the reliable pattern:

- Generate a **small PNG** (RGBA) in memory (up to **15×15**; smaller is fine)
- Upload it with `POST /api/assets/upload?app_id=<id>&file=icon.png`
- Draw it with an `image` element: `"path": "icon.png"`

Example snippet (single file; requires `pillow` + `requests`):

```python
import io
import requests
from PIL import Image, ImageDraw

DEVICE = "http://10.0.4.20"
APP_ID = "my_app"
ICON_FILE = "icon.png"

def make_icon_png_bytes() -> bytes:
    # Example: 13x13 colored status dot. Keep icons small (<= 15x15) and high-contrast.
    img = Image.new("RGBA", (13, 13), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((1, 1, 11, 11), fill=(34, 197, 94, 255))  # green
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def upload_asset(filename: str, data: bytes) -> None:
    url = f"{DEVICE}/api/assets/upload"
    r = requests.post(url, params={"app_id": APP_ID, "file": filename}, data=data, timeout=10)
    r.raise_for_status()

def draw_icon_and_text() -> None:
    url = f"{DEVICE}/api/display/draw"
    text_x = 13 + 3  # icon width + gap (2–3px recommended)
    payload = {
        "app_id": APP_ID,
        "elements": [
            {"id": "icon", "type": "image", "path": ICON_FILE, "x": 0, "y": 8, "align": "mid_left", "display": "front"},
            {"id": "txt", "type": "text", "text": "OK", "x": text_x, "y": 8, "align": "mid_left", "font": "small", "color": "#FFFFFFFF", "display": "front"},
        ],
    }
    r = requests.post(url, json=payload, timeout=10)
    r.raise_for_status()

def main():
    icon = make_icon_png_bytes()
    upload_asset(ICON_FILE, icon)
    draw_icon_and_text()

if __name__ == "__main__":
    main()
```

### PNG icons for common social media sites (built into this document)

**This document includes ready-to-use PNG icons** for these common social media sites: **Facebook, Instagram, LinkedIn, Discord, Pinterest, Reddit, TikTok, YouTube, Spotify.** They are 15×15 pixels, stored below as base64-encoded PNG strings. The AI **can and should use them** whenever a widget is for one of these platforms.

**Rule for the AI:** If the widget is about any of these sites (e.g. Facebook, Instagram, YouTube), **use the matching icon from this library.** Do not generate a custom icon or skip the icon when one exists here.

Each icon is base64-encoded PNG: decode → upload as asset → draw (see steps below).

**Usage pattern:** Pick the icon by name, decode with `base64.b64decode(...)`, upload via `POST /api/assets/upload`, then reference the filename in an `image` element.

#### How to use them on screen

1. **Decode** the base64 string to PNG bytes: `png_bytes = base64.b64decode(SOCIAL_ICONS["facebook"])`
2. **Upload** once at startup: `POST /api/assets/upload?app_id=<id>&file=facebook.png` with body = `png_bytes`
3. **Draw** with an `image` element in your draw payload, using the same filename as `path`.

**Screen layout (72×16):** Place the icon on the left, vertically centered. Put text to the right with a 2–3px gap.

| Element | `x` | `y` | `align` | Notes |
|--------|-----|-----|---------|-------|
| Icon    | 0   | 8   | `mid_left` | 15×15; vertically centered |
| Text    | 18  | 8   | `mid_left` | 15 + 3 = 18 (icon width + gap) |

Example: icon + short label (e.g. `"2 new"` or `"LIVE"`). Keep text within the safe character limits (≤12 for `small`, ≤8 for `medium`).

```python
import base64

# PNG icons for common social media sites (15×15, base64). Use: base64.b64decode(SOCIAL_ICONS["facebook"])
SOCIAL_ICONS = {
    "facebook": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACKklEQVR4nF2SP2gUQRTGf29m73J7bjxJLuc/CBIiitioBPwTEURIZ6OlWlrZKNh6WIiFoJ1dGv80KbQ1XSIRiUFBFJIiIqjIkRBjcpfkktudJ7N7MZqFYd/M+773vvnmCdWqObfjdmV1LXyoaoZUKQFWARScDxQVi4jSMJantsndyfsyL6ce1yvrteJzwQwCORGs5wUBXDoBF4/BzhDGZqD6Ai0VaSbOvcl1rV4J4rmoCpyRgIImYA3MLcP183DjAhRyvhT074bYITYgTDbMoFuMHgXOcU1IiSqCeJm93XC8NyOOTcOTCVhqQimEuJXicqoMGbFECAKIAdZbmWQroAqz8/DyA0zXILCpDR5rVSgF6vweEYFWAgfKsGcXdOT9IfREcLIf8jn4tpBdK2WADTzRR0agvgGXB2CgD8qdGeb0QdjfBeMzMPwaog5wmQ148t8vdtBXgcN7wbURPZ0QFeD9V9BN1nayBxc7YOQdfP4BZw/BkX0w+QVGpuDnIhTyW13/I3uJYQ5efYK3s5njnvzxOwyPZ4oCk5m4SfHXT9oGpIlSAbo7Id8uG+ahHGXPpv90FYMYFZbSAu1cohAn2Vj6Yv4f+3hLbzqw6lgxRhhVaPnZ3cx65/M2e6ptUvE4haYanhlbatzEuAkXs6ba7u6gtgwLDfjVaBfIeiYa00SYiIuNO+lkHb1XrxTjqJokXMUQicOPufiOXoVfqjgx/BZhlHDl1tTKg7k/93vUYGzUCoUAAAAASUVORK5CYII=",
    "instagram": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAADDUlEQVR4nB2RTWgcZRyHf/935p2vnZndZLObTWptNKVNqk0jiBqsB6VWEEsrYkCogteeigg9Rg89CKJ46MmbLfUkFfFbETW0ItXGhKalaQRNm2zSRbMf870z71/i4Tk+l+chYE68+fypOqfd92RRPCdVUTZypZkqh6My2Byxg5h9pMLmMHBFdr7qdt8e/+F0i+ae7dU7qnVh+gn7qYOHbfnAlK3ZroYiB4gYBAYJAKlC948NDi4tJGpx9XJjj3mSzhz5+9zYQ+L1l07vsm//1MLWYo8dmZNJKVuckSn6MLKYLZXRwMwIBh67H9sffp/Q0vIlHXn62swLdWtreZuXP20hXAvJTgM4RUC+TGGHHVQaOlVmJyE9Hb3vFrj09Lgsln87qhsK7tghB/Mf3EWyHsLJejhwrIb9L0/DGbER32wh+GIJeuseYLaZV5skTxzSuBxVhKFSliZBZBmsOMDewx72H2+w2Nrm9sXfIZMI9dmHYfiM/udXyKwICM+CqMWaMIscXACOyGD3A0y8sgfU7uGvd65g89wv+Pf9rxmdHvtHJyG7myzcAlA5UIsh7DwFATA4Y1eLUN7rIb3RJFrboMFxA7LVRL66AW33IOQog9wE0Bg0FEMvISZihoUMTh5y3uyRO1lDPG6xbK2j9KAPc6IBtbkOqoYkyhlACmJHdigG6QRTJeSKjDufLKB2YgKNM0egVu7C2tcgrW6guPwZaCQG/BgQGtgjFiUVF0U3hdlP4FkppV9dQ/Txz7A9Qf7so6SPOeClH4Hmr6BdBaOiAM6hWS7pLqJ2sNCsDEzVhH5nDfKfHvG16xxdvwqjmhIGA1AjAd2XgUaHSNv9CBedFbB0Qt3X+t9m8ysvDp+asexRHcXVW5Cckeb1QX4K+BnIj0F+BAzvA+rTxKvnY91yP6I/n7k4rOI7F8qPN570jh+0zKkxIkv/PwoEA7SDDlYRVPdWgfZiX4U35lNv+OTOJdo8drZu5vmcNMJXjUrsqmrEVI9BQxGomoDKgpR0FJlOWxilb0RaeuOtL9+99x8qQmQ1SoxtaAAAAABJRU5ErkJggg==",
    "linkedin": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACeElEQVR4nG2TTWxUVRTHf+e+O/NmmKHTcbCthKGIaTSm6YKabgpx4Ud3BBauQBMXykoW4EY3jXHrR2LcAIsmUt01YduSsIBo0sTEpFojEEIN2A9qv6Tz0Xlz7zH3lRZqfHdzF/f/O+f/P+cJjBo+PtIlm+2vcG4EoQQSsedTRSLB6yaGqxrLZ3zzwbJw8bsuHte/N21/3CgZRSOQvdpnICrS9BnzI891nLVSS0al7YfHPnwrN9RbQT04VcLZlbCNi62V6bmV/PuXJ4/7tfrXFtd+T1RzQ4cr+kpPWdYaW5RyWYz8f3X1qqAZvBsxGFNUkNhGcvPuAoOfT/DtjVmcV1rOkzhN74lzBF3LeUHTTEo2oBCRlld6K0Xeee0lBqoVIiNET7w32o7YRkhadLeJyD6xQ0A1EsfyRp04Mkz8fI9rv9zHGWFpdZNTx17kozcGnhVjdiaRtYbfF9YZuz7Db/MrTM0+YPzWHyn74VqNL6dmWPynQcaaveIACx0VspZsZ4FinCWTzdB/tJtLZ07w6clBVhsJf63VsFZ2J/EUAzQTR6vWpNV21LYSas0kxMFWy9FotojEpEV2Zm5AXTAdkuzcF/Ny9QClfJZqucCrB8vps3I+ZuBQhULObrcYYpJILMJGiN15Na/39cj4uTfpe76DwSPd1JM2xdjydn+VvhfK9HV1cHtpfTty9XWL2Ekx7vRPc3/nPNCZtcyv1hAEI/Drw5V0bIVMxJ3FDab/XAlOGmp0XPjkh25WN8ZN4ofFkwsLQ7pd2+YCJL2Ff0PEqWjirb3F/vzZ8Eo4f6VLtnQUr++GjUNdYPx3Pz2i60g0qUV7gS/mHv0LxowOOI1aZ+cAAAAASUVORK5CYII=",
    "discord": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACj0lEQVR4nE1STUgVURT+zrl35s3zp5eYT82iCJR8ZSYVhCmYKEK7Fi2CcNPGTYuotlmrViW4KzIkS9q1DIpISNFQKIiSxGhRGWWKijrPN+/eE3eGBx2Yucxwzne+n0vAIF+4fiOr13EPYvtAkhGQEkFcRO4tQqRJrN1kprF0ILdHhiuXaeCaZDfWN55aRocYeMaScgOlx1o3G8MAZEQryjNhKqjmS3ptKxwkkjOKg6ClxaKn00cYCj4vFJHfEdRUMw7sU2AG5j5ENDPHaZGdjnCFhjSM6S8aCXo7Ied6A2qoIxSLwJHDClaAlAcEaYJWwMH9DN8vyMsJ8XwlfQziilRKU1e7jgcdTaWAqt2E6ipCRQXFW13V1TL6zvpUl2UFshkWW5STrRr1dUmHa3RanWEl07ikHUDNHkJLzoMFqbj1RJtCKhXbirfTBQzdD/H+YxSDLCwaDD8M8eJ1IXbO00CuUccmsgPPVnOsydWb6Qijz3bw9Vuyan7R4NF4HjOzJv72PEJtTcJSO4R0KqHoNnW3+2jIKhzL6Zhq4yGFK5cD5Bo9l3acWllZIkM7hHSaE1MEOHVco+O0+53IyDUpNDcGcXzkok4IxjdHg8RMz0aq9ahGfS3j04LB918GmUpGeRrYDoHVNYuGeoW2FsbPJYOp2SJYa9KKeP3BWD7T3KS4r9unH0sGryYirKwKPB8oFIC9WUJPl4ffyxaT7yKZ/xKhLM3bdHFgc5xgz4v4QT4sgJXA95JsSz5YAxQip4qQ8h3ZndCKesxlVeVXYTEJmw+DwIqvKR4yJjHFnc4k3wNSvhhBIQ+iSZ2puMkjd+iPDbYvCetRCG+BXGal6/GfO2ItBOsE9Tzapfqf3L319x+r6QgKXnoM9wAAAABJRU5ErkJggg==",
    "pinterest": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACFUlEQVR4nEWTvUsjURTFf2+SYIyC+LVKFFPaCakELcU/IY2InWApVjaygpWWwi7YL36gWNnsbmEhBkGSxsJCUFBERFPISFxwMme580zy4M4wzD3nvHM/+A7BOww3YFdQk3ORUikpm5VyOR/ZbKx0WnIuFPwUDAEBIXxrwF8596FUKlIQSDMz0sGB9PAgvbxI5bK0uGhEsYKgbvmhEQh+COoJM0hbW9Lbm7S3J5VK0uystL7uiQ4Ppf5+KQg+BLsGDhUEsZyLNTfnlba3pYkJKZ/3hF1d0tqakrOxYeqRnKsZWIlHex8fS2dnUqEgLS1J1ao0P+//FYvSzY10eWnK5j8KwPBfZ3wcKhXo7IRSCYpFyOchCCCK4PkZenub2SkDuxY4nYa+PhgYgI4OuLuDatWDczkYHoZarZVuYLsUOAc7OzA6CoUCfH7C1RWcnnrVwUEYG4Nyua2VPOO4DX56gp4eGBmB7m6YnPTfq6sQhnB01AL7gjWj2a7lZen+Xjo/l/b3pUpFur2VVlakTMaKZXmxKTfMfMJk6pkMTE/D4yNsbnr/19dwcuKLaf4NCs7Ab0APzgVILvFnhXl/9/5eX9vXtIJGUbM7dSvYb+AzqboxGrMBLy480AAWzXb57vwDftlsD33Ndj2ZMpumhQVpasp7s4Fo18VkbTT/2E4kTEbwtS1hAkin49bUtaORbB3s2hbaNv4HU31Xb087ZxUAAAAASUVORK5CYII=",
    "reddit": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACfElEQVR4nGXST2icVRjF4efebxIn6eQPRhPFYhDqpkULKhTb2mIrBJVSBHVjFbduXCi6DSLoolBFFDdSEFsiSgWtGgtR0UbRErWItEbS1NIUY5NowiRjmsw3V74Z0YVne99zz33P/YVh4jP36e+oOxQbhtAjyBRKJRolQiMRgmRZVn9Lnj8XPjMXqg/o71x2NLITbcjEjGrOrvu5+0GW5ui7ge5rk+OvrTbGj39V6+84ECsrhiM7ROWmsalAI9LTx6+TvHmIC2fZcmfQfXVHEVRZqL1UkjxGKEshCSk0U2OkrU4WqP7B7CwfvcG3YyxMJ5k2KQ2VBBUi9bxlqtVZx+BG2stMn2UNv8+2LmkTtMdM0lMqamkmbtzEn79x173cMcT1N1HpZXGB7fs49SE/fsGGblZXis2ykO5pSx55llt3U51n6x56B/xPMz/z0zgdXfwywTsvk/Z2pjR3Kf2r05+n9PX7KS1eTqmRp3TpXEpfvpfShTP/zVycTGlvR4rkTHzC8iJ5nZEXeOUJzp0mRCYnOPg4R59vnRdz340pfFFY44NXWVnUbPr2IbbvL/6U1GDgRnbu5+bbWoUuL3Hy7cJcICQ3M535qygh8NDT5OtkBS/YvI1NWyld1XpJDMzPkqVQmJdUqz3Gj0XXDQblCj+MUa8zuIX5i6yttgotwPlmNDk/RVktiumEdutGXgw+HWlB0XUNs+cZP8bMFF19rF1h9DCvPxmU4yrpSKjuM9C56khMcYfOrrLN24LdD3PLLjb0cqXG1Pd8fJhTo7kY1qX6yeWKA6EAubpHfyUzLIVHhVjRKKXmcukfzkNOyhuyfFGWTqx0eerguy7/DT/sD1ZeZGxyAAAAAElFTkSuQmCC",
    "tiktok": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAC+0lEQVR4nIWTTWhUVxTH/+feO+9lkheTtNFJUo3GfEy0RdMYrQQ/qqBCXNQE3bhqu7BgKSjW9ZiFi9KiVuiiLgTRYjuvCF3UiCUmaIgBM+j4MVUT25DYJpiPoenMZD7uu0delC5KoT+49yzOvef8LpwL/AtmJj+uj0TKP7sTP3H20ZO5y2MTfOfM5dMMLIcSYESEf2Zx+y/GFpMCTQGFTRUlWKHkByMtB7fBY4xcfS/gN1H4HywJsjJZFO3ZWKebVx7su9aSaOrouAeA/ukcYRZ9zOoREBhmDrz12opB8F+SdiwWTTXblx3q+v7n2P1vek6e2yJAhO2RPtVNZHYQ6XeI8m1EhUTNZBbC+GmQp4G/F0jalhNqrA+Hpfpo/d2xr9WB/ful271Dfzgcb8V8el+VLdc2JlNPqi5c7+1p0WQInjAEy705ZZ7PPs93tZeFfp9udGay76rDh6NkH39waDXo4+baqnX19XVBK/Yw7UwvLLvKmPQgtCCCSEy80N9dukBvqIeT43Nrq2fmilS0NNG5mvH51qaVjWvG/0BlzyAyQwk7mcvXCMgpCGIwgDeXcNpSzxpOHu0H4C8oyYXj7eXO0nXJpDY9w/MTV27FnL8yveOhsgmSHBbMEgSw9sjyZNEwfxvYcDYrMDCgRRnJ1lBJ0HEGHyu6Hhss3L5xZGni0hdbt6WuCJKGtVGLYyMAz/O4TX1S8C/CdY0oJsoyoIVtMddVPwhjNOErbcm3lmaZGwJgm9jHr/Bq+nx8GaVBP8q87jDvtxTlllc2/7K5YddPVcEZp7a+rZx5V+WS4qAT+41yf87OkrJfwABwXxVQv2byX+6uwIp5z+xUq0KdpdUVezcv5AoByy552xKoSOeA89cKqjfWl+rcF2c3TkDU+L19Dbr4eGznJl045ki0sRJBabjYaI9NMpULRvvTuBGPPh15eqY9PzTKfEASXO+1OrABCHzFbIdP/dCFTOpT8rxW+WzKyPjoIM3Nu0N61u2YGpj2fxOh2xdf5CXOn04X12b0VwAAAABJRU5ErkJggg==",
    "youtube": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAB8UlEQVR4nI2Tu2sUURTGf+fOzO7sZnARZC1SCGmECCtBkoDRRguxUiubtVAbWwVbQ9KpYKeFiBZJ6iAIErARHxgsRAT/AMHGB0R3Nzv7mHvkzsMdBcEPZu4M5/Wd75wry2Cuz9OsjeWOsZxCaAAef0IBAbooa4S6Itt8lU6LZl1kw4zlGEoA8nfgBKKKEFtPX+2G2had4y61qYtcWa0xewSCEKohGA80L5gkMIphNISPb+HejZh+bxNtVTv68KbVXsfq/2C3Y/XRrbG2Kt8NYiLmjgv1yPWUYTiYUB2PwNrJfy0SDh/1wGsYElGmooxi4fTzGzzdgA9vwA/AmFw2zZ6oASqeDyIE1fTIegQSC88ew+dPcP4yLJyE6ZnM7hJVqqkWfjqAIqgYSiWE/gCebEM9gEOLJSO/GWZ8nLJljAbgA6cXoH0Vpg/ko5L8NGkeP307gYrqzu7GdeIMzByE1lLJJtm3G5uo+ogmdHe81FBk3rsPzl7KWQwz0YrMAvS6LtjVT37w/nVCv1tqvISgMknq4PzevVSs7fnIcIv7q+fwvJDZ+czZ0U510CzQJjB0GzZwGyY8WOnjD9als8j+eizrZmyWwIZoyv8fy60JIiN8+6Kr2nZeLkEzimUZ4QIQlW5RGRZlB8NWb49eu/2cL78Au23iDVLp1eQAAAAASUVORK5CYII=",
    "spotify": "iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAACeElEQVR4nF2TS2sUQRSFv9td3dPT8zIOwSQEEwcdNT4QxAeKrlTEgLiKe0F/hSAI/om4FcG9ChrUhYIKrowa3ZiJ4ohIopOZ6e5Md1fJdCYaLKhFceucOnXPuQIYBssqOXjHx/Cnd+DurSIlB9NO6C0sEzz4TPT6O3q1t3Ed2QCrHRUq1w7in5lACmq9wkZV0EGPcG6J1uw8yWLrH9ipVajePIF3ahy0BhkgDZj+TjWSGsQRwhdNVm68JG60EKvkmqHrxyjN1El/Reh2jAlSSDU4guQdrIKDVXYRJRlx++4nft16hfJOjGVSw+ffaN/9SPozwkRxpkDEAt9Bjfo4U1W8I9tw60Pkz20nfPoFVbhQQ/KK9HsX09PkDg9jD+XAtrKzbq1lf+ze+0T7zgLFmTrlK/vxL9ZQzp4hsMA7O4E94pM0u+hODIlBCg65yQr++QlEWYRPvmaErGncqSpKSgqxbXQnIHiwSPIjwKp4iAIdpUSrMTrW5HZvwZ+u4e6rgi1IZKFMJ8Fs1dhFF//STkys1+3RBul3XQl6JSKYWyJ89hVn15YsD7qToHrvl3EmKxhlkzYDolffELfvswG9bpkaL1CYqeOMFsG1MFqIP6yggocN8qfHEddGTZbxq96gYQK9lORnSPTmB8wv4x0YzqxLl9cIHi6iopdNgsdLlC7XyR0azphloLyvOgd4R0fQv9cwfZuBcK5BH6d0p8fq7FvUWJH8yTFMJ0ZvTiaClF2ciosRIXzeZPX2PLob/5ftqweyAFiF/nt/5yUjMN0ewaMGrdvvSBqbsv13qsou3tFR/As13KmtSFFlnsf9qbrfIHrdXM/AYP0BklQOLWdAuAIAAAAASUVORK5CYII=",
}
```
