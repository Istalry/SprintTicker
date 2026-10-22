import streamDeck, { KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';
import type { DeckController, KeyHandle } from './controller';
import { KEY_KINDS, KeyKind, actionUuid } from './key-kinds';
import { svgDataUrl } from './svg';

/**
 * The SDK's side: one action class per kind, each passing its keys' events
 * to the controller. Nothing is decided here -- the controller and the pure
 * faces behind it are what the tests reach.
 */

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
    this.controller.appear(this.kind, handleOf(ev.action));
  }

  public override onWillDisappear(ev: WillDisappearEvent): void {
    this.controller.disappear(ev.action.id);
  }

  public override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.controller.keyDown(ev.action.id);
  }

  public override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.controller.keyUp(ev.action.id);
  }
}

/** Registers every kind's action with the SDK. */
export function registerActions(controller: DeckController): void {
  for (const kind of KEY_KINDS) {
    streamDeck.actions.registerAction(new SprintTickerAction(kind, controller));
  }
}
