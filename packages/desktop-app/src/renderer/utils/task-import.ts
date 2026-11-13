import { TaskDTO } from '../../shared/dtos';

type TaskStatus = TaskDTO['status'];
const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'done'];

export type ImportedTask = { key: string; title: string; status?: TaskStatus };

/** CSV lines (KEY, TITLE, STATUS -- or a title alone) or a JSON array of tasks. */
export function parseImport(text: string): ImportedTask[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((item, idx) => {
      const t = item as Partial<ImportedTask>;
      if (typeof t?.title !== 'string' || !t.title.trim()) throw new Error(`entry ${idx + 1} has no title`);
      return { key: typeof t.key === 'string' && t.key.trim() ? t.key.trim() : `IMP-${idx + 1}`, title: t.title.trim(), status: t.status && STATUSES.includes(t.status) ? t.status : 'todo' };
    });
  }
  return trimmed.split('\n').map(l => l.trim()).filter(Boolean).map((line, idx) => {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const status = parts[2] as TaskStatus | undefined;
      return { key: parts[0], title: parts[1], status: status && STATUSES.includes(status) ? status : 'todo' };
    }
    return { key: `IMP-${idx + 1}`, title: line, status: 'todo' };
  });
}

