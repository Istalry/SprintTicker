import streamDeck, {
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from '@elgato/streamdeck';
import type { DeckController, KeyHandle } from './controller';
import { KEY_KINDS, KeyKind, LIST_TASKS_MESSAGE, actionUuid, parseFavourite } from './key-kinds';
import { svgDataUrl } from './svg';

/**
 * The SDK's side: one action class per kind, each passing its keys' events
 * to the controller. Nothing is decided here -- the controller and the pure
 * faces behind it are what the tests reach.
 */

/** The SDK's event for a property inspector's message; its payload type is not exported. */
type SendToPlugin = Parameters<NonNullable<SingletonAction['onSendToPlugin']>>[0];

/** A key action, as the SDK hands one over; its settings type is not exported. */
type SdkKey = Pick<KeyDownEvent['action'], 'id' | 'setImage' | 'showAlert'>;

function handleOf(action: SdkKey): KeyHandle {
  return {
    id: action.id,
    setImage: svg => action.setImage(svgDataUrl(svg)),
    showAlert: () => action.showAlert()
  };
}

class SprintTickerAction extends SingletonAction {
  public override readonly manifestId: string;

  constructor(
    private readonly kind: KeyKind,
    private readonly controller: DeckController
  ) {
    super();
    this.manifestId = actionUuid(kind);
  }

  // Keys only: the plugin declares no dial or touch-strip action.
  public override onWillAppear(ev: WillAppearEvent): void {
    if (!ev.action.isKey()) return;
    this.controller.appear(this.kind, handleOf(ev.action), parseFavourite(ev.payload.settings));
  }

  public override onWillDisappear(ev: WillDisappearEvent): void {
    this.controller.disappear(ev.action.id);
  }

  public override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.controller.press(ev.action.id);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.controller.settingsChanged(ev.action.id, parseFavourite(ev.payload.settings));
  }

  /**
   * The favourite's property inspector asks for the tasks to choose from;
   * the answer goes back to it, or `{ tasks: null }` when SprintTicker is
   * not there to ask.
   */
  public override async onSendToPlugin(ev: SendToPlugin): Promise<void> {
    const payload = ev.payload as { request?: unknown } | null;
    if (payload?.request !== LIST_TASKS_MESSAGE) return;
    const tasks = await this.controller.listTasks();
    // Plain data: the tasks as the app sent them, which were JSON already.
    await streamDeck.ui.sendToPropertyInspector({ tasks } as unknown as Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0]);
  }
}

/** Registers every kind's action with the SDK. */
export function registerActions(controller: DeckController): void {
  for (const kind of KEY_KINDS) {
    streamDeck.actions.registerAction(new SprintTickerAction(kind, controller));
  }
}
