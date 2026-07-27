/**
 * Enumeration of all IPC channel names used for communication
 * between Electron Main and Renderer processes.
 */
export var IPCChannel;
(function (IPCChannel) {
    // Session & Timer Controls
    IPCChannel["GET_CURRENT_SESSION"] = "session:get-current";
    IPCChannel["START_TASK"] = "session:start-task";
    IPCChannel["PAUSE_SESSION"] = "session:pause";
    IPCChannel["RESUME_SESSION"] = "session:resume";
    IPCChannel["COMPLETE_SESSION"] = "session:complete";
    IPCChannel["DISCARD_SESSION"] = "session:discard";
    IPCChannel["ON_SESSION_UPDATED"] = "session:on-updated";
    // Task Provider & Task Query
    IPCChannel["GET_PROVIDERS"] = "provider:get-all";
    IPCChannel["SET_ACTIVE_PROVIDER"] = "provider:set-active";
    IPCChannel["GET_PROJECTS"] = "provider:get-projects";
    IPCChannel["GET_TASKS"] = "provider:get-tasks";
    IPCChannel["CREATE_AD_HOC_TASK"] = "provider:create-adhoc";
    IPCChannel["RECONCILE_REMOTE_STATE"] = "provider:reconcile";
    // Hardware Input Rebindings
    IPCChannel["GET_INPUT_BINDINGS"] = "input:get-bindings";
    IPCChannel["SAVE_INPUT_BINDINGS"] = "input:save-bindings";
    IPCChannel["ON_HARDWARE_INPUT_EVENT"] = "input:on-hardware-event";
    // Priority Matrix & Display
    IPCChannel["GET_PRIORITY_RULES"] = "priority:get-rules";
    IPCChannel["SAVE_PRIORITY_RULES"] = "priority:save-rules";
    // Device Management & SDK
    IPCChannel["GET_DEVICE_STATUS"] = "device:get-status";
    IPCChannel["SET_DEVICE_CONFIG"] = "device:set-config";
    IPCChannel["ON_DEVICE_STATUS_CHANGED"] = "device:on-status-changed";
    // Ceremonies & Schedule
    IPCChannel["GET_SCHEDULE_SETTINGS"] = "schedule:get-settings";
    IPCChannel["SAVE_SCHEDULE_SETTINGS"] = "schedule:save-settings";
    IPCChannel["TRIGGER_EOD_WRAP_UP"] = "schedule:trigger-eod-wrapup";
    IPCChannel["ON_CEREMONY_PROMPT"] = "schedule:on-ceremony-prompt";
})(IPCChannel || (IPCChannel = {}));
//# sourceMappingURL=ipc-channels.js.map