import { describe, expect, it } from 'vitest';
import { createPlate, createScene, createSprite, Sprite, SpriteFrame } from '../src/model/scene';
import { floodFill, framesFromImage } from '../src/ui/sprite-editor';
import { Store } from '../src/ui/store';

function storeWithPlate(): Store {
  const scene = createScene('s');
  scene.layers.push(createPlate(scene));
  return new Store(scene);
}

describe('Store history', () => {
  it('Undo_AfterCommit_RestoresThePreviousScene', () => {
    const store = storeWithPlate();
    const before = store.scene.fps;
    store.commit(s => void (s.fps = 12));
    store.undo();
    expect(store.scene.fps).toBe(before);
    store.redo();
    expect(store.scene.fps).toBe(12);
  });

  it('Commit_AfterUndo_DropsTheRedoBranch', () => {
    const store = storeWithPlate();
    store.commit(s => void (s.fps = 12));
    store.undo();
    store.commit(s => void (s.fps = 24));
    expect(store.canRedo).toBe(false);
  });

  it('TransientStroke_ManyMutations_UndoAsOneStep', () => {
    const store = storeWithPlate();
    const before = store.scene.fps;
    store.beginTransient();
    for (let i = 1; i <= 5; i++) store.mutate(s => void (s.fps = i));
    store.endTransient();
    store.undo();
    expect(store.scene.fps).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it('TransientStroke_NoChange_LeavesNoHistoryEntry', () => {
    const store = storeWithPlate();
    store.beginTransient();
    store.endTransient();
    expect(store.canUndo).toBe(false);
  });

  it('Load_NewScene_ForgetsHistoryAndIsClean', () => {
    const store = storeWithPlate();
    store.commit(s => void (s.fps = 12));
    store.load(createScene('other'));
    expect(store.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it('Undo_OfLayerAdd_ReselectsALayerThatExists', () => {
    const store = storeWithPlate();
    const sprite = createSprite(store.scene);
    store.commit(s => void s.layers.push(sprite));
    store.select(sprite.id);
    store.undo();
    expect(store.selectedLayer?.id).toBe(store.scene.layers[0].id);
  });

  it('Commit_ShorterScene_ClampsThePlayhead', () => {
    const store = storeWithPlate();
    store.setFrame(80);
    store.commit(s => void (s.frameCount = 10));
    expect(store.frame).toBe(9);
  });
});

describe('floodFill', () => {
  it('FloodFill_EnclosedRegion_StopsAtTheBorder', () => {
    const frame: SpriteFrame = { duration: 1, rows: ['aaaa', 'a..a', 'aaaa', '....'] };
    floodFill(frame, 1, 1, 'b');
    expect(frame.rows).toEqual(['aaaa', 'abba', 'aaaa', '....']);
  });

  it('FloodFill_SameColour_ChangesNothing', () => {
    const frame: SpriteFrame = { duration: 1, rows: ['aa'] };
    floodFill(frame, 0, 0, 'a');
    expect(frame.rows).toEqual(['aa']);
  });
});

describe('framesFromImage', () => {
  const sprite: Sprite = { width: 2, height: 1, palette: { a: '#FF0000' }, frames: [] };
  const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

  it('FramesFromImage_Strip_SplitsIntoFramesAndReusesPaletteEntries', () => {
    const data = new Uint8ClampedArray([...px(255, 0, 0), ...px(0, 0, 0, 0), ...px(0, 255, 0), ...px(255, 0, 0)]);
    const { frames, palette } = framesFromImage(data, 4, 1, sprite);
    expect(frames.map(f => f.rows[0])).toEqual(['a.', 'ba']);
    expect(palette).toEqual({ a: '#FF0000', b: '#00FF00' });
  });

  it('FramesFromImage_WrongSize_ThrowsSayingWhatItMustBe', () => {
    expect(() => framesFromImage(new Uint8ClampedArray(3 * 4), 3, 1, sprite)).toThrow('must be 2×1');
  });
});
