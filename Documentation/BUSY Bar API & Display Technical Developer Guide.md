# BUSY Bar API & Display Technical Developer Guide

A comprehensive technical reference for developing applications, rendering graphics, and interacting with the BUSY Bar hardware display (72×16 pixels) over USB or Wi-Fi REST API and WebSockets.

## 1\. Display Architecture & Coordinate Mechanics

The BUSY Bar display features a 72×16 **pixel matrix**. Understanding how screen coordinates interact with bounding box anchors is essential for preventing clipped or invisible elements.

```
 (0,0) ------------------------------------> +X (71,0)
   |  [Top-Left]                  [Top-Right]
   |
   |  [Center: (36,8)]
   v
  +Y (0,15) --------------------------------> (71,15)
     [Bottom-Left]                [Bottom-Right]
```

### Screen Coordinate System

-   **Origin** (0,0) is at the **Top-Left** pixel of the matrix.
    
-   **X-axis**: Ranges from 0 (far left) to 71 (far right).
    
-   **Y-axis**: Ranges from 0 (top edge) to 15 (bottom edge).
    
-   **Dual Display Support**: Elements accept a `display` parameter set to `"front"` (default) or `"back"` for dual-screen models.
    

### Bounding Box Anchors (`align`)

The `align` parameter does **not** specify screen alignment. Instead, it defines **which anchor point on the element's bounding box** is pinned to the given screen coordinate (x,y).

-   **`align: "top_left"` at** (0,0): Pins the top-left corner of the element to pixel (0,0). Content renders predictably starting at the top-left corner.
    
-   **`align: "center"` at** (36,8): Pins the exact center of the element to pixel (36,8), centering text horizontally and vertically.
    
-   **`align: "center"` at** (0,0): Pins the _center_ of the element to (0,0). Half of the content is pushed off-screen into negative coordinate space (X<0,Y<0), resulting in clipped or invisible text.
    

#### Valid Anchor Options:

`top_left`, `top_mid`, `top_right`, `mid_left`, `center`, `mid_right`, `bottom_left`, `bottom_mid`, `bottom_right`

## 2\. Authentication & Access Security

When API access protection is enabled on the device (`/api/access`), pass the configured access key in the request header:

```
X-API-Token: 12345678
```

To query or update access settings:

-   **`GET /api/access`**: Retrieves access mode (`"disabled"`, `"enabled"`, or `"key"`) and key status.
    
-   **`POST /api/access?mode=key&key=12345678`**: Configures access mode and sets a 4–10 digit API key.
    

## 3\. Retrieving Hardware Information & Input

### Fetching System Telemetry

The device provides several REST endpoints under `/api/status` for real-time monitoring:

#### 1\. Complete System Telemetry

```
curl -X GET http://10.0.4.20/api/status
```

Returns a combined payload containing `device`, `firmware`, `system`, and `power` telemetry.

#### 2\. Battery & Power Metrics

```
curl -X GET http://10.0.4.20/api/status/power
```

**Response Schema (`StatusPower`):**

```
{
  "state": "charging",
  "battery_charge": 98,
  "battery_voltage": 4183,
  "battery_current": 180,
  "usb_voltage": 4843
}
```

#### 3\. Firmware & System Subsystems

```
curl -X GET http://10.0.4.20/api/status/firmware
curl -X GET http://10.0.4.20/api/status/system
curl -X GET http://10.0.4.20/api/status/device
```

### Physical Hardware Button Stream (WebSocket)

To receive real-time key press events when a user presses a physical button on the BUSY Bar, open a WebSocket connection to `/api/status/ws`:

```
const ws = new WebSocket("ws://10.0.4.20/api/status/ws");

ws.onopen = () => {
  // Handshake signal required to begin event streaming
  ws.send(JSON.stringify({ enable: true }));
};

ws.onmessage = (event) => {
  if (typeof event.data === "string") {
    try {
      const data = JSON.parse(event.data);
      const key = data.key || data.input || data.button || (data.input_event && data.input_event.key);
      if (key) {
        console.log("Hardware Key Pressed:", key);
      }
    } catch (e) {
      console.log("Raw WS Message:", event.data);
    }
  }
};
```

#### Valid Key Names:

`"up"`, `"down"`, `"ok"`, `"back"`, `"start"`, `"busy"`, `"custom"`, `"off"`, `"apps"`, `"settings"`

### Programmatic Remote Key Event Injection

Simulate a physical key press on the device via REST:

```
curl -X POST "http://10.0.4.20/api/input?key=ok"
```

### Real-Time Hardware Screen Capture

