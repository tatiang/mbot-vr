# Handoff prompt: mBot VR, Tier 2 (persistent on-robot programs)

*Paste everything below this line into Codex/ChatGPT to continue work on this repo.*

---

You're continuing work on **mBot VR**, a browser-based Blockly programming and
simulation app for the Makeblock mBot v1.x, at `github.com/tatiang/mbot-vr`
(deployed to `https://mbot-vr.vercel.app`). It's a static React + TypeScript + Vite
app, GPL-3.0-or-later, with a deliberately tiny dependency footprint (three runtime
deps: `blockly`, `react`, `react-dom` — treat adding a fourth as a real decision, not
a default).

## Read this first

**`docs/hardware-bridge-plan.md`**, especially the **"Implementation status"**
section at the bottom. It's the authoritative record of an experimental
physical-mBot-connection feature: the original design plan, then five rounds of
real-hardware findings (each round fixed something the previous one got wrong, in
some cases by reading `Makeblock-official/mBlock`'s own client source directly
rather than guessing). Don't re-derive any of this from scratch - it's already
paid for.

## Current state (as of this handoff)

The hardware surface is enabled by default in Chrome/Edge, with an explicit opt-out via
`?hardware=0` or `localStorage.setItem('mbotvr.hardware.enabled','0')` (see
`src/device/featureFlag.ts`). With that surface available, mBot VR can now,
**confirmed on real hardware**:

- Connect to a physical mBot v1.x over Web Serial (USB; Bluetooth RFCOMM is wired up
  but unconfirmed - see the plan's U4).
- Identify it (a `VERSION` GET handshake) and require a "yes, that's mine" wink
  confirmation before sending anything.
- Run a compiled Blockly program **tethered** - the browser is the interpreter, the
  robot is the body, one live serial command per block action. This is "Tier 1" in
  the plan.
- **Stop the robot reliably** - the safety-critical escalation ladder (halt twice,
  demand a reply, DTR reset pulse, re-probe, sticky "may still be moving" banner if
  nothing answers) is implemented and **confirmed working on real hardware**.
- Drive both wheels and set the onboard RGB LEDs correctly (both needed real-hardware
  bug fixes to a wire-format this app had wrong - see below).

**What does not exist yet, and what you're being asked to build:** any way for a
program to survive without the browser tab connected. Right now, power-cycling or
resetting the robot always returns it to Makeblock's stock factory firmware (which
beeps three times on boot) - nothing this app sends is ever stored on the robot.
That's "Tier 2" in the plan, and it's the next piece of work.

## The task: Tier 2 - persistent, untethered programs

Per `docs/hardware-bridge-plan.md` §6 ("Tier 2 — Player firmware") and the Phase 5
row of its phased plan (§15), this needs:

1. **A small custom "Player" firmware** (an Arduino sketch), a superset of
   Makeblock's factory firmware behaviour plus:
   - A **host heartbeat watchdog**: if no frame arrives for ~500ms while motors are
     running, stop them. This is the actual safety motivation - a pulled cable
     currently leaves a robot driving with nothing left to talk to it.
   - An **EEPROM program slot**: a compact bytecode representation of a compiled
     Blockly program, small enough for the mCore's ~1KB EEPROM (this is a hard
     constraint - a real "program too large, run it tethered instead" preflight
     check is required, not optional).
   - A **boot-idle halt flag**: one EEPROM byte. When set, the firmware boots idle
     and does not run the stored program - this is what makes "Clear my robot's
     program" a ~30ms EEPROM write instead of a 5-15s reflash.
2. **A bytecode compiler**: blocks → a compact opcode stream. The natural mapping
   target is the same vocabulary `src/runtime/protocol.ts`'s `RobotCall` union
   already uses (motor/LED/wait/etc.) - don't invent a second one.
3. **A one-time flashing mechanism**: STK500v1 over Web Serial, to write the Player
   firmware onto a robot exactly once, by a teacher. Reference implementations exist
   (`noopkat/avrgirl-arduino`'s Web Serial demo, `arduino/js-stk500v1` as a smaller
   primitive) - given this repo's "essentially zero dependencies" ethos, prefer
   vendoring a small audited implementation under `src/device/flash/` over pulling in
   a full library tree, and lazy-load it so a student who never flashes never
   downloads it.
