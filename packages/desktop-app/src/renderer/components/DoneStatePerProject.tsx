import React, { useEffect, useState } from 'react';
import { couldNot } from '../utils/formatters';
import { AlertTriangle } from 'lucide-react';
import { OpStatusDTO, ProjectDTO } from '../../shared/dtos';
import { DoneStateByProjectSetting, FlowSettingKey } from '../../shared/flow-settings';

export interface DoneStatePerProjectProps {
  providerId: string;
  /** OpenProject's statuses, to choose from by id; empty for Jira, whose states are typed by name. */
  statuses: readonly OpStatusDTO[];
}

/**
 * "When I mark a task done", per project (S20): each workflow has its own
 * states, so a project can send Done somewhere other than the completion
 * action above, which stays the choice for all projects. A project left
 * empty follows it.
 */
export const DoneStatePerProject: React.FC<DoneStatePerProjectProps> = ({ providerId, statuses }) => {
  const [setting, setSetting] = useState<DoneStateByProjectSetting | null>(null);
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.getFlowSetting(FlowSettingKey.DONE_STATE_BY_PROJECT).then(setSetting, (err: unknown) => setError(couldNot('read it', err)));
    api.getProjects().then(
      all => setProjects(all.filter(p => p.providerId === providerId).sort((a, b) => a.name.localeCompare(b.name))),
      (err: unknown) => setError(couldNot('change it', err))
    );
  }, [providerId]);

  if (!setting || projects.length === 0) return null;

  const save = async (projectId: string, state: string): Promise<void> => {
    const overrides = { ...setting.overrides };
    if (state.trim()) overrides[projectId] = state.trim();
    else delete overrides[projectId];
    const next = { ...setting, overrides };
    setError(null);
    setSetting(next);
    try {
      const stored = await window.electronAPI?.saveFlowSetting(FlowSettingKey.DONE_STATE_BY_PROJECT, next);
      if (stored) setSetting(stored);
    } catch (err) {
      setError(couldNot('change it', err));
    }
  };

  const differ = projects.filter(p => setting.overrides[p.id]).length;
  const inputClass =
    'w-48 bg-dark-900 border border-border-field rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-focus';

  return (
    <details className="mt-2 text-xs text-text-secondary">
      <summary className="cursor-pointer select-none hover:text-text-primary">
        {differ === 0 ? 'Every project the same' : `${differ} ${differ === 1 ? 'project differs' : 'projects differ'}`}
        {' '}&middot; set one per project
      </summary>
      <p className="mt-2">Each workflow has its own states. A project left empty follows the choice above.</p>
      <ul className="mt-2 space-y-1.5">
        {projects.map(project => {
          const value = setting.overrides[project.id] ?? '';
          return (
            <li key={project.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-text-primary">{project.name}</span>
              {statuses.length > 0 ? (
                <select
                  aria-label={`Done for ${project.name}`}
                  value={value}
                  onChange={e => void save(project.id, e.target.value)}
                  className={inputClass}
                >
                  <option value="">As above</option>
                  {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  aria-label={`Done for ${project.name}`}
                  defaultValue={value}
                  placeholder="As above"
                  onBlur={e => {
                    if (e.target.value.trim() !== value) void save(project.id, e.target.value);
                  }}
                  className={inputClass}
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2 flex items-center space-x-1.5 text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </details>
  );
};
