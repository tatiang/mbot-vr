Sep 3, 2026 — 1:58 PM PT — pending — Added the mBot VR Player firmware sketch (unverified on hardware); v1.3.1

- Added `firmware/mbotvr-player/`: a from-scratch, GPL-3.0-or-later Arduino sketch for the
  mCore with a bytecode VM, the reserved Player command channel, an EEPROM program slot
  with atomic commit, a boot-idle halt flag, and a 500 ms host-heartbeat watchdog.
- Added `docs/player-protocol.md` as the shared wire/EEPROM/opcode contract between the
  firmware and the browser, and a static bytecode validator with tests.
- Bumped the displayed app version to v1.3.1. No behavior change to the app: the simulator
  and tethered Tier-1 control are untouched, no firmware-flashing UI ships, and the sketch
  has not run on a real mBot yet.

Sep 2, 2026 — 4:32 PM PT — pending — Bumped the app version and clarified firmware updates

- Updated the displayed app version to v1.3.
- Added Help guidance that firmware updates are not yet available inside mBot VR.

Sep 2, 2026 — 4:22 PM PT — pending — Enabled the hardware panel by default

- Shows the physical mBot controls by default in supported browsers.
- Keeps `?hardware=0` and localStorage opt-out support for simulator-only sessions.

Sep 2, 2026 — 4:13 PM PT — pending — Added browser-side Player program storage

- Added bytecode compilation and EEPROM-size checks for future on-robot programs.
- Added Player firmware transfer and clear-program controls behind the hardware flag.
- Kept factory firmware live control and simulator behavior unchanged.
