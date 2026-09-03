/*
 * mBot VR Player firmware  --  v1  (bytecode format 1)
 * =====================================================
 *
 * A small "Player" firmware for the Makeblock mBot v1.x (mCore / ATmega328P) that is a
 * SUPERSET of the behaviour mBot VR's tethered Tier-1 control already relies on, plus:
 *
 *   1. a host-heartbeat watchdog that stops the motors if a tethered host goes silent
 *      mid-drive (a pulled cable);
 *   2. an EEPROM program slot holding a compact bytecode compiled in the browser
 *      (src/device/bytecode.ts), so a program can run with no computer attached;
 *   3. a one-byte boot-idle halt flag, so "clear the robot's program" is a ~30 ms
 *      EEPROM write instead of a reflash.
 *
 * The wire protocol, the EEPROM layout and the bytecode opcodes are specified in
 * docs/player-protocol.md. That file is the contract; keep this sketch and the
 * browser side (src/device/MakeblockProtocol.ts, DeviceSession.ts, bytecode.ts) in
 * sync with it.
 *
 * LICENSING
 * ---------
 * Copyright (C) 2026 the mBot VR contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This file is written FROM SCRATCH against the publicly documented mCore pin map
 * (the Makeblock mCore schematic; pin numbers are hardware facts, not code). It
 * contains NO Makeblock source and is not derived from the GPLv2 Makeblock-Libraries.
 * The whole mBot VR tree therefore stays GPL-3.0-or-later with no license island.
 *
 * !!!  UNVERIFIED  !!!
 * -------------------
 * As of this commit NOTHING below has run on a physical mBot. Pin assignments, pin
 * polarities, the WS2812 bit-bang timing, the ultrasonic pulse timing and the line
 * sensor active level are all design intent transcribed from public references and
 * MUST be confirmed on real hardware (see docs/hardware-bridge-plan.md, unknowns
 * U1/U3/U7) before this is trusted in a classroom.
 *
 * BUILD / FLASH
 * -------------
 * See firmware/mbotvr-player/README.md. Board = "Arduino Uno", 16 MHz, upload over USB.
 */

#include <Arduino.h>
#include <EEPROM.h>
#include <avr/interrupt.h>

// --------------------------------------------------------------------------------------
// Hardware map  --  mCore, from the published schematic. UNVERIFIED against any fleet.
// --------------------------------------------------------------------------------------

// TB6612FNG dual motor driver. M1 is the LEFT wheel, mounted mirrored relative to M2,
// so "logical forward" is negated for M1 -- the same flip src/device/bytecode.ts and
// MakeblockProtocol.ts's encodeMotorRun apply. Protocol motor "port" ids: M1 = 9,
// M2 = 10 (device id 10).
static const uint8_t M1_PWM = 6, M1_DIR = 7;   // left
static const uint8_t M2_PWM = 5, M2_DIR = 4;   // right

static const uint8_t BUZZER_PIN = 8;
static const uint8_t RGB_PIN    = 13;          // 2x WS2812-style onboard LEDs (PB5)

// RJ25 port -> {s1, s2} MCU pins, index 1..4. s2 is the single-wire "slot 2" signal.
static const uint8_t PORT_S1[5] = { 0, 11,  9, A2, A0 };
static const uint8_t PORT_S2[5] = { 0, 12, 10, A3, A1 };

// The app's assumed default wiring until a device-profile UI exists
// (src/device/DeviceSession.ts DEFAULT_ULTRASONIC_PORT / DEFAULT_LINE_FOLLOWER_PORT).
static const uint8_t DEFAULT_ULTRASONIC_PORT   = 3;
static const uint8_t DEFAULT_LINE_FOLLOWER_PORT = 2;

// --------------------------------------------------------------------------------------
// Protocol constants  --  mirror src/device/MakeblockProtocol.ts and docs/player-protocol.md
// --------------------------------------------------------------------------------------

static const uint8_t FRAME_H0 = 0xFF, FRAME_H1 = 0x55;

enum { ACT_GET = 1, ACT_RUN = 2, ACT_RESET = 4, ACT_START = 5 };
enum { DEV_VERSION = 0, DEV_ULTRASONIC = 1, DEV_RGB = 8, DEV_MOTOR = 10,
       DEV_LINE = 17, DEV_PLAYER = 0x7D };
