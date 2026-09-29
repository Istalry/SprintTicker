# Style guide: what the official animations do

The three full-screen animations that ship with the BUSY Bar firmware
(`Animations/lunch_72x16`, `back_soon_72x16`, `meeting_72x16`, © Flipper FZCO,
CC-BY-SA-4.0) were measured frame by frame on 2026-09-29. This document records
the **visual language** they share, so that our own animations can speak it.

It records measurements and principles, not artwork. Our scenes are drawn from
scratch: nothing here is traced or copied. The originals are CC-BY-SA, and a
derivative would carry that licence with it.

Frame numbers are at the originals' 60 fps; divide by 60 for seconds.

## 1. The rule that matters most

**Only the icon moves.** In all three, a per-pixel change map over every frame
shows the plate and the text untouched from the first frame to the last. Every
changed pixel lies in the icon's zone on the left (x ≤ 36, and ≤ 24 for two of
them). The text never animates, and nor does the plate, except where a glow
behind the icon brightens it.

The screen is a label with a living picture beside it. The picture carries all
the motion. The text is read once and then left alone, and that stillness is
what keeps the whole screen calm.

## 2. Layout

| | Lunch | Back Soon | Meeting |
| :--- | :--- | :--- | :--- |
| Plate | x 1–70, full height | x 1–70, full height | x 1–70, full height |
| Icon zone (ink) | x 6–24 (19 px) | x 11–28, glow x 4–36 | x 3–23 (21 px) |
| Text ink | x 27–64, y 4–12 | x 36–61, y 1–6 and 9–14 | x 23–67, y 4–11 |
| Text height | 9 px, one line | 6 px, two lines, 2 px apart | 8 px, one line |
| Stroke | 2 px | 2 px | 2 px |

- **The plate is 70 × 16, leaving column 0 and column 71 black.** It fills the
  full height, with a one-pixel dark margin at each end.
- **The icon is larger than 16 px.** It uses the whole height and roughly 20 px
  of width, and may overhang the plate's outline while it moves. Ingredients
  fall in from above the top edge.
- **The text sits centred in the space right of the icon**, not right-aligned.
  One word gets one line as tall as possible (8–9 px). Two words get two lines
  of 6 px.

## 3. The plate

Measured on Lunch, whose plate is the plainest:

```
fill      vertical gradient, #223731 at the top to #1B2B26 at the bottom (≈15% darker)
outline   1 px, brighter and more saturated than the fill: #295431 along the top,
          #254D2C → #18301A down the sides, #19331B along the bottom
inner     a 1 px highlight just inside the top outline
corners   radius ≈ 2, anti-aliased: the corner pixel is a partial blend, not a cut
```

