export class PomodoroWidget {
    id = 'pomodoro';
    name = 'Pomodoro Focus Timer';
    isRunning = false;
    mode = 'FOCUS';
    remainingSeconds = 25 * 60; // 25 minutes
    render(_context) {
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
    onInput(event) {
        if (event.key === 'ok') {
            this.isRunning = !this.isRunning;
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=pomodoro-widget.js.map