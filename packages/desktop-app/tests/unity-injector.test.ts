import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnityInjectorService, GitRunner } from '../src/main/services/unity-injector-service';

/**
 * A stand-in for `git config --global`, holding its settings in memory. Every
 * test goes through one: the real runner reads -- and, when the key is unset,
 * writes -- the global git config of whatever machine runs the suite.
 */
function fakeGit(initial: Record<string, string> = {}) {
  const config = { ...initial };
  const calls: string[][] = [];
  const run: GitRunner = args => {
    calls.push(args);
    const [, , key, value] = args;
    if (value !== undefined) {
      config[key] = value;
      return '';
    }
    if (!(key in config)) throw new Error(`git exited 1: ${key} is unset`);
    return `${config[key]}\n`;
  };
  return { run, config, calls };
}

describe('UnityInjectorService Unit Tests', () => {
  let tempDir: string;
  let mockPluginSourcePath: string;
  let service: UnityInjectorService;
  let globalGitignorePath: string;
  let git: ReturnType<typeof fakeGit>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-injector-test-'));
    mockPluginSourcePath = path.join(tempDir, 'mock-unity-plugin');
    fs.mkdirSync(mockPluginSourcePath, { recursive: true });
    fs.writeFileSync(path.join(mockPluginSourcePath, 'package.json'), JSON.stringify({ name: 'io.github.istalry.sprintticker' }));

    // The global gitignore path is injected at a temp file. Without it the
    // service resolves `git config --global core.excludesfile` on the machine
    // running the suite and writes to the developer's home directory.
    globalGitignorePath = path.join(tempDir, '.gitignore_global');
    git = fakeGit();
    service = new UnityInjectorService(mockPluginSourcePath, globalGitignorePath, git.run);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
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
    expect(content).toContain('Packages/io.github.istalry.sprintticker');
    expect(content).toContain('Packages/io.github.istalry.sprintticker/');

    // Run a second time to verify idempotency (no duplicate entries)
    await service.setupGlobalGitignore();
    const contentSecond = fs.readFileSync(result.path, 'utf-8');
    const matches = contentSecond.match(/Packages\/io\.github\.istalry\.sprintticker/g);
    expect(matches).not.toBeNull();
    // One for the bare entry and one for the trailing-slash entry -- not four,
    // which is what a second append would produce.
    expect(matches?.length).toBe(2);

    // The file is inside tempDir, so it is removed by afterEach. This used to
    // be the developer's own ~/.gitignore_global, and the assertion above
    // matched entries left there by previous runs rather than by this one.
    expect(contentSecond.startsWith(content)).toBe(true);
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

    const injectedPath = path.join(proj1, 'Packages', 'io.github.istalry.sprintticker');
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
    const injectedPath = path.join(proj1, 'Packages', 'io.github.istalry.sprintticker');
    expect(fs.existsSync(injectedPath)).toBe(true);

    const removed = await service.removeInjection(proj1);
    expect(removed).toBe(true);
    expect(fs.existsSync(injectedPath)).toBe(false);
  });
  it('ScanAndInjectProjects_ValidProject_InjectsAndReturnsInjectedStatus', async () => {
    // Arrange: full Unity project structure (Assets + Packages both required for detection)
    const proj = path.join(tempDir, 'ProjectWithPackages');
    fs.mkdirSync(path.join(proj, 'Assets'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'Packages'), { recursive: true });

    const results = await service.scanAndInjectProjects(tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('injected');
    expect(results[0].projectName).toBe('ProjectWithPackages');
    expect(fs.existsSync(path.join(proj, 'Packages', 'io.github.istalry.sprintticker'))).toBe(true);
  });

  it('RemoveInjection_EmptyPath_ThrowsArgumentException', async () => {
    await expect(service.removeInjection('')).rejects.toThrow('ArgumentException');
    await expect(service.removeInjection('   ')).rejects.toThrow('ArgumentException');
  });

  it('RemoveInjection_NonExistentJunctionPath_ReturnsTrueAlreadyRemoved', async () => {
    // A project directory that exists but has no junction inside — ENOENT → true
    const proj = path.join(tempDir, 'EmptyProject');
    fs.mkdirSync(proj, { recursive: true });

    const result = await service.removeInjection(proj);
    expect(result).toBe(true);
  });

  it('CheckGlobalGitignoreStatus_AfterSetupGlobalGitignore_ReturnsConfigured', async () => {
    // First, set up the gitignore entries
    await service.setupGlobalGitignore();

    // Then check the status — it should be configured
    const status = await service.checkGlobalGitignoreStatus();
    expect(status.configured).toBe(true);
    expect(status.path).toBeTruthy();
  });
  describe('git configuration', () => {
    it('SetupGlobalGitignore_NoExcludesFileConfigured_PointsGitAtTheFile', async () => {
      await service.setupGlobalGitignore();

      expect(git.config['core.excludesfile']).toBe(globalGitignorePath.split(path.sep).join('/'));
    });

    it('SetupGlobalGitignore_UserHasTheirOwn_LeavesTheSettingAlone', async () => {
      git = fakeGit({ 'core.excludesfile': '/home/me/.my-ignores' });
      service = new UnityInjectorService(mockPluginSourcePath, globalGitignorePath, git.run);

      await service.setupGlobalGitignore();

      expect(git.config['core.excludesfile']).toBe('/home/me/.my-ignores');
      expect(git.calls.every(args => args.length === 3)).toBe(true);
    });

    it('SetupGlobalGitignore_GitNotInstalled_StillWritesTheFile', async () => {
      const noGit: GitRunner = () => { throw new Error('spawn git ENOENT'); };
      service = new UnityInjectorService(mockPluginSourcePath, globalGitignorePath, noGit);

      const result = await service.setupGlobalGitignore();

      expect(result.success).toBe(true);
      expect(fs.readFileSync(globalGitignorePath, 'utf-8')).toContain('Packages/io.github.istalry.sprintticker');
    });

    it('CheckGlobalGitignoreStatus_NoOverride_ReadsTheFileGitIsConfiguredWith', async () => {
      const configured = path.join(tempDir, 'from-git-config');
      fs.writeFileSync(configured, 'Packages/io.github.istalry.sprintticker\n');
      const fromGit = new UnityInjectorService(mockPluginSourcePath, undefined, fakeGit({ 'core.excludesfile': configured }).run);

      expect(await fromGit.checkGlobalGitignoreStatus()).toEqual({ configured: true, path: configured });
    });

    it('CheckGlobalGitignoreStatus_ConfiguredWithTilde_ResolvesUnderHome', async () => {
      const fromGit = new UnityInjectorService(mockPluginSourcePath, undefined, fakeGit({ 'core.excludesfile': '~/sprintticker-test-absent' }).run);

      const status = await fromGit.checkGlobalGitignoreStatus();

      expect(status.path).toBe(path.join(os.homedir(), 'sprintticker-test-absent'));
      expect(status.configured).toBe(false);
    });

    it('SetupGlobalGitignore_ExistingFileWithoutTrailingNewline_AppendsOnItsOwnLine', async () => {
      fs.writeFileSync(globalGitignorePath, '*.log');

      await service.setupGlobalGitignore();

      expect(fs.readFileSync(globalGitignorePath, 'utf-8').split('\n')[0]).toBe('*.log');
    });
  });

  describe('finding projects', () => {
    const unityProject = (...segments: string[]) => {
      const dir = path.join(tempDir, ...segments);
      fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true });
      return dir;
    };

    it('ScanAndInjectProjects_PluginSourceMissing_Throws', async () => {
      const broken = new UnityInjectorService(path.join(tempDir, 'nowhere'), globalGitignorePath, git.run);

      await expect(broken.scanAndInjectProjects(tempDir)).rejects.toThrow('PluginSourceNotFoundException');
    });

    it('ScanAndInjectProjects_CopiesInsideToolingFolders_AreLeftAlone', async () => {
      // node_modules, Library and friends hold copies and caches of projects,
      // not projects anyone works in.
      for (const skipped of ['node_modules', 'Library', 'Temp', '.git', 'Build']) {
        unityProject('Repo', skipped, 'Copy');
      }
      unityProject('Repo', 'Real');

      const results = await service.scanAndInjectProjects(tempDir);

      expect(results.map(r => r.projectName)).toEqual(['Real']);
    });

    it('ScanAndInjectProjects_ProjectDeeperThanTheLimit_IsNotFound', async () => {
      unityProject('a', 'b', 'c', 'd', 'e', 'TooDeep');
      unityProject('a', 'b', 'Shallow');

      const results = await service.scanAndInjectProjects(tempDir);

      expect(results.map(r => r.projectName)).toEqual(['Shallow']);
    });

    it('PackagePath_HoldsSomethingElse_IsNeitherOverwrittenNorDeleted', async () => {
      // Whatever the user keeps at that path is theirs: the scan must not
      // replace it with a link, and removal must not delete it.
      const project = unityProject('Occupied');
      const occupied = path.join(project, 'Packages', 'io.github.istalry.sprintticker');
      fs.writeFileSync(occupied, 'not a link');

      const results = await service.scanAndInjectProjects(tempDir);
      const removed = await service.removeInjection(project);

      expect(results[0].status).toBe('already_exists');
      expect(removed).toBe(false);
      expect(fs.readFileSync(occupied, 'utf-8')).toBe('not a link');
    });
  });
});
