import { IWidget, WidgetContext, HardwareInputEvent } from './widget-interface';
import { DisplayPayload } from '../hardware/display-renderer';

export class TextTickerWidget implements IWidget {
  public readonly id: string = 'text-ticker';
  public readonly name: string = 'Custom Marquee Ticker';
  private tickerText: string = 'Antigravity BUSY Bar - High Performance Companion';

  constructor(customText?: string) {
    if (customText) this.tickerText = customText;
  }

  public render(_context: WidgetContext): DisplayPayload {
    return {
      frontElements: [
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 4,
          color: '#FFFFFFFF',
          text: this.tickerText,
          scroll_rate: 60
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: 'MARQUEE TICKER WIDGET'
        }
      ],
      ledColorHex: '#A855F7FF'
    };
  }

  public onInput(_event: HardwareInputEvent): boolean {
    return false;
  }
}
