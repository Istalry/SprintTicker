import { ArgumentNullException } from '../../shared/dtos';

export interface LedgerElement {
  type: string;
  path?: string;
  zIndex?: number;
  /**
   * Files the element may still be playing instead of `path`: a draw over it
   * got no answer, so the device holds one or the other.
   */
  maybePaths?: string[];
}

interface ApplicationPanel {
  /**
   * Whether `elements` is the whole of what the device holds for this
   * application. False until a clear empties the panel: a previous run of the
   * app, or one that crashed, may have left elements this run never drew.
   */
  known: boolean;
  elements: Map<string, LedgerElement>;
}

/**
 * What the driver believes each application has on the device's display.
 *
 * There is no endpoint that lists the elements on the panel, so this is built
 * from the driver's own draws, removals and clears. It is what lets the
 * driver refuse requests that cannot do any good, or that break a rule of
 * CLAUDE.md section 4, whoever asked for them:
 *
 * - removing an element known to be absent (the device answers 400);
 * - clearing a panel known to be empty (one more close, for nothing);
 * - uploading over the `.anim` an element is playing (the device answers 508);
 * - closing the screen less than the settle after something left the panel;
 * - removing an animation by id at all, which hangs the bar now and then: the
 *   driver replaces it with an empty one instead, and the ledger tells the
 *   two apart.
 *
 * It can be wrong in one direction only: an element the device dropped by
 * itself -- a reboot, another application taking the display -- is still
 * listed. A removal of it answers 400, which every caller reads as "already
 * gone", so that costs one request. Anything this run cannot vouch for makes
 * the panel *unknown*, and an unknown panel is never skipped.
 */
export class DisplayLedger {
  private readonly panels = new Map<string, ApplicationPanel>();
  /**
   * When an element last left any panel, or an animation was put to rest:
   * the device's screen is one, whoever drew on it. The close that follows
   * waits the settle from here -- the release measured safe 100 times in a
   * row removed the frame, waited 500 ms, then closed.
   */
  private lastRemovalAt: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Elements a draw put on the panel. */
  public noteDrawn(applicationName: string, elements: unknown): void {
    if (!Array.isArray(elements)) return;
    const panel = this.panel(applicationName);
    for (const element of elements as Array<Record<string, unknown>>) {
      if (typeof element?.id !== 'string') continue;
      panel.elements.set(element.id, {
        type: String(element.type ?? 'unknown'),
        path: typeof element.path === 'string' ? element.path : undefined,
        zIndex: typeof element.z_index === 'number' ? element.z_index : undefined
      });
    }
  }

  /**
   * A draw that got no answer. It may have landed, so its elements are
   * listed -- an animation among them must still be taken down before a
   * close -- and the panel is no longer vouched for. What each replaced may
   * still be there: an upload over a file it was playing answers 508.
   */
  public noteDrawUncertain(applicationName: string, elements: unknown): void {
    const panel = this.panel(applicationName);
    const before = new Map(panel.elements);
    this.noteDrawn(applicationName, elements);
    for (const [id, element] of panel.elements) {
      const previous = before.get(id);
      if (!previous || previous === element) continue;
      const maybe = new Set([...(previous.maybePaths ?? []), ...(previous.path ? [previous.path] : [])]);
      if (element.path) maybe.delete(element.path);
      if (maybe.size > 0) element.maybePaths = [...maybe];
    }
    panel.known = false;
  }

  /**
   * @param confirmed The device answered that it removed them: a removal for
   *   the settle even when this ledger never listed them, as on a panel left
   *   by a previous run.
   */
  public noteRemoved(applicationName: string, elementIds: string[], confirmed = false): void {
    if (confirmed) this.lastRemovalAt = this.now();
    const panel = this.panels.get(applicationName);
    if (!panel) return;
    for (const id of elementIds) {
      if (panel.elements.delete(id)) this.lastRemovalAt = this.now();
    }
  }

  /**
   * An animation replaced by the empty one: still on the panel, showing
   * nothing. It counts as a removal for the settle before a close.
   */
  public noteParked(applicationName: string, elementId: string, blankPath: string): void {
    const panel = this.panel(applicationName);
    const zIndex = panel.elements.get(elementId)?.zIndex;
    panel.elements.set(elementId, { type: 'animation', path: blankPath, zIndex });
    this.lastRemovalAt = this.now();
  }

  /** A clear the device carried out: the panel is empty, and now known to be. */
  public noteCleared(applicationName: string): void {
    const panel = this.panel(applicationName);
    panel.elements.clear();
    panel.known = true;
  }

  /** A clear that got no answer: it may or may not have emptied the panel. */
  public noteClearUncertain(applicationName: string): void {
    this.panel(applicationName).known = false;
  }

  /** Another device, or one that may have rebooted: nothing listed can be vouched for. */
  public forgetAll(): void {
    for (const panel of this.panels.values()) panel.known = false;
  }

  public ids(applicationName: string, type?: string): string[] {
    const panel = this.panels.get(applicationName);
    if (!panel) return [];
    return [...panel.elements].filter(([, el]) => type === undefined || el.type === type).map(([id]) => id);
  }

  /** The element as last drawn, or undefined when it is not listed. */
  public element(applicationName: string, elementId: string): Readonly<LedgerElement> | undefined {
    return this.panels.get(applicationName)?.elements.get(elementId);
  }

  /** Whether the panel's contents are vouched for: emptied by a clear, and only this run's draws since. */
  public isKnown(applicationName: string): boolean {
    return this.panels.get(applicationName)?.known ?? false;
  }

  public isKnownAbsent(applicationName: string, elementId: string): boolean {
    if (!elementId) throw new ArgumentNullException('elementId');
    const panel = this.panels.get(applicationName);
    return panel !== undefined && panel.known && !panel.elements.has(elementId);
  }

  public isKnownEmpty(applicationName: string): boolean {
    const panel = this.panels.get(applicationName);
    return panel !== undefined && panel.known && panel.elements.size === 0;
  }

  /**
   * Whether removing `elementIds` could leave the panel empty, which closes
   * the device's screen. Yes when nothing listed would remain, even on an
   * unknown panel: what the ledger cannot see is no reason to assume it is
   * there.
   */
  public couldEmpty(applicationName: string, elementIds: string[]): boolean {
    const panel = this.panels.get(applicationName);
    if (!panel) return true;
    return [...panel.elements.keys()].every(id => elementIds.includes(id));
  }

  /** Whether an animation element on the panel is playing `path`. */
  public isPlaying(applicationName: string, path: string): boolean {
    const panel = this.panels.get(applicationName);
    if (!panel) return false;
    return [...panel.elements.values()].some(
      el => el.type === 'animation' && (el.path === path || (el.maybePaths?.includes(path) ?? false))
    );
  }

  /** How long a close must still wait for the device to settle after the last removal. */
  public settleRemainingMs(settleMs: number): number {
    if (this.lastRemovalAt === null) return 0;
    return Math.max(0, settleMs - (this.now() - this.lastRemovalAt));
  }

  private panel(applicationName: string): ApplicationPanel {
    let panel = this.panels.get(applicationName);
    if (!panel) {
      panel = { known: false, elements: new Map() };
      this.panels.set(applicationName, panel);
    }
    return panel;
  }
}
