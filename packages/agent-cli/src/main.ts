import { createInterface } from 'node:readline';
import { ask, settingsFrom } from './client';
import { EXIT, runCli } from './cli';
import { McpServer } from './mcp';
import packageJson from '../package.json';

/**
 * `sprintticker`: the command an AI agent runs, or `sprintticker mcp`, the
 * MCP server an agent's host starts (AGENT-INTERFACE.md). Run by the app's
 * own executable under ELECTRON_RUN_AS_NODE in the installed app.
 */
async function main(argv: string[]): Promise<number> {
  const settings = settingsFrom(process.env);
  if (argv[0] !== 'mcp') {
    return runCli(argv, settings, { out: text => console.log(text), err: text => console.error(text) });
  }

  const server = new McpServer(settings, ask, packageJson.version);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // One answer at a time, in order: a host may send the next request before
  // the last answer, and a line written mid-line would corrupt both.
  let queue: Promise<void> = Promise.resolve();
  lines.on('line', line => {
    queue = queue.then(async () => {
      const response = await server.handleLine(line);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }).catch(err => console.error('[sprintticker mcp]', err));
  });
  await new Promise<void>(resolve => lines.on('close', () => resolve()));
  await queue;
  return EXIT.OK;
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  err => {
    console.error(err);
    process.exitCode = EXIT.REFUSED;
  }
);
