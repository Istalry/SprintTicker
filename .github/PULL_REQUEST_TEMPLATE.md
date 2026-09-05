## What this changes

<!-- What behaviour is different afterwards, and why. If it fixes a finding in
     AUDIT.md, name it (F-nn). -->

## How it was verified

<!-- What you actually ran or observed. "Tests pass" is the floor, not the
     answer -- say what would have failed before. -->

- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm typecheck` — 0 errors
- [ ] `pnpm test` — green
- [ ] New behaviour has a test, or there is a reason here why it does not

## If this touches the display or the driver

<!-- Delete this section if it does not. -->

The hardware contract in [CLAUDE.md](../blob/main/CLAUDE.md) §4 is not style
guidance — violating it fails the whole draw call, and one of the rules reboots
the device.

- [ ] Colours are exactly 8 hex digits (`#RRGGBBAA`)
- [ ] Text is printable ASCII only (`sanitizeAsciiText`)
- [ ] Fills carry one colour, gradients carry two (via `formatHardwarePayload`)
- [ ] Nothing new redraws on a timer without checking what actually changed
- [ ] Tested against real hardware, or `pnpm dev:mock` with a note on what was not covered
