# mBot VR Player firmware

A small custom firmware for the Makeblock mBot v1.x (mCore board, ATmega328P) that lets
mBot VR store a compiled program on the robot and run it **untethered**, adds a
**host-heartbeat watchdog** for tethered safety, and keeps full backward compatibility
with mBot VR's Tier-1 tethered live control.

- **The sketch:** [`mbotvr-player.ino`](./mbotvr-player.ino)
- **The contract it implements:** [`../../docs/player-protocol.md`](../../docs/player-protocol.md)
- **Why it exists / where it fits:** [`../../docs/hardware-bridge-plan.md`](../../docs/hardware-bridge-plan.md) §6 "Tier 2 — Player firmware"

---

## ⚠️ UNVERIFIED — not yet tested on a real mBot

Nothing in this firmware has run on physical hardware. Transcribed from public
references and **must be bench-checked before any classroom use**:

| Thing | Risk if wrong | How to check |
| --- | --- | --- |
| mCore pin map (motor PWM/DIR, buzzer, RGB, RJ25 port pins) | Robot does nothing, or the wrong thing | Cross-check against the mCore schematic and a known-good mBlock-generated sketch; drive one actuator at a time |
| Motor DIR polarity | Wheels spin backwards | "move forward" block on a Player-flashed robot; compare to the tethered path (already fixed there) |
| WS2812 bit-bang timing (`ws2812Show`) | LEDs wrong colour / flicker / dark | Scope the D13 waveform; set a solid colour and eyeball |
| Ultrasonic pulse + `pulseIn` timing | Distance always 0 or nonsense | Hold a hand at 10/20/40 cm, read `INFO` / a live GET |
| Line sensor active level (`INPUT_PULLUP`, LOW = on line) | `left/right on line?` inverted | Put the robot on and off dark tape |
| Boot auto-reset window | First probe after flashing may miss | The app already waits 2 s post-open; confirm that's enough |
| Watchdog 500 ms cable-pull halt (plan U1-adjacent) | A robot keeps driving after a cable pull | Drive tethered, yank the USB cable, film at 60 fps |

Record findings in `docs/hardware-bridge-plan.md`'s "Implementation status" section, in
the same per-round format used for the Tier-1 rounds.

---

## Building and flashing

No external libraries. Standard AVR core only (`Arduino.h`, `EEPROM.h`, `avr/interrupt.h`).

### Arduino IDE

1. Board: **Arduino Uno** (Tools → Board). The mCore is Uno-compatible (ATmega328P, 16 MHz).
2. Port: the robot's CH340 serial port (USB only — mBot v1 cannot be flashed over Bluetooth).
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
