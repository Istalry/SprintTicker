# Icon Reference

Source artwork for the 16×16 LED bitmaps in
`packages/desktop-app/src/main/hardware/pixel-bitmaps.ts`.

These PNGs are **not shipped**. `electron-builder.json` packages only `dist/`,
`build/` and `Animations/`. This folder is consumed once, at development time,
by the downsampler:

```bash
node scripts/convert-icons-pixelit.js
```

which rewrites the generated `*_16X16_BITMAP` arrays in `pixel-bitmaps.ts`. The
generated arrays are committed, so this folder is archival: you only need it to
regenerate a bitmap after changing its source art.

## Third-party marks are not committed

Seven source files were third-party logos (Slack, Gmail, Discord, Unity,
OpenProject) or stock icons of unclear licence. They are untracked and ignored
— redistributing another party's trademark in a public repository is not
something this project can license.

The converter handles each file in its own `try`/`catch`, so a missing source
is skipped with a warning rather than failing the run. If you need to
regenerate one of those bitmaps, drop the source PNG into this folder locally;
git will ignore it.

Longer term this matters less: the notification pipeline resolves an
application's *real* icon at runtime via `AppIconBitmapProcessor`, and the
hand-drawn bitmaps are the fallback for when that resolution fails.

## What is tracked

Original project artwork only — `App_icon.png`, `away_Icon.png`,
`compiling_icon.png`, `lunch_icon.png`, `play_mode_icon.png`, `resume_icon.png`
and `stop_task_Icon.png`.
