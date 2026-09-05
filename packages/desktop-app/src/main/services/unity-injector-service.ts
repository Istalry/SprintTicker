import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { UnityProjectInjectionResult } from '../../shared/dtos';

/**
 * Service responsible for managing global Gitignore configurations
 * and auto-injecting the BUSY Bar Unity C# Plugin into Unity projects via Directory Junctions.
 */
export class UnityInjectorService {
  private readonly _pluginSourceRelativePath: string;

  /**
   * Initializes a new instance of UnityInjectorService.
   * @param customPluginSourcePath Optional explicit override path for the Unity plugin source directory.
   */
  constructor(customPluginSourcePath?: string) {
    this._pluginSourceRelativePath = customPluginSourcePath || this.resolvePluginSourcePath();
  }

  /// <summary>
  /// Resolves the absolute path to the global Git excludes file, creating or configuring it if needed,
  /// and appends BUSY Bar entries idempotently.
  /// </summary>
  public async setupGlobalGitignore(): Promise<{ success: boolean; path: string; message: string }> {
    try {
      const gitignorePath = this.getGlobalGitignorePath();
      const parentDir = path.dirname(gitignorePath);

      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      let existingContent = '';
      if (fs.existsSync(gitignorePath)) {
        existingContent = fs.readFileSync(gitignorePath, 'utf-8');
      }

      const entryMarker = 'Packages/io.github.istalry.sprintticker';
      const entrySlashMarker = 'Packages/io.github.istalry.sprintticker/';

      const hasEntry = existingContent.includes(entryMarker);
      const hasSlashEntry = existingContent.includes(entrySlashMarker);

      if (!hasEntry || !hasSlashEntry) {
        const linesToAppend: string[] = [];
        if (!existingContent.includes('# BUSY Bar Local Companion Plugin')) {
          linesToAppend.push('# BUSY Bar Local Companion Plugin');
        }
        if (!hasEntry) {
          linesToAppend.push(entryMarker);
        }
        if (!hasSlashEntry) {
          linesToAppend.push(entrySlashMarker);
        }

        const formattedAppend = (existingContent.endsWith('\n') || existingContent === '' ? '' : '\n') +
          linesToAppend.join('\n') + '\n';

        fs.appendFileSync(gitignorePath, formattedAppend, 'utf-8');
      }

      // Configure git global core.excludesfile if not already set
      try {
        const currentConfigured = execSync('git config --global core.excludesfile', { encoding: 'utf-8' }).trim();
        if (!currentConfigured) {
          execSync(`git config --global core.excludesfile "${gitignorePath.replace(/\\/g, '/')}"`);
        }
      } catch {
        try {
          execSync(`git config --global core.excludesfile "${gitignorePath.replace(/\\/g, '/')}"`);
        } catch {
          // git command might fail if git CLI is missing; file was created/updated regardless
        }
      }

      return {
        success: true,
        path: gitignorePath,
        message: 'Global gitignore configured successfully.'
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        path: '',
        message: `Failed to configure global gitignore: ${msg}`
      };
    }
  }

  /// <summary>
  /// Checks whether the global Gitignore file exists and contains the BUSY Bar plugin ignore entries.
  /// </summary>
  public async checkGlobalGitignoreStatus(): Promise<{ configured: boolean; path?: string }> {
    try {
      const gitignorePath = this.getGlobalGitignorePath();
      if (!fs.existsSync(gitignorePath)) {
        return { configured: false, path: gitignorePath };
      }

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const isConfigured = content.includes('Packages/io.github.istalry.sprintticker');
      return { configured: isConfigured, path: gitignorePath };
    } catch {
      return { configured: false };
    }
  }

