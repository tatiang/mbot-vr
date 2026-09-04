# mBot VR Player firmware — wire protocol and on-robot format

**Status: partially implemented, UNVERIFIED against real hardware.**

This document is the single contract shared by two codebases that must not drift apart:

| Side | Files |
| --- | --- |
| Browser (this repo) | `src/device/MakeblockProtocol.ts` (`DeviceId.PLAYER`, `PlayerCommand`, `encodePlayerGet`), `src/device/DeviceSession.ts` (`writeStoredProgram`, `clearStoredProgram`), `src/device/bytecode.ts` (`PlayerOp`, `compileWorkspaceToPlayerBytecode`) |
| Firmware | `firmware/mbotvr-player/mbotvr-player.ino` |

If you change one side, change this file and the other side in the same commit.
`tests/playerBytecode.test.ts` and the Player section of `tests/makeblockProtocol.test.ts`
exist to make an un-synchronised change fail CI.

Nothing here has run on a physical mBot yet. Every "the robot does X" statement is a
design intent to be confirmed by the phase‑0 spike in `docs/hardware-bridge-plan.md`.

---

## 1. Transport framing

Player firmware speaks the **exact same `0xFF 0x55` framing** as Makeblock's factory
firmware (see the confidence note at the top of `src/device/MakeblockProtocol.ts`). It is
a superset: every request the app already sends to a factory‑firmware robot for Tier‑1
tethered control (`VERSION`/`ULTRASONIC`/`LINE_FOLLOWER` GETs, `MOTOR`/`RGB_LED` RUNs,
`RESET`) is handled identically, so flashing Player firmware does not break Tier 1.

### Request (host → robot), length‑prefixed

```
FF 55 <len> <idx> <action> <device> <params...>
```

`<len>` counts every byte from `<idx>` onward. `<action>`: GET=1, RUN=2, RESET=4, START=5.

### Reply (robot → host), NOT length‑prefixed

* GET reply: `FF 55 <idx> <type> <data...> \r\n` — `type`: BYTE=1, FLOAT=2, STRING=4
  (string data is `<strlen> <chars...>`).
* RUN / RESET / START acknowledgement: bare `FF 55 \r\n` — **no index, no data**. The app
  never awaits these (they cannot be correlated), so the firmware may send them exactly as
  the factory firmware does, or omit them; the app behaves the same either way.

---

## 2. Player command channel

All Player‑specific operations are a **GET to a reserved device id** with the real
sub‑command in the first parameter byte:

```
device = 0x7D  (DeviceId.PLAYER)
params = [ <PlayerCommand>, <sub-params...> ]
```

built by `encodePlayerGet(idx, command, params)` on the browser side.

Every Player command replies with an **indexed BYTE frame** so the app can correlate it:

```
FF 55 <idx> 01 <status> \r\n        status: 0x01 = OK, 0x00 = rejected
```

`DeviceSession.expectPlayerOk()` treats `payload[0] === 1` as success and anything else as
`ERR_VERIFY_FAILED`. `INFO` is the one exception — it replies with a STRING (see below).

| `PlayerCommand` | Value | Sub‑params | Reply | Meaning |
| --- | --- | --- | --- | --- |
| `INFO` | `0x01` | — | STRING (see §2.1) | Report firmware/program state. Not yet called by the app; reserved and implemented for the teacher surface. |
| `BEGIN_PROGRAM_WRITE` | `0x10` | `lenLo, lenHi, crcLo, crcHi` | BYTE OK | Start a transfer of a `len`‑byte blob whose instruction region hashes to `crc` (`checksum16`). Invalidates any stored program immediately. |
| `WRITE_PROGRAM_CHUNK` | `0x11` | `offLo, offHi, b0..bN` (N ≤ 31) | BYTE OK | Write `b*` into the staging area at byte `off`. Chunks are ≤ 32 bytes and arrive in ascending, non‑overlapping order. |
| `COMMIT_PROGRAM` | `0x12` | — | BYTE OK | Make the staged program the live stored program, atomically w.r.t. a power cut (writes the magic last). |
| `VERIFY_PROGRAM` | `0x13` | `lenLo, lenHi, crcLo, crcHi` | BYTE OK / reject | Re‑hash what was written and compare against `len`/`crc`. Sent **before** `COMMIT_PROGRAM`. |
| `SET_BOOT_IDLE` | `0x20` | `flag` (`1` = idle, `0` = run) | BYTE OK | Set/clear the boot‑idle halt flag. `flag = 1` is the "Clear my robot's program" primitive — one EEPROM byte, no reflash. |

The app's transfer sequence (`DeviceSession.writeStoredProgram`) is:
`BEGIN_PROGRAM_WRITE` → `WRITE_PROGRAM_CHUNK`×n → `VERIFY_PROGRAM` → `COMMIT_PROGRAM`.
Any single step timing out (15 s wall‑clock budget for the whole transfer) aborts with
`ERR_SEND_TIMEOUT` and leaves the stored program invalid, never half‑live.