- The **outline carries its own vertical gradient**, lit from above.
- **Meeting** is the same construction on a bright blue fill (#2E90FC). Its
  side outlines are much lighter (#6DB2FD → #96C7FD), which reads as a bevel.
- **Back Soon** varies it. The plate is navy at both ends and near-black behind
  the text. A dark spot under the words raises their contrast, and a blue
  radial glow sits behind the clock.

The plate is dark enough that the icon and text do the lighting: mean panel
luminance is 80–130 out of 255.

**Ours: one plate colour per animation.** The colour says which mode the bar
is in before the icon or the word is read, so no two of our animations share
a hue. Taken so far:

| Animation | Plate | Fill (top → bottom) |
| :--- | :--- | :--- |
| Lunch | teal | `#193A40` → `#10272C` |
| Away | purple | `#381A50` → `#241036`, matching the Away LED |
| Meeting | blue | `#22538A` → `#173D69`, lighter than the others |

Pick a free hue for a new one, and add it here.

## 4. Text

- **Flat colour, no anti-aliasing, 2 px strokes.** Legibility first.
- **Tinted toward the plate's hue:** pale mint #E3FAD1 on green, white fading
  to #AEC9FD on navy, pure white on blue. Never a hue foreign to the plate.
- **It carries depth, never motion.**
  - Lunch uses a soft dark shadow blurred 2–3 px below the letters.
  - Meeting uses a hard 1 px shadow directly underneath.
  - Back Soon uses a gradient across the letters, white at the top left to
    pale blue at the bottom right.

## 5. The icon

The icon is **not frame-by-frame pixel art**. It is smooth motion rendered at
60 fps with anti-aliasing:

- **Every frame of an action differs from the one before.** 7,000–10,000
  distinct colours appear per animation. Objects move by fractions of a pixel,
  and the edges blend into the plate.
- **Warm accents on a cool plate:** red and yellow salad on green, an orange and
  yellow clock rim on navy, a white bubble on blue.

The motion techniques used:

| Technique | Where | Measured |
| :--- | :--- | :--- |
| Gravity fall | Lunch ingredients | Accelerates from rest: 0 → 5.6 px over ~17 frames |
| Settle | Lunch, on landing | Small damped bounces (±0.4 px) over ~15 frames, then still |
| Stagger | Lunch | Greens first, then yellow, then tomatoes, each a few frames behind |
| Squash and stretch | Lunch bowl | The bowl flattens and widens on impact, then recovers |
| Motion blur | Lunch toss | Fast frames smear, blending the object across its path |
| 3D flip | Back Soon clock | Turns about its vertical axis; the thick orange rim changes side |
| Secondary action | Back Soon glow | Glow brightens 30 → 46 → 30 in step with the spin, eased in and out |
| Cross-fade with depth | Meeting bubbles | Front and back bubbles swap by fading through each other over ~20 frames |
| Little life | Meeting | Equaliser bars, typing dots, a chart line drawing itself |

## 6. Time

Each animation is a **story that returns to where it began**, not a spin cycle.

- **Lunch (540 frames, 9 s)**
  - 0–26: hold on a full salad.
  - 26–110: it is eaten, bite by bite.
  - 111–170: the ingredients fall back in.
  - 171–265: a toss, then a hold of 95 frames (1.6 s).
  - 360–460: the same toss again (frames 376–459 repeat 181–264).
  - 460–540: a hold of 80 frames.
  - The last frame is identical to the first.
- **Back Soon (241 frames, 4 s)**
  - 0–100: the clock spins and its hands advance.
  - 101–130: a brief pause with a small hand movement.
  - 130–220: a second spin, then it settles.
  - Continuous, with no hold. The last frame equals the first.
- **Meeting (525 frames, 8.75 s)**
  - 0–157: the front bubble talks (the equaliser plays).
  - 158–213: a hold of 55 frames.
  - 213–245: the bubbles swap.
  - 245–420: the other bubble types.
  - 420–455: a swap to a check mark.
  - 463–511: a hold.
  - The loop point is almost seamless (32 pixels differ).

The principles:

- **Rest is part of the rhythm.** Every action is followed by a hold of 1–1.6 s.
  An animation that never stops reads as an alarm.
- **Holds cost nothing in the file.** `seq2anim` merges identical consecutive
  frames, so a long hold at 60 fps is one frame.
- **The loop is seamless.** The last frame must equal the first, or every loop
  shows a jump.
- **Motion is eased**, accelerating into a fall and settling out of it. Nothing
  moves at constant speed, except a spin at full speed.

## 7. Budget

| | Frames | Unique | `.anim` size |
| :--- | ---: | ---: | ---: |
| Lunch | 540 | 219 | 843 KB |
| Back Soon | 241 | 240 | 833 KB |
| Meeting | 525 | 417 | 1,328 KB |

Firmware 1.2.3 accepts and animates all three: `pnpm probe:busybar` uploads the
largest and captures it moving. So about 1.3 MB is a proven ceiling, not a
guess. Size follows unique frames, so smooth motion is paid for per frame of
action, and holds are nearly free.

## 8. What this means for a scene

1. **Motion goes in the icon, and the icon moves smoothly.** Keyframed
   position, scale and opacity with easing, rendered with anti-aliasing,
   produce every technique in §5. Flip is a horizontal scale, squash is a scale
   anchored at the base, and cross-fade is opacity.
2. **The plate follows §3**: a vertical gradient, an outline graded from light
   at the top, anti-aliased corners, black end columns, and an optional glow or
   dark spot.
3. **The text follows §4**: flat, tinted, as tall as fits, with a shadow or a
   gradient for depth and no effect. The studio's text effects exist for
   notifications and events, where the text is the news.
4. **Time follows §6**: act, hold, act, hold, and end on the first frame.
