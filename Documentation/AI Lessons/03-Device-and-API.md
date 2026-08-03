# Device summary, connection, and API

Technical reference for the BUSY Bar device and HTTP API.

### Widgets vs on-device apps

- **This document** focuses on the **HTTP API** used by **widgets** (e.g. Python `widget.py` → `POST /api/display/draw`).
- **JerryScript apps** (optional firmware) run **on the device** and use native `require()` modules; they are **not** defined by DisplayElements JSON. See **[../Unofficial/12-JerryScript-on-device-apps.md](../Unofficial/12-JerryScript-on-device-apps.md)**. The **storage** endpoints in **openapi.yaml** are often used to upload files to `/ext/apps/…` for JS apps.

---

## 1. Device Summary

- **Name:** BUSY Bar
- **Display:** 72×16 LED matrix, RGB with 16 million colors, >800 nits, adaptive brightness
- **Connection:** USB connection provides a virtual Ethernet adapter. HTTP API is available via USB virtual LAN. The device can also be controlled via the desktop app (and/or direct HTTP to the device IP).
- **Mode:** The device must be in **Off** mode or **Apps** mode for the HTTP API (and thus custom widgets) to work. In other modes, draw requests have no effect.

All coordinates and layout (x, y, align, width) live in a **72×16** pixel space. Assets (images, animations) should be designed to fit this size.

---

## 2. Connection and API

- **Base URL:** Over **USB Virtual LAN** the address is **always** `http://10.0.4.20` — use that in scripts and examples; no lookup needed. Over **Wi‑Fi** the address differs (e.g. from your router); the user sets it in the script.
- **Authentication:** The API uses `ApiKeyAuth` (check OpenAPI for header or query usage). Some setups may allow unauthenticated local access.
- **Widget-relevant endpoints:**
  - `POST /api/display/draw` — send draw JSON (DisplayElements)
  - `DELETE /api/display/draw` — clear display (optional query: `app_id`)
  - `POST /api/assets/upload` — upload a file for an app (query: `app_id`, `file`)
  - `DELETE /api/assets/upload` — delete all assets for an app (query: `app_id`)
  - `GET /api/display/brightness`, `POST /api/display/brightness` — optional
  - `GET /api/version`, `GET /api/status` — optional

### Local AI endpoint vs BUSY Bar endpoint (critical)

- `http://localhost:11434` (or `.../v1`) is for your local AI server (Ollama/OpenAI-compatible), not the BUSY Bar device.
- In `widget.py`, API calls must target the BUSY Bar device base URL (`http://10.0.4.20` on USB, or your BUSY Bar Wi-Fi IP).
- Never use `localhost:11434` for `/api/display/draw` or `/api/assets/upload`.

---

## 3. Widget Concept

A **widget** is either:

- A one-off or recurring HTTP client that sends **draw JSON** to the device (`POST /api/display/draw`), optionally after uploading **assets** (`POST /api/assets/upload`), or
- The draw JSON plus assets (images/animations) that define what appears on the 72×16 display.

There is no separate "widget file format." You create draw payloads (and optionally assets) and send them via the API.

---

## 4. Step-by-Step Workflow

1. **Optional — Upload assets:**  
   `POST /api/assets/upload?app_id=<id>&file=<filename>`  
   Body = raw binary (e.g. PNG image). Use a stable `app_id` (e.g. `my_app`) and a simple filename (e.g. `data.png`).

2. **Send content:**  
   `POST /api/display/draw`  
   Body = JSON (DisplayElements): `{ "app_id": "<id>", "elements": [ ... ] }`.

3. **Optional — Clear when done:**  
   `DELETE /api/display/draw?app_id=<id>`  
   Clears the display for that app.
