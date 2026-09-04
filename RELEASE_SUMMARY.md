# Release Summary

## v1.3.2 — Web Bluetooth (BLE) connection for BLE-only modules

- Added `src/device/BluetoothLeTransport.ts`, a Web Bluetooth (GATT) transport that
  implements the same `SerialLink` interface the USB and Bluetooth-classic transports
  use, so every existing feature (Run on robot, STOP's full safety ladder, sensor
  reads, on-robot code storage) works over it unchanged.
- Added a "Connect Bluetooth" button for modules like "Bluetooth BLEV1.0" that the
  existing Bluetooth-classic (RFCOMM) option can't reach at all - it's BLE-only, with
  no SPP service. The existing option is kept as a secondary link for dual-mode
  modules.
- Added an opt-in `?debug=1` panel with per-actuator test buttons (motors, ultrasonic)
  and connection stats, for bringing up new hardware without a full block program.
- Five new `ERR_BLE_*` diagnostic codes, matching the existing taxonomy's format.
- Unverified against a real BLE module - the GATT service/characteristic UUIDs are
  sourced from public secondhand reports, not confirmed, and the app tries three
  candidate profiles in order rather than betting on one guess. See
  `docs/bluetooth-le-bridge.md` for the full confidence note and bench-test checklist.
- `npm run typecheck`/`test` (445 passing, all pre-existing tests unchanged)/`build`
  all pass.

## v1.3.1 — Player firmware sketch (unverified on hardware)

- Added `firmware/mbotvr-player/mbotvr-player.ino`, a from-scratch GPL-3.0-or-later
  Arduino sketch for the mCore: a bytecode VM for the `PlayerOp` set, the `0x7D` Player
  command channel (`INFO`, begin/write/verify/commit, boot-idle flag), an EEPROM program
  slot whose magic is written last so an interrupted transfer boots idle, and a 500 ms
  host-heartbeat watchdog that stops the motors if a tethered host goes silent mid-drive.
- Added `docs/player-protocol.md` as the single wire/EEPROM/opcode contract shared by the
  firmware and the browser modules, and a static bytecode validator
  (`tests/support/playerBytecode.ts`) with positive and negative tests.
- Licensing decision: Player firmware is written from scratch, keeping the tree uniformly
  GPL-3.0-or-later. Flashing-access decision: a future flashing UI will be
  student-reachable from the run bar (no such UI ships in this change).
- Bumped the displayed app version to v1.3.1. No app behavior change: simulator and
  tethered Tier-1 control untouched; no firmware-flashing path added; the app bundle is
  unchanged (the sketch is not compiled into the site). Nothing in the sketch has run on
  a physical mBot.

## v1.3 — App version and firmware guidance

- Bumped the app version shown in the header to v1.3.
- Added Help drawer guidance that firmware updates are not yet available inside mBot VR.
- Pointed teachers to mBlock 5's Factory Firmware update path for restoring live-control compatibility.

## Hardware bridge Tier 2 groundwork (previous)

- Added browser-side Player bytecode generation for Blockly programs.
- Added preflight checks that block oversized EEPROM programs before any transfer.
- Added Player-only controls to put a program on a robot and clear its stored program.
- Left actual Player firmware and flashing UI unshipped pending licensing and classroom-access decisions.
