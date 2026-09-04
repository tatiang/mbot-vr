# mBot VR Player firmware

A small custom firmware for the Makeblock mBot v1.x (mCore board, ATmega328P) that lets
mBot VR store a compiled program on the robot and run it **untethered**, adds a
**host-heartbeat watchdog** for tethered safety, and keeps full backward compatibility
with mBot VR's Tier-1 tethered live control.

- **The sketch:** [`mbotvr-player.ino`](./mbotvr-player.ino)
- **The contract it implements:** [`../../docs/player-protocol.md`](../../docs/player-protocol.md)
- **Why it exists / where it fits:** [`../../docs/hardware-bridge-plan.md`](../../docs/hardware-bridge-plan.md) §6 "Tier 2 — Player firmware"

---

## ⚠️ UNVERIFIED — bench testing in progress

Bench testing started 2026-09-03. Findings so far are logged in
`docs/hardware-bridge-plan.md`'s "Implementation status" section, per-round, the same
way the Tier-1 rounds were. Open items:

| Thing | Risk if wrong | How to check | Status |
| --- | --- | --- | --- |
| mCore pin map (M1 = D6 PWM/D7 DIR, M2 = D5 PWM/D4 DIR, buzzer D8, RGB D13) | Robot does nothing, or the wrong thing | Cross-checked against an independent public source (mCore blog writeup + Makeblock's own mCore support page) — see sources below | High confidence; pin *numbers* match |
| Motors don't move at all | Looks like a firmware bug, isn't one | **Check battery power first.** The TB6612's motor-supply rail (VM) is separate from the 5 V logic rail (VCC) — USB alone powers the MCU and logic fine but **not the motors**. Makeblock's own troubleshooting guide flags exactly this ("mBot may not function normally when not enough power is provided"). Confirm the battery pack is installed, switched on, and has charge before treating "no motion" as a code bug. | Common false alarm — check this before debugging pins/PWM |
| Motor DIR polarity | Wheels spin backwards | "move forward" block on a Player-flashed robot; compare to the tethered path (already fixed there) | Unverified |
| WS2812 onboard LED bit-bang timing (`ws2812Show()`) | LEDs dark, wrong colour, or flicker | Scope the D13 waveform | **Real bug found and fixed 2026-09-03** (not yet re-tested on hardware). The original C `if/else` let the compiler tail-merge both branches' `*port = lo`, leaving only a ~2-cycle/125 ns gap between a "0" bit's and a "1" bit's high time — confirmed by disassembling the compiled sketch (`avr-objdump`), and almost certainly too thin for a WS2812/SK6812 part to read reliably; matches the "set both LEDs doesn't work" report exactly. Rewritten as hand-counted inline assembly (11-cycle vs 4-cycle high time, a 7-cycle/437.5 ns gap) and re-verified by disassembling the actual compiled sketch again. Retest on the bench before trusting it. |
| Ultrasonic pulse + `pulseIn` timing | Distance always 0 or nonsense | Hold a hand at 10/20/40 cm, read `INFO` / a live GET | Not yet tested |
| Line sensor active level (`INPUT_PULLUP`, LOW = on line) | `left/right on line?` inverted | Put the robot on and off dark tape | Not yet tested |
| Boot auto-reset window | First probe after flashing may miss | The app already waits 2 s post-open; confirm that's enough | Connect succeeded at 2 s in initial testing |
| Watchdog 500 ms cable-pull halt (plan U1-adjacent) | A robot keeps driving after a cable pull | Drive tethered, yank the USB cable, film at 60 fps | Not yet tested |

**Pin-map sources:** [mCore support page](https://support.makeblock.com/hc/en-us/articles/4412894402967-mCore-Main-Control-Board-of-mBot) (buzzer D8, RGB D13, motor pins) and a third-party mCore teardown/writeup independently listing M1 = D6 (PWM) / D7 (DIR) and M2 = D5 (PWM) / D4 (DIR), matching this sketch. Neither is Makeblock source code — hardware pin numbers are facts, not copied expression (see the licensing note below).

Record findings in `docs/hardware-bridge-plan.md`'s "Implementation status" section, in
the same per-round format used for the Tier-1 rounds.

---

## Building and flashing

No external libraries. Standard AVR core only (`Arduino.h`, `EEPROM.h`, `avr/interrupt.h`).

### Arduino IDE

1. Board: **Arduino Uno** (Tools → Board). The mCore is Uno-compatible (ATmega328P, 16 MHz).
2. Port: the robot's CH340 serial port (USB only — mBot v1 cannot be flashed over Bluetooth).
   **On macOS, the same CH340 chip often shows up twice** — a `/dev/cu.usbserial-XXXX`
   entry from macOS's own generic USB-serial driver, and a `/dev/cu.wchusbserialXXXX`
   entry from the WCH (manufacturer) driver. Only the `wchusbserial` one reliably
   toggles DTR the way the mCore's auto-reset circuit needs; the generic one commonly
   fails with an `avrdude`/`stk500_getsync` "not in sync" error even though it looks
   like a valid port. If upload fails with a sync error, try the other entry with the
   same trailing digits before anything else.
3. Open `mbotvr-player.ino`, **Upload**.

### arduino-cli

```bash
arduino-cli compile --fqbn arduino:avr:uno firmware/mbotvr-player
arduino-cli upload  --fqbn arduino:avr:uno -p /dev/tty.usbserial-XXXX firmware/mbotvr-player
```

### Confirming it took

- The robot **chirps twice** at boot (factory firmware chirps three times).
- In mBot VR (`?hardware=1`), connect: the status line shows the firmware as
  `mBot VR Player v1` and the **"Put this on my robot"** / **"Clear my robot's program"**
  controls become enabled.
- Sending `INFO` (`PlayerCommand.INFO`, once the app surfaces it) returns
  `MBVR player=1 idle=0 prog=0 plen=0 crc=0` on a fresh flash.

### Going back to plain mBlock use

Flashing this firmware **replaces** whatever was on the board. To use the robot with
mBlock again, restore Makeblock's factory firmware from mBlock 5
(Setting → Firmware Update → Factory Firmware → Update). Firmware state is per-robot;
a cart shared between mBlock lessons and mBot VR will need this managed deliberately.

---

## Product decisions on record

Confirmed with the maintainer (2026-09-03):

1. **Licensing — written from scratch, GPL-3.0-or-later.** This sketch is authored
   against the public mCore pin map and contains no Makeblock code, so the repository
   stays uniformly GPL-3.0-or-later with no GPLv2 island. Pin *numbers* are hardware
   facts taken from the published schematic, not copied source.

2. **Flashing access — student-reachable from the run bar** (a future STK500v1 flashing
   UI, not built in this slice). This **overrides** the plan's earlier teacher-only /
   help-drawer recommendation (`docs/hardware-bridge-plan.md` §7, §18 item 4). When that
   UI is built it should still: require an explicit confirm step, rate-limit re-flashes,
   keep the wink identity check, and never sit on the emergency-stop path.

Not in this slice: the STK500v1 flashing path (`src/device/flash/` does not exist yet),
a device-profile UI for non-default sensor ports, and Me 7-Segment display support.
