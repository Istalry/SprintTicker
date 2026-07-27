import { DisplayPayload } from '../hardware/display-renderer';
import { ActiveSessionDTO } from '../../shared/dtos';

export interface WidgetContext {
  activeSession: ActiveSessionDTO | null;
  compilingProject?: string;
  compilingProgress?: number;
}

export interface HardwareInputEvent {
  key: string;
  type: string;
  timestamp: string;
}

/**
 * Interface contract implemented by custom BUSY Bar matrix display widgets.
 */
export interface IWidget {
  readonly id: string;
  readonly name: string;

  render(context: WidgetContext): DisplayPayload;
  onInput(event: HardwareInputEvent): boolean; // Returns true if input event was handled by widget
}