### 2.1 `INFO` reply

STRING, ASCII, `< 64` bytes, space‑separated `key=value`:

```
MBVR player=1 idle=<0|1> prog=<0|1> plen=<n> crc=<n>
```

`idle` = boot‑idle flag, `prog` = a valid stored program is present, `plen` = its blob
length, `crc` = its stored instruction checksum. The token `player=1` and the substring
`MBVR` both satisfy `DeviceSession`'s `isPlayerFirmwareVersion()` test.

### 2.2 Firmware identification

`VERSION` GET (`device 0`, no params) replies STRING **`mBot VR Player v1`**. That string
matches `/mbot\s*vr|mbot-vr|player/i`, which is how `DeviceSession.identify()` sets
`profile.supportsOnRobotPrograms = true` and unlocks the storage UI. A factory‑firmware
robot answers this GET with its own version string, fails that test, and the app keeps the
storage controls disabled — the intended, honest outcome.

Audible signature: Player firmware chirps **twice** at boot; factory firmware chirps three
times. A teacher can tell them apart without a screen.

---

## 3. On‑robot storage format (EEPROM)

The ATmega328P has 1024 bytes of EEPROM (rated ≥100,000 writes). Layout:

```
offset  size  field
------  ----  -------------------------------------------------------------
0       4     magic  "MBVR" (0x4D 0x42 0x56 0x52) — absent/partial ⇒ no program
4       1     bytecode format version (currently 1)
5       1     flags: bit0 = boot-idle halt; bits 1-7 reserved (0)
6       2     instruction length, little-endian (bytes of §4 stream)
8       2     checksum16 of the instruction stream, little-endian
10      ...   instruction bytes (see §4)
------  ----  ---------------------------------------------------------------
896     1     nickname length (0-31), 0xFF/0 ⇒ unset      ] reserved 128-byte
897     31    nickname, UTF-8                              ] block; not written
928     96    reserved (0xFF)                              ] by this slice
```

Bytes `0..9` are **exactly** the 10‑byte header `compileWorkspaceToPlayerBytecode()`
prepends (`PLAYER_BYTECODE_MAGIC`, `PLAYER_BYTECODE_VERSION`, a zero flags byte, the
LE length, the LE `checksum16`). The transferred blob is therefore written to EEPROM
verbatim from offset 0. Consequences:

* The zero flags byte in every fresh blob means **storing a program clears boot‑idle** —
  correct: you just gave it something to run. `SET_BOOT_IDLE 1` then re‑sets bit0 without
  touching the rest.
* `PLAYER_MAX_PROGRAM_BYTES` (896) = 1024 − 128 reserved. The browser preflight
  (`assessHardwareCompatibility(ws, { onRobotProgram: true })`) blocks any blob longer than
  this **before** a transfer starts; the firmware also rejects an out‑of‑range
  `WRITE_PROGRAM_CHUNK` offset defensively.

### Atomic commit

`BEGIN_PROGRAM_WRITE` zeroes EEPROM `0..3` (kills the magic). `WRITE_PROGRAM_CHUNK` writes
all bytes **except** offsets `0..3`, which are stashed in RAM. `VERIFY_PROGRAM` re‑hashes
EEPROM `10..len` and checks the stashed magic is `"MBVR"`. `COMMIT_PROGRAM` writes the four
magic bytes. A power loss at any point before that leaves the magic absent ⇒ the robot
boots idle. Fail‑safe by construction.

---

## 4. Bytecode instruction set (`PlayerOp`)

Defined in `src/device/bytecode.ts`; emitted by `compileWorkspaceToPlayerBytecode()`. A
stack machine over signed 16‑bit integers. Multi‑byte immediates are little‑endian. Jump
targets are **absolute byte offsets into the instruction stream** (offset 0 = first
instruction, i.e. EEPROM offset 10). The stream always ends `... STOP_MOTORS END`.

