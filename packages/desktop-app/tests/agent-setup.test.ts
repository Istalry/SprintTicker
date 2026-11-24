import { describe, it, expect } from 'vitest';
import { AGENT_DEFAULT_PORT } from '../src/shared/agent-protocol';
import { agentEnvironment, agentSetup } from '../src/shared/agent-setup';

/**
 * The lines Settings › AI agents hands out (AGENT-INTERFACE.md §7): pasted
 * as they are, so a path with a space or a backslash must survive both a
 * terminal and a JSON file.
 */
describe('agentSetup', () => {
  const launch = {
    exe: 'C:\\Users\\Rin Ota\\AppData\\Local\\Programs\\sprintticker\\SprintTicker.exe',
    script: 'C:\\Users\\Rin Ota\\AppData\\Local\\Programs\\sprintticker\\resources\\agent\\sprintticker.mjs',
    command: 'C:\\Users\\Rin Ota\\AppData\\Local\\Programs\\sprintticker\\resources\\agent\\sprintticker.cmd'
  };

  it('ClaudeCode_OneLine_PathsQuoted_TheTokenAndRunAsNodeInTheEnvironment', () => {
    expect(agentSetup(launch, 'abc123', AGENT_DEFAULT_PORT).claudeCode).toBe(
      'claude mcp add sprintticker --scope user -e ELECTRON_RUN_AS_NODE=1 -e SPRINTTICKER_TOKEN=abc123 -- '
        + `"${launch.exe}" "${launch.script}" mcp`
    );
  });

  it('ClaudeDesktop_AValidEntry_TheExecutableRunsTheScript', () => {
    const entry = JSON.parse(agentSetup(launch, 'abc123', AGENT_DEFAULT_PORT).claudeDesktop);

    expect(entry).toEqual({
      mcpServers: {
        sprintticker: { command: launch.exe, args: [launch.script, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1', SPRINTTICKER_TOKEN: 'abc123' } }
      }
    });
  });

  it('APortOffTheDefault_IsNamed_TheDefaultIsNot', () => {
    expect(agentEnvironment('t', AGENT_DEFAULT_PORT)).not.toHaveProperty('SPRINTTICKER_PORT');
    expect(agentEnvironment('t', 39187)).toMatchObject({ SPRINTTICKER_PORT: '39187' });
    expect(agentSetup(launch, 't', 39187).claudeCode).toContain('-e SPRINTTICKER_PORT=39187 --');
  });

  it('TheCommand_IsTheBuildsOwn_NoneInDevelopment', () => {
    expect(agentSetup(launch, 't', AGENT_DEFAULT_PORT).command).toBe(launch.command);
    expect(agentSetup({ ...launch, command: null }, 't', AGENT_DEFAULT_PORT).command).toBeNull();
  });
});
