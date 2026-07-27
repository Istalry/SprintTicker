export class TextTickerWidget {
    id = 'text-ticker';
    name = 'Custom Marquee Ticker';
    tickerText = 'Antigravity BUSY Bar - High Performance Companion';
    constructor(customText) {
        if (customText)
            this.tickerText = customText;
    }
    render(_context) {
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
    onInput(_event) {
        return false;
    }
}
//# sourceMappingURL=text-ticker-widget.js.map