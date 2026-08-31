# NOTICE

## mBot VR

Copyright (C) 2026 the mBot VR contributors.

mBot VR is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License version 3**, or (at your option) any
later version. See [`LICENSE`](./LICENSE) for the full text.

---

## Attribution

mBot VR is a browser reimplementation inspired by:

```
Original mBot V-REP simulation
Nenad Stajić
https://github.com/NenadZG/mBot-simulation
Licensed GPL-3.0
```

### What was carried across

No source code from the original project is included here. The original is Lua
running inside V-REP / CoppeliaSim; mBot VR is TypeScript running in a browser,
and every line of it was written from scratch.

What *was* studied and deliberately preserved is the original's **observable
behaviour**, so that programs reason about the robot the same way in both:

- **Line follower encoding.** `Scripts/mBot.lua` computes the sensor value as
  `leftOffLine * 2 + rightOffLine`, giving `0` = both sensors over the line,
  `1` = left over / right off, `2` = left off / right over, `3` = both off.
  mBot VR reproduces this exactly - see `src/simulation/LineSensor.ts`.
- **Ultrasonic "no detection" convention.** The original's
  `ReadUltrasonicSensor` returns `0` when the proximity sensor reports no hit.
  mBot VR does the same, and the help text teaches students to guard for it -
  see `src/simulation/UltrasonicSensor.ts`.
- **Seven-segment display behaviour.** `Scripts/Seven segment display.lua`
  drives a four-digit display, spends one digit position on a minus sign, and
  shows four dashes when a value will not fit. mBot VR mirrors those rules -
  see `src/simulation/SevenSegment.ts`.
- **Independent left/right motor control** over the mBot's native `-255..255`
  range, and the set of simulated devices the original supports (two motors,
  ultrasonic sensor, two line-follower sensors, onboard RGB LEDs, numeric
  display).

Because mBot VR is a derivative work in the spirit the original author intended,
it is released under the same licence.

### What was not carried across

- No files from the original repository are redistributed here, including
  `mBot.ttm`, the `V-REP scenes/` and the `mBlock projects/` directories.
- No V-REP / CoppeliaSim code, models or assets.
- No Makeblock artwork, branding, firmware or other proprietary assets. The
  robot drawn in the simulator is original stylised vector art, drawn with the
  Canvas 2D API in `src/simulation/Renderer.ts`.

---

## Trademarks and endorsement

**mBot VR is an independent educational simulator and is not an official
Makeblock product.**

"mBot", "Makeblock" and "mBlock" are trademarks of Makeblock Co., Ltd. They are
used here only to describe which physical robot this simulator models. Makeblock
has not endorsed, sponsored or reviewed this project. Likewise, "VEXcode VR" is
a trademark of Innovation First, Inc. and is referred to only as a point of
comparison; no VEX code, artwork or branding is used.

---

## Third-party dependencies

| Project | Licence | Used for |
| --- | --- | --- |
| [Blockly](https://github.com/google/blockly) | Apache-2.0 | The visual block editor and JavaScript code generation |
| [React](https://github.com/facebook/react) | MIT | User interface |
| [Vite](https://github.com/vitejs/vite) | MIT | Development server and production build |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT | Test runner |

Blockly's media assets (trash can, zoom controls, dropdown arrow and friends)
are redistributed in [`public/blockly-media/`](./public/blockly-media/) so the
application works with no network connection. They are covered by Blockly's
Apache-2.0 licence, which is compatible with GPL-3.0.

No icon fonts, web fonts or remote assets are loaded at runtime: mBot VR is
fully self-contained and works offline once served.
