
# Examples (draw JSON)

### Minimal text-only (single element)

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

### With image (upload PNG first, then draw)

After uploading e.g. `data.png` for `app_id: "my_app"`:

```json
{
  "app_id": "my_app",
  "elements": [
    {
      "id": "img1",
      "type": "image",
      "path": "data.png",
      "x": 0,
      "y": 0,
      "align": "top_left",
      "display": "front"
    }
  ]
}
```

### Multi-element (OpenAPI-style: text + text + image)

```json
{
  "app_id": "my_app",
  "elements": [
    {
      "id": "0",
      "timeout": 10,
      "align": "center",
      "x": 36,
      "y": 10,
      "type": "text",
      "text": "Hello, World! Long text",
      "font": "medium",
      "color": "#FFFFFFFF",
      "width": 72,
      "scroll_rate": 1000,
      "display": "front"
    },
    {
      "id": "1",
      "timeout": 6,
      "align": "top_mid",
      "x": 36,
      "y": 0,
      "type": "text",
      "text": "top_mid",
      "font": "small",
      "color": "#AAFF00FF",
      "display": "front"
    },
    {
      "id": "2",
      "timeout": 6,
      "type": "image",
      "path": "data.png",
      "x": 0,
      "y": 0,
      "display": "back"
    }
  ]
}
```

### Bus-arrivals style layout (multiple text elements)

Build an `elements` array with several text elements (e.g. route, destination, minutes), then send once per refresh:

```json
{
  "app_id": "bus_widget",
  "elements": [
    { "id": "route_0", "timeout": 0, "align": "top_mid", "x": 6, "y": 2, "type": "text", "text": "47", "font": "small", "color": "#FFC500FF", "width": 12, "scroll_rate": 0, "display": "front" },
    { "id": "dest_0", "timeout": 0, "align": "top_left", "x": 14, "y": 2, "type": "text", "text": "Hampstead", "font": "small", "color": "#FFC500FF", "width": 40, "scroll_rate": 400, "display": "front" },
    { "id": "mins_0", "timeout": 0, "align": "top_mid", "x": 65, "y": 2, "type": "text", "text": "2min", "font": "small", "color": "#FFC500FF", "display": "front" }
  ]
}
```

---
