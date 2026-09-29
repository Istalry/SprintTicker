import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PREVIEW_PRIORITY, PreviewDeps, previewOnBar, STUDIO_APP, stopPreview } from '../server/bar-preview';
import type { DeviceModule, DeviceResponse, RenderedSequence } from '../server/export';
import { assertSameOrigin } from '../server/api';

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/**
 * A device that answers from a script, keyed by "METHOD /path-without-query",
 * and records every request. Anything unscripted answers 200.
 */
function fakeDevice(answers: Record<string, number> = {}): { device: DeviceModule; calls: Call[] } {
  const calls: Call[] = [];
  const device: DeviceModule = {
    createDeviceClient: ({ host }) => ({
      host,
      request: async (method, url, options): Promise<DeviceResponse> => {
        calls.push({ method, path: url, body: options?.body });
        const key = `${method} ${url.split('?')[0]}`;
        return { status: answers[key] ?? 200, body: answers[key] ? 'refused' : '{}' };
      }
    }),
    encodePng: () => Buffer.from('png')
  };
  return { device, calls };
}

function deps(device: DeviceModule): PreviewDeps {
  return {
    device,
    compile: async (_dir, outFile) => {
      fs.writeFileSync(outFile, Buffer.alloc(1234));
      return 1234;
    }
  };
}

const SEQUENCE: RenderedSequence = { id: 's', width: 1, height: 1, fps: 10, frames: [new Uint8Array(4)] };
const TARGET = { host: '10.0.4.21', token: '' };

describe('previewOnBar', () => {
  it('PreviewOnBar_DeviceAccepts_ClearsThenDrawsAboveTheAppWithATimeout', async () => {
    const { device, calls } = fakeDevice();
    const result = await previewOnBar(TARGET, SEQUENCE, deps(device));

    expect(result.status).toBe(200);
    expect(result.bytes).toBe(1234);
    expect(calls.map(c => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'POST /api/assets/upload',
      'DELETE /api/display/draw',
      'POST /api/display/draw'
    ]);
    const draw = calls[2].body as { application_name: string; priority: number; elements: { timeout: number }[] };
    expect(draw.application_name).toBe(STUDIO_APP);
    expect(draw.priority).toBe(PREVIEW_PRIORITY);
    // A studio closed without Stop must not leave the bar stuck on a preview.
    expect(draw.elements[0].timeout).toBeGreaterThan(0);
  });

  it('PreviewOnBar_UploadRefused_ReportsItAndNeverDraws', async () => {
    const { device, calls } = fakeDevice({ 'POST /api/assets/upload': 413 });
    const result = await previewOnBar(TARGET, SEQUENCE, deps(device));

    expect(result.status).toBe(413);
    expect(result.message).toContain('would not store');
    expect(calls.some(c => c.path.startsWith('/api/display/draw'))).toBe(false);
  });

  it('PreviewOnBar_DrawConflict_ReportsSomethingElseHoldsTheDisplay', async () => {
    const { device } = fakeDevice({ 'POST /api/display/draw': 409 });
    const result = await previewOnBar(TARGET, SEQUENCE, deps(device));
    expect(result.status).toBe(409);
    expect(result.message).toContain('higher priority');
  });

  it('PreviewOnBar_DrawRejected_ReportsTheStatus', async () => {
    const { device } = fakeDevice({ 'POST /api/display/draw': 400 });
    const result = await previewOnBar(TARGET, SEQUENCE, deps(device));
    expect(result.status).toBe(400);
    expect(result.message).toContain('would not draw it (400');
  });

  it('PreviewOnBar_HostThatRetargetsTheUrl_ThrowsBeforeAnyRequest', async () => {
    const { device, calls } = fakeDevice();
    await expect(previewOnBar({ host: 'evil.example/x', token: '' }, SEQUENCE, deps(device))).rejects.toThrow(
      'not an IP address or hostname'
    );
    expect(calls).toEqual([]);
  });

  it('PreviewOnBar_CompileFails_RejectsAndLeavesNoTempFolder', async () => {
    const { device, calls } = fakeDevice();
    let workDir = '';
    const failing: PreviewDeps = {
      device,
      compile: async dir => {
        workDir = path.dirname(dir);
        throw new Error('seq2anim failed');
      }
    };
    await expect(previewOnBar(TARGET, SEQUENCE, failing)).rejects.toThrow('seq2anim failed');
    expect(calls).toEqual([]);
    expect(fs.existsSync(workDir)).toBe(false);
  });
});

describe('stopPreview', () => {
  it('StopPreview_DeviceAccepts_ClearsAndDeletesOnlyTheStudiosOwnName', async () => {
    const { device, calls } = fakeDevice();
    expect(await stopPreview(TARGET, device)).toBe('Preview removed from the bar.');
    expect(calls.every(c => c.path.includes(`application_name=${STUDIO_APP}`))).toBe(true);
  });

  it('StopPreview_ClearRefused_StillDeletesTheFileAndSaysWhatFailed', async () => {
    const { device, calls } = fakeDevice({ 'DELETE /api/display/draw': 503 });
    const message = await stopPreview(TARGET, device);
    expect(message).toContain('clearing the display (503)');
    expect(calls.map(c => c.path.split('?')[0])).toContain('/api/assets/upload');
  });
});

describe('assertSameOrigin', () => {
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

  it('AssertSameOrigin_SameHost_Passes', () => {
    expect(() => assertSameOrigin(request({ host: '127.0.0.1:5180', origin: 'http://127.0.0.1:5180' }))).not.toThrow();
  });

  it('AssertSameOrigin_NoOriginHeader_Passes', () => {
    expect(() => assertSameOrigin(request({ host: '127.0.0.1:5180' }))).not.toThrow();
  });

  it('AssertSameOrigin_OtherSite_Throws', () => {
    // Any page in the same browser can post to localhost; this is the check
    // that stops one exporting over Animations/.
    expect(() => assertSameOrigin(request({ host: '127.0.0.1:5180', origin: 'https://example.com' }))).toThrow(
      'cross-origin'
    );
  });
});