Capture the exact BMP bitmap currently displayed on the device matrix:

```
curl -X GET "http://10.0.4.20/api/screen?display=0" \
  -H "Accept: image/bmp" \
  --output screen_capture.bmp
```

## 4\. Display Priority, Timers & Buffer Management

### Priority Escalation System

Every draw payload specifies a `priority` integer from 1 to 100:

-   **`0`**: Idle / power-off state (reserved for internal firmware use).
    
-   **`10`**: Default system built-in applications.
    
-   **`90`**: Active BUSY or CUSTOM timer session.
    
-   **`95–100`**: Custom WebApp / Developer override level.
    

> **CRITICAL**: If your payload specifies a priority level lower than an active session running on the device, the request is rejected with `HTTP 409 Conflict`. Always use `priority: 95` or higher for custom app overlays.

### Element Lifespan (`timeout` vs `display_until`)

Control element display duration using one of two mutually exclusive parameters:

-   **`timeout`**: Duration in seconds before the element auto-hides (e.g., `"timeout": 10`). Setting `0` displays it indefinitely.
    
-   **`display_until`**: Unix UTC timestamp (in seconds) when the element expires.
    

### Buffer Wipe

To clear existing display elements drawn by your application ID:

```
curl -X DELETE "http://10.0.4.20/api/display/draw?application_name=my_app"
```

## 5\. Complete Display Elements Schema Reference

Draw commands are posted to `POST /api/display/draw` using the `DisplayElements` container:

```
{
  "application_name": "my_app",
  "priority": 95,
  "led_notification_color": "#FF0000FF",
  "elements": [ ... ]
}
```

### 1\. `TextElement` (`type: "text"`)

Renders printable ASCII characters (`0x20`–`0x7E`) using standard bitmap fonts.

```
{
  "id": "text_0",
  "type": "text",
  "text": "BUSY BAR",
  "font": "bold",
  "color": "#00FFCCFF",
  "align": "center",
  "x": 36,
  "y": 8,
  "display": "front",
  "width": 72,
  "scroll_rate": 1000,
  "scroll_start_delay": 1000,
  "scroll_repeat_delay": 2000
}
```

-   **`font` options**: `"tiny"`, `"small"`, `"normal"`, `"condensed"`, `"bold"`, `"large"`, `"extra_large"`, `"global"`
    
-   **`color`**: Hex format `#RRGGBBAA` (e.g., `"#00FFCCFF"`).
    
-   **Scrolling parameters**: Set `width` alongside `scroll_rate` (pixels/min), `scroll_start_delay` (ms), and `scroll_repeat_delay` (ms) to enable auto-scrolling for long strings.
    

### 2\. `ImageElement` (`type: "image"`)

Displays a bitmap asset from the app's uploaded storage or stock library.

```
{
  "id": "img_0",
  "type": "image",
  "path": "data.png",
  "x": 0,
  "y": 0,
  "align": "top_left",
  "opacity": 100,
  "display": "front"
}
```

-   **Custom asset**: Use `path` (e.g., `"data.png"`).
    
-   **Stock asset**: Use `stock_path` (e.g., `"shared/icon_warning.png"`).
    
-   **`opacity`**: Value from 0 to 100%.
    

### 3\. `AnimationElement` (`type: "animation"`)

Plays animated sprite sequences stored on the hardware.

```
{
  "id": "anim_0",
  "type": "animation",
  "path": "spinner.anim",
  "x": 0,
  "y": 0,
  "align": "top_left",
  "loop": true,
  "section": "default",
  "await_previous_end": false,
  "opacity": 100
}
```

### 4\. `CountdownElement` (`type: "countdown"`)

Displays a live counting timer relative to a target timestamp.

```
{
  "id": "count_0",
  "type": "countdown",
  "timestamp": "1761582532",
  "direction": "time_left",
  "show_hours": "when_non_zero",
  "color": "#FFFF00FF",
  "align": "center",
  "x": 36,
  "y": 8
}
```

-   **`timestamp`**: Seconds-based Unix UTC timestamp as a string.
    
-   **`direction`**: `"time_left"` (count down) or `"time_since"` (count up).
    
-   **`show_hours`**: `"when_non_zero"` or `"always"`.
    

### 5\. `RectangleElement` (`type: "rectangle"`)

Renders shapes, borders, and color fills.

```
{
  "id": "rect_0",
  "type": "rectangle",
  "x": 6,
  "y": 1,
  "width": 60,
  "height": 14,
  "radius": 2,
  "fill": "solid",
  "fill_colors": ["#FF0000FF"],
  "border_width": 1,
  "border_color": "#FFFFFFFF",
  "align": "top_left"
}
```

