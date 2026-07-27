import { BusyBarDriver, HardwareEvent } from './busybar-driver';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { HardwareBindingConfig } from '../../shared/dtos';

export type ActionHandler = (action: string, inputKey: string) => void;

/**
 * Event decoder mapping physical BUSY Bar inputs (wheel scroll, wheel click, short/long press)
 * to user-configured rebindable application actions.
 */
export class InputDecoder {
  private driver: BusyBarDriver;
  private engine: TimeTrackingEngine;
  private settingsRepo: SettingsRepository;
  private actionHandlers: Set<ActionHandler> = new Set();

  private defaultBindings: HardwareBindingConfig = {
    startButtonPress: 'TOGGLE_TRACK_PAUSE',
    wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
    wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
    wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
    backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
    backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
  };

  constructor(
    driver: BusyBarDriver,
    engine: TimeTrackingEngine,
    settingsRepo?: SettingsRepository
  ) {
    this.driver = driver;
    this.engine = engine;
    this.settingsRepo = settingsRepo || new SettingsRepository();

    this.driver.on('input', (event: HardwareEvent) => this.handleHardwareInput(event));
  }

  /**
   * Retrieves active hardware rebindings config from database or defaults.
   */
  public getBindings(): HardwareBindingConfig {
    return this.settingsRepo.getSetting<HardwareBindingConfig>('hardware_bindings', this.defaultBindings);
  }

  /**
   * Saves updated hardware rebindings.
   */
  public saveBindings(config: HardwareBindingConfig): void {
    this.settingsRepo.setSetting('hardware_bindings', config);
  }

  public registerActionHandler(handler: ActionHandler): () => void {
    this.actionHandlers.add(handler);
    return () => this.actionHandlers.delete(handler);
  }

  /**
   * Decodes incoming hardware input and triggers mapped action.
   */
  public handleHardwareInput(event: HardwareEvent): string {
    const bindings = this.getBindings();
    let action = 'NONE';

    if (event.key === 'start') {
      action = bindings.startButtonPress;
    } else if (event.key === 'ok' && event.type === 'press') {
      action = bindings.wheelClick;
    } else if (event.key === 'up') {
      action = bindings.wheelRotateLeft;
    } else if (event.key === 'down') {
      action = bindings.wheelRotateRight;
    } else if (event.key === 'back' && event.type === 'press') {
      action = bindings.backButtonShortPress;
    } else if (event.key === 'back_hold' || (event.key === 'back' && event.type === 'long_press')) {
      action = bindings.backButtonLongPress;
    }

    this.executeAction(action, event.key);
    return action;
  }

  /**
   * Executes engine or UI action based on decoded binding.
   */
  private executeAction(action: string, inputKey: string): void {
    console.log(`[InputDecoder] Executing Action: ${action} (Key: ${inputKey})`);

    switch (action) {
      case 'TOGGLE_TRACK_PAUSE': {
        const active = this.engine.getCurrentSession();
        if (!active) {
          this.engine.startTask('PROJ-101', false, 'Development Task');
        } else if (active.status === 'TRACKING') {
          this.engine.pauseSession();
        } else if (active.status === 'PAUSED') {
          this.engine.resumeSession();
        }
        break;
      }
      case 'COMPLETE_AND_LOG_ACTIVE_TASK': {
        this.engine.stopSession('Completed via BUSY Bar Long Press');
        break;
      }
    }

    for (const handler of this.actionHandlers) {
      try {
        handler(action, inputKey);
      } catch (err) {
        console.error('[InputDecoder] Error in action handler:', err);
      }
    }
  }
}
