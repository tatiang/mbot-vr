# Bluetooth Low Energy (Web Bluetooth) bridge for BLE-only mBot modules

**Status: implemented, UNVERIFIED against real hardware.** Everything below has been
exercised against a fake GATT device in tests and against a real Chromium `navigator
.bluetooth` (a real chooser opened, a real `NotFoundError` came back and was handled
correctly - see the "First smoke test" section) but **never against an actual Makeblock
BLEV1.0 module**. Treat every protocol-shape claim here the way
`docs/hardware-bridge-plan.md` treats an unconfirmed one: plausible, sourced, not proven.

## Why this exists, and how it differs from the existing "Connect (via Bluetooth)"

mBot VR already reaches a Bluetooth-paired robot one way: `src/device/SerialTransport.ts`
opens Bluetooth Classic RFCOMM (a paired dual-mode module's SPP service) through
`navigator.serial`. That is deliberate and documented (`hardware-bridge-plan.md` §3,
sources 10-11) - Web Bluetooth's GATT API cannot reach an SPP service, and Chrome's
RFCOMM-over-Web-Serial support was the whole point of choosing that path.

That reasoning holds for a **dual-mode** module. It does not help a module that is
**BLE-only** - no SPP service exists to expose, so the RFCOMM path's port chooser simply
never lists it (the plan's own predicted, "honest," outcome for that case). A module
printed **"Bluetooth BLEV1.0"** (Makeblock's single-mode BLE board, FCC id
`2AH9Q-BLEV1-C`) is exactly that case. This is the other half of the plan's still-open
**U4** ("which Bluetooth module is fitted") - one physical answer now has one working
transport apiece.

## Architecture: one more `SerialLink`, not a parallel app

The entire point of this project's device layer is the seam described at the top of
`docs/hardware-bridge-plan.md`: `MbotRuntime` is implemented once per transport
(`createEngineRuntime` for the simulator, `createSerialRuntime` for a physical robot),
and everything above that - `ProgramRunner`, the block compiler, `StopController`, the
error taxonomy, the diagnostic log - is written once against the interface, not once per
transport. `SerialLink` (`{ write, onData, onDisconnect, setSignals, close }`) is the
narrower seam directly underneath that: `DeviceSession` only ever talks to a
`SerialLink`, never to a `SerialPort` or a Bluetooth device directly.

`src/device/BluetoothLeTransport.ts` adds exactly one more `SerialLink` implementation,
backed by `navigator.bluetooth` instead of `navigator.serial`. Nothing else in the
device layer changed in kind - `DeviceSession`, `MakeblockProtocol`'s `FrameParser`,
`StopController`, `SerialRobotRuntime`, `assessHardwareCompatibility`, the Player
firmware storage commands, all work against a BLE-connected robot completely unchanged
(verified: none of those files import anything Bluetooth-specific; see the grep this
work started from - `LinkKind` is the only thing any of them know about the transport,
and it is threaded through opaquely). Concretely, this means "Run on mBot" **is** the
existing "Run on robot" button - there is no second interpreter, no second STOP path, no
second program-cancellation mechanism to build, because none of those are transport-
specific in this codebase to begin with. That is also why Phase 3/4 of the original
request ("Run on mBot", block support, sensor reads, cancellation, the command queue)
needed no new code once the transport existed: they were already generic.

What *is* new:

| Piece | File |
| --- | --- |
| The GATT transport itself | `src/device/BluetoothLeTransport.ts` |
| Ambient Web Bluetooth types (no `@types/web-bluetooth` package exists) | `src/types/webBluetooth.d.ts` |
| A third `LinkKind` (`'ble'`), and `isWirelessLink()` covering both wireless kinds | `src/device/types.ts` |
| `bleAvailable` capability + `canOfferHardware` accepting either transport | `src/device/capabilities.ts` |
| The `connect()` branch that calls the BLE functions instead of the Web Serial ones | `src/hooks/useDeviceSession.ts` |
| Five `ERR_BLE_*` taxonomy entries | `src/diagnostics/taxonomy.ts` |
| The "Connect Bluetooth" button (primary) and a secondary link to the old RFCOMM path | `src/components/DevicePanel.tsx` |
| The `?debug=1` panel (per-actuator test buttons, connection stats) | `src/components/DeviceDebugPanel.tsx`, `isHardwareDebugEnabled()` in `featureFlag.ts` |
| `packetsSent`/`packetsReceived` counters the debug panel reads | `DeviceSession.getStats()` |

## Confidence note: the GATT service/characteristic UUIDs

No source found during this work names BLEV1-C's GATT profile specifically. What exists
is several independent, secondhand reports that Makeblock's mBot BLE module (unqualified
- not confirmed to be this exact part) exposes a UART-bridge service at `0xFFE1` with a
notify characteristic at `0xFFE2` and a write characteristic at `0xFFE3`, forwarding
bytes transparently to the mCore's hardware serial port - i.e. the same `0xFF 0x55` byte
protocol this app already speaks over USB and RFCOMM, just tunnelled through GATT.
Sources (all secondhand):

- Makeblock forum, "Bluetooth Low Energy specs question" (forum.makeblock.com)
- "MakeBlock STEM mbot Robot - Using nodeJS to control mbot through BLE" (primalcortex.wordpress.com)
- community.appinventor.mit.edu, "ServiceUUID and CharacteristicUUID after connection"
- A GitHub-wiki mirror of `Ted-CAcert/mymbot`'s wiki, "Bluetooth Module für mBot V1"

Rather than bet the whole feature on one unconfirmed guess, `requestBleDevice()` asks
the browser's chooser for **three** candidate GATT shapes at once (Web Bluetooth's
privacy model requires every service to be named at request time or it can never be
opened later, even if the device advertises it), and `openBleLink()` tries them in
order until one actually resolves both characteristics:

