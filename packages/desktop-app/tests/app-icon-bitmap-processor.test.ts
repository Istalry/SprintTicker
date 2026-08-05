import { describe, it, expect } from 'vitest';
import { AppIconBitmapProcessor } from '../src/main/hardware/app-icon-bitmap-processor';

describe('AppIconBitmapProcessor Unit Tests', () => {
  it('ProcessAppIcon_StringIconId_Returns16x16Grid', () => {
    const grid = AppIconBitmapProcessor.processAppIcon('discord');

    expect(grid.length).toBe(16);
    expect(grid[0].length).toBe(16);
  });

  it('ProcessAppIcon_UnknownStringIconId_FallsBackToBellIcon', () => {
    const grid = AppIconBitmapProcessor.processAppIcon('unknown_app_xyz');
    const expectedBellGrid = AppIconBitmapProcessor.processAppIcon('bell');

    expect(grid).toEqual(expectedBellGrid);
  });

  it('DownscaleTo15x15_Already15x15Matrix_ReturnsSameMatrix', () => {
    const input15: (string | null)[][] = Array.from({ length: 15 }, () => Array(15).fill('#FF0000'));
    const result = AppIconBitmapProcessor.downscaleTo15x15(input15);

    expect(result.length).toBe(15);
    expect(result[0].length).toBe(15);
    expect(result[0][0]).toBe('#FF0000');
  });

  it('DownscaleTo15x15_Larger32x32Matrix_ScalesDownTo15x15', () => {
    const input32: (string | null)[][] = Array.from({ length: 32 }, () => Array(32).fill('#00FF00'));
    const result = AppIconBitmapProcessor.downscaleTo15x15(input32);

    expect(result.length).toBe(15);
    expect(result[0].length).toBe(15);
    expect(result[0][0]).toBe('#00FF00');
  });

  it('Center15x15In16x16_Valid15x15Input_Returns16x16With15x15Data', () => {
    const input15: (string | null)[][] = Array.from({ length: 15 }, () => Array(15).fill('#0000FF'));
    const result16 = AppIconBitmapProcessor.center15x15In16x16(input15);

    expect(result16.length).toBe(16);
    expect(result16[0].length).toBe(16);
    expect(result16[0][0]).toBe('#0000FF');
    expect(result16[14][14]).toBe('#0000FF');
    expect(result16[15][15]).toBeNull();
  });

  it('ProcessAppIcon_WithCacheKey_CachesAndReturnsSameResult', () => {
    AppIconBitmapProcessor.clearCache();
    const res1 = AppIconBitmapProcessor.processAppIcon('slack', 'slack_cache_id');
    const res2 = AppIconBitmapProcessor.processAppIcon('slack', 'slack_cache_id');

    expect(res1).toBe(res2);
  });

  it('ProcessAppIcon_Custom2DMatrixInput_ProcessesAndDownscales', () => {
    const customMatrix: (string | null)[][] = Array.from({ length: 20 }, () => Array(20).fill('#FFAA00FF'));
    const result = AppIconBitmapProcessor.processAppIcon(customMatrix);

    expect(result.length).toBe(16);
    expect(result[0].length).toBe(16);
    expect(result[0][0]).toBe('#FFAA00FF');
  });
});
