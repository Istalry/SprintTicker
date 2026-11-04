# busybar-anim-toolchain

The firmware's own `.anim` compilers, copied from the BUSY Bar firmware
repository (`scripts/seq2anim.py` and `scripts/flipper/`,
https://github.com/busy-app/busybar-firmware). `scripts/build-anims.js`, the
animation studio's export and the hardware probe run them as separate Python
processes; nothing imports them.

There are two, because the firmware changed its file format and reads only
its own: 1.2 reads `bicycle0`, 1.3 reads `bicycle1` (interframe compression,
files about four times smaller). A file in the other format is stored and
drawn with 200s and shows a load-error icon, so every animation is compiled
by both and the app picks one per bar
(`packages/desktop-app/src/shared/anim-format.ts`; the list of compilers for
the tools is `scripts/lib/anim-formats.js`).

| Script | Firmware it comes from | Writes | Read by |
| :--- | :--- | :--- | :--- |
| `seq2anim.py` | 1.2.3 | `<name>.anim`, `bicycle0` | firmware 1.2 |
| `seq2anim_v1.py` | 1.3.1 | `<name>.v1.anim`, `bicycle1` | firmware 1.3 |

**Licence: GPL-2.0-or-later**, Copyright (c) 2024-2026 Flipper FZCO, as the
firmware's `REUSE.toml` assigns to everything under its `scripts/`. The text is
in [LICENSE](LICENSE). It is the one part of this repository that is not MIT,
and it is not bundled into the installer.

Against the firmware each came from:

- `flipper/` is unmodified, and the same in 1.2.3 and 1.3.1.
- `seq2anim.py` is modified, and says so in its header. It accepts a directory
  of frames as well as a `.zip`, and annotates `FileFrame.encode`'s return as
  `"FileFrame"` rather than `typing.Self`, which needs Python 3.11.
- `seq2anim_v1.py` is 1.3.1's `seq2anim.py`, modified the same way and saying
  so in its header: it accepts a directory of frames as well as a `.zip`.
  1.3.1 no longer uses `typing.Self`.

To take a newer compiler, diff the firmware's `scripts/seq2anim.py` between
its tags first: a new `SIGNATURE` is a new format, which needs a new script
beside these, a new entry in both lists above, and the files compiled again.

Keep it a separate program. Porting it into the app or the studio, or
importing it from Python code of ours, would bring that code under the GPL.
The firmware also has a TypeScript port, `assets/frontend/util/seq2anim.ts`,
under the same licence, so copying that one changes nothing.
