import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemAutomationService, CommandExecFn } from '../src/main/services/system-automation-service';
import { ArgumentException, ArgumentNullException } from '../src/shared/dtos';

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
