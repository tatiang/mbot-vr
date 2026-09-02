# mBot VR Hardware Bridge — Planning Report

**Status:** planning document, partially implemented behind a feature flag (see [Implementation status](#implementation-status)).
**Repo:** `tatiang/mbot-vr` · **App version at time of writing:** 1.2.0
**Prepared:** 2 September 2026

How the existing simulator could drive, program and — above all — reliably **stop** a
physical Makeblock mBot v1.x from the browser, without a backend, without an installer,
and without pretending a robot has halted before the app has evidence that it has.

An HTML version of this report with tables, a state diagram and full source links was
also published as an Artifact during planning; this file is the durable, in-repo copy.

---

## 1. Executive summary

Four of the five requested capabilities are achievable in the browser today. The fifth —
compiling a student's blocks into an Arduino program — is the one that should not be
built the way it was originally framed.

mBot VR already has the single hardest thing a project like this needs: a clean seam
between "the program" and "the robot". `MbotRuntime` in
[`src/runtime/RobotRuntimeBridge.ts`](../src/runtime/RobotRuntimeBridge.ts) is a
fifteen-method async interface, and `createEngineRuntime()` is only *one* implementation
of it. A second implementation that speaks to a real mBot over a serial port drops into
exactly the same socket — the Blockly definitions, the code generators, the worker, the
stop semantics and the whole test suite stay untouched.

What the research changed about the original framing:

- **Compiling Arduino C++ in a browser is not a realistic classroom dependency.** There
  is no maintained in-browser AVR toolchain, and a cloud compiler means a backend, a
  cost, a privacy surface and a new outage mode for an app whose defining property today
  is that it has none of those.
- **You do not need one.** The mBot's factory firmware already exposes a documented,
  open-source serial command protocol. Running a student's program *tethered* — with the
  browser as the interpreter and the robot as the body — needs no compiler, no flashing
  and no waiting, and it makes **Stop** a 10-millisecond command rather than a 10-second
  flash cycle.
- **Uploading a blank program as the stop mechanism is the wrong primitive for a safety
  feature.** It is slow, it wears a 10,000-cycle flash, and it fails open: a
  half-finished upload leaves the robot in a worse state than it started. The safe stop
  is a halt command plus, if that goes unanswered, a hardware reset pulse — with the UI
  refusing to claim "stopped" until a reply proves it.
- **Bluetooth can never upload.** Makeblock is explicit: firmware and program uploads to
  mBot v1 require USB. Bluetooth and 2.4G support live control only. This is a hardware
  fact, not a software limitation, and it should shape the UI rather than be discovered
  by a student mid-lesson.

> **Recommendation.** Build **tethered live control over Web Serial** as the primary
> feature, backed by a small purpose-built **Player firmware** that adds a host
> heartbeat watchdog and can hold a compact program in EEPROM for untethered running.
> Treat per-run Arduino compilation as out of scope, and export-to-mBlock as the
> documented escape hatch. Ship it dark behind a feature flag until a hardware spike
> confirms the five questions in [§4](#4-important-unknowns-and-the-experiments-that-settle-them).

---

## 2. Current repository architecture

Read in full for this report: `README.md`, `package.json`, `vite.config.ts`, all of
`src/`, and the test manifest. Roughly 9,500 lines of TypeScript/TSX, three runtime
dependencies (Blockly 11, React 18), zero backend, zero analytics, static build with
`base: './'`, deployed to Vercel over HTTPS.

### The seam this feature plugs into

The runtime is deliberately front-end-agnostic. The comment at the top of
`RobotRuntimeBridge.ts` says so outright: *"Blockly is only one possible front end.
Anything that can produce calls against this interface … can drive the simulator."* The
same sentence read backwards is the integration plan — anything that *implements* the
interface can be driven by the existing program pipeline.

| Integration point | File | What it gives you |
| --- | --- | --- |
| `MbotRuntime` | `runtime/RobotRuntimeBridge.ts` | The complete robot API surface, already async, already awaited at every call site. A `createSerialRuntime(session)` sits beside `createEngineRuntime(engine)`. |
| `ProgramRunner` | `runtime/ProgramRunner.ts` | Constructor takes any `MbotRuntime`. Its `dispatch()` switch is the single place every protocol call funnels through — the natural spot to tee diagnostics. |
| `RobotCall` / `protocol.ts` | `runtime/protocol.ts` | A 15-case tagged union that is already an excellent wire vocabulary. It maps almost 1:1 onto the Makeblock firmware's own command set. |
| `compileWorkspace()` | `blocks/compile.ts` | Returns `{ code, hasStart, attachedBlocks, startBlockCount }`. Preflight validation extends this result rather than adding a second traversal. |
| `handleRun` / `handleStop` | `App.tsx:501–546` | Where a *target* (Simulator \| Robot) selector lands. `handleStop` already has the right instinct: it cuts motors unconditionally, whatever the program was doing. |
| `pushToast` | `App.tsx:90–102` | The only user-facing message channel. Deliberately non-modal. Hardware needs one thing it cannot express: a persistent, non-dismissing "the robot may still be moving" state. |
| `ProjectSettings` | `types/index.ts:135` | Where a per-project physical-robot speed cap and target preference serialize, with `migrateSettings()` in `projectStore.ts` already handling forward compatibility. |

### Behaviours the hardware path must respect

- **Time gating.** `SimulationEngine` only advances simulated time while the program is
  blocked in `wait()` or the loop `yield()`. On real hardware there is no simulated
  clock to gate — a real robot keeps moving during the message round trip. The serial
  runtime must therefore *not* emulate `nextSlot()`; it needs its own pacing, and the
  documented consequence is that timings differ between simulator and robot.
- **Motors latch by design.** `onFinished` calls `engine.endProgram(false)` and toasts
  "the motors are still running." On hardware this stops being a teaching point and
  becomes a safety condition. A finished program on a physical robot should stop the
  motors, not coast.
- **Stop is worker termination.** `ProgramRunner.stop()` kills the worker outright. That
  guarantees the *program* stops. It says nothing about whether the *robot* stopped, and
  the UI must stop conflating the two the moment hardware is attached.
- **Everything is local.** `localStorage` under `mbotvr.*` keys; no network calls at
  runtime; Blockly media vendored into `public/`. Any hardware work that introduces a
  fetch, a CDN or a localhost helper breaks a property the README sells to teachers
  explicitly.

> **Validation note.** `node_modules/` was absent when this report was researched, so
> `npm run test` / `npm run typecheck` were not executed during planning. Conclusions
> about existing behaviour came from reading source and tests, not from running them.
> See [Implementation status](#implementation-status) for what has since been built and
> verified.

---

## 3. Verified mBot v1.x connection and upload capabilities

Claims below are tagged **Verified** (a primary or vendor source states it),
**Inference** (follows from verified facts but not directly confirmed), or **Rejected**
(investigated and should not be built). Sources are numbered; see
[§ Sources](#sources) at the end.

### The board

- **Verified (1, 2).** mBot v1.1 runs the **mCore** board: an Arduino Uno-compatible
  ATmega328P with a preloaded Arduino bootloader, a **CH340** USB-to-serial bridge, a
  USB-B connector, an onboard buzzer, light sensor, two RGB LEDs, four colour-coded RJ25
  ports, and a dual-channel motor driver. In the Arduino IDE it is programmed as an
  "Arduino Uno".
- **Verified (9).** The ATmega328P's flash is rated for **at least 10,000** write/erase
  cycles; its 1 KB EEPROM for **at least 100,000**. This pair of numbers is why "upload
  a blank program" is the wrong stop mechanism and why an EEPROM-resident program is the
  right storage for student code.

### How mBlock connects today

- **Verified (3, 4).** mBlock 5 on the web historically required the **mLink 2** desktop
  helper. Makeblock has since shipped a "direct connection" feature: in **Chrome or
  Edge**, devices connect over serial or Bluetooth with no extra software. The older
  mLink Chrome extension is discontinued. mLink 2 is therefore a legacy compatibility
  path, not the future of the platform — and not something to build on.
- **Verified (5, 6) — the decisive constraint.** **Program and firmware uploads to mBot
  v1 require USB.** Makeblock and Vernier both state that over Bluetooth you can only
  program mBot in Scratch (live) mode — you cannot upload a program or switch to Arduino
  mode — and that firmware cannot be updated over a 2.4G connection either. A "Bluetooth
  dongle" plugged into the computer is still, for these purposes, a USB connection on
  the computer side and a Bluetooth link on the robot side; it does not unlock upload.

### What a browser can reach

- **Verified (7).** **Web Serial** ships in Chrome and Edge 89+ on Windows, macOS, Linux
  and ChromeOS. Safari and Firefox do not support it and both vendors have signalled
  opposition. It requires a secure context — `https://mbot-vr.vercel.app` qualifies.
  Access is gated by a user gesture and a port chooser, and permissions persist per
  origin.
- **Verified (8).** Chrome Enterprise policies control this on managed fleets:
  `DefaultSerialGuardSetting` (2 = block, 3 = ask), `SerialBlockedForUrls`, and
  `SerialAllowAllPortsForUrls`, which *auto-grants* listed origins without a chooser.
  That last one is the concrete ask for a district IT admin, and it also removes the
  "pick the right port" step for students entirely.
- **Verified (10, 11).** **Web Bluetooth is GATT/BLE only** — it cannot reach a
  Bluetooth Classic SPP serial service. But **Web Serial** gained Bluetooth RFCOMM/SPP
  support in Chrome 117 on desktop (connect/disconnect events added in Chrome 130,
  Android later). The device must already be **paired at the operating-system level**;
  the browser then enumerates it as a serial port. So the Bluetooth path exists —
  through the Serial API, not the Bluetooth one.
- **Verified (12).** Makeblock's Bluetooth modules are a mixed fleet. The common
  "Bluetooth Module for mBot" is **dual-mode BR/EDR + BLE with SPP**; there is also a
  "single mode" Bluetooth 4.0 module that is BLE-only. A BLE-only module cannot be
  reached by Web Serial *or* usefully by Web Bluetooth without reverse-engineering its
  GATT service. **Which module is in your robots is a hardware question that must be
  answered before any Bluetooth work is scheduled.**

### The protocol

- **Verified (13).** Makeblock's own `mbot_factory_firmware.ino` (in the GPLv2
  Makeblock-Libraries repo) implements a frame protocol: header `0xFF 0x55`, then
  length, index, action, device, parameters. Actions are `GET = 1`, `RUN = 2`,
  `RESET = 4`, `START = 5`. Device ids include ultrasonic = 1, RGB LED = 8, motor = 10,
  servo = 11, line follower = 17. A motor command is
  `FF 55 len idx 02 0A port speed_lo speed_hi`. **RESET stops both motors and the
  buzzer.** This is a complete, open, already-installed command set — the app does not
  need to invent one.
- **Verified (13, 14).** Makeblock's Arduino libraries and firmware are licensed **GPL
  v2 (or commercial)**. mBot VR is GPL-3.0-or-later. GPLv2-only and GPLv3 code cannot be
  combined into one work; a firmware binary and a web app that talk over a serial cable
  are separate programs in aggregate, but this needs a deliberate call rather than an
  accident — see [§18](#18-decisions-needed-from-tatian).
- **Verified (15).** Flashing an Uno-class board from a browser is a solved problem:
  `avrgirl-arduino` implements STK500v1 in JavaScript and ships a Web Serial demo, and
  `arduino/js-stk500v1` exists as a smaller primitive. STK500v1 covers Uno/Nano — which
  is exactly the mCore. So a one-time firmware flash from the browser is feasible; only
  the *compilation* step has no browser answer.

### Drivers and fleet reality

- **Inference (16) — verify on the actual fleet.** macOS has shipped a built-in CH34x
  driver since 10.13 that is reported to be reliable at ordinary baud rates and
  problematic only at very high ones — 115200 should be fine, but this needs bench
  confirmation on your MacBook image. ChromeOS carries `ch341` in the kernel. Windows
  may still need the WCH driver on a fresh image. **On a managed fleet, "does the port
  appear at all" is a per-image question that no amount of documentation can answer for
  you.**

### Approaches investigated and rejected

- **Rejected — in-browser Arduino compilation.** No maintained WebAssembly avr-gcc
  exists that is suitable for a classroom dependency. Building one is a project larger
  than this entire application.
- **Rejected — a cloud compile service.** Introduces a backend, per-request cost, an
  availability dependency, and a student-code-leaves-the-device privacy change that
  directly contradicts what the README promises teachers.
- **Rejected — depending on mLink 2's local interface.** mLink 2's local protocol is
  undocumented. A community reimplementation exists (`audetto/mblock-mlink`) but is a
  de-minified copy of Makeblock's shipped bundle, with no specification and no
  stability contract. Building a classroom safety feature on an undocumented local API
  that Makeblock can change in any release is not defensible.

---

## 4. Important unknowns and the experiments that settle them

These are the questions where a wrong assumption invalidates the design. Every one of
them is answerable in a single afternoon at a bench with one mBot, one cable, and a
throwaway branch. **None of these has been run** — this repository has no physical mBot
attached to it, so everything downstream of them is unverified against real hardware.

| # | Unknown | Experiment | Why it matters |
| --- | --- | --- | --- |
| U1 | Does a bootloader reset (DTR/RTS pulse) actually stop the motors, and how fast? | Drive both motors at full power, toggle `setSignals({dataTerminalReady})`, film at 60 fps. Measure delay; check for a restart twitch. | The entire escalation ladder in [§9](#9-stop-and-clear-safety-design) rests on this. |
| U2 | What is actually flashed on your robots right now? | Connect at 115200, GET the firmware version, log raw bytes from each robot in the cart. | Factory firmware means live control works out of the box; a foreign sketch means firmware restore is needed first. |
| U3 | Which sensor sits on which port across the fleet? | Read ultrasonic on ports 1–4 and line follower on 1–4; record what answers. | The app's blocks deliberately dropped mBlock's port dropdown — fine for the simulator, a landmine on non-default wiring. |
| U4 | Which Bluetooth module is fitted — dual-mode SPP or BLE-only? | Pair one robot to a Mac and a Chromebook; check whether an SPP serial port appears and whether `navigator.serial.getPorts()` lists it. | Decides whether Bluetooth is a phase or a "not supported" screen. Do not schedule Bluetooth work before this is answered. |
| U5 | Does the managed fleet allow serial at all? | Open the deployed app on a real student MacBook and Chromebook and call `requestPort()`. | If `DefaultSerialGuardSetting` is 2, nothing else in this plan matters until IT changes it. |
| U6 | Round-trip latency of one GET, over USB and over Bluetooth. | Time 200 sequential ultrasonic reads; report min/median/p95. | Sets the achievable control-loop rate. |
| U7 | The mCore pin map, from the published schematic. | Obtain the mCore v1.x schematic; confirm motor/LED/port pin assignments. | Needed only if Player firmware is written from scratch to avoid the GPLv2 library. |
| U8 | Does the CH340 port survive a Chromebook sleep/wake and a cable re-plug? | Connect, close the lid, reopen; unplug and replug mid-session. | Determines how aggressive reconnection needs to be. |

---

## 5. Comparison of architecture options

| Option | Feasible today | USB | Bluetooth | Browsers | Install | Compiles code | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. Web Serial, tethered live control** | Yes | Yes | Yes (RFCOMM, once paired) | Chrome/Edge, all desktop OSes | None | N/A — no compilation | **Build** |
| **B. A + one-time Player firmware** | Yes, with a firmware build in CI | Yes (flashing is USB-only by hardware) | Live control yes, flashing never | Same as A | None for students; one flash per robot by a teacher | Firmware compiled ahead of time in CI; student programs become bytecode | **Build as Tier 2** |
| **C. Web Bluetooth (GATT)** | No for SPP modules; unknown for BLE-only | No | BLE/GATT only | Chrome/Edge | None | Cannot upload at all | **Do not build** — superseded by A's RFCOMM path |
| **D. Integrate through mLink 2** | Only by reverse engineering | Yes | Yes | Any, but mixed-content/CORS issues from HTTPS | mLink 2 on every machine, admin rights | Yes — the only option that genuinely compiles Arduino | **Do not depend on** — undocumented, no stability contract |
| **E. A dedicated companion app** | Yes | Yes | Yes | All, including Safari/Firefox | Per-machine install, code signing, admin approval — effectively impossible on school Chromebooks | Full | **Not now** — destroys the "just open the link" property |
| **F. Export to mBlock** | Yes | Delegated to mBlock | Delegated to mBlock | All | Whatever mBlock needs (already installed in most mBot classrooms) | By mBlock | **Build as the fallback** |

---

## 6. Recommended architecture

Option A first and alone. Option B as a second, separately flagged tier. Option F as the
universal fallback. Nothing else gets built.

### Tier 1 — Live Robot (Option A)

A new `DeviceSession` owns one open `SerialPort`, frames and de-frames the Makeblock
protocol, and exposes a promise-per-request API keyed on the protocol's own index byte.
`createSerialRuntime(session)` implements `MbotRuntime` against it. `App.tsx` gains a
target selector; `handleRun` constructs a `ProgramRunner` against whichever runtime the
target names. **Not one line of `blocks/`, `worker.ts` or `simulation/` changes.**

| `MbotRuntime` method | Serial realisation |
| --- | --- |
| `setMotors(l, r)` | Two RUN frames to device 10, ports M1/M2, 16-bit signed speed. Clamped to the classroom cap. |
| `stop()` | `setMotors(0, 0)`, then a RESET frame as belt and braces. |
| `getUltrasonicDistance()` | GET device 1, awaited float reply. Cached ~50 ms so a tight loop cannot flood the link. |
| `getLineFollowerValue()` | GET device 17 → the same 0–3 encoding the simulator already produces. |
| `isLeft/RightLineSensorOnLine()` | Derived from the line value's bits, exactly as `LineSensor.ts` does. |
| `setRgbLed(which, r, g, b)` | RUN device 8, onboard port, LED index 0/1/all. |
| `wait(s)`, `yield()` | Host-side `setTimeout`. No simulated clock — real seconds only; the speed multiplier is disabled on hardware. |
| `getTimer()`, `resetTimer()` | Host-side wall clock since run start. |
| `getX/getY/getHeading()` | Blocked at preflight — no hardware can answer these. |
| `displayNumber(v)` | Only if a Me 7-Segment module is present and configured; otherwise blocked at preflight. |

### Tier 2 — Player firmware (Option B)

A small Arduino sketch, built in CI, versioned, and shipped as a static asset under
`public/firmware/`. A superset of the factory firmware's behaviour plus three things the
factory firmware cannot do:

1. **A host heartbeat watchdog.** If no frame arrives for ~500 ms while motors are
   running, stop the motors. Closes the single worst failure mode of tethered control: a
   pulled cable leaving a robot driving into a wall with nothing left to talk to it.
2. **An EEPROM program slot.** Student blocks compile to a compact bytecode of the same
   15 opcodes the protocol already defines. Writing it is one EEPROM transaction, about
   a second, on a 100,000-cycle memory.
3. **A boot-idle halt flag.** One EEPROM byte. When set, the firmware boots idle and
   does not run the stored program. Clearing a robot's program is a one-byte write, not
   a flash cycle.

The firmware `.hex` is flashed **once per robot**, by a teacher, over USB, using a
vendored STK500v1 implementation. It is never flashed as part of a student's run, and
never as part of stopping.

### Why not compile Arduino C++ at all

Because the deliverable a student needs is "my blocks make the robot do the thing", and
bytecode delivers that in one second with no toolchain, no backend and no flash wear.
Arduino C++ generation is still worth having — but as *export* (Option F), where a human
takes it to mBlock, not as a step in the run loop.

---

## 7. Student and teacher user experience

### The one-line mental model

The app gains a **target switch** in the run bar, next to Run/Stop/Reset — two segments,
**Simulator** and **My robot**. Simulator is always selected on first load and after any
disconnect. Everything hardware-related lives behind "My robot" so a student who never
touches a physical mBot sees an app identical to today's.

### Names for things

| Control | Student-facing label | Behind "Technical details" |
| --- | --- | --- |
| Target switch | **Simulator** / **My robot** | Execution target; serial vs simulation runtime |
| Connect | **Find my robot** | `navigator.serial.requestPort()`, filters, granted ports |
| Link picker | **Plugged in with a cable** / **Wireless (Bluetooth)** | USB CDC via CH340 · Bluetooth RFCOMM SPP |
| Identity check | **Make my robot wink** | RGB LED flash + buzzer chirp on the selected port |
| Ready state | **Connected to Robot 7** | Port id, firmware version, protocol version |
| Send program | **Put this on my robot** | Bytecode length, EEPROM slot, checksum |
| Emergency stop | **STOP** (always visible, always enabled) | Halt frame → RESET frame → DTR reset ladder |
| Clear stored program | **Clear my robot's program** | EEPROM halt-flag write |
| Disconnect | **Done with my robot** | Port close, permission retained |

### Not uploading to the robot next to you

A cart of fifteen identical blue robots on a Bluetooth list all called "Makeblock" is
the realistic hazard, and no amount of port-string cleverness solves it. Three layers,
in order of importance:

1. **Wink to confirm, every session.** After the port opens and before anything else is
   offered, the app flashes the robot's LEDs and chirps, then asks: *"Did the robot in
   front of you flash blue?"* — **Yes, that's mine** / **No, try a different one**.
   Nothing is sent until Yes.
2. **Nicknames stored on the robot.** A teacher writes "Robot 7" into a reserved EEPROM
   field once. Every subsequent connection shows the name the sticker on the chassis
   shows.
3. **Confirmation expires.** Any disconnect, port change, or firmware-identity change
   invalidates the confirmation token. The next send re-runs the wink.

### Message register

Student text names the object and the next action, never the mechanism. Every message
has a paired teacher-facing detail behind a **Technical details** disclosure, and a
matching entry in the diagnostic log. Examples:

| Situation | Student sees | Teacher detail |
| --- | --- | --- |
| Unsupported browser | "This browser can't talk to robots yet. Open mBot VR in Chrome or Edge — everything else here works fine in this one." | `navigator.serial` undefined. Simulator unaffected. |
| Permission dismissed | "No robot picked. Press **Find my robot** and choose the one with your cable in it." | `requestPort()` rejected — chooser dismissed, no port granted. |
| Blocked by policy | "This computer isn't allowed to connect to robots. Ask your teacher — they'll need to show this to IT." | Serial blocked by Chrome policy. |
| Port busy | "Something else is using this robot. Close mBlock or the Arduino window and try again." | Port open failed — likely held by another process. |
| No reply | "Found the robot but it isn't answering. Check it's switched on and the battery isn't flat, then press Find my robot again." | No protocol reply within 2,000 ms across 3 attempts. |
| Bluetooth chosen but not paired | "Pair your robot in this computer's Bluetooth settings first, then come back." | Web Serial only enumerates already-paired RFCOMM devices. |
| Bluetooth + send attempted | "Programs can only be put on the robot through the cable. You can still drive it wirelessly." | Hardware constraint: mBot v1 upload is USB-only. |
| Cable pulled mid-run | "Lost the robot. **It may still be moving** — pick it up and switch it off if it doesn't stop." | Link lost during run. |

### Progress that means something

Two progress treatments only. **Indeterminate** (a pulse, no percentage) for anything
whose duration is unknowable — connecting, identifying, waiting for a reply.
**Determinate** (a real bar with byte counts) only where a byte count genuinely exists.

### Teacher surface

A **Classroom** section in the existing help drawer, not a separate admin app: the
one-time firmware flash, the nickname writer, the physical-robot speed cap, a printable
IT request naming the three Chrome policies, and a link to the diagnostic log.

---

## 8. Connection and upload state model

Three lanes rather than one chain, because Stop is not a stage of the happy path — it is
reachable from every state, including states the happy path never enters.

**Lane 1 — Connect:** No robot → Choose (cable/wireless) → Permission → Opening →
Identify → Wink → Ready.

**Lane 2 — Send & run:** Preflight → Sending → Verifying → Running (loops back to
Preflight after a run).

**Lane 3 — Stop (reachable from any state):** Stop pressed → Halt sent → Checking →
either **Stopped, confirmed by robot** or, on no reply/timeout, **May still be moving —
switch the robot off**.

| State | Enters when | Leaves to |
| --- | --- | --- |
| `unsupported` | `navigator.serial` absent at load | Terminal. Offers Export-to-mBlock; simulator fully works. |
| `disconnected` | Default; after any close | → `choosing` on "Find my robot" |
| `choosing` | Student picks cable or wireless | → `requestingPermission`; wireless first checks OS pairing |
| `requestingPermission` | Chooser shown (skipped when policy pre-grants) | → `opening` · `permissionDenied` · `noPortSelected` · `policyBlocked` |
| `opening` | Port granted | → `identifying` · `portBusy` · `openFailed` |
| `identifying` | Port open; version GET, 3 attempts × 2 s | → `confirmingIdentity` · `noReply` · `firmwareUnknown` · `firmwareTooOld` |
| `confirmingIdentity` | Firmware known; wink issued | → `ready` on Yes · `choosing` on No |
| `ready` | Identity confirmed this session | → `preflight` · `running` (live) · `disconnected` |
| `preflight` | Send or Run pressed | → `sending`/`running` if clean · `incompatible` if a blocking issue exists |
| `sending` | Bytecode transfer begins | → `verifying` · `sendTimeout` · `linkLost` |
| `verifying` | All bytes written | → `ready` on checksum match · `verifyFailed` · `uncertain` |
| `running` | Program executing (tethered or on-robot) | → `stopping` · `finished` · `linkLost` |
| `stopping` | Stop pressed, or any error path | → `stoppedConfirmed` · `stopUnconfirmed` |
| `stopUnconfirmed` | Halt ladder exhausted with no evidence | Sticky. Requires explicit acknowledgement. |
| `linkLost` | Read error, disconnect event, or heartbeat gap | → `stopping` immediately, then `disconnected`. Reconnect is offered, never automatic. |
| `incompatible` | Preflight found a blocking issue | → `ready` once the blocks change. Never overridable for simulator-only blocks. |

### Timeouts and retries

- **Identify:** 2,000 ms per attempt, 3 attempts, 400 ms apart. Then `noReply`.
- **Any single command reply:** 400 ms. Two retries for reads; **writes are never
  blindly retried** — a retried motor command could re-start a robot the student thought
  had stopped.
- **Bytecode send:** 15 s wall clock, per-chunk ack. Interruption leaves the halt flag
  set, so an incomplete program can never run.
- **Firmware flash:** 90 s, no retry, explicit re-run only.
- **Stop ladder:** see §9 — deliberately tighter than everything else.

---

## 9. Stop-and-clear safety design

The requested feature was "upload a program containing only the start block". That is a
reasonable instinct built on how mBlock works, and it is the wrong mechanism for an
emergency stop.

### Why the blank upload fails as a stop

| Mechanism | Time to motors off | Wear | Failure behaviour |
| --- | --- | --- | --- |
| **Halt command** (motors 0 + RESET frame) | ~10–30 ms | None | Fails *closed* only if the link is alive; a dead link produces no reply, and you know immediately. **Best.** |
| **DTR/RTS reset pulse** | ~50–200 ms (U1) | None | Reboots the board. Safe only if what is resident boots idle — a student's flashed sketch would restart and drive again. **Conditional.** |
| **Upload a blank sketch** | ~5,000–15,000 ms | 1 flash cycle of 10,000 | Motors stop at the *start* (the reset), then the board is unprogrammed for 5–15 s. A failed upload leaves no working robot at all. **Worst.** |
| **EEPROM halt flag** (one byte, Player firmware) | ~30 ms | 1 of 100,000 | Persistent across power cycles. The real "clear the program" primitive. **Best for clearing.** |

Thirty classes a year × twenty stops a lesson × a blank upload each = flash exhaustion
inside two school years, on a robot the district expects to keep for five.

### Two separate actions, deliberately

- **STOP** — emergency, always visible, always enabled, never confirmed. Red, large,
  keyboard-reachable, bound to <kbd>Esc</kbd> as today. Its only job is to make the
  robot stop moving now.
- **Clear program** — deliberate, in the device panel, confirmed once. Sets the EEPROM
  halt flag so the robot stays inert through a power cycle. Never on the critical path
  of stopping.

Merging these — a single button that both stops and clears — is what produces the
ten-second stop. Keeping them apart is what lets the stop be ten milliseconds.

### The escalation ladder

1. **Cut the program first.** `ProgramRunner.stop()` terminates the worker, so no
   further motor commands can be generated. Already exists.
2. **Halt frame, immediately.** `setMotors(0,0)` to both ports, then a RESET frame.
   Written ahead of any queued traffic — the write queue is *flushed*, not appended to.
   Repeat twice at 60 ms.
3. **Demand evidence.** Send a GET (firmware version) and require a well-formed reply
   within **300 ms**. A reply proves the board is alive, is parsing frames, and
   processed the halt bytes that preceded it.
4. **No reply → reset pulse.** Toggle DTR/RTS, wait 300 ms, re-probe.
5. **Still nothing → say so.** A sticky red banner: *"Your robot may still be moving.
   Pick it up and switch it off."* No timer dismisses it.

> **The rule the UI must never break.** The words "stopped" and the green state appear
> **only** after step 3 or step 4 returns a reply. Everything else — timeout, link loss,
> partial write, disconnect during stop — renders as **"may still be moving"**.

### Adjacent safety behaviours

- **Link-loss watchdog** (Player firmware): motors stop after ~500 ms of host silence.
- **Programs end stopped** on hardware; the simulator keeps its educational latching
  behaviour.
- **Page hidden, closed, or crashed:** `visibilitychange` and `pagehide` both fire a
  halt; the `ErrorBoundary` attempts a halt before rendering its recovery card.
- **Speed cap:** a per-project maximum motor power for the physical robot, defaulting to
  **60%**.
- **Rate limits:** minimum 3 s between program sends; minimum 30 s between firmware
  flashes; a per-robot flash counter.
- **Uncertain upload is never "done".** If verification cannot complete, the halt flag
  stays set and the student is told the program did not make it — not that it might
  have.

---

## 10. Block and code compatibility strategy

| Block | Class | Notes |
| --- | --- | --- |
| `mbot_when_start` | Direct | Structural. |
| `mbot_move_direction`, `mbot_set_motors`, `mbot_stop_motors` | Direct | One RUN frame per motor; clamped by the classroom speed cap. |
| `mbot_move_*_for` | Translate | Set → wait → stop. Timing will differ from the simulator. |
| `mbot_ultrasonic`, `mbot_line_value` | Translate | Needs a **port**, which the block deliberately omits. Resolve from a device profile. |
| `mbot_left/right_on_line`, `mbot_obstacle_within` | Translate | Derived; "0 means nothing in range" convention holds on hardware. |
| `mbot_line_detects` | Ambiguous | "Black"/"white" depend on surface, ambient light and calibration on a real photoresistor module. |
| `mbot_timer` / `reset_timer` | Translate | Host clock when tethered; `millis()` when on-robot. |
| `mbot_set_led_named` / `_rgb` | Direct | Onboard LEDs — no port ambiguity. |
| `mbot_display_number`, `mbot_clear_display` | **Unsupported** | mBot v1 has no onboard display; needs an optional Me 7-Segment module. Block unless configured. |
| `mbot_robot_x` / `_y` / `_heading` | **Simulator only** | Already documented as such in the block tooltips. Hard block — no override. |
| `mbot_wait` | Translate | Real seconds; the simulator's speed multiplier is disabled on hardware. |
| `repeat` / `forever` / `if` / `repeat until` / `wait until` | Direct (tethered) | On-robot needs the bytecode VM's jump opcodes. |
| Operators, variables | Translate | Free when tethered; bounded set on-robot (Tier 2). |

### Preflight

Preflight is a separate pass over the workspace (`assessHardwareCompatibility`), rather
than a change to `CompileResult`'s existing shape, so the current `compile.test.ts`
suite is untouched. Three severities:

- **Blocking.** Simulator-only blocks; unconfigured display; program too large. Send is
  disabled with a specific, named reason and the offending block is highlighted.
- **Warning.** Ambiguous line-colour semantics; a program whose last motion block leaves
  motors latched. Send proceeds after a single acknowledgement.
- **Note.** Speed cap applied; simulator speed multiplier ignored.

### Representation: bytecode, not C++

Generate a compact bytecode over the opcodes `protocol.ts` already defines, plus jumps
and a small expression stack (Tier 2 only). It needs no toolchain, is verifiable by
checksum, fits an EEPROM with room to spare, and costs one 100,000-cycle write rather
than one 10,000-cycle flash. Arduino C++ generation stays worthwhile — as the *export*
format for the mBlock fallback (Option F), where a human does the compiling.

---

## 11. Diagnostic logging and error taxonomy

### Shape of the log

- **Storage:** in-memory ring buffer, 500 events or 256 KB, whichever comes first.
  Oldest dropped, with a "N earlier events dropped" marker.
- **Persistence:** `sessionStorage`, not `localStorage` — the log is most needed right
  after a refresh, but should not outlive the tab on a shared Chromebook.
- **Clearing:** a **Clear log** button; also cleared on target change back to Simulator.
- **Export:** **Copy** (plain text), **Download .txt**, **Download .json**.
- **Summary:** **Copy troubleshooting report** — app build, browser, OS, link type, last
  five state transitions, the normalized error code, and the suggested action.

### Event record

Every event carries: monotonic `t` plus wall-clock ISO timestamp; app version and build
hash; browser/OS family and major version only; link type; device profile name; a
**session-scoped anonymous device handle** (never a serial number or port path); the
state transition; permission outcome; firmware/protocol version when known; stage and
progress; elapsed ms; retry count; the normalized error code; the raw low-level message
*after redaction*; the exact student-facing string shown; and the suggested action.

### Redaction

Redaction runs **at write time**, not at export time. Stripped: OS usernames and home
directories, full filesystem paths reduced to basenames, USB serial numbers, Bluetooth
addresses, port device paths, project names and any student-authored text, anything
matching a token or key shape.

### Normalized error taxonomy

Codes are stable strings, decoupled from exception text.

| Code | Category | Suggested action shown |
| --- | --- | --- |
| `ERR_BROWSER_UNSUPPORTED` | Environment | Open in Chrome or Edge |
| `ERR_INSECURE_CONTEXT` | Environment | Use the https:// address |
| `ERR_POLICY_BLOCKED` | Environment | Show IT the policy request in Help |
| `ERR_PERMISSION_DENIED` | Permission | Press Find my robot and choose a port |
| `ERR_NO_PORT_SELECTED` | Permission | Chooser dismissed — try again |
| `ERR_NO_PORTS_FOUND` | Connection | Check the cable; try the other USB socket |
| `ERR_PORT_BUSY` | Connection | Close mBlock or Arduino IDE |
| `ERR_PORT_OPEN_FAILED` | Connection | Unplug, replug, retry |
| `ERR_DRIVER_SUSPECTED` | Connection | Robot powered but no port — driver may be missing |
| `ERR_BT_NOT_PAIRED` | Connection | Pair in system Bluetooth settings first |
| `ERR_BT_MODULE_UNSUPPORTED` | Connection | This module can't be reached — use the cable |
| `ERR_NO_REPLY` | Handshake | Switch the robot on; check the battery |
| `ERR_FIRMWARE_UNKNOWN` | Handshake | Robot has a different program on it — restore firmware |
| `ERR_FIRMWARE_TOO_OLD` | Handshake | Ask your teacher to update this robot |
| `ERR_IDENTITY_REJECTED` | Safety | Student said "not my robot" — pick another |
| `ERR_PREFLIGHT_BLOCKED` | Program | Named block cannot run on a real robot |
| `ERR_PROGRAM_TOO_LARGE` | Program | Too big to store — run it with the cable instead |
| `ERR_SEND_TIMEOUT` | Transfer | Didn't finish — nothing was left on the robot |
| `ERR_VERIFY_FAILED` | Transfer | Program arrived damaged — send it again |
| `ERR_TRANSFER_INTERRUPTED` | Transfer | Robot cleared for safety — send again |
| `ERR_FLASH_SYNC_FAILED` | Firmware | Bootloader didn't answer — retry, then try another cable |
| `ERR_FLASH_VERIFY_FAILED` | Firmware | Re-flash needed before this robot is usable |
| `ERR_LINK_LOST` | Runtime | Robot may still be moving — check it |
| `ERR_STOP_UNCONFIRMED` | Safety | Pick the robot up and switch it off |
| `ERR_RATE_LIMITED` | Runtime | Wait a moment before sending again |
| `ERR_INTERNAL` | Fallback | Copy the troubleshooting report and show a teacher |

---

## 12. Security, privacy and classroom-management considerations

| Concern | Position |
| --- | --- |
| Browser device permission | Web Serial is user-gesture gated, per-origin, per-port, revocable in site settings, HTTPS-required. One port requested per session, never opportunistic enumeration. |
| Localhost / mLink | **Not used.** No localhost calls at all — sidesteps mixed content, CORS, and an unauthenticated local service. |
| Cross-origin | No fetches, no third-party scripts, no CDN at runtime. Firmware `.hex` is a same-origin static asset, build-time hashed. |
| HTTPS | Already satisfied by Vercel; hardware features do not appear at all if `isSecureContext` is false. |
| Malicious/malformed programs | Frames length-prefixed and checksummed; motor values clamped twice; bytecode validated against opcode/size limits before any byte is sent. Worker sandbox unchanged. |
| Unauthorized device access | The wink-confirmation token is required for every send and expires on any disconnect. |
| Supply chain | Ideally zero new runtime dependencies; STK500v1 vendored as a small audited module rather than pulling in a full library tree, lazy-loaded. |
| Log contents | Redacted at write time; session-scoped; student-clearable. |
| Student privacy | Nothing leaves the device unless explicitly downloaded or copied. No telemetry added. |
| Physical safety limits | Default motor cap 60%; program size capped by EEPROM; sends rate-limited to 3 s; flashes to 30 s; per-robot flash counter recorded. |

### What to hand the IT administrator

A one-page printable in the help drawer: origin `https://mbot-vr.vercel.app`;
`DefaultSerialGuardSetting = 3` (or add the origin to `SerialAllowAllPortsForUrls` to
skip the chooser entirely); confirm `SerialBlockedForUrls` does not cover it; and a note
that no software installation, no extension and no admin-installed driver is requested.

---

## 13. Proposed source-file and module changes

### New — device layer

| Path | Responsibility |
| --- | --- |
| `src/device/types.ts` | Shared device-layer types: execution target, connection status, device profile, hardware issues. |
| `src/device/featureFlag.ts` | Whether the hardware UI is enabled at all (off by default). |
| `src/device/capabilities.ts` | Feature detection: Web Serial present, secure context. |
| `src/device/MakeblockProtocol.ts` | Frame encode/decode for `0xFF 0x55`. Pure functions over `Uint8Array`. |
| `src/device/SerialTransport.ts` | Opens a real `SerialPort`, pumps its streams into a `SerialLink`. |
| `src/device/DeviceSession.ts` | State machine of §8; request/reply correlation; timeouts; retry policy. |
| `src/device/StopController.ts` | The escalation ladder of §9. Owns the only path to a "stopped" claim. |
| `src/device/SerialRobotRuntime.ts` | `createSerialRuntime(session): MbotRuntime`. Mirrors `createEngineRuntime`. |
| `src/device/preflight.ts` | Workspace → `HardwareIssue[]`, with severities. |

### New — diagnostics and UI

| Path | Responsibility |
| --- | --- |
| `src/diagnostics/taxonomy.ts` | Codes, categories, student strings, suggested actions. |
| `src/diagnostics/redact.ts` | Redaction at write time. |
| `src/diagnostics/DiagnosticLog.ts` | Ring buffer, session persistence, subscription. |
| `src/diagnostics/report.ts` | Text, JSON and short-summary formatters. |
| `src/components/DevicePanel.tsx` | The rail's "My robot" section: connect flow, wink, send, clear, technical details. |
| `src/components/StopBanner.tsx` | The sticky, non-dismissing "may still be moving" state. |
| `src/components/PreflightList.tsx` | Issues, severities, block links. |
| `src/components/DiagnosticsPanel.tsx` | View, copy, download, clear. |

### Changed

`src/App.tsx` (target state, runtime selection, hardware halt hooks),
`src/components/RunBar.tsx` (target switch, Stop always enabled when connected),
`src/types/index.ts` (`ProjectSettings` gains `robotSpeedCapPct`),
`src/storage/projectStore.ts` (one more `migrateSettings` default).

**Untouched:** `src/simulation/*`, `src/runtime/worker.ts`, `src/blocks/generators.ts`,
`src/blocks/defineBlocks.ts`, `src/blocks/compile.ts`'s existing return shape,
`src/playgrounds/*`. That is the measure of whether the seam was used correctly.

### New dependencies

Ideally **zero**. Web Serial is a platform API; the protocol is a few dozen lines of
byte handling. STK500v1 (Tier 2, not yet built) is the one future candidate, and
vendoring a small audited copy is preferable to adding a full library tree.

---

## 14. Testing strategy

The existing suite's philosophy — test the logic that would be expensive to get wrong,
against real engines rather than mocks where possible — carries over directly. Hardware
adds one hard problem: the device cannot be in CI. The answer is a **fake serial link**
at the same seam `tests/programRunner.test.ts` already uses for `FakeWorker`.

- **Unit:** `MakeblockProtocol` round-trips and fixtures (split frames, garbage
  prefixes, truncated frames, index wraparound); `redact` against every rule;
  `taxonomy` completeness (every code has a message and action); `preflight`
  classification against the eight starter programs.
- **Integration (`FakeLink`):** the full connect ladder including every failure branch;
  **the stop ladder is the most-tested path** — confirmed stop, timeout→reset→confirm,
  total silence → `stopUnconfirmed`, disconnect mid-stop, a stop arriving during a send.
  Assertion in every case: *the UI claims "stopped" only on evidence.*
- **Regression:** the entire existing suite passes unchanged; any edit to a current test
  file is a signal the seam was violated.
- **Hardware:** not automatable — a written manual matrix (two robots × {USB,
  Bluetooth} × {macOS, ChromeOS} × {factory firmware, foreign sketch}) for a human to
  run before each term.

---

## 15. Phased implementation plan

| Phase | Purpose | Touches | Done when |
| --- | --- | --- | --- |
| **0 — Spike** | Answer U1–U8 on real hardware before committing further. Throwaway branch, never merged. | A scratch page, no repo files | All eight unknowns answered or explicitly deferred. |
| **1 — Diagnostics** | Log, redaction, taxonomy, export. Ships value alone. | `src/diagnostics/*`, `DiagnosticsPanel` | A student can copy a troubleshooting report today, with no robot present. |
| **2 — Connect** | Capability detection, connect ladder, identify, wink. No program execution. | `src/device/{capabilities,SerialTransport,MakeblockProtocol,DeviceSession}`, `DevicePanel` | A student connects, sees "Connected to Robot 7", winks it, disconnects — all logged. |
| **3 — Stop** | The safety layer, *before* anything can make a robot move. Order is not negotiable. | `StopController`, `StopBanner`, `RunBar`, `ErrorBoundary` | Every stop path either confirms or says "may still be moving". |
| **4 — Live drive** | Tethered execution: `createSerialRuntime` plus preflight. First phase a class could use. | `SerialRobotRuntime`, `preflight`, `PreflightList`, `App.tsx` | A line-follower program drives a real robot; a simulator-only block is blocked with a named reason. |
| **5 — Firmware** | Player firmware: watchdog, EEPROM slot, halt flag, nickname; one-time flash path. | `firmware/`, `src/device/flash/`, `bytecode/` | A program runs untethered; a pulled cable stops the robot within 500 ms. |
| **6 — Bluetooth** | RFCOMM via Web Serial. **Only if U4 says the fitted modules support SPP.** | `capabilities`, `DeviceSession` pacing | A student drives wirelessly and is told plainly that sending needs the cable. |
| **7 — Fallback** | Arduino C export for unsupported browsers and locked-down fleets. | A new generator profile, `ProjectManager` export entry | Generated sketches compile in the Arduino IDE for all eight starters. |

### Feature flags

- `hardware` — the master gate. Off by default. Enabled by a URL parameter for testing.
- `hardware.bluetooth` — independent, disableable per classroom without losing USB.
- `hardware.onRobotPrograms` — Tier 2 separately, so live control can ship first.
- `diagnostics` — on by default from phase 1; useful with no robot attached.

Every flag is checked at a single place that decides whether to dynamically import the
device modules, so "off" means the code is not downloaded, not merely hidden.

---

## 16. Risks, dependencies and fallback approaches

| Risk | Severity | Mitigation / fallback |
| --- | --- | --- |
| A robot keeps moving after Stop appears to succeed | Critical | Evidence-gated status; sticky banner; firmware watchdog; the stop matrix is the most-tested code path. Phase 3 lands before phase 4. |
| Managed fleet blocks serial entirely | Blocking | Answered in phase 0 (U5). If blocked, the plan reduces to phase 1 + phase 7. |
| Robots have foreign firmware from previous lessons | High | Detected at identify. Offer a teacher-run firmware restore. Never silently reflash. |
| Fitted Bluetooth modules are BLE-only | Medium | Phase 6 is cancelled, not attempted. |
| Web Serial changes or is deprecated | Low | Shipping since 2021, actively extended through 2025–26. |
| Firmware becomes a maintenance burden | Medium | Keep it small and versioned; Tier 1 works fully with factory firmware alone. |
| GPLv2 / GPLv3 friction | Medium | Write Player firmware from scratch against the mCore pin map, or keep it clearly separated as an aggregate work — a decision, not an accident. |
| Feature destabilises the classroom app | High | Feature flags gate dynamic imports; simulator path untouched; existing test suite passes with no test file edited. |

---

## 17. Acceptance criteria

- **Connection clarity.** Device state visible without opening a panel; "Connected"
  never appears before a firmware reply *and* a student confirmation; disconnecting or
  refreshing returns to "no robot" with no stale name.
- **Right robot.** No state-changing bytes sent before a wink confirmation; any
  disconnect invalidates it.
- **Environment guidance.** Unsupported browsers get a named recommendation and a
  working export path; a policy block is distinguished from a user denial.
- **Preflight and progress.** Every simulator-only block is blocked with the block named
  and highlighted; determinate progress only where a byte count exists.
- **Truthful reporting.** "Program is on your robot" only after checksum verification;
  an interrupted transfer reports failure and leaves the robot inert.
- **Safety.** Stop reachable from every state and never disabled while connected; stop
  cuts motors before anything else; unconfirmed stops require acknowledgement; clearing
  a program survives a power cycle; a pulled cable stops the robot within 500 ms with
  Player firmware, and always produces the warning banner.
- **Privacy and stability.** An exported log contains no username, path, serial number,
  Bluetooth address, or student-authored text; the simulator behaves identically with no
  robot connected; the existing test suite passes with no test file edited; with the
  flag off, no device code is downloaded.

---

## 18. Decisions needed from Tatian

1. **Is untethered running actually required, or is tethered enough?** Tier 1 alone is
   roughly a third of the work and ships far sooner.
2. **Is Chrome/Edge-only acceptable for the hardware feature?** Unavoidable for direct
   connection — the question is whether Safari/Firefox get the export fallback or just
   a "use Chrome" message.
3. **How should the Player firmware handle the GPLv2 question?** Build on Makeblock's
   GPLv2 libraries as a separately licensed aggregate, or write it from scratch against
   the mCore pin map to keep the whole tree GPLv3.
4. **Who is allowed to flash firmware?** Recommendation: teacher-only, in the help
   drawer rather than the run bar.
5. **What is the default motor cap on physical robots?** Recommendation: 60%,
   teacher-adjustable per project.
6. **Should the diagnostic log survive a refresh?** Recommendation: yes, via
   `sessionStorage`, but not longer.
7. **Do you have hardware access to run the phase 0 spike, and when?** Everything
   downstream is gated on it.
8. **Is "display number" worth keeping in the palette?** It has no onboard hardware on
   mBot v1.

---

## Recommendation, in one paragraph

Implement a second `MbotRuntime` that speaks the Makeblock `0xFF 0x55` protocol over Web
Serial, so a student's existing blocks drive a real mBot tethered over USB with no
compiler, no backend and no installer — then add a small, versioned Player firmware,
flashed once per robot by a teacher, that provides a host-heartbeat watchdog and stores
student programs as compact bytecode in EEPROM so they run untethered. Treat Bluetooth
as live-control-only (it physically cannot upload) and reach it through Web Serial's
RFCOMM support rather than Web Bluetooth. Replace the requested blank-program upload
with a two-command halt ladder — motors-zero and RESET, then a DTR reset pulse, then a
sticky "may still be moving" warning — and make the persistent "clear the program"
action a single EEPROM byte on a separate, non-emergency button. Gate everything behind
feature flags that control dynamic imports, land the stop layer before anything that can
make a robot move, and keep the simulator bit-for-bit unchanged for the students who
never plug anything in.

### The five feasibility questions that matter most

1. **Does a DTR reset actually stop the motors, and in how many milliseconds?**
2. **Does the managed school fleet permit Web Serial at all?**
3. **What firmware is on the robots today, and does it answer the protocol?**
4. **Are the Bluetooth modules dual-mode SPP or BLE-only?**
5. **What is the real round-trip latency for one sensor read?**

---

## Implementation status

This section is updated as code lands; the sections above are the frozen planning
record. Updated after the first implementation pass, which built as much of Tier 1
(tethered live control) as is possible without access to a physical mBot.

**No physical mBot was available to validate against. Every claim below about actual
robot behaviour - the protocol byte layout, the DTR-reset assumption, port wiring,
timing - remains unverified until the phase 0 spike in §4 runs on real hardware.**
What *is* verified is that the software runs, is internally consistent, and does not
touch the simulator path.

### What is built

- **Diagnostics** (`src/diagnostics/`: `DiagnosticLog.ts`, `redact.ts`, `taxonomy.ts`,
  `report.ts`) - the full ring-buffer log, redaction, the complete error taxonomy from
  §11, and the copy/download/troubleshooting-report formatters. Surfaced through
  `DiagnosticsPanel.tsx`. Unlike the phase table's original split, this is bundled
  inside the lazy-loaded `DeviceSection` rather than always-visible - with the hardware
  feature off, nothing in this app ever calls `diagnosticLog.log()`, so an
  always-rendered, always-empty log panel would be clutter with no content. The
  `DiagnosticLog` class itself is still constructed unconditionally in `App.tsx`, so
  turning the flag on mid-session does not lose anything logged before that point.
- **Connect and identify** (`src/device/DeviceSession.ts`, `SerialTransport.ts`,
  `capabilities.ts`, `MakeblockProtocol.ts`) - the full state machine from §8:
  capability detection, `requestPort`/`open`, the 3-attempt identify probe, the wink
  sequence, "yes/no that's mine", disconnect handling, reconnection. Bluetooth is
  offered as a link choice (using the standard SPP service class UUID to steer the
  port chooser, per source 11) rather than withheld pending U4 - since Tier 1's live
  control is just serial writes with no special-casing by transport, there is nothing
  to gate on U4 for *this* phase; U4 only matters once Tier 2's upload path exists. A
  fitted BLE-only module will simply not appear in the chooser, which is the correct,
  honest outcome for that hardware fact rather than a bug.
- **Stop** (`src/device/StopController.ts`) - the exact escalation ladder from §9:
  halt-twice, probe, DTR pulse, re-probe, sticky unconfirmed state. `DeviceSession`
  gained an explicit `acknowledgeStopUnconfirmed()` for the "I checked it" action the
  plan's UX section describes. This is the most heavily tested path in the codebase
  (`tests/stopController.test.ts`) precisely because it is the one piece that must not
  be wrong.
- **Live drive** (`src/device/SerialRobotRuntime.ts`, `preflight.ts`) - a second
  `MbotRuntime` implementation, exactly mirroring `createEngineRuntime`'s shape, driven
  by the *exact same* `ProgramRunner`/`compileWorkspace`/generator pipeline the
  simulator uses. `assessHardwareCompatibility()` classifies every block per §10's
  table and blocks sending a program that uses a simulator-only block. This is real,
  working Tier-1 functionality - a compiled program genuinely drives an
  `MbotRuntime` bound to a serial link - just never exercised against an actual board.
- **UI** (`src/components/DevicePanel.tsx`, `StopBanner.tsx`, `PreflightList.tsx`,
  `DiagnosticsPanel.tsx`, `DeviceSection.tsx`) - one component per state-machine phase
  in `DevicePanel`, composed in `DeviceSection`, which also owns its own `ProgramRunner`
  instance so running on the robot is independent of the simulator's Run/Stop. Wired
  into `App.tsx` as a `React.lazy` import, rendered only when
  `isHardwareFeatureEnabled()` is true. Verified in the browser (see below) that with
  the flag off, `DeviceSection.tsx` and everything it imports is never fetched -
  confirmed via the network log, not just by reading the code.
- **Tests**: 111 new tests across 11 files (`tests/makeblockProtocol.test.ts`,
  `redact.test.ts`, `taxonomy.test.ts`, `diagnosticLog.test.ts`,
  `diagnosticsReport.test.ts`, `deviceSession.test.ts`, `stopController.test.ts`,
  `serialRobotRuntime.test.ts`, `preflight.test.ts`, `featureFlag.test.ts`,
  `deviceCapabilities.test.ts`), all passing alongside the original 234 - none of which
  were modified. `tests/fakeSerialLink.ts` is a `FakeLink` for `SerialLink`, the same
  pattern as `FakeWorker` in `tests/programRunner.test.ts`. `npm run typecheck` and
  `npm run build` both pass; the build confirms `DeviceSection` code-splits into its
  own chunk (≈23 KB, ≈8 KB gzipped).

### First real-hardware finding, and the fix

The first live test against a physical mBot (2 September 2026, over USB/CH340)
surfaced exactly the kind of bug this plan flagged as possible: `identify()` timed out
with `ERR_NO_REPLY` on every attempt, even though the robot was almost certainly
answering. Reading Makeblock's firmware source directly (rather than relying on
secondhand summaries, which is what the original protocol notes above were partly
built on) found the actual cause: **the reply direction is not length-prefixed the way
the request direction is.** A `GET` reply is `FF 55 <idx> <type> <data...> \r\n`, and a
`RUN`/`RESET`/`START` acknowledgement is a bare `FF 55 \r\n` with no index at all -
confirmed byte-for-byte against `writeHead`/`sendFloat`/`sendString`/`callOK` in
`mbot_factory_firmware.ino`. `FrameParser` originally assumed a uniform length-prefixed
shape for both directions, so it was misreading every reply's index byte as a length
and waiting for a frame that would never complete.

This has been corrected in `MakeblockProtocol.ts` (`FrameParser` now implements the
real, asymmetric shape) and `DeviceSession.ts` (`identify`/`probe` now query `VERSION`,
device id `0`, rather than the ultrasonic sensor - not because the sensor didn't reply
too, but because `VERSION` needs no port and doubles as a genuine firmware-version
readout for the device profile). Every test that mocked a reply has been rewritten to
emit byte-accurate frames instead of the previous incorrect shape - the earlier 111
"passing" tests were, in hindsight, mostly validating internal self-consistency against
the wrong assumption rather than the real protocol, which is precisely why this needed
a human with actual hardware to surface it. This is the first of the plan's "unverified
until tested" claims to be confirmed and corrected against real hardware, and the
confidence note at the top of `MakeblockProtocol.ts` has been rewritten accordingly.

### Second and third rounds: port confusion, and a reset-timing hypothesis

Two more real-hardware rounds followed, each surfacing something the first fix didn't
cover:

- **The port picker was showing every serial-capable device on the machine** -
  Bluetooth-paired earbuds, a debug console, an unrelated USB device - alongside the
  mBot's two duplicate driver entries (macOS commonly exposes one CH340-family adapter
  through both its own built-in driver and a separately-installed WCH one). Chrome's
  port chooser is native OS UI the page cannot rename or rank entries inside, but
  `requestPort()`'s `filters` option can narrow it before it opens.
  `SerialTransport.ts` now filters a USB request to vendor id `0x1A86` (WCH) by
  default, with a "my robot isn't listed" fallback that requests with no filter.
  Separately, a real bug was found and fixed in the same round: a failed connection
  attempt (e.g. `identify()` timing out on an already-opened port) never closed that
  port, so the *next* attempt failed with `ERR_PORT_BUSY` against a port only the
  previous, already-failed attempt was still holding - `useDeviceSession.connect()`
  now disposes the session in its `catch` block.
- **A reset-timing hypothesis, not yet confirmed.** `ERR_NO_REPLY` persisted even with
  the port narrowed correctly. Arduino Uno-compatible boards - the mCore included -
  are documented to auto-reset when a serial connection opens (a DTR-line capacitor
  turns the port-open handshake into a reset pulse, the same mechanism behind the
  Arduino IDE's own Serial Monitor resetting a board on open). `identify()` was
  probing immediately after `port.open()` succeeded, which could mean probing a board
  still mid-reboot. A 2-second settle period was added between opening the port and
  the first probe. **This is a plausible, well-documented cause, not a confirmed one**
  - unlike the framing bug above, it has not yet been proven against this specific
    hardware by a passing connection afterward.
- **A cross-check against Makeblock's own official client.** To look for a reference
  implementation of the reset-timing problem, `Makeblock-official/mBlock` (the older,
  Scratch-2.0-based mBlock 3/4 client - Electron + ActionScript, not the same codebase
  as mBlock 5) was read directly. Two useful, concrete outcomes:
  - **No reference implementation exists to borrow.** That client's `app/serial.js`
    considers a connection "ready" the instant the OS reports the port open, with no
    protocol-level handshake at all (confirmed by `grep`-ing the whole source tree for
    any firmware version check - only the app's own auto-updater has one). It simply
    does not handle this timing issue; it is not that they solved it differently.
  - **The reply-parsing byte format is now cross-checked against a second,
    independent, official source** (`src/cc/makeblock/interpreter/PacketParser.as`),
    and matches this app's implementation for every reply type it actually uses
    (`FLOAT` for ultrasonic/line-follower, `STRING` for `VERSION`). It also caught a
    real internal inconsistency *within Makeblock's own mBlock repo* - the bundled
    firmware's `sendShort`/`sendDouble` claim 4 and 8 bytes, but the bundled client
    reads `SHORT` as 2 bytes and treats `DOUBLE` identically to `FLOAT` (4 bytes); a
    `grep` confirmed neither `sendShort` nor `sendDouble` is ever actually called by
    that firmware, so the mismatch has evidently never mattered in practice. This
    app's `ReplyType` byte lengths now follow the client's behaviour, and a `RawFrame`
    now carries the type byte plus raw hex-preview logging of every unidentified
    connection's incoming bytes (`DeviceSession`'s "Raw bytes received" log entries),
    so the next hardware round produces direct evidence - what actually arrived on the
    wire - rather than another hypothesis to test blind.

### What is explicitly not built

- **Player firmware, EEPROM program storage, the flash-once workflow (Tier 2 /
  Phase 5).** No Arduino sketch was written and no STK500 flashing code exists. This
  needs an Arduino build environment and real hardware to validate the watchdog timing,
  neither of which this session had. "Clear my robot's program" is correspondingly
  **not offered anywhere in the UI** - it would need Tier 2's EEPROM halt flag to mean
  anything, and showing a control that does nothing would be dishonest.
- **The Arduino-C export fallback (Phase 7).** Safari/Firefox users currently see the
  "open in Chrome or Edge" message with no export alternative yet.
- **A device-profile UI** for a teacher to correct the assumed default port wiring
  (ultrasonic port 3, line follower port 2 - see the confidence note in
  `MakeblockProtocol.ts`) or configure a Me 7-Segment display. Until that exists,
  `mbot_display_number`/`mbot_clear_display` are always blocked by preflight.
- **The phase-0 hardware spike itself.** U1-U8 remain open. In particular: whether a
  DTR pulse actually stops motors (U1, the whole stop ladder's second line of defence),
  what firmware is actually on your fleet (U2), and the real port wiring (U3) are still
  unknown.

### Known simplifications versus the plan text

- Preflight is a standalone `assessHardwareCompatibility(workspace)` function rather
  than a new field on `compile.ts`'s `CompileResult`, so `tests/compile.test.ts` needed
  no changes at all (matching the plan's own stated goal, just via a slightly different
  mechanism than §13 originally proposed).
- The "flush the write queue, don't append" requirement in §9 is satisfied by
  `ProgramRunner.stop()` terminating the worker before any halt command is sent (so no
  *new* program-generated write can be created), rather than by a literal
  cancel-and-reorder queue - this app's single-in-flight-command architecture never
  builds up a queue to flush in the first place. See the comment at the top of
  `StopController.ts`.

Enable the feature during development with `?hardware=1` in the URL (persists via
`localStorage`) or `localStorage.setItem('mbotvr.hardware.enabled', '1')`.
`?hardware=0` turns it back off and clears the stored preference.


---

## Sources

1. [Makeblock — mCore, Main Control Board of mBot](https://support.makeblock.com/hc/en-us/articles/4412894402967-mCore-Main-Control-Board-of-mBot)
2. [mCore datasheet (10041)](https://media.digikey.com/pdf/Data%20Sheets/Makeblock%20PDFs/10041_Web.pdf) · [Core Electronics — mBot overview](https://core-electronics.com.au/guides/mbot-overview/)
3. [Makeblock — Direct Connection of mBlock 5 on the web](https://support.makeblock.com/hc/en-us/articles/19412317319191-Introduction-to-Direct-Connection-of-mBlock-5-on-the-web)
4. [Makeblock — Program mBot with mBlock 5](https://support.makeblock.com/hc/en-us/articles/1500003954802-Program-mBot-with-mBlock-5) · [mLink installation](https://support.makeblock.com/hc/en-us/articles/14778822055959-mLink-Installation-and-Application)
5. [Vernier TIL 4140 — mBot via Bluetooth (mBlock 3)](https://www.vernier.com/til/4140) · [TIL 4474 — same, mBlock 5](https://www.vernier.com/til/4474)
6. [Makeblock — FAQs on mBot](https://support.makeblock.com/hc/en-us/articles/1500004081921-FAQs-on-mBot)
7. [Can I use — Web Serial API](https://caniuse.com/web-serial) · [MDN — Serial.requestPort()](https://developer.mozilla.org/en-US/docs/Web/API/Serial/requestPort)
8. [Chrome Enterprise — DefaultSerialGuardSetting](https://chromeenterprise.google/policies/default-serial-guard-setting/) · [SerialBlockedForUrls](https://chromeenterprise.google/policies/serial-blocked-for-urls/) · [SerialAllowAllPortsForUrls](https://chromeenterprise.google/policies/serial-allow-all-ports-for-urls/)
9. [ATmega328P datasheet](https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-7810-Automotive-Microcontrollers-ATmega328P_Datasheet.pdf)
10. [Chrome for Developers — Serial over Bluetooth](https://developer.chrome.com/blog/serial-over-bluetooth)
11. [Chrome for Developers — Bluetooth RFCOMM updates in Web Serial](https://developer.chrome.com/blog/bluetooth-rfcomm-updates-web-serial)
12. [Makeblock — Bluetooth Module for mBot](https://www.makeblock.com/products/bluetooth-module-for-mbot-1) · [#SH Bluetooth Module (Single Mode)](https://www.makeblock.com/products/bluetooth-module-for-mbot) · [Me Bluetooth Module (Dual Mode) manual](https://usermanual.wiki/Makeblock/BLUETOOTH01/html)
13. [Makeblock-Libraries — mbot_factory_firmware.ino](https://github.com/Makeblock-official/Makeblock-Libraries/blob/master/examples/Firmware_For_mBlock/mbot_factory_firmware/mbot_factory_firmware.ino) · [Makeblock forum — mBlock firmware protocol introduction](https://forum.makeblock.com/t/mblock-firmware-protocol-introduction/2281)
14. [Makeblock-Libraries — MeMCore.h licence header](https://github.com/Makeblock-official/Makeblock-Libraries/blob/master/src/MeMCore.h)
15. [avrgirl-arduino — Web Serial demo](https://github.com/noopkat/avrgirl-arduino/blob/master/tests/demos/webserial/README.md) · [arduino/js-stk500v1](https://github.com/arduino/js-stk500v1)
16. [CH340 drivers for Windows, Mac and Linux](https://sparks.gogo.co.nz/ch340.html) · [WCH macOS CH34x driver](https://github.com/WCHSoftGroup/ch34xser_macos)

Two Makeblock help-centre pages (the direct-connection article and the Chromebook
connection guide) returned HTTP 403 to automated fetching during research; their content
is cited from search-result excerpts rather than a full read, and should be re-checked
by hand before phase 6 is scheduled.