enum { REPLY_BYTE = 1, REPLY_FLOAT = 2, REPLY_STRING = 4 };

// PlayerCommand (first param byte of a GET to DEV_PLAYER)
enum { PC_INFO = 0x01, PC_BEGIN = 0x10, PC_CHUNK = 0x11, PC_COMMIT = 0x12,
       PC_VERIFY = 0x13, PC_SET_BOOT_IDLE = 0x20 };

static const uint16_t HEARTBEAT_TIMEOUT_MS = 500;   // see docs/player-protocol.md section 5
static const char     VERSION_STRING[]     = "mBot VR Player v1";

// --------------------------------------------------------------------------------------
// EEPROM layout  --  see docs/player-protocol.md section 3
// --------------------------------------------------------------------------------------

static const uint16_t EE_MAGIC      = 0;    // 4 bytes "MBVR"
static const uint16_t EE_VERSION    = 4;    // 1 byte
static const uint16_t EE_FLAGS      = 5;    // bit0 = boot-idle halt
static const uint16_t EE_INSTR_LEN  = 6;    // u16 LE  (INSTRUCTION bytes, not blob)
static const uint16_t EE_CHECKSUM   = 8;    // u16 LE  checksum16 of the instruction bytes
static const uint16_t EE_INSTR      = 10;   // instruction stream begins here

static const uint16_t EE_RESERVED_BASE = 896;   // 1024 - 128; matches PLAYER_MAX_PROGRAM_BYTES
static const uint8_t  MAGIC[4] = { 'M', 'B', 'V', 'R' };
static const uint8_t  BYTECODE_VERSION = 1;

// --------------------------------------------------------------------------------------
// Bytecode opcodes  --  mirror PlayerOp in src/device/bytecode.ts
// --------------------------------------------------------------------------------------

enum {
  OP_END = 0x00, OP_PUSH_I16 = 0x01, OP_ADD = 0x02, OP_SUB = 0x03, OP_MUL = 0x04,
  OP_DIV = 0x05, OP_LT = 0x06, OP_GT = 0x07, OP_EQ = 0x08, OP_AND = 0x09, OP_OR = 0x0A,
  OP_NOT = 0x0B, OP_JUMP = 0x0C, OP_JUMP_IF_FALSE = 0x0D,
  OP_SET_MOTORS = 0x10, OP_STOP_MOTORS = 0x11, OP_WAIT_MS = 0x12, OP_SET_RGB_LED = 0x13,
  OP_DISPLAY_NUMBER = 0x14, OP_CLEAR_DISPLAY = 0x15,
  OP_READ_ULTRASONIC_CM = 0x20, OP_READ_LINE_VALUE = 0x21, OP_READ_LEFT_ON_LINE = 0x22,
  OP_READ_RIGHT_ON_LINE = 0x23, OP_READ_TIMER_DSEC = 0x24, OP_RESET_TIMER = 0x25,
  OP_POWER_TO_MOTOR = 0x30, OP_CM_WITHIN_OBSTACLE = 0x31, OP_DUP = 0x32, OP_POP = 0x33
};

// --------------------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------------------

static int16_t  g_m1 = 0, g_m2 = 0;          // last commanded raw speeds, per port
static bool     g_watchdogArmed = false;     // true only while a HOST motor frame drives us
static uint32_t g_lastFrameMs = 0;

static uint8_t  g_pixels[6];                 // 2 LEDs x G,R,B

// Bytecode VM
static bool     g_vmRunning  = false;
static bool     g_vmWaiting  = false;
static uint32_t g_vmWaitUntil = 0;
static uint16_t g_vmPc = 0;
static uint16_t g_vmInstrLen = 0;
static uint32_t g_vmTimerStart = 0;
static int16_t  g_stack[24];
static uint8_t  g_sp = 0;

// Program-transfer staging (see docs/player-protocol.md section 2)
static uint8_t  g_magicStash[4] = { 0, 0, 0, 0 };
static bool     g_stagedVerified = false;

// --------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------

// Fletcher-style mod-255 checksum -- byte-identical to checksum16() in bytecode.ts.
static uint16_t checksum16_eeprom(uint16_t start, uint16_t len) {
  uint16_t a = 0, b = 0;
  for (uint16_t i = 0; i < len; i++) {
    a = (a + EEPROM.read(start + i)) % 255;
    b = (b + a) % 255;
  }
  return (uint16_t)((b << 8) | a);
}

