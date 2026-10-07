/**
 * A fake BUSY Bar that answers HTTP the way firmware 1.2.4 does, and checks
 * every request against the hardware contract in CLAUDE.md section 4.
 *
 * The screen model is the part of the firmware's canvas service (`canvas.c`)
 * that decides when the device's screen closes:
 *
 * - A draw merges by element id and opens the screen if it was closed.
 * - A removal by `element_ids` checks every id before removing any: one
 *   missing id is a 400 and nothing goes. On a closed screen it is a 400.
 * - Whatever empties the element set closes the screen. A full DELETE on a
 *   closed screen does nothing and answers 200.
 * - An upload over an `.anim` an element is playing answers 508.
 *
 * Every rule a real bar was measured breaking on is a {@link RuleId}. A test
 * ends with `expectClean()`, so a code path that breaks one fails in CI
 * rather than on the user's desk -- which is where the 2026-10-05 hang, two
 * clears closing the screen without the settle, was found.
 *
 * **A rule measured on the bar belongs here.** When the probe finds a new way
 * to hang or reboot the device, add it as a rule, and every test that drives
 * the display starts checking it.
 */

/** The ways a request can break the hardware contract. */
export type RuleId =
  /** The screen closed less than the settle after an animation came off it: the sequence that hung the bar on round 6. */
  | 'close-too-soon-after-animation'
  /** The screen closed with an image and an animation both on it: hung the bar on rounds 3 and 4. */
  | 'close-with-image-and-animation'
  /** Two display or asset requests in flight at once. Nothing on the firmware is known to need it, and races between them are what the clears had. */
  | 'overlapping-display-requests'
  /** A full clear of a screen already closed, after something has been drawn: a request with nothing to do. */
  | 'redundant-clear'
  /** A removal naming an element the device does not hold: answered 400. */
  | 'absent-element-removal'
  /** An upload over the `.anim` an element is playing: answered 508. */
  | 'upload-over-playing-anim'
  /** A body the firmware rejects, or one that reboots it: colours, text, fill colour counts, names, priority. */
  | 'contract';

export interface Violation {
  rule: RuleId;
  /** `METHOD /path` of the request that broke it. */
  request: string;
  detail: string;
  /** Milliseconds since the simulator was created. */
  atMs: number;
}

export interface ScreenClose {
  /** The element types on the panel at the moment its screen closed. */
  types: string[];
  /** How long before the close the last animation left the panel, or null if none ever did. */
  sinceLastAnimationRemovedMs: number | null;
}

export interface FirmwareSimulatorOptions {
  /** The pause the device needs between an animation leaving and the screen closing. */
  settleMs: number;
  /**
   * How long each display or asset request takes to answer. Zero answers at
   * once, and no two requests can then overlap; a latency is what lets a test
   * see requests racing.
   */
  latencyMs?: number | (() => number);
  /**
   * Allowance on timing rules, for real timers firing a millisecond early.
   * Zero under fake timers.
   */
  timingToleranceMs?: number;
}

/** Same rule as the driver's `ASSET_FILENAME_REGEX`, restated so a drift between them is visible. */
const ASSET_NAME = /^[a-zA-Z0-9._-]+$/;
const COLOUR = /^#[0-9A-Fa-f]{8}$/;
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;
/** From the driver's `DEFAULT_DRAW_PRIORITY`: below it the app does not hold the display. */
const MIN_DRAW_PRIORITY = 95;

interface Element {
  type: string;
  path?: string;
}

export class FirmwareSimulator {
  public readonly elements = new Map<string, Element>();
  public readonly closes: ScreenClose[] = [];
  public readonly violations: Violation[] = [];
  /** Every request, as `METHOD /path body`. */
  public readonly requests: string[] = [];
  /** Every element set the panel has shown, for "was it ever empty" checks. */
  public readonly history: string[][] = [];
  /**
   * Every display request with when it was answered, its status and the panel
   * after it, for reading a failure: `formatTrace()` prints it.
   */
  public readonly trace: Array<{ atMs: number; request: string; status: number; panel: string[] }> = [];
  public screenOpen = false;
  /** The most display and asset requests ever in flight together. */
  public maxInFlight = 0;

  private readonly settleMs: number;
  private readonly latency: () => number;
  private readonly toleranceMs: number;
  private readonly startedAt = Date.now();
  private lastAnimationRemovedAt: number | null = null;
  private inFlight = 0;
  /** A clear before anything is drawn is not redundant: the driver cannot know a previous run left nothing. */
  private everDrawn = false;
  private restoreFetch: (() => void) | null = null;

  constructor(options: FirmwareSimulatorOptions) {
    this.settleMs = options.settleMs;
    const latency = options.latencyMs ?? 0;
    this.latency = typeof latency === 'function' ? latency : () => latency;
    this.toleranceMs = options.timingToleranceMs ?? 2;
  }

