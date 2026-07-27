import { contextBridge, ipcRenderer } from 'electron';
import { IPCChannel } from '../shared/ipc-channels';
const electronAPI = {
    // Session Controls
    getCurrentSession: () => ipcRenderer.invoke(IPCChannel.GET_CURRENT_SESSION),
    startTask: (taskId, isAdHoc, customTitle) => ipcRenderer.invoke(IPCChannel.START_TASK, { taskId, isAdHoc, customTitle }),
    pauseSession: () => ipcRenderer.invoke(IPCChannel.PAUSE_SESSION),
    resumeSession: () => ipcRenderer.invoke(IPCChannel.RESUME_SESSION),
    completeSession: (comment) => ipcRenderer.invoke(IPCChannel.COMPLETE_SESSION, { comment }),
    discardSession: () => ipcRenderer.invoke(IPCChannel.DISCARD_SESSION),
    onSessionUpdated: (callback) => {
        const handler = (_event, session) => callback(session);
        ipcRenderer.on(IPCChannel.ON_SESSION_UPDATED, handler);
        return () => ipcRenderer.removeListener(IPCChannel.ON_SESSION_UPDATED, handler);
    },
    // Providers & Tasks
    getProjects: () => ipcRenderer.invoke(IPCChannel.GET_PROJECTS),
    getTasks: (projectId) => ipcRenderer.invoke(IPCChannel.GET_TASKS, projectId),
    reconcileRemoteState: () => ipcRenderer.invoke(IPCChannel.RECONCILE_REMOTE_STATE),
    // Hardware Rebindings
    getInputBindings: () => ipcRenderer.invoke(IPCChannel.GET_INPUT_BINDINGS),
    saveInputBindings: (config) => ipcRenderer.invoke(IPCChannel.SAVE_INPUT_BINDINGS, config),
    onHardwareInputEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
        return () => ipcRenderer.removeListener(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
    },
    // Priority Rules
    getPriorityRules: () => ipcRenderer.invoke(IPCChannel.GET_PRIORITY_RULES),
    savePriorityRules: (config) => ipcRenderer.invoke(IPCChannel.SAVE_PRIORITY_RULES, config),
    // Device Management
    getDeviceStatus: () => ipcRenderer.invoke(IPCChannel.GET_DEVICE_STATUS),
    onDeviceStatusChanged: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
        return () => ipcRenderer.removeListener(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
    },
    // Schedule & Ceremonies
    getScheduleSettings: () => ipcRenderer.invoke(IPCChannel.GET_SCHEDULE_SETTINGS),
    saveScheduleSettings: (settings) => ipcRenderer.invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, settings),
    triggerEodWrapUp: () => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_WRAP_UP),
    onCeremonyPrompt: (callback) => {
        const handler = (_event, prompt) => callback(prompt);
        ipcRenderer.on(IPCChannel.ON_CEREMONY_PROMPT, handler);
        return () => ipcRenderer.removeListener(IPCChannel.ON_CEREMONY_PROMPT, handler);
    }
};
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
//# sourceMappingURL=index.js.map