import { Layer, Scene, SpriteLayer, parseScene, serializeScene } from '../model/scene';

/**
 * The editor's state, and the only thing allowed to change the scene.
 *
 * Every edit goes through `commit`, which records the scene as it was before,
 * so undo is a property of the store rather than something each panel has to
 * remember to support. Snapshots are serialised JSON: scenes are a few
 * kilobytes, and a string cannot be mutated behind the history's back.
 */

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

/** Why listeners are being called, so a panel can skip work it does not need. */
export type ChangeReason = 'scene' | 'selection' | 'frame' | 'playback' | 'tool' | 'file';

export interface ChangeEvent {
  reason: ChangeReason;
  /** The panel that made the change, which usually need not rebuild itself. */
  origin?: string;
}

const HISTORY_LIMIT = 200;

export class Store {
  public scene: Scene;
  public selectedLayerId: string | null = null;
  public frame = 0;
  public playing = false;
  public spriteFrame = 0;
  public tool: Tool = 'pencil';
  public colorKey = 'a';
  public onionSkin = true;
  /** Whether the scene has changed since it was last saved or loaded. */
  public dirty = false;

  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private readonly listeners = new Set<(event: ChangeEvent) => void>();
  private transientBase: string | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.selectedLayerId = scene.layers[0]?.id ?? null;
  }

  public subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(reason: ChangeReason, origin?: string): void {
    for (const listener of this.listeners) listener({ reason, origin });
  }

  // ─── editing ────────────────────────────────────────────────────────────────

  /** Applies `edit` to the scene as one undoable step. */
  public commit(edit: (scene: Scene) => void, origin?: string): void {
    this.pushUndo(serializeScene(this.scene));
    edit(this.scene);
    this.afterEdit(origin);
  }

  /**
   * Starts an edit made of many small changes -- a pencil stroke -- that
   * should undo as one. Changes go through `mutate` until `endTransient`.
   */
  public beginTransient(): void {
    if (this.transientBase === null) this.transientBase = serializeScene(this.scene);
  }

  public mutate(edit: (scene: Scene) => void, origin?: string): void {
    edit(this.scene);
    this.dirty = true;
    this.clampFrames();
    this.emit('scene', origin);
  }

  public endTransient(): void {
    if (this.transientBase === null) return;
    if (this.transientBase !== serializeScene(this.scene)) this.pushUndo(this.transientBase);
    this.transientBase = null;
  }

  public undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(serializeScene(this.scene));
    this.restore(previous);
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(serializeScene(this.scene));
    this.restore(next);
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Replaces the scene outright -- a file opened -- and forgets the history. */
  public load(scene: Scene): void {
    this.scene = scene;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selectedLayerId = scene.layers[0]?.id ?? null;
    this.frame = 0;
    this.spriteFrame = 0;
    this.dirty = false;
    this.emit('scene');
    this.emit('selection');
  }

  // ─── selection and playback ─────────────────────────────────────────────────

  public get selectedLayer(): Layer | null {
    return this.scene.layers.find(l => l.id === this.selectedLayerId) ?? null;
  }

  public get selectedSprite(): SpriteLayer | null {
    const layer = this.selectedLayer;
    return layer?.type === 'sprite' ? layer : null;
  }

  public select(layerId: string | null): void {
    this.selectedLayerId = layerId;
    this.spriteFrame = 0;
    this.emit('selection');
  }

  public setFrame(frame: number): void {
    const clamped = Math.min(Math.max(0, Math.round(frame)), this.scene.frameCount - 1);
    if (clamped === this.frame) return;
    this.frame = clamped;
    this.emit('frame');
  }

  public setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit('playback');
  }

  public setSpriteFrame(index: number): void {
    const sprite = this.selectedSprite;
    if (!sprite) return;
    this.spriteFrame = Math.min(Math.max(0, index), sprite.sprite.frames.length - 1);
    this.emit('tool');
  }

  public setTool(tool: Tool): void {
    this.tool = tool;
    this.emit('tool');
  }

  public setColorKey(key: string): void {
    this.colorKey = key;
    this.emit('tool');
  }

  public setOnionSkin(on: boolean): void {
    this.onionSkin = on;
    this.emit('tool');
  }

  public markSaved(): void {
    this.dirty = false;
    this.emit('file');
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private pushUndo(snapshot: string): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private afterEdit(origin?: string): void {
    this.dirty = true;
    this.clampFrames();
    this.emit('scene', origin);
  }

  private restore(snapshot: string): void {
    this.scene = parseScene(JSON.parse(snapshot));
    if (!this.scene.layers.some(l => l.id === this.selectedLayerId)) {
      this.selectedLayerId = this.scene.layers[0]?.id ?? null;
    }
    this.dirty = true;
    this.clampFrames();
    this.emit('scene');
    this.emit('selection');
  }

  /** Keeps the playhead and the edited sprite frame inside what still exists. */
  private clampFrames(): void {
    this.frame = Math.min(this.frame, this.scene.frameCount - 1);
    const sprite = this.selectedSprite;
    if (sprite) this.spriteFrame = Math.min(this.spriteFrame, sprite.sprite.frames.length - 1);
  }
}