  /** Replaces `globalThis.fetch` with this device until `uninstall()`. */
  public install(): this {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => this.fetch(String(url), init)) as typeof fetch;
    this.restoreFetch = () => {
      globalThis.fetch = original;
    };
    return this;
  }

  public uninstall(): void {
    this.restoreFetch?.();
    this.restoreFetch = null;
  }

  public shown(): string[] {
    return [...this.elements.keys()].sort();
  }

  public has(id: string): boolean {
    return this.elements.has(id);
  }

  /** Violations of one rule. */
  public violationsOf(rule: RuleId): Violation[] {
    return this.violations.filter(v => v.rule === rule);
  }

  /**
   * Throws, listing every violation, unless the run broke no rule outside
   * `allow`. A test that provokes a rule on purpose names it there.
   */
  public expectClean(options: { allow?: RuleId[] } = {}): void {
    const allowed = new Set(options.allow ?? []);
    const found = this.violations.filter(v => !allowed.has(v.rule));
    if (found.length === 0) return;
    const lines = found.map(v => `  [${v.rule}] at ${v.atMs} ms, ${v.request}: ${v.detail}`);
    throw new Error(`The firmware simulator saw ${found.length} contract violation(s):\n${lines.join('\n')}`);
  }

  public async fetch(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET';
    const parsed = new URL(url);
    const label = `${method} ${parsed.pathname}`;
    this.requests.push(`${label}${init?.body && typeof init.body === 'string' ? ' ' + init.body : ''}`);

    const isDisplay = parsed.pathname.startsWith('/api/display/draw') || parsed.pathname.startsWith('/api/assets/');
    if (!isDisplay) return this.answer(200);

    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.inFlight > 1) {
      this.violate('overlapping-display-requests', label, `${this.inFlight} display requests in flight`);
    }
    try {
      const latency = this.latency();
      if (latency > 0) await new Promise(resolve => setTimeout(resolve, latency));
      // Applied when the device answers, which is when it acted: a request
      // that is still in flight has not changed the panel yet.
      const response = this.handle(label, parsed, method, init);
      const body = typeof init?.body === 'string' ? ' ' + this.summarise(init.body) : '';
      const file = parsed.searchParams.get('file');
      this.trace.push({
        atMs: Date.now() - this.startedAt,
        request: `${label}${file ? ' ' + file : ''}${body}`,
        status: response.status,
        panel: this.shown()
      });
      return response;
    } finally {
      this.inFlight--;
    }
  }

  private handle(label: string, url: URL, method: string, init?: RequestInit): Response {
    if (url.pathname === '/api/assets/upload') {
      if (method !== 'POST') return this.answer(200);
      const file = url.searchParams.get('file') ?? '';
      if (!ASSET_NAME.test(file)) this.violate('contract', label, `asset name ${JSON.stringify(file)}`);
      if (!url.searchParams.get('application_name')) this.violate('contract', label, 'upload without application_name');
      const playing = [...this.elements.values()].some(el => el.type === 'animation' && el.path === file);
      if (playing) {
        this.violate('upload-over-playing-anim', label, `${file} is playing`);
        return this.answer(508);
      }
      return this.answer(200);
    }
    if (url.pathname === '/api/display/draw') {
      if (method === 'POST') return this.draw(label, JSON.parse(String(init?.body)));
      if (method === 'DELETE') {
        return init?.body ? this.remove(label, JSON.parse(String(init.body)).element_ids as string[]) : this.clear(label);
      }
    }
    return this.answer(200);
  }

  private draw(label: string, payload: Record<string, unknown>): Response {
    this.checkDrawContract(label, payload);
    const elements = (payload.elements as Array<{ id: string; type: string; path?: string }>) ?? [];
    this.screenOpen = true;
    this.everDrawn = true;
    for (const el of elements) this.elements.set(el.id, { type: el.type, path: el.path });
    this.snapshot();
    return this.answer(200);
  }

  private remove(label: string, ids: string[]): Response {
    const missing = ids.filter(id => !this.elements.has(id));
    if (!this.screenOpen || missing.length > 0) {
      this.violate('absent-element-removal', label, `not on the panel: ${(this.screenOpen ? missing : ids).join(', ')}`);
      return this.answer(400);
    }
    // The settle is measured from the animations that left *before* this
    // request. An animation that is the last thing on the panel closes the
    // screen as it goes, and that alone closed safely every time it was
    // measured; the hang needs something else left to close on afterwards.
    const settleFrom = this.lastAnimationRemovedAt;
    const removedTypes: string[] = [];
    for (const id of ids) {
      const type = this.elements.get(id)?.type ?? 'unknown';
      removedTypes.push(type);
      if (type === 'animation') this.lastAnimationRemovedAt = Date.now();
      this.elements.delete(id);
    }
    this.snapshot();
    if (this.elements.size === 0) this.close(label, removedTypes, settleFrom);
    return this.answer(200);
  }

  private clear(label: string): Response {
    if (!this.screenOpen) {
      if (this.everDrawn) this.violate('redundant-clear', label, 'the screen is already closed');
      return this.answer(200);
    }
    const types = [...this.elements.values()].map(el => el.type);
    this.elements.clear();
    this.snapshot();
    this.close(label, types, this.lastAnimationRemovedAt);
    return this.answer(200);
  }

  /**
   * @param types What the close took off the panel.
   * @param settleFrom When an animation last left before this close began.
   */
  private close(label: string, types: string[], settleFrom: number | null): void {
    const since = settleFrom === null ? null : Date.now() - settleFrom;
    this.closes.push({
      types,
      sinceLastAnimationRemovedMs: this.lastAnimationRemovedAt === null ? null : Date.now() - this.lastAnimationRemovedAt
    });
    if (types.includes('animation') && types.some(type => type !== 'animation')) {
      this.violate('close-with-image-and-animation', label, `closed on ${types.join(', ')}`);
    }
    if (since !== null && since < this.settleMs - this.toleranceMs) {
      this.violate('close-too-soon-after-animation', label, `closed ${since} ms after an animation left, settle is ${this.settleMs} ms`);
    }
    this.screenOpen = false;
  }

  private checkDrawContract(label: string, payload: Record<string, unknown>): void {
    if (typeof payload.application_name !== 'string' || payload.application_name === '') {
      this.violate('contract', label, 'draw without application_name');
    }
    if ('app_id' in payload) this.violate('contract', label, 'app_id is ignored by the firmware; use application_name');
    if (typeof payload.priority !== 'number' || payload.priority < MIN_DRAW_PRIORITY) {
      this.violate('contract', label, `priority ${String(payload.priority)} is below ${MIN_DRAW_PRIORITY}`);
    }
    this.checkColours(label, payload, 'payload');
    const elements = payload.elements;
    if (!Array.isArray(elements) || elements.length === 0) {
      // The schema says minItems: 1; the whole draw is a 400.
      this.violate('contract', label, 'a draw needs at least one element');
      return;
    }
    for (const el of elements as Array<Record<string, unknown>>) {
      const where = `element ${String(el.id)}`;
      this.checkColours(label, el, where);
      if (el.display === 'back') this.violate('contract', label, `${where} draws on the rear display, which the app leaves to the firmware`);
      if (el.type === 'text' && typeof el.text === 'string' && !PRINTABLE_ASCII.test(el.text)) {
        this.violate('contract', label, `${where} text is not printable ASCII`);
      }
      if ((el.type === 'image' || el.type === 'animation') && (typeof el.path !== 'string' || !ASSET_NAME.test(el.path))) {
        this.violate('contract', label, `${where} path ${JSON.stringify(el.path)}`);
      }
      if (el.type === 'rectangle') {
        // A wrong count reboots the device.
        const fill = String(el.fill ?? 'solid').toLowerCase();
        const count = Array.isArray(el.fill_colors) ? el.fill_colors.length : 0;
        const expected = fill.startsWith('gradient') ? 2 : 1;
        if (count !== expected) this.violate('contract', label, `${where} ${fill} fill with ${count} colours, needs ${expected}`);
      }
    }
  }

  /** Every field named `...color` or `...colors` must be `#RRGGBBAA`; one bad one makes the whole draw a 400. */
  private checkColours(label: string, obj: Record<string, unknown>, where: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (!/colou?rs?$/i.test(key)) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const colour of values) {
        if (typeof colour !== 'string' || !COLOUR.test(colour)) {
          this.violate('contract', label, `${where} ${key} ${JSON.stringify(colour)} is not #RRGGBBAA`);
        }
      }
    }
  }

  public formatTrace(): string {
    return this.trace
      .map(t => `${String(t.atMs).padStart(6)} ms  ${t.status}  ${t.request}  -> [${t.panel.join(', ')}]`)
      .join('\n');
  }

  /** A draw's element ids and types, or a removal's ids; not the whole body. */
  private summarise(body: string): string {
    try {
      const parsed = JSON.parse(body) as { elements?: Array<{ id: string; type: string; path?: string }>; element_ids?: string[] };
      if (parsed.element_ids) return `remove ${parsed.element_ids.join(',')}`;
      if (parsed.elements) return `draw ${parsed.elements.map(el => `${el.id}:${el.type}${el.path ? '(' + el.path + ')' : ''}`).join(',')}`;
    } catch {
      // Not JSON: an upload's bytes. Nothing worth printing.
    }
    return '';
  }

  private snapshot(): void {
    this.history.push(this.shown());
  }

  private violate(rule: RuleId, request: string, detail: string): void {
    this.violations.push({ rule, request, detail, atMs: Date.now() - this.startedAt });
  }

  private answer(code: number): Response {
    return { ok: code >= 200 && code < 300, status: code, json: async () => ({}), text: async () => '' } as Response;
  }
}