static int16_t clamp16(long v, long lo, long hi) {
  if (v < lo) return (int16_t)lo;
  if (v > hi) return (int16_t)hi;
  return (int16_t)v;
}

static void chirp() { tone(BUZZER_PIN, 2200, 70); delay(90); noTone(BUZZER_PIN); }

// --------------------------------------------------------------------------------------
// Actuators
// --------------------------------------------------------------------------------------

// speed is a RAW per-motor value in -255..255. Caller has already applied any mirroring.
static void motorRaw(uint8_t pwmPin, uint8_t dirPin, int16_t speed) {
  bool forward = speed >= 0;
  int mag = speed < 0 ? -speed : speed;
  if (mag > 255) mag = 255;
  digitalWrite(dirPin, forward ? HIGH : LOW);   // polarity UNVERIFIED
  analogWrite(pwmPin, mag);
}

static void stopMotors() {
  g_m1 = g_m2 = 0;
  motorRaw(M1_PWM, M1_DIR, 0);
  motorRaw(M2_PWM, M2_DIR, 0);
  g_watchdogArmed = false;
}

// Host MOTOR RUN frame -> drive one raw port. The host has ALREADY negated M1, so no
// flip here. A non-zero speed arms the heartbeat watchdog.
static void hostMotor(uint8_t port, int16_t speed) {
  if (port == 9)       { g_m1 = speed; motorRaw(M1_PWM, M1_DIR, speed); }
  else if (port == 10) { g_m2 = speed; motorRaw(M2_PWM, M2_DIR, speed); }
  g_watchdogArmed = (g_m1 != 0 || g_m2 != 0);
}

// VM-driven motion. left/right are "logical forward = positive"; apply the M1 mirror
// here, exactly like encodeMotorRun does on the tethered path. Never arms the watchdog
// (see docs/player-protocol.md section 5).
static void vmDriveMotors(int16_t left, int16_t right) {
  g_m1 = -left;
  g_m2 = right;
  motorRaw(M1_PWM, M1_DIR, g_m1);
  motorRaw(M2_PWM, M2_DIR, g_m2);
  g_watchdogArmed = false;
}

// --- WS2812 onboard LEDs (PB5 / D13) ------------------------------------------------
// Minimal 800 kHz bit-bang for F_CPU = 16 MHz. Cycle counts are approximate and MUST
// be checked on a scope against real WS2812/SK6812 parts -- this is the single least
// certain thing in this file. GRB byte order.
static void ws2812Show() {
  volatile uint8_t *port = &PORTB;
  const uint8_t hi = *port | _BV(5);
  const uint8_t lo = *port & ~_BV(5);
  const uint8_t *p = g_pixels;
  uint8_t n = sizeof(g_pixels);
  cli();
  while (n--) {
    uint8_t byte = *p++;
    for (uint8_t bit = 8; bit; bit--) {
      *port = hi;
      if (byte & 0x80) {
        __asm__ volatile("nop\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n");
        *port = lo;
      } else {
        __asm__ volatile("nop\n nop\n nop\n");
        *port = lo;
      }
      __asm__ volatile("nop\n nop\n nop\n nop\n nop\n");
      byte <<= 1;
    }
  }
  sei();
}

// which: 0 = both, 1 = right (pixel 0), 2 = left (pixel 1). Mapping UNVERIFIED.
static void setLed(uint8_t which, uint8_t r, uint8_t g, uint8_t b) {
  if (which == 0 || which == 1) { g_pixels[0] = g; g_pixels[1] = r; g_pixels[2] = b; }
  if (which == 0 || which == 2) { g_pixels[3] = g; g_pixels[4] = r; g_pixels[5] = b; }
  ws2812Show();
}

// --------------------------------------------------------------------------------------
// Sensors
// --------------------------------------------------------------------------------------

