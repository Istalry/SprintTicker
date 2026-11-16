import { describe, it, expect } from 'vitest';
import { localApiPortFrom } from '../src/main/api/local-api-port';
import { LOCAL_API_PORT } from '../src/shared/deck-protocol';

describe('localApiPortFrom', () => {
  it('NoSwitch_TheAppsOwnPort', () => {
    expect(localApiPortFrom(['electron.exe', '--mock-hardware'])).toBe(LOCAL_API_PORT);
  });

  it('Switch_ThePortItNames', () => {
    // verify:packed and the capture run beside the user's app on another port.
    expect(localApiPortFrom(['SprintTicker.exe', '--local-api-port=40123'])).toBe(40123);
  });

  it.each(['', 'abc', '80', '70000', '4012x', '-1'])('NotAPortAbove1023_%s_IsIgnored', value => {
    expect(localApiPortFrom([`--local-api-port=${value}`])).toBe(LOCAL_API_PORT);
  });
});
