# busybar-anim-toolchain

The firmware's own `.anim` compiler, copied from the BUSY Bar firmware
repository (`scripts/seq2anim.py` and `scripts/flipper/`,
https://github.com/busy-app/busybar-firmware). `scripts/build-anims.js`, the
animation studio's export and the hardware probe run it as a separate Python
process; nothing imports it.

**Licence: GPL-2.0-or-later**, Copyright (c) 2024-2026 Flipper FZCO, as the
firmware's `REUSE.toml` assigns to everything under its `scripts/`. The text is
in [LICENSE](LICENSE). It is the one part of this repository that is not MIT,
and it is not bundled into the installer.

Against firmware 1.2.3:

- `flipper/` is unmodified.
- `seq2anim.py` is modified, and says so in its header. It accepts a directory
  of frames as well as a `.zip`, and annotates `FileFrame.encode`'s return as
  `"FileFrame"` rather than `typing.Self`, which needs Python 3.11.

Keep it a separate program. Porting it into the app or the studio, or
importing it from Python code of ours, would bring that code under the GPL.
The firmware also has a TypeScript port, `assets/frontend/util/seq2anim.ts`,
under the same licence, so copying that one changes nothing.
