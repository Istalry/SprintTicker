import { BusyBarDriver, HardwareEvent } from './busybar-driver';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { HardwareBindingConfig } from '../../shared/dtos';
import { IPriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { DisplayRenderer } from './display-renderer';

export type ActionHandler = (action: string, inputKey: string) => void;

/**
 * Event decoder mapping physical BUSY Bar inputs (wheel scroll, wheel click, short/long press)
 * to user-configured rebindable application actions, managing active notification dismissal,
 * task pause/resume window focusing, and interactive paused state controls (STOP / FINISH).
 */
export class InputDecoder {
  private _driver: BusyBarDriver;
  private _engine: TimeTrackingEngine;
  private _settingsRepo: SettingsRepository;
  private _priorityEngine?: IPriorityPreemptionEngine;
  private _renderer?: DisplayRenderer;
  private _windowFocusCallback?: () => void;
  private _actionHandlers: Set<ActionHandler> = new Set();
  
  private _isSelectingTask: boolean = false;

  /**
   * Releases the display lock the hardware task menu holds.
   *
   * `renderTaskSelection` acquires `menuPriority` on every redraw but nothing
   * released it, so the lock outlived the menu. Nothing in the dismissal path
   * covers it either -- `dismissActiveNotification` only recognises notification
   * and ceremony events -- so it stayed until some higher-priority event
   * happened to overwrite it.
   */
  private releaseSelectionLock(): void {
    this._priorityEngine?.releaseActiveLock('menuPriority');
  }
  private _selectionStage: 'PROJECT' | 'TASK' = 'PROJECT';
  private _projectsList: { id: string, name: string }[] = [];
  private _tasksList: { id: string, title: string, description: string }[] = [];
  private _selectedProjectIndex: number = 0;
  private _selectedTaskIndex: number = 0;
  private _eodConfirmStep: number = 0;

  private _defaultBindings: HardwareBindingConfig = {
    startButtonPress: 'TOGGLE_TRACK_PAUSE',
    wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
    wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
    wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
    backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
    backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
  };

  /// <summary>
  /// Instantiates InputDecoder, binding hardware driver event listeners.
  /// </summary>
  constructor(
    driver: BusyBarDriver,
    engine: TimeTrackingEngine,
    settingsRepo?: SettingsRepository,
    priorityEngine?: IPriorityPreemptionEngine,
    renderer?: DisplayRenderer
  ) {
    this._driver = driver;
    this._engine = engine;
    this._settingsRepo = settingsRepo || new SettingsRepository();
    this._priorityEngine = priorityEngine;
    this._renderer = renderer;

    // Guard the listener itself, not just the action handlers. handleHardwareInput
    // calls engine.startTask() and stopSession(), both of which throw on invalid
    // state -- and a throw inside an EventEmitter listener with no error handler
    // terminates the main process, taking the whole app down on a button press.
    this._driver.on('input', (event: HardwareEvent) => {
      try {
        this.handleHardwareInput(event);
      } catch (err) {
        console.error('[InputDecoder] Unhandled error while processing hardware input:', err);
      }
    });
  }

  /// <summary>
  /// Injects PriorityPreemptionEngine reference for notification dismissal checks.
  /// </summary>
  public setPriorityEngine(engine: IPriorityPreemptionEngine): void {
    this._priorityEngine = engine;
  }

  /// <summary>
  /// Injects DisplayRenderer reference for matrix input feedback and selection screens.
  /// </summary>
  public setRenderer(renderer: DisplayRenderer): void {
    this._renderer = renderer;
  }

  /// <summary>
  /// Sets callback invoked when hardware actions request desktop app window focus.
  /// </summary>
  public setWindowFocusCallback(cb: () => void): void {
    this._windowFocusCallback = cb;
  }

  /// <summary>
  /// Gets current EOD confirmation step.
  /// </summary>
  public getEodConfirmStep(): number {
    return this._eodConfirmStep;
  }

  /// <summary>
  /// Sets current EOD confirmation step.
  /// </summary>
  public setEodConfirmStep(step: number): void {
    this._eodConfirmStep = step;
  }

  /// <summary>
  /// Retrieves current rebindable hardware key bindings from settings.
  /// </summary>
  public getBindings(): HardwareBindingConfig {
    return this._settingsRepo.getSetting<HardwareBindingConfig>('hardware_bindings', this._defaultBindings);
  }

  /// <summary>
  /// Saves custom hardware key bindings to settings.
  /// </summary>
  public saveBindings(config: HardwareBindingConfig): void {
    this._settingsRepo.setSetting('hardware_bindings', config);
  }

  /// <summary>
  /// Registers an action listener callback invoked when hardware actions execute.
  /// </summary>
  public registerActionHandler(handler: ActionHandler): () => void {
    this._actionHandlers.add(handler);
    return () => this._actionHandlers.delete(handler);
  }

  /// <summary>
  /// Decodes incoming hardware input events and handles active notifications,
  /// interactive paused task options (STOP vs FINISH), and mapped actions.
  /// </summary>
  public handleHardwareInput(event: HardwareEvent): string {
    const bindings = this.getBindings();
    const normalizedKey = (event.key || '').toLowerCase();
    
    if (this._renderer) {
      this._renderer.logLastInputKey(normalizedKey);
    }

    const activeLock = this._priorityEngine?.getActiveLockEventName();

    // 1. Handle Active End-of-Day (EOD) Wrap-Up Ceremony Inputs
    if (activeLock === 'eodWrapUpPriority') {
      const isConfirmPress =
        normalizedKey === 'start' ||
        normalizedKey === 'ok' ||
        normalizedKey === 'click' ||
        normalizedKey === 'busy' ||
        normalizedKey === 'custom';

      if (isConfirmPress && (event.type === 'press' || !event.type)) {
        if (this._windowFocusCallback) {
          this._windowFocusCallback();
        }

        if (this._eodConfirmStep === 0) {
          this._eodConfirmStep = 1;
          if (this._renderer) {
            this._renderer.renderCeremonyPrompt('EOD', 'Press START to Confirm');
          }
          this.notifyActionHandlers('CONFIRM_EOD_WRAP_UP_STEP_1', normalizedKey);
          return 'CONFIRM_EOD_WRAP_UP_STEP_1';
        } else {
          this._eodConfirmStep = 0;
          if (this._renderer) {
            this._renderer.renderCeremonyPrompt('EOD', 'Wrapping Up...');
          }
          this.notifyActionHandlers('EXECUTE_EOD_WRAP_UP', normalizedKey);
          return 'EXECUTE_EOD_WRAP_UP';
        }
      }

      if (normalizedKey === 'back' || normalizedKey === 'cancel' || normalizedKey === 'back_hold') {
        this._eodConfirmStep = 0;
        if (this._priorityEngine) {
          this._priorityEngine.releaseActiveLock('eodWrapUpPriority');
        }
        if (this._renderer) {
          this._renderer.renderActiveSession(this._engine.getCurrentSession());
        }
        this.notifyActionHandlers('DISMISS_EOD_WRAP_UP', normalizedKey);
        return 'DISMISS_EOD_WRAP_UP';
      }
    } else {
      this._eodConfirmStep = 0;
    }

    // 2. Handle Active Stand-Up Ceremony Inputs
    if (activeLock === 'standupPromptPriority') {
      const isConfirmPress =
        normalizedKey === 'start' ||
        normalizedKey === 'ok' ||
        normalizedKey === 'click' ||
        normalizedKey === 'busy' ||
        normalizedKey === 'custom';

      if (isConfirmPress && (event.type === 'press' || !event.type)) {
        if (this._windowFocusCallback) {
          this._windowFocusCallback();
        }
        if (this._priorityEngine) {
          this._priorityEngine.releaseActiveLock('standupPromptPriority');
        }
        if (this._renderer) {
          this._renderer.renderActiveSession(this._engine.getCurrentSession());
        }
        this.notifyActionHandlers('CONFIRM_STANDUP_PROMPT', normalizedKey);
        return 'CONFIRM_STANDUP_PROMPT';
      }

      if (normalizedKey === 'back' || normalizedKey === 'cancel' || normalizedKey === 'back_hold') {
        if (this._priorityEngine) {
          this._priorityEngine.releaseActiveLock('standupPromptPriority');
        }
        if (this._renderer) {
          this._renderer.renderActiveSession(this._engine.getCurrentSession());
        }
        this.notifyActionHandlers('DISMISS_STANDUP_PROMPT', normalizedKey);
        return 'DISMISS_STANDUP_PROMPT';
      }
    }

    if (this._isSelectingTask && this._renderer) {
      if (normalizedKey === 'back') {
        this._isSelectingTask = false;
        this.releaseSelectionLock();
        this._renderer.renderIdle();
        return 'CANCEL_SELECTION';
      }
      
      const isUp = normalizedKey === 'up' || normalizedKey === 'rotate_left' || event.type === 'rotate_left';
      const isDown = normalizedKey === 'down' || normalizedKey === 'rotate_right' || event.type === 'rotate_right';
      
      if (this._selectionStage === 'PROJECT') {
        if (isUp) this._selectedProjectIndex = Math.max(0, this._selectedProjectIndex - 1);
        if (isDown) this._selectedProjectIndex = Math.min(this._projectsList.length - 1, this._selectedProjectIndex + 1);
        
        if ((normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type)) {
          this._selectionStage = 'TASK';
          const proj = this._projectsList[this._selectedProjectIndex];
          if (proj) {
            // TaskDTO carries no description; `t.description` was always
            // undefined, so every row read "No description". The key is real
            // data and identifies the task. A description field is Phase 2.
            this._tasksList = this._engine.getTasksForProject(proj.id).map(t => ({
               id: t.id,
               title: t.title,
               description: t.key
            }));
          }
          if (this._tasksList.length === 0) {
            this._tasksList = [{ id: 'none', title: 'No Tasks', description: '' }];
          }
          this._selectedTaskIndex = 0;
        }
      } else if (this._selectionStage === 'TASK') {
        if (isUp) this._selectedTaskIndex = Math.max(0, this._selectedTaskIndex - 1);
        if (isDown) this._selectedTaskIndex = Math.min(this._tasksList.length - 1, this._selectedTaskIndex + 1);
        
        if ((normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type)) {
          const task = this._tasksList[this._selectedTaskIndex];
          if (task && task.id !== 'none') {
             this._engine.startTask(task.id, false, task.title, this._projectsList[this._selectedProjectIndex].id);
          }
          this._isSelectingTask = false;
          this.releaseSelectionLock();
          return 'START_TASK_FROM_SELECTION';
        }
      }
      
      if (this._isSelectingTask) {
        if (this._selectionStage === 'PROJECT') {
          const proj = this._projectsList[this._selectedProjectIndex];
          this._renderer.renderTaskSelection('PROJECT', proj?.name || 'No Projects');
        } else {
          const task = this._tasksList[this._selectedTaskIndex];
          this._renderer.renderTaskSelection('TASK', task?.title || 'No Tasks', task?.description);
        }
        return 'UPDATE_SELECTION';
      }
    }
    
    const activeSession = this._engine.getCurrentSession();
    const isPaused = activeSession?.status === 'PAUSED';

    // Interactive Paused State Controls: Wheel scroll toggles STOP/FINISH, wheel click validates choice
    if (isPaused && this._renderer) {
      const isWheelScroll =
        normalizedKey === 'up' ||
        normalizedKey === 'down' ||
        normalizedKey === 'rotate_left' ||
        normalizedKey === 'rotate_right' ||
        event.type === 'rotate_left' ||
        event.type === 'rotate_right';

      if (isWheelScroll) {
        this._renderer.togglePausedSelection();
        this.notifyActionHandlers('TOGGLE_PAUSED_SELECTION', normalizedKey);
        return 'TOGGLE_PAUSED_SELECTION';
      }

      const isWheelClick = (normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type);
      if (isWheelClick) {
        const choice = this._renderer.getPausedSelection();
        if (choice === 'STOP') {
          this._engine.stopSession('Stopped via BUSY Bar Paused Menu');
        } else {
          if (this._renderer.renderTaskCompletionConfetti) {
            this._renderer.renderTaskCompletionConfetti();
          }
          this._engine.stopSession('Completed via BUSY Bar Paused Menu');
        }
        this.notifyActionHandlers('VALIDATE_PAUSED_SELECTION', normalizedKey);
        return 'VALIDATE_PAUSED_SELECTION';
      }
    }

    let action = 'NONE';
    if (normalizedKey === 'start' || normalizedKey === 'busy' || normalizedKey === 'custom') {
      action = bindings.startButtonPress;
    } else if ((normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type)) {
      action = bindings.wheelClick;
    } else if (normalizedKey === 'up' || normalizedKey === 'rotate_left' || event.type === 'rotate_left') {
      action = bindings.wheelRotateLeft;
    } else if (normalizedKey === 'down' || normalizedKey === 'rotate_right' || event.type === 'rotate_right') {
      action = bindings.wheelRotateRight;
    } else if (normalizedKey === 'back' && (event.type === 'press' || !event.type)) {
      action = bindings.backButtonShortPress;
    } else if (normalizedKey === 'back_hold' || (normalizedKey === 'back' && event.type === 'long_press')) {
      action = bindings.backButtonLongPress;
    } else if (normalizedKey === 'apps' || normalizedKey === 'settings' || normalizedKey === 'off') {
      action = `SYSTEM_MODE_${normalizedKey.toUpperCase()}`;
    }

    this.executeAction(action, normalizedKey);
    return action;
  }

  private executeAction(action: string, inputKey: string): void {
    console.log(`[InputDecoder] Executing Action: ${action} (Key: ${inputKey})`);

    switch (action) {
      case 'TOGGLE_TRACK_PAUSE': {
        // If an active notification is currently displayed, dismiss it first
        if (this._priorityEngine && this._priorityEngine.dismissNotification(false)) {
          console.log('[InputDecoder] Dismissed notification alert on start/pause press.');
          break;
        }

        const active = this._engine.getCurrentSession();
        if (!active) {
          this.startTaskSelection();
        } else if (active.status === 'TRACKING') {
          this._engine.pauseSession();
          if (this._windowFocusCallback) {
            this._windowFocusCallback();
          }
        } else if (active.status === 'PAUSED') {
          this._engine.resumeSession();
        }
        break;
      }
      case 'DISMISS_NOTIFICATION_ALERT': {
        if (this._priorityEngine) {
          this._priorityEngine.dismissNotification(true);
        }
        break;
      }
      case 'COMPLETE_AND_LOG_ACTIVE_TASK': {
        this._engine.stopSession('Completed via BUSY Bar Long Press');
        break;
      }
      case 'TRIGGER_TASK_SELECTOR_MODAL': {
        const active2 = this._engine.getCurrentSession();
        if (!active2) {
          this.startTaskSelection();
        } else {
          if (this._windowFocusCallback) {
            this._windowFocusCallback();
          }
        }
        break;
      }
      case 'NAVIGATE_QUEUE_PREV':
      case 'NAVIGATE_QUEUE_NEXT': {
        if (this._windowFocusCallback) {
          this._windowFocusCallback();
        }
        break;
      }
    }

    this.notifyActionHandlers(action, inputKey);
  }

  private notifyActionHandlers(action: string, inputKey: string): void {
    for (const handler of this._actionHandlers) {
      try {
        handler(action, inputKey);
      } catch (err) {
        console.error('[InputDecoder] Error in action handler:', err);
      }
    }
  }

  private startTaskSelection() {
    this._isSelectingTask = true;
    this._selectionStage = 'PROJECT';
    this._projectsList = this._engine.getProjects().map(p => ({ id: p.id, name: p.name }));
    if (this._projectsList.length === 0) {
      this._projectsList = [{ id: 'PROJ-101', name: 'Default Project' }];
    }
    this._selectedProjectIndex = 0;
    if (this._renderer) {
      this._renderer.renderTaskSelection('PROJECT', this._projectsList[0].name);
    }
  }
}
