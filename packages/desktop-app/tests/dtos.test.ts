import { describe, it, expect } from 'vitest';
import { DTOValidator } from '../src/shared/dtos';

describe('DTOValidator Unit Tests', () => {
  it('isValidCompileStart_ValidData_ReturnsTrue', () => {
    // Arrange
    const data = {
      project: 'MyFantasyGame',
      unityVersion: '2022.3.10f1',
      timestampUtc: '2026-07-27T09:30:00.000Z'
    };

    // Act & Assert
    expect(DTOValidator.isValidCompileStart(data)).toBe(true);
  });

  it('isValidCompileStart_NullOrNonObject_ReturnsFalse', () => {
    expect(DTOValidator.isValidCompileStart(null)).toBe(false);
    expect(DTOValidator.isValidCompileStart('string')).toBe(false);
    expect(DTOValidator.isValidCompileStart({ project: 123 })).toBe(false);
  });

  it('isValidCompileFinish_ValidData_ReturnsTrue', () => {
    // Arrange
    const data = {
      project: 'MyFantasyGame',
      success: true,
      elapsedSeconds: 12.5,
      errorCount: 0,
      warningCount: 2
    };

    // Act & Assert
    expect(DTOValidator.isValidCompileFinish(data)).toBe(true);
  });

  it('isValidCompileFinish_InvalidType_ReturnsFalse', () => {
    const data = {
      project: 'MyFantasyGame',
      success: 'true', // string instead of boolean
      elapsedSeconds: 12.5,
      errorCount: 0,
      warningCount: 2
    };
    expect(DTOValidator.isValidCompileFinish(data)).toBe(false);
  });

  it('isValidPlayMode_ValidStates_ReturnsTrue', () => {
    expect(DTOValidator.isValidPlayMode({ project: 'Game', state: 'EnteredPlayMode' })).toBe(true);
    expect(DTOValidator.isValidPlayMode({ project: 'Game', state: 'ExitedPlayMode' })).toBe(true);
  });

  it('isValidPlayMode_InvalidState_ReturnsFalse', () => {
    expect(DTOValidator.isValidPlayMode({ project: 'Game', state: 'Paused' })).toBe(false);
  });

  it('isValidException_ValidData_ReturnsTrue', () => {
    // Arrange
    const data = {
      project: 'MyFantasyGame',
      exceptionType: 'NullReferenceException',
      message: 'Null object',
      stackTrace: 'at Test.cs:10'
    };

    // Act & Assert
    expect(DTOValidator.isValidException(data)).toBe(true);
  });

  it('isValidException_MissingStackTrace_ReturnsFalse', () => {
    const data = {
      project: 'MyFantasyGame',
      exceptionType: 'NullReferenceException',
      message: 'Null object'
    };
    expect(DTOValidator.isValidException(data)).toBe(false);
  });
});
