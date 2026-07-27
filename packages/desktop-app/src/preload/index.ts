import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPCChannel } from '../shared/ipc-channels';
import {
  ActiveSessionDTO,
  TaskDTO,
  ProjectDTO,
  HardwareBindingConfig,
  DeviceStatusDTO,
  PriorityMatrixConfig,
  ScheduleSettingsDTO,
  UnityProjectInjectionResult
} from '../shared/dtos';

export interface UnityInjectorAPI {
  setupGitignore: () => Promise<{ success: boolean; path: string; message: string }>;
  checkGitignore: () => Promise<{ configured: boolean; path?: string }>;
  scanAndInject: (rootFolder: string) => Promise<UnityProjectInjectionResult[]>;
  removeInjection: (projectPath: string) => Promise<boolean>;
  openFolderPicker: () => Promise<string | null>;
}

export interface IElectronAPI {
  // Session Controls
  getCurrentSession: () => Promise<ActiveSessionDTO | null>;
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => Promise<ActiveSessionDTO>;
  pauseSession: () => Promise<ActiveSessionDTO>;
  resumeSession: () => Promise<ActiveSessionDTO>;
  completeSession: (comment?: string) => Promise<{ success: boolean; loggedSeconds: number }>;
  discardSession: () => Promise<boolean>;
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => () => void;

  // Providers & Tasks
  getProjects: () => Promise<ProjectDTO[]>;
  getTasks: (projectId: string) => Promise<TaskDTO[]>;
  reconcileRemoteState: () => Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }>;

  // Hardware Rebindings
  getInputBindings: () => Promise<HardwareBindingConfig>;
  saveInputBindings: (config: HardwareBindingConfig) => Promise<boolean>;
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => () => void;

  // Priority Rules
  getPriorityRules: () => Promise<PriorityMatrixConfig>;
  savePriorityRules: (config: PriorityMatrixConfig) => Promise<boolean>;

  // Device Management
  getDeviceStatus: () => Promise<DeviceStatusDTO>;
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => () => void;

  // Schedule & Ceremonies
  getScheduleSettings: () => Promise<ScheduleSettingsDTO>;
  saveScheduleSettings: (settings: ScheduleSettingsDTO) => Promise<boolean>;
  triggerEodWrapUp: () => Promise<{ success: boolean; savedUnityScenes: boolean; savedVSCode: boolean }>;
  onCeremonyPrompt: (callback: (prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) => void) => () => void;

  // Unity Plugin Injector & Gitignore
  unityInjector: UnityInjectorAPI;
}

const electronAPI: IElectronAPI = {
  // Session Controls
  getCurrentSession: () => ipcRenderer.invoke(IPCChannel.GET_CURRENT_SESSION),
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) =>
    ipcRenderer.invoke(IPCChannel.START_TASK, { taskId, isAdHoc, customTitle }),
  pauseSession: () => ipcRenderer.invoke(IPCChannel.PAUSE_SESSION),
  resumeSession: () => ipcRenderer.invoke(IPCChannel.RESUME_SESSION),
  completeSession: (comment?: string) => ipcRenderer.invoke(IPCChannel.COMPLETE_SESSION, { comment }),
  discardSession: () => ipcRenderer.invoke(IPCChannel.DISCARD_SESSION),
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, session: ActiveSessionDTO | null) => callback(session);
    ipcRenderer.on(IPCChannel.ON_SESSION_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_SESSION_UPDATED, handler);
  },

  // Providers & Tasks
  getProjects: () => ipcRenderer.invoke(IPCChannel.GET_PROJECTS),
  getTasks: (projectId: string) => ipcRenderer.invoke(IPCChannel.GET_TASKS, projectId),
  reconcileRemoteState: () => ipcRenderer.invoke(IPCChannel.RECONCILE_REMOTE_STATE),

  // Hardware Rebindings
  getInputBindings: () => ipcRenderer.invoke(IPCChannel.GET_INPUT_BINDINGS),
  saveInputBindings: (config: HardwareBindingConfig) =>
    ipcRenderer.invoke(IPCChannel.SAVE_INPUT_BINDINGS, config),
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { inputKey: string; actionAssigned: string }) => callback(data);
    ipcRenderer.on(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
  },

  // Priority Rules
  getPriorityRules: () => ipcRenderer.invoke(IPCChannel.GET_PRIORITY_RULES),
  savePriorityRules: (config: PriorityMatrixConfig) =>
    ipcRenderer.invoke(IPCChannel.SAVE_PRIORITY_RULES, config),

  // Device Management
  getDeviceStatus: () => ipcRenderer.invoke(IPCChannel.GET_DEVICE_STATUS),
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => {
    const handler = (_event: IpcRendererEvent, status: DeviceStatusDTO) => callback(status);
    ipcRenderer.on(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
  },

  // Schedule & Ceremonies
  getScheduleSettings: () => ipcRenderer.invoke(IPCChannel.GET_SCHEDULE_SETTINGS),
  saveScheduleSettings: (settings: ScheduleSettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, settings),
  triggerEodWrapUp: () => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_WRAP_UP),
  onCeremonyPrompt: (callback: (prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) => void) => {
    const handler = (_event: IpcRendererEvent, prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) =>
      callback(prompt);
    ipcRenderer.on(IPCChannel.ON_CEREMONY_PROMPT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_CEREMONY_PROMPT, handler);
  },

  // Unity Plugin Injector & Gitignore
  unityInjector: {
    setupGitignore: () => ipcRenderer.invoke(IPCChannel.SETUP_GITIGNORE),
    checkGitignore: () => ipcRenderer.invoke(IPCChannel.CHECK_GITIGNORE),
    scanAndInject: (rootFolder: string) => ipcRenderer.invoke(IPCChannel.SCAN_AND_INJECT, rootFolder),
    removeInjection: (projectPath: string) => ipcRenderer.invoke(IPCChannel.REMOVE_INJECTION, projectPath),
    openFolderPicker: () => ipcRenderer.invoke(IPCChannel.OPEN_FOLDER_PICKER)
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