| Op | Value | Immediate | Stack effect | Semantics |
| --- | --- | --- | --- | --- |
| `END` | `0x00` | — | — | Halt the VM. Motors are already stopped by the emitted `STOP_MOTORS` before it. |
| `PUSH_I16` | `0x01` | i16 | → +1 | Push the immediate. |
| `ADD` `SUB` `MUL` `DIV` | `0x02`‑`0x05` | — | −1 | `a op b`. `DIV` by 0 ⇒ 0. |
| `LT` `GT` `EQ` | `0x06`‑`0x08` | — | −1 | `a op b` ⇒ 1/0. |
| `AND` `OR` | `0x09`‑`0x0A` | — | −1 | Logical, operands treated as truthy/falsey ⇒ 1/0. |
| `NOT` | `0x0B` | — | 0 | `x == 0 ? 1 : 0`. |
| `JUMP` | `0x0C` | u16 target | 0 | Unconditional. |
| `JUMP_IF_FALSE` | `0x0D` | u16 target | −1 | Pop; if 0, jump. |
| `SET_MOTORS` | `0x10` | — | −2 | Pop `right`, then `left` (both already in −255..255 motor units, "logical forward = positive"). Drive **M1 = −left, M2 = right** (M1 is mounted mirrored — same flip `encodeMotorRun` applies on the tethered path). Arms the... nothing: VM‑driven motion does **not** arm the host‑heartbeat watchdog (see §5). |
| `STOP_MOTORS` | `0x11` | — | 0 | Both motors to 0. |
| `WAIT_MS` | `0x12` | u16 ms | 0 | Busy‑wait `ms` milliseconds while still (a) servicing serial frames and (b) running the watchdog. |
| `SET_RGB_LED` | `0x13` | `which,r,g,b` (4 bytes) | 0 | `which`: 0 all, 1 right, 2 left. |
| `DISPLAY_NUMBER` | `0x14` | i16 | 0 | Me 7‑Segment on the configured port; no‑op if absent. |
| `CLEAR_DISPLAY` | `0x15` | — | 0 | As above. |
| `READ_ULTRASONIC_CM` | `0x20` | — | +1 | Distance in cm; **0 = nothing in range** (mBot convention). |
| `READ_LINE_VALUE` | `0x21` | — | +1 | 0 both on line, 1 left only, 2 right only, 3 both off. |
| `READ_LEFT_ON_LINE` | `0x22` | — | +1 | `(lineValue & 2) == 0 ? 1 : 0`. |
| `READ_RIGHT_ON_LINE` | `0x23` | — | +1 | `(lineValue & 1) == 0 ? 1 : 0`. |
| `READ_TIMER_DSEC` | `0x24` | — | +1 | Tenths of a second since program start / last `RESET_TIMER`. **Unit mismatch, see note.** |
| `RESET_TIMER` | `0x25` | — | 0 | Zero the timer. |
| `POWER_TO_MOTOR` | `0x30` | — | 0 | Convert a 0‑100 (%) TOS to motor units: `round(x * 2.55)` clamped −255..255. |
| `CM_WITHIN_OBSTACLE` | `0x31` | — | −1 | Pop `distance`, then `cm`; push `(cm > 0 && cm < distance) ? 1 : 0`. |
| `DUP` | `0x32` | — | +1 | Duplicate TOS. |
| `POP` | `0x33` | — | −1 | Discard TOS. |

> **Known unit mismatch (`READ_TIMER_DSEC`).** The compiler emits this opcode for the
> `mbot_timer` block but does **not** scale literal comparison operands, while the block's
> simulator semantics are in whole seconds. So a stored `timer > 5` currently compares
> tenths against `5`. The tethered runtime is unaffected (it never uses this opcode).
> Reconcile when the timer block is promoted to a supported Tier‑2 block — either scale in
> the compiler or make the VM return whole seconds. Tracked here rather than silently
> changed because `bytecode.ts` is already shipped (inert).

---

## 5. Host‑heartbeat watchdog

Purpose (from `hardware-bridge-plan.md` §2, §9 and the Tier‑2 handoff): a cable pulled
**during a tethered live‑drive run** must not leave the robot driving into a wall with
nothing left to command it.

* Every **valid received frame** updates `lastFrameMs`.
* A `MOTOR` RUN frame with a non‑zero speed **arms** the watchdog.
* `STOP_MOTORS`/`RESET`, a zero‑speed `MOTOR` RUN, and **any motor command issued by the
  bytecode VM** *disarm* it.
* While armed, if `millis() - lastFrameMs > 500`, stop both motors and disarm.

This targets exactly the tethered hazard and never interferes with an untethered stored
run (whose motion comes from the VM, which never arms it). One deliberate consequence: if
a host connects, and the stored program is already running, and then the host disconnects,
the watchdog trips 500 ms later — after a tethered session a pure untethered run needs a
power cycle. Documented, not a bug.

`HEARTBEAT_TIMEOUT_MS = 500` in the sketch; the number lives in this doc too so a change
is visible on both sides.

---

## 6. What is intentionally not here yet

* No STK500v1 flashing path (`src/device/flash/` does not exist). Getting Player firmware
  onto a board is, for now, an Arduino‑IDE / `arduino-cli` upload done by hand — see
  `firmware/mbotvr-player/README.md`.
* No Bluetooth transfer — mBot v1 upload is USB‑only by hardware; the app already blocks
  `writeStoredProgram` on a Bluetooth link.
* No variables, no user‑defined functions, no nested expression temporaries beyond the
  operand stack. The bytecode compiler rejects blocks it cannot lower and the preflight
  surfaces that as a blocking issue before any transfer.
