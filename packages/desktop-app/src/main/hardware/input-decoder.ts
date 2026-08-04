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
  private driver: BusyBarDriver;
  private engine: TimeTrackingEngine;
  private settingsRepo: SettingsRepository;
  private priorityEngine?: IPriorityPreemptionEngine;
  private renderer?: DisplayRenderer;
  private windowFocusCallback?: () => void;
  private actionHandlers: Set<ActionHandler> = new Set();
  
  private isSelectingTask: boolean = false;
  private selectionStage: 'PROJECT' | 'TASK' = 'PROJECT';
  private projectsList: { id: string, name: string }[] = [];
  private tasksList: { id: string, title: string, description: string }[] = [];
  private selectedProjectIndex: number = 0;
  private selectedTaskIndex: number = 0;

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
    settingsRepo?: SettingsRepository,
    priorityEngine?: IPriorityPreemptionEngine,
    renderer?: DisplayRenderer
  ) {
    this.driver = driver;
    this.engine = engine;
    this.settingsRepo = settingsRepo || new SettingsRepository();
    this.priorityEngine = priorityEngine;
    this.renderer = renderer;

    this.driver.on('input', (event: HardwareEvent) => this.handleHardwareInput(event));
  }

  public setPriorityEngine(engine: IPriorityPreemptionEngine): void {
    this.priorityEngine = engine;
  }

  public setRenderer(renderer: DisplayRenderer): void {
    this.renderer = renderer;
  }

  public setWindowFocusCallback(cb: () => void): void {
    this.windowFocusCallback = cb;
  }

  public getBindings(): HardwareBindingConfig {
    return this.settingsRepo.getSetting<HardwareBindingConfig>('hardware_bindings', this.defaultBindings);
  }

  public saveBindings(config: HardwareBindingConfig): void {
    this.settingsRepo.setSetting('hardware_bindings', config);
  }

  public registerActionHandler(handler: ActionHandler): () => void {
    this.actionHandlers.add(handler);
    return () => this.actionHandlers.delete(handler);
  }

  /**
   * Decodes incoming hardware input events and handles active notifications,
   * interactive paused task options (STOP vs FINISH), and mapped actions.
   */
  public handleHardwareInput(event: HardwareEvent): string {
    const bindings = this.getBindings();
    const normalizedKey = (event.key || '').toLowerCase();
    
    if (this.renderer) {
      this.renderer.logLastInputKey(normalizedKey);
    }

    if (this.isSelectingTask && this.renderer) {
      if (normalizedKey === 'back') {
        this.isSelectingTask = false;
        this.renderer.renderIdle();
        return 'CANCEL_SELECTION';
      }
      
      const isUp = normalizedKey === 'up' || normalizedKey === 'rotate_left' || event.type === 'rotate_left';
      const isDown = normalizedKey === 'down' || normalizedKey === 'rotate_right' || event.type === 'rotate_right';
      
      if (this.selectionStage === 'PROJECT') {
        if (isUp) this.selectedProjectIndex = Math.max(0, this.selectedProjectIndex - 1);
        if (isDown) this.selectedProjectIndex = Math.min(this.projectsList.length - 1, this.selectedProjectIndex + 1);
        
        if ((normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type)) {
          this.selectionStage = 'TASK';
          const proj = this.projectsList[this.selectedProjectIndex];
          if (proj) {
            this.tasksList = this.engine.getTasksForProject(proj.id).map(t => ({
               id: t.id,
               title: t.title,
               description: t.description || 'No description'
            }));
          }
          if (this.tasksList.length === 0) {
            this.tasksList = [{ id: 'none', title: 'No Tasks', description: '' }];
          }
          this.selectedTaskIndex = 0;
        }
      } else if (this.selectionStage === 'TASK') {
        if (isUp) this.selectedTaskIndex = Math.max(0, this.selectedTaskIndex - 1);
        if (isDown) this.selectedTaskIndex = Math.min(this.tasksList.length - 1, this.selectedTaskIndex + 1);
        
        if ((normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type)) {
          const task = this.tasksList[this.selectedTaskIndex];
          if (task && task.id !== 'none') {
             this.engine.startTask(task.id, false, task.title, this.projectsList[this.selectedProjectIndex].id);
          }
          this.isSelectingTask = false;
          return 'START_TASK_FROM_SELECTION';
        }
      }
      
      if (this.isSelectingTask) {
        if (this.selectionStage === 'PROJECT') {
          const proj = this.projectsList[this.selectedProjectIndex];
          this.renderer.renderTaskSelection('PROJECT', proj?.name || 'No Projects');
        } else {
          const task = this.tasksList[this.selectedTaskIndex];
          this.renderer.renderTaskSelection('TASK', task?.title || 'No Tasks', task?.description);
        }
        return 'UPDATE_SELECTION';
      }
    }
    
    const activeSession = this.engine.getCurrentSession();
    const isPaused = activeSession?.status === 'PAUSED';

    // Interactive Paused State Controls: Wheel scroll toggles STOP/FINISH, wheel click validates choice
    if (isPaused && this.renderer) {
      const isWheelScroll =
        normalizedKey === 'up' ||
        normalizedKey === 'down' ||
        normalizedKey === 'rotate_left' ||
        normalizedKey === 'rotate_right' ||
        event.type === 'rotate_left' ||
        event.type === 'rotate_right';

      if (isWheelScroll) {
        this.renderer.togglePausedSelection();
        this.notifyActionHandlers('TOGGLE_PAUSED_SELECTION', normalizedKey);
        return 'TOGGLE_PAUSED_SELECTION';
      }

      const isWheelClick = (normalizedKey === 'ok' || normalizedKey === 'click') && (event.type === 'press' || !event.type);
      if (isWheelClick) {
        const choice = this.renderer.getPausedSelection();
        if (choice === 'STOP') {
          this.engine.stopSession('Stopped via BUSY Bar Paused Menu');
        } else {
          if (this.renderer.renderTaskCompletionConfetti) {
            this.renderer.renderTaskCompletionConfetti();
          }
          this.engine.stopSession('Completed via BUSY Bar Paused Menu');
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
        if (this.priorityEngine && this.priorityEngine.dismissNotification()) {
          console.log('[InputDecoder] Dismissed notification alert on start/pause press.');
          break;
        }

        const active = this.engine.getCurrentSession();
        if (!active) {
          this.startTaskSelection();
        } else if (active.status === 'TRACKING') {
          this.engine.pauseSession();
          if (this.windowFocusCallback) {
            this.windowFocusCallback();
          }
        } else if (active.status === 'PAUSED') {
          this.engine.resumeSession();
        }
        break;
      }
      case 'DISMISS_NOTIFICATION_ALERT': {
        if (this.priorityEngine) {
          this.priorityEngine.dismissNotification();
        }
        break;
      }
      case 'COMPLETE_AND_LOG_ACTIVE_TASK': {
        this.engine.stopSession('Completed via BUSY Bar Long Press');
        break;
      }
      case 'TRIGGER_TASK_SELECTOR_MODAL': {
        const active2 = this.engine.getCurrentSession();
        if (!active2) {
          this.startTaskSelection();
        } else {
          if (this.windowFocusCallback) {
            this.windowFocusCallback();
          }
        }
        break;
      }
      case 'NAVIGATE_QUEUE_PREV':
      case 'NAVIGATE_QUEUE_NEXT': {
        if (this.windowFocusCallback) {
          this.windowFocusCallback();
        }
        break;
      }
    }

    this.notifyActionHandlers(action, inputKey);
  }

  private notifyActionHandlers(action: string, inputKey: string): void {
    for (const handler of this.actionHandlers) {
      try {
        handler(action, inputKey);
      } catch (err) {
        console.error('[InputDecoder] Error in action handler:', err);
      }
    }
  }

  private startTaskSelection() {
    this.isSelectingTask = true;
    this.selectionStage = 'PROJECT';
    this.projectsList = this.engine.getProjects().map(p => ({ id: p.id, name: p.name }));
    if (this.projectsList.length === 0) {
      this.projectsList = [{ id: 'PROJ-101', name: 'Default Project' }];
    }
    this.selectedProjectIndex = 0;
    if (this.renderer) {
      this.renderer.renderTaskSelection('PROJECT', this.projectsList[0].name);
    }
  }
}