1. `makeblock-ffe1` - the shape above (service `ffe1`, notify `ffe2`, write `ffe3`).
2. `hm10-ffe0` - the common HM-10/CC41-A generic BLE-UART-bridge shape (service `ffe0`,
   one characteristic `ffe1` doing both notify and write), included because cheap BLE
   radios are frequently OEM'd from this reference design.
3. `nordic-uart` - the Nordic UART Service, in case the module's radio SoC is a Nordic
   part advertising its reference profile unmodified.

If none match, connecting fails loudly with `ERR_BLE_SERVICE_NOT_FOUND` and a
diagnostic-log line naming every profile that was tried - never a silent wrong guess.
**Whichever profile actually matches your BLEV1.0 module belongs recorded here**, the
same way every other protocol fact in this app graduates from "sourced" to "confirmed."

## Other things assumed, not proven

- **Write chunking.** BLE's default ATT MTU is 23 bytes (20 usable after the write-
  request header) unless a larger MTU is negotiated; Web Bluetooth has no cross-browser
  way to read the negotiated value. `BLE_MAX_CHUNK_BYTES = 20` in
  `BluetoothLeTransport.ts` is deliberately conservative rather than tuned to "what
  Chrome on macOS usually negotiates." A Player-firmware program chunk (up to 38 bytes,
  see `docs/player-protocol.md`) is therefore split into two BLE writes.
- **Write-with-response vs. without.** `openBleLink` prefers
  `writeValueWithoutResponse` when the characteristic advertises it (lower latency), and
  the existing FIFO write-chain (same pattern `SerialTransport.ts` uses for USB - see
  its comment on the real concurrent-write bug that pattern fixed) still serializes every
  chunk, awaiting each one before sending the next. Whether that pacing is fast enough,
  or too fast, for the real module's receive buffer is unverified.
- **No DTR-equivalent auto-reset.** `setSignals()` is a documented no-op - GATT has no
  control lines. The stop escalation ladder's DTR-pulse step (`StopController.ts`, plan
  §9 step 4) has no effect over this link; steps 1-3 (halt frames, RESET frame, demand a
  reply) are unaffected and remain the primary stop mechanism regardless of transport.
  `useDeviceSession.ts` also skips the 2-second reset-settle wait for `'ble'` connections
  for the same reason - there is nothing to settle.

## First smoke test already run (software only)

Clicking the real "Connect Bluetooth" button in a real Chromium browser (no mock)
before any real hardware was involved: `navigator.bluetooth.requestDevice()` genuinely
opened, no BLE hardware was available to select, the browser reported `NotFoundError`,
and the app correctly classified it as `ERR_NO_PORT_SELECTED` and returned to a clean,
retryable `disconnected` state - visible end-to-end in the Diagnostics log with no
unhandled exception. That confirmed the browser-facing half of the stack; it said
nothing yet about talking to a real module.

## First real-hardware finding: the chooser was empty, and the fix

The very first attempt against a real "Bluetooth BLEV1.0" module surfaced a genuine bug,
not a "device not paired yet" situation: the Bluetooth chooser opened but listed **no
devices at all**, not even an unrelated one. `requestBleDevice()`'s original
`filters: [{ services: [uuid] }, ...]` (one entry per candidate profile in
`CANDIDATE_PROFILES`) was the cause. `filters: [{services}]` only matches a peripheral's
**advertising/scan-response payload** - it has nothing to do with what GATT services a
device exposes once connected. Plenty of cheap or rebranded BLE-UART bridges (this
module plausibly among them) advertise only a device name and expect a central to
connect blind, discovering services afterward via GATT - Web Bluetooth's `filters`
option has no way to express "match on anything, then check services after connecting."

