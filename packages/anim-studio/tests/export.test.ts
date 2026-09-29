import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlate, createScene } from '../src/model/scene';
import { frameFileName, loadDeviceModule, RenderedSequence, sequenceDir, writeSequence } from '../server/export';
import { listScenes, loadScene, renderSequence, saveScene } from '../server/scenes';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { encodePng } = loadDeviceModule(REPO_ROOT);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sequence(frameCount: number): RenderedSequence {
  return {
    id: 'test',
    width: 2,
    height: 1,
    fps: 24,
    frames: Array.from({ length: frameCount }, () => new Uint8Array(2 * 1 * 4))
  };
}

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-studio-test-'));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe('frameFileName', () => {
  it('FrameFileName_Index_HasNoDigitsBesideTheFrameNumber', () => {
    // seq2anim reads a frame's position from every digit in its name.
    expect(frameFileName(7)).toBe('frame_00007.png');
    expect(frameFileName(7).replace(/\D/g, '')).toBe('00007');
  });
});

describe('sequenceDir', () => {
  it('SequenceDir_ValidId_NestsTheFolderTheWayTheAppReadsIt', () => {
    expect(sequenceDir('/anims', 'lunch_72x16')).toBe(path.join('/anims', 'lunch_72x16', 'lunch_72x16'));
  });

  it('SequenceDir_TraversalId_Throws', () => {
    expect(() => sequenceDir('/anims', '../x')).toThrow('invalid scene id');
  });
});

describe('writeSequence', () => {
  it('WriteSequence_NewFolder_WritesPngFramesAndMeta', () => {
    const dir = path.join(work, 'seq');
    const files = writeSequence(dir, sequence(3), encodePng);

    expect(files.map(f => path.basename(f))).toEqual(['frame_00000.png', 'frame_00001.png', 'frame_00002.png']);
    expect(fs.readFileSync(files[0]).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))).toEqual({
      fps: 24,
      color_mode: 'rgb888',
      sections: []
    });
  });

  it('WriteSequence_ShorterReExport_RemovesStaleFrames', () => {
    const dir = path.join(work, 'seq');
    writeSequence(dir, sequence(5), encodePng);
    writeSequence(dir, sequence(2), encodePng);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.png'))).toEqual(['frame_00000.png', 'frame_00001.png']);
  });

  it('WriteSequence_FolderWithForeignFiles_ThrowsAndLeavesThemAlone', () => {
    // The shape of a firmware frame set: it must never be overwritten.
    const dir = path.join(work, 'seq');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'Lunch_salad_00000.png'), 'x');
    expect(() => writeSequence(dir, sequence(1), encodePng)).toThrow('did not write');
    expect(fs.readdirSync(dir)).toEqual(['Lunch_salad_00000.png']);
  });

  it('WriteSequence_ExistingAnimFile_IsKept', () => {
    const dir = path.join(work, 'seq');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'test.anim'), 'x');
    writeSequence(dir, sequence(1), encodePng);
    expect(fs.existsSync(path.join(dir, 'test.anim'))).toBe(true);
  });

  it('WriteSequence_FrameOfWrongSize_Throws', () => {
    const bad = sequence(1);
    bad.frames[0] = new Uint8Array(3);
    expect(() => writeSequence(path.join(work, 'seq'), bad, encodePng)).toThrow('frame 0 is 3 bytes');
  });

  it('WriteSequence_NoFrames_Throws', () => {
    expect(() => writeSequence(path.join(work, 'seq'), sequence(0), encodePng)).toThrow('at least one frame');
  });
});

describe('scene storage', () => {
  it('SaveScene_ThenLoad_ReturnsTheSameScene', () => {
    const scene = createScene('saved_72x16');
    scene.layers.push(createPlate(scene));
    saveScene(work, scene);
    expect(loadScene(work, 'saved_72x16')).toEqual(scene);
    expect(listScenes(work)).toEqual(['saved_72x16']);
  });

  it('SaveScene_InvalidScene_ThrowsAndWritesNothing', () => {
    expect(() => saveScene(work, { version: 1, id: 'bad', width: 10 })).toThrow();
    expect(fs.readdirSync(work)).toEqual([]);
  });

  it('LoadScene_TraversalId_Throws', () => {
    expect(() => loadScene(work, '../../etc')).toThrow('invalid scene id');
  });

  it('ListScenes_MissingFolder_ReturnsEmpty', () => {
    expect(listScenes(path.join(work, 'nope'))).toEqual([]);
  });

  it('RenderSequence_Scene_HasOneFullSizeFramePerSceneFrame', () => {
    const scene = { ...createScene('r'), frameCount: 4 };
    const rendered = renderSequence(scene);
    expect(rendered.frames).toHaveLength(4);
    expect(rendered.frames[0].byteLength).toBe(72 * 16 * 4);
  });
});