-   **`fill` options**: `"none"`, `"solid"`, `"gradient_h"`, `"gradient_v"`
    
-   **CRITICAL RULE FOR `fill_colors`**:
    
    -   For `"solid"`, `fill_colors` **MUST contain strictly 1 color string** (`["#RRGGBBAA"]`).
        
    -   For gradients (`"gradient_h"` / `"gradient_v"`), `fill_colors` **MUST contain strictly 2 color strings** (`["#COLOR1", "#COLOR2"]`).
        
    -   _Providing 2 colors for a solid fill violates the firmware schema validator and will reboot the device._
        

## 6\. Pixel Matrix Rendering Strategies

Rendering pixel art on the 72×16 screen requires choosing the correct method based on pixel density:

### Method 1: Rectangle Strip Compression (≤40 Strips)

For simple icons or sparse pixel art, combine contiguous horizontal pixels of identical color into rectangle elements:

```
curl -X POST http://10.0.4.20/api/display/draw \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "my_app",
    "priority": 95,
    "elements": [
      {
        "id": "strip_r0_c10",
        "type": "rectangle",
        "x": 10, "y": 0, "width": 15, "height": 1,
        "fill": "solid", "fill_colors": ["#00FFCCFF"],
        "border_width": 0, "align": "top_left"
      }
    ]
  }'
```

### Method 2: PNG Asset Upload + Image Element (\>40 Strips)

For detailed graphics or dense photos, sending thousands of rectangle JSON objects exceeds the microcontroller's JSON buffer memory. Render the matrix to a 72×16 24-bit opaque PNG, upload it, and render it as an `ImageElement`.

#### Step 1: Upload Asset (`POST /api/assets/upload`)

-   **Filename constraint**: Must strictly match `^[a-zA-Z0-9._-]+$`.
    
-   **Content-Type**: Must be `application/octet-stream`.
    

```
curl -X POST "http://10.0.4.20/api/assets/upload?application_name=my_app&file=matrix_art.png" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@matrix_art.png"
```

#### Step 2: Render Image Element (`POST /api/display/draw`)

```
curl -X POST http://10.0.4.20/api/display/draw \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "my_app",
    "priority": 95,
    "elements": [
      {
        "id": "matrix_art",
        "type": "image",
        "path": "matrix_art.png",
        "x": 0, "y": 0, "align": "top_left",
        "opacity": 100, "display": "front"
      }
    ]
  }'
```

## 7\. Hardware Controls, Audio & System Settings

### Display Brightness Control

```
# Query brightness
curl -X GET http://10.0.4.20/api/display/brightness

# Set brightness (0-100 or "auto")
curl -X POST "http://10.0.4.20/api/display/brightness?value=50"
```

### Audio Volume & Sound Playback

```
# Set volume (0-100, silent=1 disables volume change chime)
curl -X POST "http://10.0.4.20/api/audio/volume?volume=60&silent=1"

# Play audio asset (.snd format)
curl -X POST http://10.0.4.20/api/audio/play \
  -H "Content-Type: application/json" \
  -d '{"application_name": "my_app", "path": "alert.snd"}'

# Stop playback
curl -X DELETE http://10.0.4.20/api/audio/play
```

### RTC Timestamp Synchronization

```
# Query system RTC time
curl -X GET http://10.0.4.20/api/time

# Synchronize RTC timestamp (ISO 8601 format with timezone offset)
curl -X POST "http://10.0.4.20/api/time/timestamp?timestamp=2026-07-30T23:14:00%2B02:00"
```

## 8\. HTTP Status Codes & Error Diagnostics

| 
HTTP Code

 | 

Cause

 | 

Resolution

 |
| --- | --- | --- |
| 

**`200 OK`**

 | 

Request executed successfully.

 | 

—

 |
| 

**`400 Bad Request`**

 | 

Invalid parameters, color format error, invalid filename pattern, or missing required field.

 | 

Verify `#RRGGBBAA` hex formats and regex constraints.

 |
| 

**`409 Conflict`**

 | 

Draw priority is lower than an active session on the device.

 | 

Increase `priority` to `95` or higher.

 |
| 

**`413 Payload Too Large`**

 | 

Image file or JSON payload exceeds device buffer limits.

 | 

Scale images down to 72×16 PNG assets before uploading.

 |
| 

**`503 Service Unavailable`**

 | 

Hardware subsystem or radio coprocessor temporary failure.

 | 

Retry request after a brief delay.

 |