Fixed by requesting `acceptAllDevices: true` instead of any filter - every nearby BLE
device now appears (a classroom's phones and earbuds included; picking the right one is
on the student, same as the existing unfiltered "Show all ports" USB fallback already
asks of them). `optionalServices` is untouched and still lists every candidate profile's
service UUID, so `openBleLink()`'s post-connect `getPrimaryService()` walk over
`CANDIDATE_PROFILES` works exactly as designed regardless of how the device was found.
See the comments on `requestBleDevice()` and at the top of
`BluetoothLeTransport.ts` for the full reasoning, and
`tests/bluetoothLeTransport.test.ts`'s "chooser scope" tests for the regression test
that pins this (`acceptAllDevices: true`, no `filters`, `optionalServices` unchanged).

**Still to determine:** what BLEV1.0 actually advertises (name, or nothing beyond a MAC).
Once known, `requestBleDevice()` could safely re-narrow to `filters: [{ namePrefix: ...
}]` - a real, evidence-based tightening rather than the blind guess `filters:
[{services}]` turned out to be. Until then `acceptAllDevices: true` stays, because it is
the one option that cannot be "wrong" the way a second guess could be.

## Physical-hardware test plan

Do this **before** trusting any block program over Bluetooth, in this order, with the
mBot's **wheels off the table**:

1. Lift the wheels clear of the table/floor.
2. Open mBot VR with `?hardware=1`, click **Connect Bluetooth**. The chooser now lists
   **every** nearby BLE device (see "First real-hardware finding" above) - pick the
   BLEV1.0 module by name/proximity. Confirm the app reaches `ready` (identify
   succeeds) - if it instead lands on `ERR_BLE_SERVICE_NOT_FOUND`, check Diagnostics for
   which profile names were tried and update the confidence note above with what the
   module's `Bluetooth` app / `nRF Connect` / a similar generic BLE inspector shows it
   actually exposes.
3. Open `?hardware=1&debug=1`, expand **Debug**, click **Test Left Motor** - expect a
   brief, slow spin, nothing else.
4. **STOP.**
5. **Test Right Motor** - same check.
6. **STOP.**
7. **Test Both Motors** - both wheels together, slowly.
8. **STOP.**
9. **Read Ultrasonic** - hold a hand at ~20 cm, confirm the reading is plausible.
10. Disconnect (via **Disconnect my robot**) while a test motor pulse might still be
    running, and confirm the robot stops rather than coasting - this is the "STOP on
    disconnect" requirement, and it is already covered because `useDeviceSession`'s
    disconnect path disposes the session (which is what `StopController`'s escalation
    ladder is layered on top of for every other disconnect-adjacent path already).
11. Only after 1-10 pass: build a short block program (`move forward`, `wait 1s`, `turn
    right`, `wait 0.5s`, `stop moving`), click **Run on robot**, and watch it execute
    live. Press **STOP** mid-run and confirm it halts immediately.

Record what actually happened in `docs/hardware-bridge-plan.md`'s "Implementation
status" section, in the same per-round format the USB rounds already use - including
which candidate GATT profile matched, real write-chunk pacing behavior, and whether the
20-byte chunk size needs to change.

## Mapping to the original 12-step "definition of done"

| # | Step | Status |
| --- | --- | --- |
| 1-2 | Open in Chrome, click Connect Bluetooth | Built; button present, gated on `navigator.bluetooth` support |
| 3-4 | Pick the BLEV1.0 device, see "Connected" | Built (reuses the existing identify/wink/confirm flow) - **unverified against the real module** |
| 5-6 | Motor test + STOP moves/stops the real motor | Built (`DeviceDebugPanel.tsx`, reuses the existing STOP ladder) - **unverified** |
| 7-10 | Build blocks, Run on robot, watch it execute, STOP instantly | Already-existing Tier-1 machinery, unchanged - **unverified over this transport** |
| 11 | Useful error info on failure | Built (five new `ERR_BLE_*` codes with plain-language student text + technical detail, same taxonomy/log as everything else) |
| 12 | Simulation and USB keep working | Verified: `npm run test` (445 passing, none of the pre-existing 438 modified) and `npm run build` both pass; no simulator/USB file changed in kind, only `LinkKind`'s union grew and two `=== 'bluetooth'` checks became `isWirelessLink()` |
