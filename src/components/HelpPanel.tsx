/**
 * Help drawer: a short first-use walkthrough plus a block reference written in
 * classroom language rather than API language.
 */
export function HelpPanel() {
  return (
    <div className="prose">
      <h3>Getting started</h3>
      <ol>
        <li>
          Open the <strong>Motion</strong> category and drag{' '}
          <code>move forward at power 50% for 1 seconds</code> under the{' '}
          <code>when program starts</code> block until it clicks into place.
        </li>
        <li>
          Press <strong>Run</strong> and watch the mBot drive.
        </li>
        <li>
          Press <strong>Reset</strong> to put the robot back at the start, change a number, and run
          it again.
        </li>
        <li>
          Add a <code>turn right at power 50% for 0.5 seconds</code> block underneath, and run it
          again.
        </li>
      </ol>
      <p>
        If a block will not connect, drag it until the notch lines up and you see it snap. The{' '}
        <strong>JavaScript</strong> tab always shows exactly what will run, which is a quick way to
        check a block really is attached.
      </p>
      <p>
        Nothing you can build here will break the robot. Try a number, watch what happens, and
        change it.
      </p>

      <h3>Two kinds of motion block</h3>
      <p>
        The Motion category has two groups, and the difference matters.
      </p>
      <p>
        <strong>"for ... seconds" blocks</strong> - like{' '}
        <code>move forward at power 50% for 2 seconds</code> - drive for that long and then stop on
        their own. Use these when you are writing a list of steps: drive here, turn, drive there.
      </p>
      <p>
        <strong>The "keep going" block</strong> - <code>move forward ▾ at power 50%</code>, with a
        dropdown for the direction - sets the motors and leaves them running until something else
        changes them. That is exactly how a real mBot behaves. Use this inside a <code>forever</code>{' '}
        loop, where you are steering continuously and never want the robot to pause.
      </p>
      <p>
        A program that is only <code>move forward ▾ at power 50%</code> with nothing after it will
        drive until it hits a wall, and the toolbar will say{' '}
        <em>Finished - motors still running</em>. That is not a bug - you just have not told it
        when to stop. Either use the <code>for ... seconds</code> version, or spell it out:
      </p>
      <ul>
        <li>
          <code>move forward ▾ at power 50%</code>
        </li>
        <li>
          <code>wait 2 seconds</code> - the motors keep running while you wait
        </li>
        <li>
          <code>stop moving</code>
        </li>
      </ul>
      <p>
        You can always press <strong>Stop</strong> to cut the motors, or <strong>Reset</strong> to
        send the robot back to the start.
      </p>

      <h3>The sensors</h3>
      <p>
        <strong>Ultrasonic sensor.</strong> The two round "eyes" on the front measure how far away
        an object is, in centimetres. A smaller number means the object is closer.{' '}
        <strong>0 means the sensor is not detecting anything in range</strong> - so a test like
        "distance &lt; 20" is true when nothing is there, which is why some examples also check
        "distance &gt; 0". The <code>is something closer than ___ cm?</code> block already does
        that check for you, so it is usually the easier choice.
      </p>
      <p>
        The sensor works on anything solid in front of it - walls, boxes, and other robots too, so
        it will see a practice <strong>opponent</strong> the same way it sees a wall.
      </p>
      <p>
        Use the <strong>Distance</strong> and <strong>Line</strong> buttons in the toolbar to show
        or hide each sensor's drawing on the playground. Distance draws the cone the sensor is
        listening through, what it hit, and the number it measured; Line draws the two floor
        sensors and whether each one can see the tape.
      </p>
      <p>
        <strong>Line sensors.</strong> Two sensors point down at the floor just in front of the
        wheels. Each one answers a yes/no question: can I see the black line? Use{' '}
        <code>left line sensor on line?</code> and <code>right line sensor on line?</code> in an if
        block - the easiest way to ask.
      </p>
      <p>
        <code>line follower sensor detects leftside/rightside being black/white?</code> asks the same
        question the mBlock way, with dropdowns instead of two separate blocks. mBot VR's course is
        always dark tape on a light floor, so "black" means on the tape and "white" means off it -
        the two forms always agree, just phrased differently.
      </p>
      <p>
        The <code>line follower sensor value</code> block reports the same number a real mBot does:
      </p>
      <ul>
        <li>
          <code>0</code> - both sensors are on the line
        </li>
        <li>
          <code>1</code> - only the left sensor is on the line
        </li>
        <li>
          <code>2</code> - only the right sensor is on the line
        </li>
        <li>
          <code>3</code> - both sensors are off the line
        </li>
      </ul>

      <h3>The motors</h3>
      <p>
        Each wheel has its own motor, shown on the blocks as a <strong>power</strong> percentage -
        the same unit mBlock uses for a real mBot. Power runs from <code>0%</code> (stopped) to{' '}
        <code>100%</code> (full strength); the independent-wheel block also accepts negative power,
        down to <code>-100%</code>, to reverse just one wheel.
      </p>
      <ul>
        <li>
          Same power on both wheels (<code>55% / 55%</code>) drives straight.
        </li>
        <li>
          Different power (<code>28% / 60%</code>) drives a curve, turning towards the slower wheel.
        </li>
        <li>
          Opposite power (<code>55% / -55%</code>) spins on the spot.
        </li>
      </ul>

      <h3>Block reference</h3>
      <p>
        <strong>Motion.</strong> The <code>for ... seconds</code> blocks drive for a set time and
        stop themselves. <code>move forward ▾ at power</code> sets both motors for whichever
        direction the dropdown says and keeps going.{' '}
        <code>left wheel turns at power / right wheel at power</code> gives you each wheel
        separately, which is what you need for line following. <code>stop moving</code> sets both to
        0.
      </p>
      <p>
        To turn a different amount, change the <em>time</em>, not the power. At power 50%, about{' '}
        <code>0.45</code> seconds is a quarter turn - so <code>0.9</code> is a half turn. Try it and
        watch the <strong>heading</strong> in the sensor monitor.
      </p>
      <p>
        <strong>Control.</strong> <code>wait</code> pauses without changing the motors, so the robot
        keeps doing what you last told it. <code>repeat</code> runs blocks a set number of times.{' '}
        <code>forever</code> runs until you press Stop. <code>if</code> and <code>if / else</code>{' '}
        choose between actions based on a sensor.
      </p>
      <p>
        <strong>Looks.</strong> <code>set LEDs</code> lights the two RGB LEDs on the board.{' '}
        <code>display number</code> shows a value on the four-digit display - handy for watching a
        variable change while the robot drives.
      </p>
      <p>
        <strong>Sensing.</strong> <code>timer</code> reports seconds since Run was pressed.{' '}
        <code>reset timer</code> sets it back to 0 mid-program, without moving the robot or changing
        the motors - useful for timing one part of a longer program on its own.
      </p>

      <h3>Setting where the robot starts</h3>
      <p>
        While your program is <em>not</em> running, drag the robot to move it, or drag the round
        handle in front of it to turn it. Whatever you set becomes its{' '}
        <strong>start pose</strong> - the place and direction <strong>Reset</strong> returns it to,
        and where it begins next time you press Run.
      </p>
      <p>
        Once the robot has driven away from its start, a faint dashed outline shows where Reset
        will put it back. <strong>Robot setup</strong> has a{' '}
        <em>Restore default start positions</em> button if you want the playground's original
        layout back.
      </p>

      <h3>Practising with an opponent</h3>
      <p>
        Turn on <strong>Opponent</strong> above the playground to place a second mBot in the arena
        (not available on the Battle Bot Arena, which already has one that moves). Your ultrasonic
        sensor sees it just like a wall, and driving into it stops you the same way a box would.
      </p>
      <p>
        It has its own start pose: drag it, or drag its handle to turn it, exactly like your own
        robot. Reset puts it back there too, so you can set up the same practice scenario over and
        over.
      </p>

      <h3>Weight and pushing</h3>
      <p>
        Both robots have a <strong>weight</strong> you can change in{' '}
        <strong>Robot setup</strong>. A standard mBot build is about{' '}
        <code>0.9 kg</code>, which is where both start.
      </p>
      <p>
        Weight decides who wins when two robots meet. Heavier tyres press down harder, so a heavier
        robot can <strong>push harder</strong> and is also <strong>harder to push</strong>. Roughly:
        you can shove something up to about one and a half times your own weight - and only if you
        are driving hard enough. Creep into an equal-weight robot at low power and you will simply
        stall against it.
      </p>
      <p>
        Weight does <em>not</em> change how fast a robot drives. The motors hold whatever speed you
        ask for, the same way a real geared robot does at these speeds, so a heavy mBot covers the
        same ground in the same time - it just wins arguments.
      </p>

      <h3>Building your own playground</h3>
      <p>
        <strong>Free Build</strong> starts as an empty room. Use <code>Add wall</code>,{' '}
        <code>Add box</code> and <code>Draw line</code> to build a course, <code>Erase</code> to
        remove something, and <code>Set start</code> to move where the robot begins. The{' '}
        <strong>Layout</strong> menu loads a ready-made starting point - an obstacle field or a
        line loop - that you can then keep editing with the same tools.
      </p>

      <h3>Keyboard shortcuts</h3>
      <ul>
        <li>
          <code>Ctrl/Cmd + Z</code> - undo, <code>Ctrl/Cmd + Shift + Z</code> - redo
        </li>
        <li>
          <code>Ctrl/Cmd + S</code> - save the project
        </li>
        <li>
          <code>Ctrl/Cmd + Enter</code> - run, <code>Esc</code> - stop
        </li>
      </ul>

      <h3>Going to a real mBot</h3>
      <p>
        The block wording, the power percentage, the line follower values and the ultrasonic
        "0 means nothing in range" rule all match mBlock and the physical robot, so the logic you
        work out here transfers. What will not transfer exactly is timing: real wheels slip,
        batteries sag, and floors differ. Expect to retune your wait times on hardware.
      </p>
      <p>
        A few mBlock blocks have no real equivalent here yet, on purpose rather than by accident:
      </p>
      <ul>
        <li>
          The <strong>light sensor</strong> and <strong>on-board button</strong> - the simulated
          playgrounds have no light levels or a clickable button to report.
        </li>
        <li>
          <strong>IR remote and IR messaging</strong> - sending a message and reacting to it would
          need two programs running at once, which mBot VR does not support yet (see below).
        </li>
      </ul>
      <p>
        A handful of blocks run the other way: <code>robot x/y/heading position</code> and{' '}
        <code>is something closer than ___ cm?</code> exist only in mBot VR, as simulator-only
        conveniences with no mBlock counterpart - a real mBot has no way to know its own position
        without extra hardware.
      </p>
      <p>
        Also, only the first <code>when program starts</code> block in your workspace runs; extra
        ones are ignored. A real mBot (and mBlock) can run more than one script at a time - that is
        planned here too, but is not built yet.
      </p>
    </div>
  );
}
