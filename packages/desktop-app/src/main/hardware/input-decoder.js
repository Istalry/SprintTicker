import { SettingsRepository } from '../db/repositories/settings-repository';
/**
 * Event decoder mapping physical BUSY Bar inputs (wheel scroll, wheel click, short/long press)
 * to user-configured rebindable application actions.
 */
export class InputDecoder {
    driver;
    engine;
    settingsRepo;
    actionHandlers = new Set();
    defaultBindings = {
        startButtonPress: 'TOGGLE_TRACK_PAUSE',
        wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
        wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
        wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
        backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
        backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
    };
    constructor(driver, engine, settingsRepo) {
        this.driver = driver;
        this.engine = engine;
        this.settingsRepo = settingsRepo || new SettingsRepository();
        this.driver.on('input', (event) => this.handleHardwareInput(event));
    }
    /**
     * Retrieves active hardware rebindings config from database or defaults.
     */
    getBindings() {
        return this.settingsRepo.getSetting('hardware_bindings', this.defaultBindings);
    }
    /**
     * Saves updated hardware rebindings.
     */
    saveBindings(config) {
        this.settingsRepo.setSetting('hardware_bindings', config);
    }
    registerActionHandler(handler) {
        this.actionHandlers.add(handler);
        return () => this.actionHandlers.delete(handler);
    }
    /**
     * Decodes incoming hardware input and triggers mapped action.
     */
    handleHardwareInput(event) {
        const bindings = this.getBindings();
        let action = 'NONE';
        if (event.key === 'start' || (event.key === 'ok' && event.type === 'press')) {
            action = bindings.startButtonPress;
        }
        else if (event.key === 'ok' && event.type === 'press') {
            action = bindings.wheelClick;
        }
        else if (event.key === 'up') {
            action = bindings.wheelRotateLeft;
        }
        else if (event.key === 'down') {
            action = bindings.wheelRotateRight;
        }
        else if (event.key === 'back' && event.type === 'press') {
            action = bindings.backButtonShortPress;
        }
        else if (event.key === 'back_hold' || (event.key === 'back' && event.type === 'long_press')) {
            action = bindings.backButtonLongPress;
        }
        this.executeAction(action, event.key);
        return action;
    }
    /**
     * Executes engine or UI action based on decoded binding.
     */
    executeAction(action, inputKey) {
        console.log(`[InputDecoder] Executing Action: ${action} (Key: ${inputKey})`);
        switch (action) {
            case 'TOGGLE_TRACK_PAUSE': {
                const active = this.engine.getCurrentSession();
                if (!active) {
                    this.engine.startTask('PROJ-101', false, 'Development Task');
                }
                else if (active.status === 'TRACKING') {
                    this.engine.pauseSession();
                }
                else if (active.status === 'PAUSED') {
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
            }
            catch (err) {
                console.error('[InputDecoder] Error in action handler:', err);
            }
        }
    }
}
//# sourceMappingURL=input-decoder.js.map