import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemAutomationService, CommandExecFn } from '../src/main/services/system-automation-service';
import { ArgumentException, ArgumentNullException } from '../src/shared/dtos';

// Replaced for the whole file: no test here may run a real command, whichever
// path it takes.
const { childProcessExec } = vi.hoisted(() => ({ childProcessExec: vi.fn() }));
vi.mock('child_process', () => ({ exec: childProcessExec }));

describe('SystemAutomationService Unit Tests', () => {
  let mockExecFn: ReturnType<typeof vi.fn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    mockExecFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    originalEnv = process.env.NODE_ENV;
  });

  it('SaveOpenEditors_NoEditorRunning_ReturnsCleanlyWithoutSpawningProcess', async () => {
    // Arrange: Mock PowerShell returning NO_EDITORS_RUNNING
    mockExecFn.mockResolvedValueOnce({ stdout: 'NO_EDITORS_RUNNING', stderr: '' });
    const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);

    // Act
    const result = await service.saveOpenEditors();

    // Assert
    expect(result.isEditorDetected).toBe(false);
    expect(result.isSaved).toBe(false);
    expect(mockExecFn).toHaveBeenCalledTimes(1);
  });

  it('SaveOpenEditors_EditorRunning_ExecutesSaveAllAutomation', async () => {
    // Arrange: Mock PowerShell returning EDITORS_SAVED
    mockExecFn.mockResolvedValueOnce({ stdout: 'EDITORS_SAVED', stderr: '' });
    const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);

    // Act
    const result = await service.saveOpenEditors();

    // Assert
    expect(result.isEditorDetected).toBe(true);
    expect(result.isSaved).toBe(true);
  });

  it('SaveOpenEditors_ExecutionFails_HandlesGracefully', async () => {
    // Arrange: Mock execution failure
    mockExecFn.mockRejectedValueOnce(new Error('PowerShell execution failed'));
    const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);

    // Act
    const result = await service.saveOpenEditors();

    // Assert
    expect(result.isEditorDetected).toBe(false);
    expect(result.isSaved).toBe(false);
  });

  it('ScheduleShutdown_NegativeTimeout_ThrowsArgumentException', async () => {
    const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
    await expect(service.scheduleShutdown(-5, 'Test')).rejects.toThrow(ArgumentException);
  });

  it('ScheduleShutdown_NullReason_ThrowsArgumentNullException', async () => {
    const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
    await expect(service.scheduleShutdown(30, '')).rejects.toThrow(ArgumentNullException);
  });

  it('ScheduleShutdown_CustomExecFn_ExecutesPlatformCommandAndSetsPendingFlag', async () => {
    // Temporarily unset test NODE_ENV to test real command building with mockExecFn
    process.env.NODE_ENV = 'production';
    try {
      const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
      expect(service.isShutdownPending()).toBe(false);

      const success = await service.scheduleShutdown(45, 'End of Day');

      expect(success).toBe(true);
      expect(service.isShutdownPending()).toBe(true);
      expect(mockExecFn).toHaveBeenCalledTimes(1);
      const executedCommand = mockExecFn.mock.calls[0][0] as string;
      if (process.platform === 'win32') {
        expect(executedCommand).toContain('shutdown /s /f /t 45');
        expect(executedCommand).toContain('End of Day');
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('AbortShutdown_PendingShutdown_ExecutesAbortCommand', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
      await service.scheduleShutdown(30, 'Wrap Up');
      expect(service.isShutdownPending()).toBe(true);

      const aborted = await service.abortShutdown();

      expect(aborted).toBe(true);
      expect(service.isShutdownPending()).toBe(false);
      expect(mockExecFn).toHaveBeenCalledTimes(2);
      if (process.platform === 'win32') {
        expect(mockExecFn.mock.calls[1][0]).toBe('shutdown /a');
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('AbortShutdown_NoPendingShutdown_ReturnsTrueWithoutCallingCommand', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
      expect(service.isShutdownPending()).toBe(false);

      const aborted = await service.abortShutdown();

      expect(aborted).toBe(true);
      expect(mockExecFn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('AbortShutdown_ExecutionFails_ReturnsFalseAndResetsPendingFlag', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const service = new SystemAutomationService(mockExecFn as unknown as CommandExecFn);
      await service.scheduleShutdown(30, 'Wrap Up');

      mockExecFn.mockRejectedValueOnce(new Error('Abort failed: no shutdown in progress'));
      const aborted = await service.abortShutdown();

      expect(aborted).toBe(false);
      expect(service.isShutdownPending()).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

/**
 * The paths the suite's own platform never takes, and the guard that keeps the
 * suite from shutting down the machine it runs on. `process.platform` is forced
 * per test; `child_process.exec` is replaced above, so nothing here can run a
 * real command whatever the guard does.
 */
describe('SystemAutomationService across platforms', () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let originalEnv: string | undefined;
  let execFn: ReturnType<typeof vi.fn>;

  const onPlatform = (platform: NodeJS.Platform) =>
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    originalEnv = process.env.NODE_ENV;
    execFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    childProcessExec.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  const service = () => new SystemAutomationService(execFn as unknown as CommandExecFn);

  describe('saving open editors', () => {
    it.each([
      ['EDITORS_SAVED', true],
      ['NO_EDITORS_RUNNING', false]
    ])('SaveOpenEditors_MacAnswers%s_ReportsWhetherItSaved', async (stdout, saved) => {
      onPlatform('darwin');
      execFn.mockResolvedValueOnce({ stdout, stderr: '' });

      const result = await service().saveOpenEditors();

      expect(result).toEqual({ isSaved: saved, isEditorDetected: saved });
      expect(execFn.mock.calls[0][0]).toMatch(/^osascript -e /);
    });

    it('SaveOpenEditors_MacAutomationFails_ReportsNothingSaved', async () => {
      onPlatform('darwin');
      execFn.mockRejectedValueOnce(new Error('not authorised to send Apple events'));

      expect(await service().saveOpenEditors()).toEqual({ isSaved: false, isEditorDetected: false });
    });

    it('SaveOpenEditors_LinuxWithoutXdotool_SendsNoKeystrokes', async () => {
      onPlatform('linux');
      execFn.mockResolvedValueOnce({ stdout: '\n', stderr: '' });

      const result = await service().saveOpenEditors();

      expect(result).toEqual({ isSaved: false, isEditorDetected: false });
      expect(execFn).toHaveBeenCalledTimes(1);
    });

    it('SaveOpenEditors_LinuxWithXdotool_SendsSaveAll', async () => {
      onPlatform('linux');
      execFn.mockResolvedValueOnce({ stdout: '/usr/bin/xdotool\n', stderr: '' });

      const result = await service().saveOpenEditors();

      expect(result).toEqual({ isSaved: true, isEditorDetected: true });
      expect(execFn.mock.calls[1][0]).toContain('ctrl+k s');
    });

    it('SaveOpenEditors_LinuxXdotoolFails_ReportsNothingSaved', async () => {
      onPlatform('linux');
      execFn.mockResolvedValueOnce({ stdout: '/usr/bin/xdotool', stderr: '' }).mockRejectedValueOnce(new Error('no display'));

      expect(await service().saveOpenEditors()).toEqual({ isSaved: false, isEditorDetected: false });
    });
  });

  describe('shutdown', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('ScheduleShutdown_ReasonWithQuotes_CannotBreakOutOfTheCommand', async () => {
      // The reason is interpolated into a shell command inside double quotes.
      onPlatform('win32');

      await service().scheduleShutdown(30, 'Done" & del C:\\x & "');

      expect(execFn.mock.calls[0][0]).toBe('shutdown /s /f /t 30 /c "Done & del C:\\x & "');
    });

    it.each([
      [0, 1],
      [45, 1],
      [60, 1],
      [90, 2]
    ])('ScheduleShutdown_Linux%ss_WaitsWholeMinutesNeverLess', async (seconds, minutes) => {
      // Linux shutdown counts in minutes; rounding down would shut down early.
      onPlatform('linux');

      await service().scheduleShutdown(seconds, 'Wrap Up');

      expect(execFn.mock.calls[0][0]).toBe(`shutdown -h +${minutes} "Wrap Up"`);
    });

    it('ScheduleShutdown_CommandFails_ReportsItAndNothingIsPending', async () => {
      onPlatform('win32');
      execFn.mockRejectedValueOnce(new Error('Access is denied.'));
      const automation = service();

      expect(await automation.scheduleShutdown(30, 'Wrap Up')).toBe(false);
      expect(automation.isShutdownPending()).toBe(false);
    });

    it('AbortShutdown_Linux_CancelsWithShutdownC', async () => {
      onPlatform('linux');
      const automation = service();
      await automation.scheduleShutdown(30, 'Wrap Up');

      expect(await automation.abortShutdown()).toBe(true);
      expect(execFn.mock.calls[1][0]).toBe('shutdown -c');
    });
  });

  describe('the default executor', () => {
    it('AnyCommand_UnderTestWithoutAnExecutor_NeverReachesTheMachine', async () => {
      // The backstop for a test that forgets to inject: without it this suite
      // could shut down, or type into, the machine running it.
      process.env.NODE_ENV = 'test';
      const unguarded = new SystemAutomationService();

      expect(await unguarded.saveOpenEditors()).toEqual({ isSaved: true, isEditorDetected: true });
      expect(await unguarded.scheduleShutdown(30, 'Wrap Up')).toBe(true);
      expect(unguarded.isShutdownPending()).toBe(true);
      expect(await unguarded.abortShutdown()).toBe(true);
      expect(unguarded.isShutdownPending()).toBe(false);
      expect(childProcessExec).not.toHaveBeenCalled();
    });

    it('ScheduleShutdown_DefaultExecutorSucceeds_IsPending', async () => {
      process.env.NODE_ENV = 'production';
      onPlatform('win32');
      childProcessExec.mockImplementation((_cmd: string, cb: (e: Error | null, out: string, err: string) => void) => cb(null, '', ''));
      const automation = new SystemAutomationService();

      expect(await automation.scheduleShutdown(30, 'Wrap Up')).toBe(true);
      expect(childProcessExec.mock.calls[0][0]).toContain('shutdown /s /f /t 30');
    });

    it('ScheduleShutdown_DefaultExecutorFails_ReportsIt', async () => {
      process.env.NODE_ENV = 'production';
      onPlatform('win32');
      childProcessExec.mockImplementation((_cmd: string, cb: (e: Error | null, out: string, err: string) => void) =>
        cb(new Error('Access is denied.'), '', ''));
      const automation = new SystemAutomationService();

      expect(await automation.scheduleShutdown(30, 'Wrap Up')).toBe(false);
      expect(automation.isShutdownPending()).toBe(false);
    });

    it('SaveOpenEditors_DefaultExecutorReturnsOutput_ReadsIt', async () => {
      process.env.NODE_ENV = 'production';
      onPlatform('win32');
      childProcessExec.mockImplementation((_cmd: string, cb: (e: Error | null, out: string, err: string) => void) =>
        cb(null, 'EDITORS_SAVED\r\n', ''));

      expect(await new SystemAutomationService().saveOpenEditors()).toEqual({ isSaved: true, isEditorDetected: true });
    });
  });
});
