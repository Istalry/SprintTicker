// Migrates a COPY of a SprintTicker database and says whether the migrations
// lost anything on the way. The original is only copied, never opened.
//
//   pnpm db:check-migration [path-to-sprintticker.db]
//
// Defaults to %APPDATA%\SprintTicker\sprintticker.db. Run it from an ordinary
// terminal, not an agent's shell: a shell inside a packaged app can see a
// different file at that path (CLAUDE.md section 7).
//
// The rules live in packages/desktop-app/src/main/db/migration-check.ts, where
// they are tested; this file only makes the copy and prints the report.
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.features.typescript) {
  console.error('This needs a Node.js that runs TypeScript directly (22.18 or later; .nvmrc pins one).');
  process.exit(2);
}

// The app's sources import each other without an extension, as the bundler
// allows. Node does not, so a relative import that fails is retried as `.ts`.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return next(`${specifier}.ts`, context);
      }
      throw err;
    }
  }
});

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'desktop-app');
const Database = createRequire(join(app, 'package.json'))('better-sqlite3');
const { checkMigration } = await import(pathToFileURL(join(app, 'src/main/db/migration-check.ts')).href);

const source = process.argv[2] ?? join(process.env.APPDATA ?? '', 'SprintTicker', 'sprintticker.db');
if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(2);
}

// The -wal file holds whatever the app wrote since its last checkpoint; a copy
// without it would be missing the most recent work.
const copy = join(mkdtempSync(join(tmpdir(), 'sprintticker-migration-')), 'sprintticker.db');
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
}

const db = new Database(copy);
db.pragma('foreign_keys = ON');
const report = checkMigration(db);
db.close();

console.log(`Source:   ${source}`);
console.log(`Migrated: ${copy}`);
console.log(`Schema:   ${report.before.version} -> ${report.after.version} (latest ${report.latestVersion})`);
console.table({ before: report.before, after: report.after });
if (report.tombstones.length > 0) {
  console.log('Archived tasks kept so history can name them:');
  console.table(report.tombstones);
}
if (report.recovered.length > 0) {
  console.log('Sessions closed by a migration, their time logged locally (never sent):');
  console.table(report.recovered);
}
console.log(`Foreign key violations: ${report.foreignKeyViolations}`);

if (report.problems.length === 0) {
  console.log('OK: every worklog and every second kept, every orphan named, at most one open session.');
} else {
  console.log('PROBLEMS -- do not ship this migration:');
  for (const problem of report.problems) console.log(`  - ${problem}`);
}
process.exit(report.problems.length === 0 ? 0 : 1);
