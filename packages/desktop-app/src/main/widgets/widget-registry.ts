import { IWidget, WidgetContext, HardwareInputEvent } from './widget-interface';
import { DisplayPayload } from '../hardware/display-renderer';
import {
  TaskTrackerWidget,
  StandupStopwatchWidget,
  UnityBuildWidget,
  NotificationCounterWidget
} from './default-widgets';

/**
 * Widget Registry managing custom display widget registration, wheel cycling,
 * and hardware input dispatching.
 */
export class WidgetRegistry {
  private widgets: Map<string, IWidget> = new Map();
  private activeWidgetId: string | null = null;

  constructor() {
    this.registerWidget(new TaskTrackerWidget());
    this.registerWidget(new StandupStopwatchWidget());
    this.registerWidget(new UnityBuildWidget());
    this.registerWidget(new NotificationCounterWidget());
  }

  public registerWidget(widget: IWidget): void {
    if (!widget || !widget.id) {
      throw new Error('Valid widget instance with ID required');
    }
    this.widgets.set(widget.id, widget);
    if (!this.activeWidgetId) {
      this.activeWidgetId = widget.id;
    }
  }

  public getActiveWidget(): IWidget | null {
    if (!this.activeWidgetId) return null;
    return this.widgets.get(this.activeWidgetId) || null;
  }

  public setActiveWidget(id: string): void {
    if (this.widgets.has(id)) {
      this.activeWidgetId = id;
    }
  }

  public cycleNextWidget(): IWidget | null {
    const keys = Array.from(this.widgets.keys());
    if (keys.length === 0) return null;

    const currentIndex = this.activeWidgetId ? keys.indexOf(this.activeWidgetId) : -1;
    const nextIndex = (currentIndex + 1) % keys.length;
    this.activeWidgetId = keys[nextIndex];
    return this.getActiveWidget();
  }

  public renderActiveWidget(context: WidgetContext): DisplayPayload | null {
    const active = this.getActiveWidget();
    if (!active) return null;
    return active.render(context);
  }

  public handleInput(event: HardwareInputEvent): boolean {
    const active = this.getActiveWidget();
    if (!active) return false;
    return active.onInput(event);
  }
}
