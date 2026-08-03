# Complete widget.py (copy/paste)

If you couldn’t download `widget.py` as a file, copy everything below into a new file named **`widget.py`**.

This example is intentionally **reliable**:
- No external (third‑party) APIs
- Shows a simple icon (up to 15×15) + current time
- Keeps running even if the device is temporarily unreachable

```python
import io
import time
from datetime import datetime

import requests

try:
    from PIL import Image, ImageDraw
except Exception:  # pillow is optional; script still works without an icon
    Image = None
    ImageDraw = None


# Over USB the address is always http://10.0.4.20 (leave as-is). Only change this if you're on Wi‑Fi.
DEVICE = "http://10.0.4.20"

# Give each widget a unique app_id (allowed characters: a-z A-Z 0-9 . _ -)
# This helps avoid collisions if you run multiple widgets.
APP_ID = "busybar_example_widget"
DISPLAY = "front"  # "front" or "back"

REFRESH_SECONDS = 30
TIME_FORMAT = "%H:%M"

ICON_ENABLED = True
ICON_FILE = "icon.png"
ICON_SIZE = 13  # max 15x15; smaller is often clearer on 72x16


def http_post(path: str, *, params=None, json=None, data=None, timeout=10):
    url = DEVICE.rstrip("/") + path
    return requests.post(url, params=params, json=json, data=data, timeout=timeout)


def make_icon_png_bytes() -> bytes:
    if not (Image and ImageDraw):
        raise RuntimeError("Pillow not available (install with: python3 -m pip install --user pillow)")

    img = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Simple colored “status dot” icon. Replace with your own pixel art if desired.
    d.ellipse((1, 1, ICON_SIZE - 2, ICON_SIZE - 2), fill=(34, 197, 94, 255))  # green

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def upload_icon_once():
    if not ICON_ENABLED:
        return False
    if not (Image and ImageDraw):
        # No icon possible; continue without one.
        return False

    try:
        png = make_icon_png_bytes()
        r = http_post(
            "/api/assets/upload",
            params={"app_id": APP_ID, "file": ICON_FILE},
            data=png,
            timeout=10,
        )
        r.raise_for_status()
        return True
    except requests.RequestException as e:
        print("Icon upload failed (continuing without icon):", e)
        return False


def build_elements(icon_available: bool):
    now = datetime.now().strftime(TIME_FORMAT)

    elements = []

    if icon_available:
        elements.append(
            {
                "id": "icon",
                "type": "image",
                "path": ICON_FILE,
                "x": 0,
                "y": 8,
                "align": "mid_left",
                "display": DISPLAY,
            }
        )
        text_x = ICON_SIZE + 3  # icon width + gap (2–3px recommended)
        text_align = "mid_left"
    else:
        text_x = 36
        text_align = "center"

    elements.append(
        {
            "id": "time",
            "type": "text",
            "text": now,
            "x": text_x,
            "y": 8,
            "align": text_align,
            "font": "medium",
            "color": "#FFFFFFFF",
            "display": DISPLAY,
        }
    )

    return elements


def send_draw(elements):
    r = http_post(
        "/api/display/draw",
        json={"app_id": APP_ID, "elements": elements},
        timeout=10,
    )
    r.raise_for_status()


def main():
    icon_available = upload_icon_once()

    while True:
        try:
            elements = build_elements(icon_available)
            send_draw(elements)
            print("Sent to display.")
        except requests.RequestException as e:
            print("BUSY Bar request failed (will retry):", e)
        except KeyboardInterrupt:
            print("\nStopped.")
            break

        time.sleep(REFRESH_SECONDS)


if __name__ == "__main__":
    main()
```