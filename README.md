# mBot VR

**A browser-based block programming and simulation environment for the Makeblock mBot.**

Students drag mBot-specific command blocks into a workspace, press **Run**, and
watch a virtual robot drive, sense and react in a simulated playground - with
every sensor value visible on screen while the program runs.

No installation, no accounts, no backend. Open the page and start programming.

**For students:** **<https://mbot-vr.vercel.app>** - no sign-in, just open the
link. Works best in a **current version of Chrome**, on a Chromebook or a
laptop. Each student's programs are saved **only in their own browser**
(nothing is uploaded anywhere) - see
[Student data and storage](#student-data-and-storage) below.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ mBot VR   Playground ▾   Project [ My mBot program ]   New Save Open  ?   │
├────────────────────────────────┬──────────────────────────┬───────────────┤
│ BLOCK PROGRAMMING   Blocks │ JS│ VIRTUAL PLAYGROUND       │ SENSOR MONITOR│
│ ┌────────┬───────────────────┐ │                          │ ULTRASONIC    │
│ │ Start  │  when program     │ │        ╲   │   ╱         │  17.4 cm      │
│ │ Motion │    starts         │ │         ╲  │  ╱          │               │
│ │ Sensing│  ┌──────────────┐ │ │          ╲ │ ╱           │ LEFT SENSOR   │
│ │ Looks  │  │ forever      │ │ │          [mBot]          │  ● ON LINE    │
│ │ Control│  │  if ◇ < 20   │ │ │                          │               │
│ │ Operat.│  │   turn right │ │ │      ▁▁▁▁▁▁▁▁▁▁▁         │ LEFT MOTOR    │
│ │ Vars   │  │  else        │ │ │                          │  140  fwd     │
│ │        │  │   forward    │ │ │                          │               │
│ └────────┴───────────────────┘ │                          │ CHALLENGE     │
├────────────────────────────────┴──────────────────────────┴───────────────┤
│ ▶ Run   ■ Stop   ↻ Reset   Ready   Distance Line Grid Highlight  Speed 1x │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (usually <http://localhost:5173>).

```bash
npm run test
```

```bash
npm run build
```

`npm run build` type-checks the whole project and emits a completely static site
into `dist/`, which can be served from any web server, a subfolder, or even a USB
stick - the build uses relative asset paths.

Requires Node.js 20.19+ (Vite 7). Tested on Node 22.

To try the production build locally before shipping it (catches anything
`vite dev`'s dev-server behaviour might hide):

```bash
npm run build
npm run preview
```

`preview` serves the same static `dist/` output a real deployment serves, on
<http://localhost:4173>.

---

## Deployment

mBot VR is a fully static site - no server, no environment variables, no
secrets. It is deployed on **Vercel**, built straight from this repository.

| | |
| --- | --- |
| **Student URL** | <https://mbot-vr.vercel.app> |
| **Vercel project** | `tatiang/mbot-vr` ([dashboard](https://vercel.com/tatiang/mbot-vr)) |
| **GitHub repo** | [`tatiang/mbot-vr`](https://github.com/tatiang/mbot-vr) (public) |
| **Framework preset** | Vite (auto-detected: build `npm run build`, output `dist/`) |
| **Auto-deploy** | Enabled - every push to `main` redeploys `https://mbot-vr.vercel.app` automatically |
| **Deployment protection** | Off - the production URL is open to anyone, no Vercel login required |

**To ship a change:** commit and push to `main`. Vercel builds and redeploys
within a minute or two; no manual step needed.

**To deploy without waiting on a push** (e.g. testing from a branch), with the
[Vercel CLI](https://vercel.com/docs/cli) installed and run once from the repo
root to link it (`npx vercel link`, already done on this machine):

```bash
npx vercel --prod
```

**To roll back**, use the Vercel dashboard's Deployments tab and "Promote to
Production" on any earlier build - every deployment is kept, not just the
current one.

**If the GitHub connection is ever lost or moved to a new machine/account**,
reconnect it from the project's Git settings
(<https://vercel.com/tatiang/mbot-vr/settings/git>) or run
`npx vercel git connect` after logging in with `npx vercel login` - this needs
a one-time authorization of the Vercel GitHub App on `tatiang/mbot-vr`, done
once in a browser, not something the CLI can do unattended.

### Student data and storage

No backend exists to send student work to. Everything a student builds -
block programs, saved projects, autosave - lives in **`localStorage` in their
own browser**, scoped to `mbot-vr.vercel.app`. Consequences worth knowing:

- Nothing a student writes is visible to the teacher, to Vercel, or to
  anyone else unless the student explicitly exports/shares the file.
- A student's work does not follow them to a different computer or browser
  profile - if they might switch machines, have them **Export** (or **Save**,
  in Chrome/Edge) their project to a file first.
- Clearing browser data, using a private/incognito window, or a Chromebook
  policy that wipes local storage on logout will erase unsaved local work.
  This is a real risk on managed school Chromebooks - export anything that
  matters.
- The app adds no analytics, trackers, ads, or third-party services of any
  kind - see [Known limitations](#known-limitations) and the network
  requests a browser dev tools panel shows for confirmation.

---

## Why this exists

Programming a physical mBot in upload mode has one big teaching problem: you
cannot see what the robot sees. A student writes `if ultrasonic distance < 20`,
the robot does something unexpected, and there is no way to find out what the
sensor was actually reading at that moment.

mBot VR is built around fixing exactly that. The sensor monitor updates live
while the program runs, the ultrasonic cone and line-sensor states are drawn on
the playground, and the currently executing block is highlighted. The loop the
whole app is designed for is:

> **build blocks → press Run → observe → inspect sensor values → revise → retry**

The simulated robot is deliberately faithful to the real one where it matters -
the motor range, the line-follower value table, the "0 means nothing in range"
ultrasonic convention - so the logic a student works out here transfers to
hardware.

---

## Features

### Programming

- **Blockly workspace** with mBot-specific blocks in seven categories: Start,
  Motion, Sensing, Looks, Control, Operators and Variables. The Motion and
  Sensing vocabulary is drawn directly from mBlock's own Action and Sensing
  blocks - same wording, same 0-100% power units - so a program built here
  reads the same as one built for the physical robot in mBlock (see
  [Matching mBlock](#matching-mblock) below for exactly what does and does
  not carry over).
- **Motion** - two families. Timed blocks
  (`move forward at power [X]% for [n] seconds`, and the backward / left /
  right equivalents) drive for a set time and stop themselves, which is what
  a sequence wants. `[move forward ▾] at power [X]%` sets the motors for
  whichever direction its dropdown says and leaves them running, which is
  what a control loop wants. Plus
  `left wheel turns at power [X]%, right wheel at power [Y]%` for independent
  wheel control, from -100% to 100%. Power is scaled to the simulator's
  internal -255..255 motor range at the point each block generates code.
- **Sensing** - `ultrasonic sensor distance (cm)`, `line follower sensor
  value`, and the friendlier Boolean blocks `left line sensor on line?` /
  `right line sensor on line?`. Also
  `line follower sensor detects [leftside/rightside] being [black/white]?`,
  mirroring mBlock's own parameterized block; `is something closer than [ ]
  cm?`, a convenience reporter that bakes in the "0 means nothing in range"
  check; and `timer` / `reset timer`. An Advanced section adds robot x, y and
  heading reporters that have no mBlock equivalent - a real mBot cannot sense
  its own position without extra hardware.
- **Looks** - named and RGB LED blocks, plus `display number` on a four-digit
  seven-segment display.
- **Control** - `wait`, `repeat`, `forever`, `if`, `if / else` (with else-if),
  `repeat until`, `wait until`.
- **Operators and Variables** - comparisons, and/or/not, arithmetic, random,
  and standard Blockly variables.
- **Eight worked examples** loadable from the Open panel, each targeting the
  playground it was written for - including a "Clumsy Line Follower" (a rough,
  single-sensor first attempt that weaves down the track) next to the steady,
  two-sensor version, so students can see what improving on a first draft
  actually looks like.
- **Read-only JavaScript view** showing what the blocks generate - a bridge for
  older students.
- Undo / redo with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`, plus toolbar buttons.

### Matching mBlock

The Motion and Sensing block wording was checked directly against mBlock's own
Action and Sensing palettes and adjusted to match, so a program built here
reads like one built for the physical robot. What that means concretely:

- **Power is 0-100%, not a raw register value.** mBlock's motor blocks show a
  percentage; the simulator's own physics still run on the real mBot's
  -255..255 motor scale internally, so the block generators scale at the
  boundary (`generators.ts`) rather than changing the physics.
- **One continuous motion block with a direction dropdown**
  (`[move forward ▾] at power [X]%`), matching mBlock's single block instead
  of a separate block per direction.
- **The line-follower "detects ... being ..." block** is reproduced with its
  side and colour dropdowns; the port dropdown mBlock shows is dropped, since
  the simulated mBot has exactly one line-follower module wired in a fixed
  place rather than several numbered ports to choose between. The same
  simplification drops the port dropdown from the ultrasonic and line-value
  reporters.
- **`reset timer`** is included alongside `timer`.
- **Not implemented, on purpose:** the light sensor, the on-board button, and
  IR remote / IR messaging. The light sensor and button have no simulated
  hardware behind them yet; IR messaging would need genuinely parallel
  program execution (an "IR message received" listener running alongside the
  main script), which the current single-thread-only runtime does not
  support - see [Known limitations](#known-limitations).
- **mBot VR-only additions with no mBlock equivalent:** `robot x/y/heading`
  (a real mBot cannot sense its own position without extra hardware) and
  `is something closer than ___ cm?` (a convenience wrapper around the
  ultrasonic reading and its "0 means nothing in range" check).

### Simulation

- Differential-drive physics with independent wheel velocities, integrated in
  closed form so curves are exact at any simulation speed.
- Collision with arena walls, rectangular obstacles and other robots, resolved
  by sliding rather than stopping dead.
- **Ultrasonic sensor** simulated as a 30-degree fan of rays with a 400 cm
  range, reporting `0` for "nothing in range".
- **Two line sensors** on the underside, reporting the real mBot's `0..3`
  value table.
- **Onboard RGB LEDs** and a four-digit numeric display.
- Simulation speeds of 0.5x, 1x, 2x and 4x that scale motion and `wait` blocks
  together.
- **Parked practice opponent.** An **Opponent** toggle above the playground
  (every arena except the Battle Bot Arena, which already has a moving one)
  places a second mBot. It never drives itself, but it is a real body: sensed
  by the ultrasonic sensor, solid to drive into, and shoveable given enough
  weight and throttle. It has its own start pose, set the same way as the
  player's.
- **Editable start poses.** While stopped, drag either robot to move it, or
  drag its round handle to turn it. That sets the pose **Reset** returns it
  to, and it is saved with the project. A dashed ghost shows where Reset will
  put a robot once it has driven away.
- **Mass and pushing contests.** Both robots have an adjustable weight,
  starting at roughly **0.9 kg** for a standard mBot build. Push force is
  capped by tyre grip, so a heavier robot shoves harder *and* resists harder -
  you can move something up to about 1.5x your own weight, and only under
  enough throttle. Weight deliberately does not change driving speed; the
  drive model is speed-controlled, like a real geared robot at these speeds.
- **Separate sensor overlays.** The distance-sensor drawing (cone, hit point,
  measured value) and the line-sensor drawing toggle independently from the
  toolbar.
- **Objects are real obstacles, not decoration.** A box added anywhere - a
  built-in playground, a Free Build course, or the obstacle-field starting
  layout - is picked up by both the collision system and the ultrasonic
  sensor the same way a wall is; there is no special-cased "scenery."

### Playgrounds

| Playground | Practises |
| --- | --- |
| **Grid World** | Sequencing, turns, repeat loops. 20 cm grid to measure against. |
| **Obstacle Course** | Ultrasonic sensing, if/else, avoidance loops. |
| **Line Follower** | Line sensors and feedback control. A closed loop with gentle and sharp corners. |
| **Maze** | Ultrasonic navigation, dead ends, wall following. |
| **Free Build** | Build your own course: walls, boxes, tape, start position - or start from one of two preset layouts (an obstacle field, a line loop) and keep editing. |
| **Battle Bot Arena** | *Experimental.* A second, scripted robot that chases you. |

Each playground carries one or more **challenges** with a goal, hints and live
progress.

### Classroom usability

- **Stop always works.** Student programs run in a Web Worker and are killed
  with `terminate()`; an accidental `forever` loop cannot freeze the page. Stop
  also stays available after a program ends, to cut motors it left running.
- **Motors latch, like the real robot.** A program that finishes without a
  `stop moving` block leaves the robot driving; the status line says so and the
  app explains how to fix it. This is deliberate - it is how a physical mBot
  behaves, and it is why every mBot lesson ends with `stop moving`.
- **Reset** returns the robot to its start pose and clears motors, LEDs,
  display and the run timer.
- **Drag-to-reposition** for either robot while stopped, which is also how
  each robot's start pose is set (see Editable start poses, above).
- **Autosave** to the browser, so a refresh does not destroy work, plus a
  warning before leaving with unsaved changes. If an autosave was written by
  an older version of the app and its blocks can no longer be loaded, that is
  caught and reported rather than left to break the page - see
  [Known limitations](#known-limitations).
- **Save and Save As write a real file to disk** in Chrome and Edge, via the
  File System Access API - a genuine operating-system save dialog, not
  anything drawn by the page. Save reuses the same file on later saves, the
  way a native app's Save does; Save As always asks for a new location.
  Safari and Firefox do not support this API, so there Save falls back to a
  normal browser download. Either way, projects also keep saving to this
  browser and export/import as JSON, so Open and "restore my last program"
  work exactly as before. No accounts.
- Friendly error messages instead of stack traces (details still go to the
  console).
- No modal dialogs - all feedback is non-blocking toasts.
- **A top-level error boundary** as a last resort: if something unexpected
  still slips through, the page shows a plain-language explanation and a
  recovery button instead of going blank.

### Accessibility

- Every control is keyboard reachable, with visible focus rings.
- Sensor state is conveyed by **word, shape and colour** - never colour alone.
- ARIA labels on icon-only buttons; the pane divider is a real
  `role="separator"` that responds to arrow keys.
- `prefers-reduced-motion` is respected.
- Body text is 15 px and up; controls have generous hit targets.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Enter` | Run |
| `Esc` | Stop |
| `Ctrl/Cmd + S` | Save project |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |

---

## Architecture

```
src/
  App.tsx                  application shell, run/stop/reset, project state
  main.tsx                 entry point

  blocks/                  everything Blockly
    defineBlocks.ts        custom mBot block definitions
    generators.ts          block -> async JavaScript
    compile.ts             workspace -> runnable program
    toolbox.ts             the block palette
    starters.ts            the worked examples
    colors.ts              category colours

  runtime/                 safe execution of student programs
    protocol.ts            typed messages between page and worker
    worker.ts              runs the generated program off the main thread
    ProgramRunner.ts       owns the worker's lifetime
    RobotRuntimeBridge.ts  the MbotRuntime interface + engine binding

  simulation/              the world (no React, no DOM apart from the canvas)
    SimulationEngine.ts    the animation loop, clock and time gating
    Robot.ts               pose, actuators, cached sensor readings
    DifferentialDrive.ts   closed-form drive kinematics
    Collision.ts           circle vs. arena, obstacles and robots
    UltrasonicSensor.ts    ray-fan distance sensing
    LineSensor.ts          line detection and the mBot value encoding
    SevenSegment.ts        four-digit display formatting
    Renderer.ts            Canvas 2D drawing and sensor overlays
    RobotPhysics.ts        mass, push/hold forces, robot-vs-robot contact
    constants.ts           chassis and sensor dimensions
    opponentPlacement.ts   picks a clear spot for the practice opponent

  playgrounds/             arena definitions (pure data + a maze generator)
    freeBuildLayouts.ts    preset starting layouts for Free Build
  challenges/              challenge rules and the run statistics tracker
  storage/                 project save/load/import/export, native file saving
  components/              React UI
  hooks/                   engine sampling
  utils/                   units, geometry, ids
  types/                   shared domain types
```

### How a program runs

```
   Blockly workspace
        │  compileWorkspace()
        ▼
   async JavaScript source
        │  postMessage
        ▼
   Web Worker  ──── await robot.setMotors(...) ────┐
        ▲                                          │
        │  reply                                   ▼
        └──────────────  ProgramRunner  ──── MbotRuntime ──── SimulationEngine
                                                                    │
                                                                    ▼
                                                          Renderer / telemetry
```

Every robot command in the generated code is `await`ed, so the program spends
almost all of its life suspended on a promise rather than occupying a thread.
Three consequences follow, and they are the reason for the design:

1. **Stop is instant.** There is no cooperative shutdown to negotiate. The
   worker is terminated outright, so it works even mid-infinite-loop.
2. **The UI never freezes.** A runaway loop burns worker time, not main-thread
   time, and the engine rate-limits how many robot calls it will service per
   frame.
3. **The simulation stays honest.** See below.

### Time gating

A running program only lets simulated time advance while it is *blocked on
time* - inside a `wait`, or inside the one-per-iteration `yield` the generators
insert at the top of every unbounded loop. Everything else a program does
(setting motors, reading a sensor, evaluating a condition) is effectively
instantaneous on real hardware, but takes real milliseconds of message passing
here.

Without this gate, the robot keeps turning during the round trip between "your
wait is over" and "here are the new motor values", and the classic *drive a
square* exercise never closes its square. With it, `turn right at 130` for
`0.45` seconds produces exactly 91.4 degrees - the number the kinematics
predict - so a student tuning the wait time sees the arithmetic they expect.

### Rendering and performance

The simulation owns a single `requestAnimationFrame` loop. The renderer draws
straight from engine state on every frame; React never re-renders at frame
rate. Components that show live values subscribe through `useEngineSample`,
which samples at 10 Hz - continuous to the eye, and cheap enough to leave the
Blockly workspace responsive.

### Coordinates and units

The world is in **centimetres**, origin top-left, `x` right and `y` down.
Headings are radians clockwise from `+x` internally, and are converted to
friendly compass degrees (0 = up) for display. Students never see a pixel;
`src/utils/units.ts` is the only bridge between world units and the screen.

---

## Testing

```bash
npm run test
```

The suite covers the logic that would be expensive to get wrong:

- line-follower value mapping and sensor geometry
- motor clamping and unit conversions
- differential-drive direction, pivots, curves and integration accuracy
- ray/rectangle intersection and ultrasonic behaviour including the range limit
- collision detection, push-out and inside-corner convergence
- seven-segment display formatting
- project serialization, import validation and storage
- engine timing: waits against simulated time, speed scaling, stop and reset
- program runner lifetime: worker termination, re-running, no replies to a
  terminated worker
- block compilation: every starter program parses, all robot calls are awaited,
  loop traps are present
- playground validation: start poses in free space, unique ids, and a flood
  fill proving the maze finish is actually reachable at the robot's radius
- the parked practice opponent: placement never lands inside an obstacle, it
  is sensed and collided with like any obstacle, it returns to its start pose
  on Reset, and it keeps its configured mass across one
- push physics: force scales with throttle and is capped by both motor output
  and tyre grip; an equal-weight opponent gives way at full power but not at
  low power; a much heavier one holds firm until the player is loaded up too;
  a lighter opponent slides further than a heavy one; neither robot is ever
  pushed through a wall or into the other's chassis; and mass provably does
  not change open-floor driving distance
- "cube" (box) obstacles specifically: sensed by the ultrasonic sensor,
  block the robot, and stop blocking it once removed - run against the real
  engine, not just the geometry helpers underneath it
- Free Build's preset layouts: each keeps the start position clear and the
  arena editable, and the line-loop layout is a genuine closed course
- native file saving: reuses an existing file handle rather than re-prompting,
  suggests a sanitised filename on first save, tells a cancelled dialog apart
  from a genuine write failure, and never throws when the File System Access
  API is unavailable
- the two line-follower examples run against a real engine (compiled code,
  no Worker) for enough simulated time to complete a lap, confirming the
  clumsy one actually finishes the course - just more slowly than the
  steady one

---

## Known limitations

- **Saved projects are not guaranteed to survive a block-set change across
  versions.** If the app's blocks change between releases (a field renamed, a
  block removed) an old project's blocks may fail to load. That failure is
  caught - the project's playground, name and settings still load, the
  student sees a plain-language toast instead of a blank page, and a broken
  autosave is cleared so it cannot keep failing on every refresh - but the
  old blocks themselves are lost, not migrated. There is no version-to-version
  block migration system.
- **Timing will not transfer exactly to hardware.** Real wheels slip, batteries
  sag, and floors differ. Sensor logic transfers; wait times need retuning.
- **One program thread.** Only the stack under `when program starts` runs;
  blocks left elsewhere on the workspace are ignored (deliberately).
- **The Battle Bot arena is experimental.** The opponent follows a fixed
  behaviour, there is no scoring, and pushing physics is approximate.
- **No sound.** The real mBot's buzzer is not simulated, matching the original
  V-REP project's limitation.
- **No LED matrix, servo, or the other Makeblock add-on modules** - only the
  devices the original simulation supported.
- **Free Build is simple by design**: rectangles, freehand tape, an eraser and
  a start marker. Shapes cannot be moved or resized after being drawn, only
  erased.
- **The simulation pauses in a background tab**, because it is driven by
  `requestAnimationFrame`.
- Ultrasonic sensing is a 2D ray fan; it does not model beam spreading, soft
  surfaces, or the glancing-angle reflections that fool real sonar.
- **Only one practice opponent at a time**, and it never drives itself; it is
  a separate feature from the Battle Bot Arena's own moving opponent, and the
  two do not combine.
- **Pushing physics is a force comparison, not a rigid-body simulation.**
  There is no momentum, spin-out or friction against the floor while sliding:
  a robot moves only while something is actively pressing on it. Weight
  affects contests, not acceleration.
- **Only one `when program starts` block runs.** Extra ones are ignored (with
  a warning) rather than running as parallel threads.

---

## Physical mBot connection (experimental)

Experimental work toward driving a **real** mBot v1.x from this app over USB is
available by default in Chrome and Edge. The classroom simulator path above is still
separate from it, and an explicit opt-out keeps the device code from being downloaded.

- **Turn it off:** open the app with `?hardware=0` in the URL, or run
  `localStorage.setItem('mbotvr.hardware.enabled', '0')`.
- **Turn it back on:** open the app with `?hardware=1`, or remove the
  `mbotvr.hardware.enabled` localStorage key.
- **Connecting:** a cable. Uploading code to the robot always needs the cable anyway.
- **What works today:** connecting over USB, identifying a robot with a "wink"
  confirmation so you don't send to the wrong one, a stop button whose ladder only ever
  claims "stopped" once the robot has actually confirmed it, running the current blocks
  live on a physical robot, driving both wheels, setting the onboard LEDs, and a
  diagnostic log for troubleshooting.
- **What doesn't exist yet:** an Arduino-export fallback for Safari/Firefox, and
  real-hardware validation of sensor reads and Tier 2 Player firmware.
- **Bluetooth (both the classic RFCOMM option and the newer Web Bluetooth LE bridge) is
  built but hidden by default** as of 2026-09-04 - real classroom testing hit a
  Bluetooth connection that a managed school Chrome profile never resolved cleanly (see
  `docs/bluetooth-le-bridge.md`'s real-hardware findings), and it was hidden rather than
  removed since the code may simply need a different Chrome policy configuration, or
  work on a different fleet. Bring it back for testing with `?wireless=1` in the URL
  (persists the same way `?hardware=1` does; `?wireless=0` hides it again).
- **Firmware updates:** mBot VR cannot flash firmware from the web app yet. If a robot
  does not answer because it was last used with mBlock Upload mode, restore Makeblock's
  factory firmware in mBlock 5: Setting -> Firmware Update -> Factory Firmware ->
  Update.

Full design rationale, the safety reasoning behind the stop mechanism, and exactly
what remains open: [`docs/hardware-bridge-plan.md`](./docs/hardware-bridge-plan.md).
The Bluetooth LE bridge specifically - architecture, UUID sourcing, and its bench-test
checklist: [`docs/bluetooth-le-bridge.md`](./docs/bluetooth-le-bridge.md).

---

## Roadmap

- Multiple event hats and parallel scripts
- Editable JavaScript, and a Python view
- Battle Bot arena: a second block workspace, wedges, ring-out scoring
- Recording and replaying a run for classroom review
- Shareable project links and a teacher-assignable challenge set
- Selecting, moving and resizing objects in Free Build
- A moving (not just parked) practice opponent outside the Battle Bot Arena
- Parallel scripts, so more than one `when program starts` stack can run
- Optional gyro and light-sensor blocks

---

## Licence and attribution

mBot VR is licensed under the **GNU General Public License v3.0 or later** -
see [`LICENSE`](./LICENSE).

It is a browser reimplementation inspired by:

```
Original mBot V-REP simulation
Nenad Stajić
https://github.com/NenadZG/mBot-simulation
```

No code or assets from that project are redistributed here; what was preserved
is its observable behaviour, so programs mean the same thing in both. The full
attribution, including exactly what was and was not carried across, and the
licences of all third-party dependencies, is in [`NOTICE.md`](./NOTICE.md).

> **mBot VR is an independent educational simulator and is not an official
> Makeblock product.** "mBot", "Makeblock" and "mBlock" are trademarks of
> Makeblock Co., Ltd., used here only to identify the robot being modelled.
