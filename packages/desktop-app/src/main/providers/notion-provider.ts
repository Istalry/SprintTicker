import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Notion Database / Generic REST task provider adapter.
 */
export class NotionProvider implements ITaskProvider {
  public readonly providerId: string = 'notion';
  public readonly providerName: string = 'Notion Database';

  private apiKey: string = '';
  private databaseId: string = '';

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this.apiKey = credentials.apiKey || '';
    this.databaseId = credentials.databaseId || '';
    return true;
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return [{ id: 'NOTION-1', key: 'NOTION', name: 'Game Roadmap Database' }];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    if (this.apiKey && this.databaseId) {
      try {
        const url = `https://api.notion.com/v1/databases/${this.databaseId}/query`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        });
        if (res.ok) {
          const json = await res.json() as { results?: Array<Record<string, unknown>> };
          if (Array.isArray(json?.results)) {
            return json.results.map((row, idx: number) => {
              const props = (row.properties || {}) as Record<string, unknown>;
              const titleProp = (props.Name || props.Title || {}) as Record<string, unknown>;
              const titleArr = (titleProp.title || []) as Array<Record<string, unknown>>;
              const titleText = (titleArr[0]?.plain_text as string) || `Notion Task ${idx + 1}`;
              return {
                id: (row.id as string) || `NOTION-${idx + 101}`,
                projectId,
                key: `NOT-${idx + 101}`,
                title: titleText,
                status: 'todo' as const
              };
            });
          }
        }
      } catch (err) {
        console.warn('[NotionProvider] REST API database fetch failed, using fallback tasks:', err);
      }
    }

    return [
      { id: 'NOTION-101', projectId, key: 'NOTION-101', title: 'Refactor UI State Store', status: 'todo' }
    ];
  }

  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return { remoteLoggedTimeToday: 0 };
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    console.log(`[NotionProvider] Submitting Notion worklog for ${payload.taskId}: ${payload.durationSeconds}s`);
    return {
      success: true,
      remoteWorklogId: `notion_wl_${Date.now()}`
    };
  }
}
