import { IWidget, WidgetContext, HardwareInputEvent } from './widget-interface';
import { DisplayPayload } from '../hardware/display-renderer';
import { getBitmapById } from '../../shared/pixel-bitmaps';
import { BitmapIconId } from '../../shared/dtos';

/**
 * Widget 1: Active Task Tracker Widget with Asymmetric Split Layout & Elapsed Mini Progress Bar.
 */
export class TaskTrackerWidget implements IWidget {
  public readonly id: string = 'task_tracker';
  public readonly name: string = 'Active Task Tracker';

  public render(context: WidgetContext): DisplayPayload {
    const session = context.activeSession;
    const taskKey = session ? session.taskKey : 'IDLE';
    const title = session ? session.taskTitle : 'No Active Task Selected';
    const elapsed = session ? session.elapsedSeconds : 0;
    const progressWidth = Math.min(72, Math.floor(((elapsed % 3600) * 72) / 3600));

    return {
      frontElements: [
        { type: 'bitmap', iconId: 'unity', bitmapData: getBitmapById('unity'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 10, y: 0, color: '#AAFF00FF', text: `${taskKey} TRACKER` },
        { type: 'text', font: 'small', x: 0, y: 8, color: '#FFFFFFFF', text: title, scroll_rate: 60 },
        // Bottom elapsed mini-progress indicator
        { type: 'rectangle', x: 0, y: 15, width: progressWidth, height: 1, fill: session ? '#10B981FF' : '#2D3440FF' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `WIDGET: TASK TRACKER (${taskKey})` }
      ],
      ledColorHex: session ? '#10B981FF' : '#2D3440FF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}

/**
 * Widget 2: Stand-Up / Ceremonies Stopwatch Widget with 1 Hz Ticking Colon & Animated Clock Icon.
 */
export class StandupStopwatchWidget implements IWidget {
  public readonly id: string = 'standup_stopwatch';
  public readonly name: string = 'Daily Stand-Up Stopwatch';

  public render(context: WidgetContext): DisplayPayload {
    const elapsed = context.activeSession ? context.activeSession.elapsedSeconds : 0;
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    const colon = elapsed % 2 === 0 ? ':' : ' ';
    const clockBitmap = getBitmapById('clock', elapsed);

    return {
      frontElements: [
        { type: 'bitmap', iconId: 'clock', bitmapData: clockBitmap, x: 0, y: 0 },
        { type: 'text', font: 'tiny', x: 10, y: 0, color: '#F59E0BFF', text: 'DAILY STAND-UP' },
        { type: 'text', font: 'bold', x: 10, y: 8, color: '#FFFFFFFF', text: `00${colon}${mins}${colon}${secs}` }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'WIDGET: DAILY STAND-UP TIMER' }
      ],
      ledColorHex: '#F59E0BFF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}

/**
 * Widget 3: Unity Engine Build & Play Mode Telemetry Widget.
 */
export class UnityBuildWidget implements IWidget {
  public readonly id: string = 'unity_build';
  public readonly name: string = 'Unity Telemetry Widget';

  public render(_context: WidgetContext): DisplayPayload {
    return {
      frontElements: [
        { type: 'bitmap', iconId: 'unity', bitmapData: getBitmapById('unity'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 10, y: 0, color: '#3B82F6FF', text: 'UNITY ENGINE' },
        { type: 'text', font: 'small', x: 0, y: 8, color: '#FFFFFFFF', text: 'Status: Connected (Idle)', scroll_rate: 60 },
        { type: 'rectangle', x: 0, y: 15, width: 72, height: 1, fill: '#3B82F6FF' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'WIDGET: UNITY TELEMETRY' }
      ],
      ledColorHex: '#3B82F6FF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}

/**
 * Widget 4: Messaging Notifications Counter Widget with Animated Icons (Slack, Discord, Gmail).
 */
export class NotificationCounterWidget implements IWidget {
  public readonly id: string = 'notification_counter';
  public readonly name: string = 'Messaging Counter';

  public render(context: WidgetContext): DisplayPayload {
    const elapsed = context.activeSession ? context.activeSession.elapsedSeconds : 0;
    const icons: BitmapIconId[] = ['slack', 'discord', 'gmail'];
    const activeIcon = icons[elapsed % icons.length];
    const animatedBitmap = getBitmapById(activeIcon, elapsed);

    return {
      frontElements: [
        { type: 'bitmap', iconId: activeIcon, bitmapData: animatedBitmap, x: 0, y: 0 },
        { type: 'text', font: 'tiny', x: 10, y: 0, color: '#8B5CF6FF', text: 'UNREAD ALERTS' },
        { type: 'text', font: 'tiny', x: 10, y: 8, color: '#FFFFFFFF', text: 'Slack: 2 | Discord: 1 | Mail: 0' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'WIDGET: MESSAGING SUMMARY' }
      ],
      ledColorHex: '#8B5CF6FF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}

