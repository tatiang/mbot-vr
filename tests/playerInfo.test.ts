import { describe, expect, it } from 'vitest';
import { describePlayerInfo, parsePlayerInfo } from '../src/device/playerInfo';

describe('parsePlayerInfo', () => {
  it('parses a fresh flash with no stored program', () => {
    expect(parsePlayerInfo('MBVR player=1 idle=0 prog=0 plen=0 crc=0')).toEqual({
      idle: false,
      hasProgram: false,
      programBytes: 0,
      checksum: 0,
    });
  });

  it('parses a robot with a stored, runnable program', () => {
    expect(parsePlayerInfo('MBVR player=1 idle=0 prog=1 plen=118 crc=4321')).toEqual({
      idle: false,
      hasProgram: true,
      programBytes: 118,
      checksum: 4321,
    });
  });

  it('parses a robot with a stored program that is set not to run (boot-idle)', () => {
    expect(parsePlayerInfo('MBVR player=1 idle=1 prog=1 plen=118 crc=4321')).toEqual({
      idle: true,
      hasProgram: true,
      programBytes: 118,
      checksum: 4321,
    });
  });

  it('is tolerant of field order and extra whitespace', () => {
    expect(parsePlayerInfo('MBVR   crc=9  plen=3 prog=1 idle=0  player=1')).toEqual({
      idle: false,
      hasProgram: true,
      programBytes: 3,
      checksum: 9,
    });
  });

  it('rejects a reply that is not from Player firmware', () => {
    expect(parsePlayerInfo('06.01.009')).toBeNull();
  });

  it('rejects a reply missing a required field', () => {
    expect(parsePlayerInfo('MBVR player=1 idle=0 prog=1')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parsePlayerInfo('')).toBeNull();
  });
});

describe('describePlayerInfo', () => {
  it('says nothing is stored', () => {
    expect(describePlayerInfo({ idle: false, hasProgram: false, programBytes: 0, checksum: 0 })).toMatch(
      /no code is stored/i,
    );
  });

  it('says stored code is set to run', () => {
    const text = describePlayerInfo({ idle: false, hasProgram: true, programBytes: 50, checksum: 1 });
    expect(text).toMatch(/50 bytes/);
    expect(text).toMatch(/run the next time/i);
  });

  it('says stored code will not run because boot-idle is set', () => {
    const text = describePlayerInfo({ idle: true, hasProgram: true, programBytes: 50, checksum: 1 });
    expect(text).toMatch(/50 bytes/);
    expect(text).toMatch(/won't run/i);
  });
});
