# Tier 2 Bytecode Storage Slice

## Goal

Implement the browser-side foundation for storing mBot VR programs on a future Player
firmware without shipping firmware source or a flashing UI before the remaining
licensing and classroom-access decisions are made.

## Scope

- Add a compact bytecode format and Blockly workspace compiler that targets the existing
  robot action vocabulary.
- Add an EEPROM-size preflight check so oversized programs are blocked before any send.
- Add serial protocol helpers and `DeviceSession` methods for Player program write,
  checksum verification, and persistent halt-flag clearing.
- Add feature-flagged UI controls for "Put this on my robot" and "Clear my robot's
  program" only when connected firmware advertises Player support.
- Update tests and `docs/hardware-bridge-plan.md` implementation status.

## Out of Scope

- No Arduino sketch or firmware binary until the GPLv2/GPLv3 decision is explicit.
- No STK500 flashing UI until the teacher-only/help-drawer access decision is explicit.
- No new runtime dependencies.

## Acceptance

- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- With `?hardware=0`, no new device/bytecode modules are statically imported by the
  simulator path.
- On-robot send is disabled for non-Player firmware and for programs exceeding the
  EEPROM payload limit.

## Progress

- 2026-09-02: Created plan after confirming repo and remote.
- 2026-09-02: Added bytecode compiler, EEPROM-size preflight, Player protocol hooks,
  storage UI, tests, and hardware-plan implementation notes.

## Decision Log

- Keep the Player bytecode format app-owned and GPL-3.0-or-later compatible; do not
  vendor or derive firmware source in this slice.
- Reserve Player protocol device ids in the app for future firmware implementation,
  with commands inert unless the connected firmware version advertises Player support.

## Surprises

- `CHANGELOG.md` and `RELEASE_SUMMARY.md` were absent in this repo, so this change adds
  both to satisfy the workspace release-note rules.