// Me Ultrasonic: single signal wire on the port's s2 pin. 0.0 == nothing in range.
static float readUltrasonicCm(uint8_t port) {
  if (port < 1 || port > 4) port = DEFAULT_ULTRASONIC_PORT;
  uint8_t sig = PORT_S2[port];
  pinMode(sig, OUTPUT);
  digitalWrite(sig, LOW);  delayMicroseconds(2);
  digitalWrite(sig, HIGH); delayMicroseconds(10);
  digitalWrite(sig, LOW);
  pinMode(sig, INPUT);
  unsigned long us = pulseIn(sig, HIGH, 30000UL);   // ~5 m ceiling
  if (us == 0) return 0.0f;
  return (float)us / 58.0f;
}

// Me Line Follower: two digital sensors; a sensor OVER the line reads LOW.
// value = (s1 << 1) | s2  ->  0 both on, 1 left only, 2 right only, 3 both off.
static uint8_t readLineValue(uint8_t port) {
  if (port < 1 || port > 4) port = DEFAULT_LINE_FOLLOWER_PORT;
  pinMode(PORT_S1[port], INPUT_PULLUP);
  pinMode(PORT_S2[port], INPUT_PULLUP);
  uint8_t s1 = digitalRead(PORT_S1[port]) ? 1 : 0;
  uint8_t s2 = digitalRead(PORT_S2[port]) ? 1 : 0;
  return (uint8_t)((s1 << 1) | s2);
}

// --------------------------------------------------------------------------------------
// Reply encoders (robot -> host).  GET replies are NOT length-prefixed.
// --------------------------------------------------------------------------------------

static void sendAck() {   // bare callOK(): no index, no data
  Serial.write(FRAME_H0); Serial.write(FRAME_H1);
  Serial.write('\r'); Serial.write('\n');
}

static void sendByteReply(uint8_t idx, uint8_t value) {
  Serial.write(FRAME_H0); Serial.write(FRAME_H1);
  Serial.write(idx); Serial.write((uint8_t)REPLY_BYTE); Serial.write(value);
  Serial.write('\r'); Serial.write('\n');
}

static void sendFloatReply(uint8_t idx, float value) {
  uint8_t b[4];
  memcpy(b, &value, 4);                 // AVR float is little-endian IEEE-754
  Serial.write(FRAME_H0); Serial.write(FRAME_H1);
  Serial.write(idx); Serial.write((uint8_t)REPLY_FLOAT);
  Serial.write(b, 4);
  Serial.write('\r'); Serial.write('\n');
}

static void sendStringReply(uint8_t idx, const char *s) {
  uint8_t len = (uint8_t)strlen(s);
  Serial.write(FRAME_H0); Serial.write(FRAME_H1);
  Serial.write(idx); Serial.write((uint8_t)REPLY_STRING); Serial.write(len);
  Serial.write((const uint8_t *)s, len);
  Serial.write('\r'); Serial.write('\n');
}

// --------------------------------------------------------------------------------------
// Program load / validation
// --------------------------------------------------------------------------------------

static bool magicPresent() {
  for (uint8_t i = 0; i < 4; i++) if (EEPROM.read(EE_MAGIC + i) != MAGIC[i]) return false;
  return true;
}

static bool programValid(uint16_t *instrLenOut) {
  if (!magicPresent()) return false;
  if (EEPROM.read(EE_VERSION) != BYTECODE_VERSION) return false;
  uint16_t instrLen = EEPROM.read(EE_INSTR_LEN) | (EEPROM.read(EE_INSTR_LEN + 1) << 8);
  if (instrLen == 0 || (uint16_t)(EE_INSTR + instrLen) > EE_RESERVED_BASE) return false;
  uint16_t want = EEPROM.read(EE_CHECKSUM) | (EEPROM.read(EE_CHECKSUM + 1) << 8);
  if (checksum16_eeprom(EE_INSTR, instrLen) != want) return false;
  if (instrLenOut) *instrLenOut = instrLen;
  return true;
}

static void startVm(uint16_t instrLen) {
  g_vmInstrLen = instrLen;
  g_vmPc = 0;
  g_sp = 0;
  g_vmWaiting = false;
  g_vmTimerStart = millis();
  g_vmRunning = true;
}

// --------------------------------------------------------------------------------------
// Bytecode VM
// --------------------------------------------------------------------------------------

static uint8_t  instrByte(uint16_t pc) { return EEPROM.read(EE_INSTR + pc); }
static uint16_t instrU16(uint16_t pc)  { return instrByte(pc) | (instrByte(pc + 1) << 8); }

