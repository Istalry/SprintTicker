import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnityInjectorService } from '../src/main/services/unity-injector-service';
describe('UnityInjectorService Unit Tests', () => {
    let tempDir;
    let mockPluginSourcePath;
    let service;
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-injector-test-'));
        mockPluginSourcePath = path.join(tempDir, 'mock-unity-plugin');
        fs.mkdirSync(mockPluginSourcePath, { recursive: true });
        fs.writeFileSync(path.join(mockPluginSourcePath, 'package.json'), JSON.stringify({ name: 'com.antigravity.busybar' }));
        service = new UnityInjectorService(mockPluginSourcePath);
    });
    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        catch {
            // ignore cleanup errors
        }
    });
    it('CheckGlobalGitignoreStatus_FileMissing_ReturnsUnconfigured', async () => {
        const status = await service.checkGlobalGitignoreStatus();
        expect(typeof status.configured).toBe('boolean');
    });
    it('SetupGlobalGitignore_ValidExecution_AppendsEntriesIdempotently', async () => {
        const result = await service.setupGlobalGitignore();
        expect(result.success).toBe(true);
        expect(result.path).toBeTruthy();
        expect(fs.existsSync(result.path)).toBe(true);
        const content = fs.readFileSync(result.path, 'utf-8');
        expect(content).toContain('Packages/com.antigravity.busybar');
        expect(content).toContain('Packages/com.antigravity.busybar/');
        // Run a second time to verify idempotency (no duplicate entries)
        await service.setupGlobalGitignore();
        const contentSecond = fs.readFileSync(result.path, 'utf-8');
        const matches = contentSecond.match(/Packages\/com\.antigravity\.busybar/g);
        expect(matches).not.toBeNull();
        // One for Packages/com.antigravity.busybar and one for Packages/com.antigravity.busybar/
        expect(matches?.length).toBe(2);
    });
    it('ScanAndInjectProjects_EmptyRootPath_ThrowsException', async () => {
        await expect(service.scanAndInjectProjects('')).rejects.toThrow('ArgumentException');
    });
    it('ScanAndInjectProjects_NonExistentPath_ThrowsException', async () => {
        const nonExistentPath = path.join(tempDir, 'does-not-exist');
        await expect(service.scanAndInjectProjects(nonExistentPath)).rejects.toThrow('DirectoryNotFoundException');
    });
    it('ScanAndInjectProjects_ValidUnityProjects_CreatesJunctionsAndReturnsStatus', async () => {
        // Setup a dummy Unity project directory structure
        const proj1 = path.join(tempDir, 'MyGameProject');
        fs.mkdirSync(path.join(proj1, 'Assets'), { recursive: true });
        fs.mkdirSync(path.join(proj1, 'Packages'), { recursive: true });
        const results = await service.scanAndInjectProjects(tempDir);
        expect(results).toHaveLength(1);
        expect(results[0].projectName).toBe('MyGameProject');
        expect(results[0].status).toBe('injected');
        const injectedPath = path.join(proj1, 'Packages', 'com.antigravity.busybar');
        expect(fs.existsSync(injectedPath)).toBe(true);
        // Re-scanning should mark status as 'already_exists'
        const resultsSecond = await service.scanAndInjectProjects(tempDir);
        expect(resultsSecond).toHaveLength(1);
        expect(resultsSecond[0].status).toBe('already_exists');
    });
    it('RemoveInjection_ExistingJunction_SafelyRemovesJunction', async () => {
        const proj1 = path.join(tempDir, 'MyGameProject');
        fs.mkdirSync(path.join(proj1, 'Assets'), { recursive: true });
        fs.mkdirSync(path.join(proj1, 'Packages'), { recursive: true });
        await service.scanAndInjectProjects(tempDir);
        const injectedPath = path.join(proj1, 'Packages', 'com.antigravity.busybar');
        expect(fs.existsSync(injectedPath)).toBe(true);
        const removed = await service.removeInjection(proj1);
        expect(removed).toBe(true);
        expect(fs.existsSync(injectedPath)).toBe(false);
    });
});
//# sourceMappingURL=unity-injector.test.js.map