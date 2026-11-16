import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeProviderApi, TEAMMATE, TEAMMATE_TOKEN } from '../../../scripts/fake-provider-api.js';
import { runAgainstFake } from '../../../scripts/provider-api-check.js';

/**
 * The Provider API's fake server and its conformance check
 * (`Documentation/PROVIDER-API.md`, sections 13 and 15). CI runs the check
 * against the fake by itself (`pnpm provider:check --fake`); this holds the
 * other half -- that the check fails a server that is wrong -- and the
 * failure switches the client's integration tests lean on.
 */
describe('The conformance check against the fake', () => {
  const quiet = (): void => undefined;

  it('RunAgainstFake_ConformingFake_PassesEveryCheck', async () => {
    const result = await runAgainstFake([], quiet);

    expect(result.failed).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('RunAgainstFake_ServerIgnoresClientRef_FailsIdempotency', async () => {
    const result = await runAgainstFake(['ignoreClientRef'], quiet);

    expect(result.ok).toBe(false);
    expect(result.findings.get(8).failures.join('\n')).toMatch(/billed twice/);
  });

  it('RunAgainstFake_BadTokenReadAsAnonymous_FailsTheTokenCheck', async () => {
    const result = await runAgainstFake(['anonymousOnBadToken'], quiet);

    expect(result.ok).toBe(false);
    expect(result.findings.get(2).failures.length).toBeGreaterThan(0);
  });

  it('RunAgainstFake_AnswerLostOnce_ResendFindsTheSameWorklog', async () => {
    const result = await runAgainstFake(['loseWorklogAnswers=1'], quiet);

    expect(result.ok).toBe(true);
  });
});

describe('The fake provider server', () => {
  let fake: ReturnType<typeof createFakeProviderApi>;
  let base: string;

  beforeEach(async () => {
    fake = createFakeProviderApi({ quiet: true, projects: 2, tasks: 12, pageSize: 5 });
    base = await fake.listen(0);
  });

  afterEach(async () => {
    await fake.close();
  });

  const call = (method: string, path: string, body?: unknown, token = 'fake-provider-token'): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'SprintTicker/0.0.0',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  const worklog = (clientRef: string) => ({
    clientRef,
    taskId: 't-1-1',
    startedAt: '2026-11-16T08:00:00Z',
    day: '2026-11-16',
    durationSeconds: 600,
    comment: 'Work [#ABCDEFGH]'
  });

  it('PostWorklog_TwoAtOnce_MakesOneWorklog', async () => {
    const answers = await Promise.all([call('POST', '/worklogs', worklog('q_1')), call('POST', '/worklogs', worklog('q_1'))]);

    expect(answers.map(a => a.status).sort()).toEqual([200, 201]);
    expect([...fake.state.worklogs.values()]).toHaveLength(1);
  });

  it('PostWorklog_AnswerLost_StoredAndResendAnswers200', async () => {
    fake.state.faults.loseWorklogAnswers = 1;

    await expect(call('POST', '/worklogs', worklog('q_2'))).rejects.toThrow();
    const resend = await call('POST', '/worklogs', worklog('q_2'));

    expect(resend.status).toBe(200);
    expect([...fake.state.worklogs.values()]).toHaveLength(1);
  });

  it('AnyEndpoint_ExpiredToken_Answers401', async () => {
    fake.state.faults.expiredToken = true;

    for (const path of ['/capabilities', '/me', '/projects', '/projects/p-1/tasks']) {
      expect((await call('GET', path)).status).toBe(401);
    }
  });

  it('TaskList_FailingSecondPage_AnswersAnErrorNotAShortList', async () => {
    fake.state.faults.failPage = { path: '/projects/p-1/tasks', page: 2 };

    const first = (await (await call('GET', '/projects/p-1/tasks')).json()) as { nextCursor: string };
    const second = await call('GET', `/projects/p-1/tasks?cursor=${first.nextCursor}`);

    expect(second.status).toBe(500);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('internal');
  });

  it('Assignment_TakenMeanwhile_Answers409TakenWithTheirName', async () => {
    fake.state.faults.takeOnAssign = TEAMMATE;

    const answer = await call('POST', '/tasks/t-1-4/assignment', { ifUnassigned: true });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ outcome: 'taken', task: { assignee: TEAMMATE }, error: { code: 'taken' } });
  });

  it('Finish_ClosedTask_ChangesNothingAndLeavesTheList', async () => {
    fake.closeTask('t-1-1');

    const answer = await call('POST', '/tasks/t-1-1/transitions', { intent: 'finish' });
    const list = (await (await call('GET', '/projects/p-1/tasks?limit=500')).json()) as { items: { id: string }[] };

    expect(await answer.json()).toMatchObject({ id: 't-1-1', state: 'closed' });
    expect(list.items.map(t => t.id)).not.toContain('t-1-1');
  });

  it('Finish_WorkflowRefuses_Answers409WorkflowRefused', async () => {
    fake.state.faults.refuseTransitions.push({ intent: 'finish', message: 'Review first.' });

    const answer = await call('POST', '/tasks/t-1-1/transitions', { intent: 'finish' });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: { code: 'workflow_refused', message: 'Review first.' } });
  });

  it('Worklog_AnotherUsers_Answers404', async () => {
    const created = (await (await call('POST', '/worklogs', worklog('q_3'))).json()) as { id: string };

    const theirs = await call('DELETE', `/worklogs/${created.id}`, undefined, TEAMMATE_TOKEN);

    expect(theirs.status).toBe(404);
    expect(fake.state.violations).toEqual([]);
  });
});