static void vmAbort() { g_vmRunning = false; stopMotors(); }

static void push(int16_t v) {
  if (g_sp >= sizeof(g_stack) / sizeof(g_stack[0])) { vmAbort(); return; }
  g_stack[g_sp++] = v;
}
static int16_t pop() {
  if (g_sp == 0) { vmAbort(); return 0; }
  return g_stack[--g_sp];
}

static void vmStep() {
  if (!g_vmRunning) return;
  if (g_vmWaiting) {
    if ((int32_t)(millis() - g_vmWaitUntil) >= 0) g_vmWaiting = false;
    else return;
  }
  if (g_vmPc >= g_vmInstrLen) { vmAbort(); return; }

  uint8_t op = instrByte(g_vmPc++);
  switch (op) {
    case OP_END: g_vmRunning = false; stopMotors(); break;

    case OP_PUSH_I16: { int16_t v = (int16_t)instrU16(g_vmPc); g_vmPc += 2; push(v); break; }

    case OP_ADD: { int16_t b = pop(), a = pop(); push(a + b); break; }
    case OP_SUB: { int16_t b = pop(), a = pop(); push(a - b); break; }
    case OP_MUL: { int16_t b = pop(), a = pop(); push(a * b); break; }
    case OP_DIV: { int16_t b = pop(), a = pop(); push(b == 0 ? 0 : a / b); break; }
    case OP_LT:  { int16_t b = pop(), a = pop(); push(a <  b ? 1 : 0); break; }
    case OP_GT:  { int16_t b = pop(), a = pop(); push(a >  b ? 1 : 0); break; }
    case OP_EQ:  { int16_t b = pop(), a = pop(); push(a == b ? 1 : 0); break; }
    case OP_AND: { int16_t b = pop(), a = pop(); push((a && b) ? 1 : 0); break; }
    case OP_OR:  { int16_t b = pop(), a = pop(); push((a || b) ? 1 : 0); break; }
    case OP_NOT: { int16_t a = pop(); push(a == 0 ? 1 : 0); break; }

    case OP_JUMP: { uint16_t t = instrU16(g_vmPc); g_vmPc = (t < g_vmInstrLen) ? t : g_vmInstrLen; break; }
    case OP_JUMP_IF_FALSE: {
      uint16_t t = instrU16(g_vmPc); g_vmPc += 2;
      if (pop() == 0) g_vmPc = (t < g_vmInstrLen) ? t : g_vmInstrLen;
      break;
    }

    case OP_SET_MOTORS: { int16_t right = pop(), left = pop(); vmDriveMotors(left, right); break; }
    case OP_STOP_MOTORS: stopMotors(); break;
    case OP_WAIT_MS: {
      uint16_t ms = instrU16(g_vmPc); g_vmPc += 2;
      g_vmWaitUntil = millis() + ms;
      g_vmWaiting = true;
      break;
    }
    case OP_SET_RGB_LED: {
      uint8_t which = instrByte(g_vmPc++), r = instrByte(g_vmPc++),
              g = instrByte(g_vmPc++), b = instrByte(g_vmPc++);
      setLed(which, r, g, b);
      break;
    }
    case OP_DISPLAY_NUMBER: g_vmPc += 2; break;   // no 7-segment support in this slice
    case OP_CLEAR_DISPLAY:  break;

    case OP_READ_ULTRASONIC_CM: push((int16_t)readUltrasonicCm(DEFAULT_ULTRASONIC_PORT)); break;
    case OP_READ_LINE_VALUE:    push((int16_t)readLineValue(DEFAULT_LINE_FOLLOWER_PORT)); break;
    case OP_READ_LEFT_ON_LINE:  push((readLineValue(DEFAULT_LINE_FOLLOWER_PORT) & 2) == 0 ? 1 : 0); break;
    case OP_READ_RIGHT_ON_LINE: push((readLineValue(DEFAULT_LINE_FOLLOWER_PORT) & 1) == 0 ? 1 : 0); break;
    case OP_READ_TIMER_DSEC:    push((int16_t)((millis() - g_vmTimerStart) / 100)); break;
    case OP_RESET_TIMER:        g_vmTimerStart = millis(); break;

    case OP_POWER_TO_MOTOR: { int16_t x = pop(); push(clamp16((long)x * 255 / 100, -255, 255)); break; }
    case OP_CM_WITHIN_OBSTACLE: { int16_t dist = pop(), cm = pop(); push((cm > 0 && cm < dist) ? 1 : 0); break; }
    case OP_DUP: { if (g_sp == 0) { vmAbort(); break; } push(g_stack[g_sp - 1]); break; }
    case OP_POP: pop(); break;

    default: vmAbort(); break;   // unknown opcode -> safe halt
  }
}

