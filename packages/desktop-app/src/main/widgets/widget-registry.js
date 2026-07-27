/**
 * Widget Registry managing custom display widget registration, wheel cycling,
 * and hardware input dispatching.
 */
export class WidgetRegistry {
    widgets = new Map();
    activeWidgetId = null;
    registerWidget(widget) {
        this.widgets.set(widget.id, widget);
        if (!this.activeWidgetId) {
            this.activeWidgetId = widget.id;
        }
    }
    getActiveWidget() {
        if (!this.activeWidgetId)
            return null;
        return this.widgets.get(this.activeWidgetId) || null;
    }
    setActiveWidget(id) {
        if (this.widgets.has(id)) {
            this.activeWidgetId = id;
        }
    }
    cycleNextWidget() {
        const keys = Array.from(this.widgets.keys());
        if (keys.length === 0)
            return null;
        const currentIndex = this.activeWidgetId ? keys.indexOf(this.activeWidgetId) : -1;
        const nextIndex = (currentIndex + 1) % keys.length;
        this.activeWidgetId = keys[nextIndex];
        return this.getActiveWidget();
    }
    renderActiveWidget(context) {
        const active = this.getActiveWidget();
        if (!active)
            return null;
        return active.render(context);
    }
    handleInput(event) {
        const active = this.getActiveWidget();
        if (!active)
            return false;
        return active.onInput(event);
    }
}
//# sourceMappingURL=widget-registry.js.map