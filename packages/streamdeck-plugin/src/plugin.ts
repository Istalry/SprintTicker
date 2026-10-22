import streamDeck from '@elgato/streamdeck';
import { registerActions } from './actions';
import { AppLink } from './app-link';
import { DeckController } from './controller';

/**
 * The plugin's entry point, run by Stream Deck's own Node.js (manifest
 * `Nodejs.Version`). It reaches SprintTicker over the app's local socket and
 * keeps trying while the app is closed.
 */
const link = new AppLink();
const controller = new DeckController(link, {
  log: message => streamDeck.logger.warn(message)
});

registerActions(controller);
link.start();
void streamDeck.connect();