// --------------------------------------------------------------------------------------
// Player command channel  (GET to DEV_PLAYER; params[0] = PlayerCommand)
// --------------------------------------------------------------------------------------

static void playerCommand(uint8_t idx, const uint8_t *params, uint8_t nparams) {
  if (nparams < 1) { sendByteReply(idx, 0); return; }
  const uint8_t sub = params[0];
  const uint8_t *sp = params + 1;
  const uint8_t sn = nparams - 1;

  switch (sub) {
    case PC_INFO: {
      uint16_t instrLen = 0;
      bool ok = programValid(&instrLen);
      uint8_t flags = EEPROM.read(EE_FLAGS);
      uint16_t crc = EEPROM.read(EE_CHECKSUM) | (EEPROM.read(EE_CHECKSUM + 1) << 8);
      char buf[64];
      snprintf(buf, sizeof(buf), "MBVR player=1 idle=%u prog=%u plen=%u crc=%u",
               (unsigned)(flags & 1), (unsigned)(ok ? 1 : 0),
               (unsigned)(ok ? instrLen : 0), (unsigned)(ok ? crc : 0));
      sendStringReply(idx, buf);
      return;
    }

    case PC_BEGIN: {
      // Invalidate any stored program immediately, then stash a cleared magic.
      for (uint8_t i = 0; i < 4; i++) { EEPROM.update(EE_MAGIC + i, 0); g_magicStash[i] = 0; }
      g_stagedVerified = false;
      g_vmRunning = false;
      stopMotors();
      sendByteReply(idx, 1);
      return;
    }

    case PC_CHUNK: {
      if (sn < 3) { sendByteReply(idx, 0); return; }
      uint16_t off = sp[0] | (sp[1] << 8);
      const uint8_t *data = sp + 2;
      uint8_t dn = sn - 2;
      for (uint8_t i = 0; i < dn; i++) {
        uint16_t a = off + i;
        if (a < 4) g_magicStash[a] = data[i];              // hold the magic back until COMMIT
        else if (a < EE_RESERVED_BASE) EEPROM.update(a, data[i]);
        else { sendByteReply(idx, 0); return; }            // out of the program slot
      }
      sendByteReply(idx, 1);
      return;
    }

    case PC_VERIFY: {
      if (sn < 4) { sendByteReply(idx, 0); return; }
      uint16_t blobLen = sp[0] | (sp[1] << 8);
      uint16_t wantCrc = sp[2] | (sp[3] << 8);
      bool magicOk = (g_magicStash[0] == 'M' && g_magicStash[1] == 'B' &&
                      g_magicStash[2] == 'V' && g_magicStash[3] == 'R');
      bool lenOk = (blobLen > EE_INSTR && blobLen <= EE_RESERVED_BASE);
      uint16_t instrLen = lenOk ? (blobLen - EE_INSTR) : 0;
      uint16_t storedInstrLen = EEPROM.read(EE_INSTR_LEN) | (EEPROM.read(EE_INSTR_LEN + 1) << 8);
      bool ok = magicOk && lenOk && storedInstrLen == instrLen &&
                EEPROM.read(EE_VERSION) == BYTECODE_VERSION &&
                checksum16_eeprom(EE_INSTR, instrLen) == wantCrc;
      g_stagedVerified = ok;
      sendByteReply(idx, ok ? 1 : 0);
      return;
    }

    case PC_COMMIT: {
      if (!g_stagedVerified) { sendByteReply(idx, 0); return; }
      for (uint8_t i = 0; i < 4; i++) EEPROM.update(EE_MAGIC + i, g_magicStash[i]);
      // A fresh blob carries a zero flags byte, so committing also clears boot-idle.
      g_stagedVerified = false;
      sendByteReply(idx, 1);
      return;
    }

    case PC_SET_BOOT_IDLE: {
      uint8_t flag = (sn >= 1) ? sp[0] : 1;
      uint8_t f = EEPROM.read(EE_FLAGS);
      if (flag) { f |= 1;  g_vmRunning = false; stopMotors(); }
      else        f &= ~1;
      EEPROM.update(EE_FLAGS, f);
      sendByteReply(idx, 1);
      return;
    }

    default:
      sendByteReply(idx, 0);
      return;
  }
}