4. **UI**: "Put this on my robot" (send + verify), "Clear my robot's program" (the
   EEPROM halt-flag write - **not** the emergency Stop button, which must stay a
   separate, always-available, unconfirmed action per the plan's §9 safety design),
   and the flashing tool itself gated to a teacher-facing surface (the plan
   recommends the help drawer, not the run bar - see the open decision below).

## Hard-won facts - trust these, don't rediscover them

All confirmed against real hardware and/or Makeblock's own official client source
(`Makeblock-official/mBlock`, specifically `src/ext/libraries/mbot/js/mbot.js` and
`src/cc/makeblock/interpreter/PacketParser.as`). Full detail and citations are in
`docs/hardware-bridge-plan.md`; this is the condensed version:

- **Requests are length-prefixed; replies are not.** A request is
  `FF 55 <len> <idx> <action> <device> <params...>`. A `GET` reply is
  `FF 55 <idx> <type> <data...> \r\n` - no length byte. A `RUN`/`RESET`/`START`
  acknowledgement is a bare `FF 55 \r\n` with **no index at all** - it cannot be
  correlated to a specific outgoing write, which is why this app never awaits a
  reply to those. See `src/device/MakeblockProtocol.ts`'s `FrameParser`.
- **Reply type-byte lengths**: `BYTE`=1, `FLOAT`=4, `SHORT`=2 (despite the firmware
  source's `sendShort` suggesting 4 - that function is dead code, never called;
  the *client's* 2-byte reading is what's authoritative), `STRING`=length-prefixed,
  `DOUBLE`=4 (AVR's `double` is the same 4 bytes as `float`), `INT`=4.
- **Motor ports**: `M1` = port 9 = **left**, `M2` = port 10 = **right**, device id
  10. **M1's speed must be negated before sending** - it's physically mounted
  mirrored relative to M2. Confirmed directly in `mbot.js`.
- **RGB LED**: device id 8, six RUN params - `[port=7 (fixed), slot=2 (fixed),
  ledIndex, r, g, b]`. `ledIndex`: `all=0, right=1, left=2`. Sending the wrong
  parameter count (five instead of six) doesn't light the wrong colour, it does
  nothing at all - the firmware reads misaligned garbage for everything after.
- **`VERSION` is device id 0, needs no port, and always answers** regardless of
  what's physically wired to the board - it's the identify/liveness probe, and
  should be your model for anything Tier 2 needs to detect readiness.
- **The board auto-resets when the serial port opens** (a DTR-line capacitor - the
  same mechanism behind the Arduino IDE resetting a board when Serial Monitor
  opens). This app waits 2s after `port.open()` before the first probe.
  Flashing new firmware will need its own handling of this, likely via the
  STK500 sync sequence's own retry logic rather than a fixed delay.
- **Serial writes must be serialized.** `WritableStream.getWriter()` throws if
  called while a previous write's lock is still held, and driving two motors via
  `Promise.all` genuinely triggers this. `src/device/SerialTransport.ts` now
  queues writes FIFO - reuse that, don't reintroduce concurrent writes.
- **The robot must be running Makeblock's factory firmware for *any* of this to
  work at all.** A robot last used with mBlock's Upload mode has a different,
  non-listening program resident and won't respond to anything until factory
  firmware is restored (mBlock 5: Setting → Firmware Update → Factory Firmware).
  This will matter *more* for Tier 2, since flashing Player firmware replaces
  whatever's there - think about what happens if a teacher wants to switch a robot
  back to plain mBlock use afterward.

## Two decisions to get from the user (Tatian) before finalizing, not to assume

1. **GPLv2/GPLv3 licensing for the Player firmware.** Makeblock's own firmware
   source is GPLv2; this repo is GPL-3.0-or-later. Either build the Player firmware
   from scratch against the mCore's public pin map (cleaner, keeps the whole tree
   GPLv3, costs some extra time), or base it on Makeblock's GPLv2 code as a clearly
   separated aggregate work with correct licensing notices. This is a real legal/
   licensing call, not a technical one - ask rather than pick.
2. **Who can flash firmware.** The plan recommends teacher-only, reachable from the
   help drawer rather than the run bar, specifically to keep an irreversible-ish,
   slightly risky action away from casual student use. Confirm this before shipping
   a flashing UI students can reach unsupervised.

## A smaller, separate item worth doing first or alongside

**Silent reconnection to a previously-granted port.** `navigator.serial.getPorts()`
returns already-authorized ports without a picker or user gesture, and opening one
of them doesn't need a fresh gesture either - so "reconnects automatically on page
load" is achievable. Two real constraints to respect: (1) this permission never
transfers across machines or browser profiles - every new laptop needs one manual
grant first; (2) **keep the wink-confirmation step even on auto-reconnect** - cheap
CH340 clones often lack a real hardware serial number, so Chrome's device-identity
matching isn't airtight enough to skip verifying it's the right physical robot in a
room with several. This is a good, contained first PR if you want a warm-up before
Tier 2's larger scope.

## Conventions to match

- **The seam**: `src/runtime/RobotRuntimeBridge.ts`'s `MbotRuntime` interface is
  the single contract both the simulator (`createEngineRuntime`) and the physical
  robot (`src/device/SerialRobotRuntime.ts`, `createSerialRuntime`) implement.
  Whatever Tier 2 needs from the robot API should go through this interface, not
  around it.
- **Testing without hardware**: `tests/fakeSerialLink.ts` provides `createFakeLink`
  (a `SerialLink` test double) and byte-accurate reply encoders
  (`encodeAck`/`encodeFloatReply`/`encodeStringReply`). `tests/serialTransport.test.ts`
  shows the pattern for testing against *real* `WritableStream`/`ReadableStream`
  instances when a plain mock can't reproduce real behaviour (used to catch the
  write-serialization bug - a real regression, not a hypothetical one). Match this
  style for new tests rather than introducing a mocking library.
- **Feature-flag discipline**: `src/device/*` and everything it pulls in is
  dynamically imported (`React.lazy` in `src/App.tsx`, gated by
  `isHardwareFeatureEnabled()`) so it's never downloaded with the flag off. Extend
  this pattern for Tier 2's new modules rather than adding new static imports.
- **Strict TypeScript, `noUnusedLocals`/`noUnusedParameters` on.** Run
  `npm run typecheck`, `npm run test`, and `npm run build` before considering
  anything done - all three are currently clean (370 tests passing) and should stay
  that way.
- **Document as you go.** Continue the existing per-round format at the bottom of
  `docs/hardware-bridge-plan.md`'s "Implementation status" section - it's the
  project's single source of truth for what's actually been verified against real
  hardware versus what's still a plan on paper. Don't let that drift out of sync
  with what's shipped.

## Definition of done

Per the plan's original Tier 2 framing: a compiled program can be sent to a robot
and stored; the robot runs it after being power-cycled, with no browser tab
connected; pulling the cable during a *tethered* run still halts the robot within
~500ms via the watchdog; "Clear my robot's program" leaves the robot inert across a
power cycle without a full reflash; and none of this destabilizes Tier 1 or the
simulator, which should keep working exactly as they do today.
