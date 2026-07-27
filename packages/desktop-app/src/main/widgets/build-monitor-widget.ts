import { IWidget, WidgetContext, HardwareInputEvent } from './widget-interface';
import { DisplayPayload } from '../hardware/display-renderer';

export class BuildMonitorWidget implements IWidget {
  public readonly id: string = 'build-monitor';
  public readonly name: string = 'Unity Build & Test Monitor';

  public render(context: WidgetContext): DisplayPayload {
    const projName = context.compilingProject || 'MyFantasyGame';
    const progress = context.compilingProgress ?? 75;

    return {
      frontElements: [
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 0,
          color: '#3B82F6FF',
          text: `UNITY: ${projName}`
        },
        {
          type: 'rectangle',
          x: 0,
          y: 9,
          width: Math.floor((progress * 72) / 100),
          height: 5,
          fill: '#3B82F6FF'
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: `BUILD MONITOR [${projName}]`
        },
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 16,
          color: '#CCCCCC',
          text: `Assembly Compilation (${progress}%)`
        }
      ],
      ledColorHex: '#3B82F6FF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}