// --------------------------------------------------------------------------------------
// Frame dispatch
// --------------------------------------------------------------------------------------

static void dispatchFrame(const uint8_t *body, uint8_t len) {
  if (len < 3) return;
  const uint8_t idx    = body[0];
  const uint8_t action = body[1];
  const uint8_t device = body[2];
  const uint8_t *params = body + 3;
  const uint8_t nparams = len - 3;

  g_lastFrameMs = millis();   // any well-formed frame feeds the heartbeat

  if (action == ACT_RESET) { g_vmRunning = false; stopMotors(); sendAck(); return; }

  if (action == ACT_GET) {
    switch (device) {
      case DEV_VERSION:    sendStringReply(idx, VERSION_STRING); return;
      case DEV_ULTRASONIC: sendFloatReply(idx, readUltrasonicCm(nparams >= 1 ? params[0] : DEFAULT_ULTRASONIC_PORT)); return;
      case DEV_LINE:       sendFloatReply(idx, (float)readLineValue(nparams >= 1 ? params[0] : DEFAULT_LINE_FOLLOWER_PORT)); return;
      case DEV_PLAYER:     playerCommand(idx, params, nparams); return;
      default: return;
    }
  }

  if (action == ACT_RUN) {
    switch (device) {
      case DEV_MOTOR:
        if (nparams >= 3) hostMotor(params[0], (int16_t)(params[1] | (params[2] << 8)));
        sendAck();
        return;
      case DEV_RGB:
        if (nparams >= 6) setLed(params[2], params[3], params[4], params[5]);
        sendAck();
        return;
      default:
        sendAck();
        return;
    }
  }
}

// --------------------------------------------------------------------------------------
// Serial frame reader  --  FF 55 <len> <len bytes>
// --------------------------------------------------------------------------------------

static void serviceSerial() {
  static uint8_t st = 0;          // 0 wait FF, 1 wait 55, 2 want len, 3 body
  static uint8_t need = 0, got = 0;
  static uint8_t body[64];

  while (Serial.available() > 0) {
    uint8_t c = (uint8_t)Serial.read();
    switch (st) {
      case 0: if (c == FRAME_H0) st = 1; break;
      case 1: st = (c == FRAME_H1) ? 2 : (c == FRAME_H0 ? 1 : 0); break;
      case 2:
        need = c; got = 0;
        st = (need == 0 || need > sizeof(body)) ? 0 : 3;
        break;
      case 3:
        body[got++] = c;
        if (got >= need) { dispatchFrame(body, need); st = 0; }
        break;
    }
  }
}

static void watchdogTick() {
  if (g_watchdogArmed && (uint32_t)(millis() - g_lastFrameMs) > HEARTBEAT_TIMEOUT_MS) {
    stopMotors();   // also clears g_watchdogArmed
  }
}

// --------------------------------------------------------------------------------------
// Arduino entry points
// --------------------------------------------------------------------------------------

void setup() {
  pinMode(M1_PWM, OUTPUT); pinMode(M1_DIR, OUTPUT);
  pinMode(M2_PWM, OUTPUT); pinMode(M2_DIR, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RGB_PIN, OUTPUT); digitalWrite(RGB_PIN, LOW);

  stopMotors();
  memset(g_pixels, 0, sizeof(g_pixels));
  ws2812Show();

  Serial.begin(115200);

  // Two chirps = mBot VR Player firmware (factory firmware chirps three times).
  chirp(); chirp();

  uint16_t instrLen = 0;
  bool valid = programValid(&instrLen);
  bool bootIdle = (EEPROM.read(EE_FLAGS) & 1) != 0;
  if (valid && !bootIdle) startVm(instrLen);

  g_lastFrameMs = millis();
}

void loop() {
  serviceSerial();
  watchdogTick();
  if (g_vmRunning) vmStep();
}