  /// <summary>
  /// Recursively scans rootFolder for valid Unity projects and creates Directory Junctions
  /// to the BUSY Bar Unity plugin under Packages/io.github.istalry.sprintticker.
  /// </summary>
  public async scanAndInjectProjects(rootFolder: string): Promise<UnityProjectInjectionResult[]> {
    if (!rootFolder || typeof rootFolder !== 'string' || rootFolder.trim() === '') {
      throw new Error('ArgumentException: rootFolder path must not be null or empty.');
    }

    const absoluteRoot = path.resolve(rootFolder);
    if (!fs.existsSync(absoluteRoot)) {
      throw new Error(`DirectoryNotFoundException: Root directory does not exist: ${absoluteRoot}`);
    }

    const pluginSourcePath = this._pluginSourceRelativePath;
    if (!fs.existsSync(pluginSourcePath)) {
      throw new Error(`PluginSourceNotFoundException: Unity plugin source path not found at: ${pluginSourcePath}`);
    }

    const detectedProjects = this.findUnityProjects(absoluteRoot, 5);
    const results: UnityProjectInjectionResult[] = [];

    for (const projectPath of detectedProjects) {
      const projectName = path.basename(projectPath);
      const targetPackagePath = path.join(projectPath, 'Packages', 'io.github.istalry.sprintticker');

      try {
        let exists = false;
        try {
          fs.lstatSync(targetPackagePath);
          exists = true;
        } catch {
          exists = false;
        }

        if (exists) {
          results.push({
            projectName,
            projectPath,
            status: 'already_exists'
          });
          continue;
        }

        // Ensure Packages folder exists
        const packagesDir = path.join(projectPath, 'Packages');
        if (!fs.existsSync(packagesDir)) {
          fs.mkdirSync(packagesDir, { recursive: true });
        }

        // Create Directory Junction (on Windows) or Symlink (on Unix)
        const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(pluginSourcePath, targetPackagePath, symlinkType);

        results.push({
          projectName,
          projectPath,
          status: 'injected'
        });
      } catch (err: unknown) {
        results.push({
          projectName,
          projectPath,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return results;
  }

  /// <summary>
  /// Safely detaches and removes the io.github.istalry.sprintticker symlink or junction from a Unity project.
  /// </summary>
  public async removeInjection(projectPath: string): Promise<boolean> {
    if (!projectPath || typeof projectPath !== 'string' || projectPath.trim() === '') {
      throw new Error('ArgumentException: projectPath must not be null or empty.');
    }

    const targetPackagePath = path.join(path.resolve(projectPath), 'Packages', 'io.github.istalry.sprintticker');

    try {
      const lstat = fs.lstatSync(targetPackagePath);
      if (lstat.isSymbolicLink() || lstat.isDirectory()) {
        if (process.platform === 'win32') {
          fs.unlinkSync(targetPackagePath);
        } else {
          fs.rmSync(targetPackagePath, { recursive: true, force: true });
        }
        return true;
      }
      return false;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'ENOENT') {
        return true; // Already removed
      }
      throw err;
    }
  }

  /**
   * Resolves the global Gitignore file path using git config or default location.
   */
  private getGlobalGitignorePath(): string {
    try {
      const gitConfigPath = execSync('git config --global core.excludesfile', { encoding: 'utf-8' }).trim();
      if (gitConfigPath) {
        if (gitConfigPath.startsWith('~')) {
          return path.join(os.homedir(), gitConfigPath.slice(1));
        }
        return path.resolve(gitConfigPath);
      }
    } catch {
      // Fall through to default
    }
    return path.join(os.homedir(), '.gitignore_global');
  }

  /**
   * Resolves the monorepo path for packages/unity-plugin.
   */
  private resolvePluginSourcePath(): string {
    const exeDir = path.dirname(process.execPath);
    const candidates = [
      path.resolve(process.cwd(), 'packages', 'unity-plugin'),
      path.resolve(process.cwd(), '..', 'unity-plugin'),
      path.resolve(exeDir, 'packages', 'unity-plugin'),
      path.resolve(exeDir, 'resources', 'packages', 'unity-plugin'),
      path.resolve(process.cwd(), 'dist-electron', 'win-unpacked', 'packages', 'unity-plugin'),
      path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'unity-plugin'),
      path.resolve(__dirname, '..', '..', '..', 'unity-plugin')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }

    // Default fallback
    return path.resolve(process.cwd(), 'packages', 'unity-plugin');
  }

  /**
   * Traverses directories up to maxDepth to locate valid Unity projects.
   */
  private findUnityProjects(dir: string, maxDepth: number): string[] {
    if (maxDepth <= 0) return [];

    const projectPaths: string[] = [];

    try {
      const assetsDir = path.join(dir, 'Assets');
      const packagesDir = path.join(dir, 'Packages');

      if (
        fs.existsSync(assetsDir) &&
        fs.statSync(assetsDir).isDirectory() &&
        fs.existsSync(packagesDir) &&
        fs.statSync(packagesDir).isDirectory()
      ) {
        projectPaths.push(dir);
        return projectPaths; // Don't recurse inside a valid Unity project
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subName = entry.name;
          if (
            subName.startsWith('.') ||
            subName === 'node_modules' ||
            subName === 'Library' ||
            subName === 'Logs' ||
            subName === 'Temp' ||
            subName === 'obj' ||
            subName === 'Build'
          ) {
            continue;
          }

          const fullSubPath = path.join(dir, subName);
          const subResults = this.findUnityProjects(fullSubPath, maxDepth - 1);
          projectPaths.push(...subResults);
        }
      }
    } catch {
      // Skip inaccessible directories
    }

    return projectPaths;
  }
}
