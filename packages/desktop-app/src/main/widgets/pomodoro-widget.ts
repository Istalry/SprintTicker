import { IWidget, WidgetContext, HardwareInputEvent } from './widget-interface';
import { DisplayPayload } from '../hardware/display-renderer';

export class PomodoroWidget implements IWidget {
  public readonly id: string = 'pomodoro';
  public readonly name: string = 'Pomodoro Focus Timer';

  private isRunning: boolean = false;
  private mode: 'FOCUS' | 'BREAK' = 'FOCUS';
  private remainingSeconds: number = 25 * 60; // 25 minutes

  public render(_context: WidgetContext): DisplayPayload {
    const mins = Math.floor(this.remainingSeconds / 60);
    const secs = this.remainingSeconds % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const labelStr = this.mode === 'FOCUS' ? 'POMODORO FOCUS' : 'SHORT BREAK';
    const ledColor = this.mode === 'FOCUS' ? '#3B82F6FF' : '#10B981FF';

    return {
      frontElements: [
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 0,
          color: '#AAFF00FF',
          text: `${labelStr} ${timeStr}`
        },
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 8,
          color: '#FFFFFFFF',
          text: this.isRunning ? 'Running... Press OK to Pause' : 'Paused... Press OK to Start'
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: `POMODORO WIDGET [${this.mode}]`
        },
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 16,
          color: '#CCCCCC',
          text: `Time Remaining: ${timeStr}`
        }
      ],
      ledColorHex: ledColor
    };
  }

  public onInput(event: HardwareInputEvent): boolean {
    if (event.key === 'ok') {
      this.isRunning = !this.isRunning;
      return true;
    }
    return false;
  }
}
