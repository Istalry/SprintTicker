import React, { useEffect, useState } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { ProviderSettingsUpdateDTO } from '../../../shared/dtos';
import { ConnectionTestDTO, connectionFailureText } from '../../../shared/first-run';
import { DEFAULT_START_SIDE_EFFECTS, FlowSettingKey } from '../../../shared/flow-settings';
import { ProviderId, providerDisplayName } from '../../../shared/provider-names';
import { StepFrame, choiceCard, fieldClass, primaryButton, quietButton, secondaryButton } from './StepFrame';
import { ipcErrorMessage } from '../../utils/formatters';

type Choice = 'jira' | 'openproject' | 'none';
type Test = { state: 'idle' } | { state: 'testing' } | { state: 'done'; result: ConnectionTestDTO };

const warn = (what: string) => (err: unknown) => console.warn(`[FirstRun] ${what} failed:`, err);
const MINUTE = 60;

/**
 * S1, where are your tasks? Jira, OpenProject, or no account. Test connection
 * tries what was typed without saving it; Continue saves, and asks nothing
 * of an account it has not seen answer. The SprintTicker server choice is
 * left out until `PROVIDER-API.md` §15 ships -- left out, not greyed out.
 */
export const YourTasksStep: React.FC<{ onLater: () => void; onNext: () => void }> = ({ onLater, onNext }) => {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [startUpdates, setStartUpdates] = useState<boolean>(DEFAULT_START_SIDE_EFFECTS.enabled);
  const [afterSeconds, setAfterSeconds] = useState<number>(DEFAULT_START_SIDE_EFFECTS.afterSeconds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set up again: what is saved is where it starts.
  useEffect(() => {
    const api = window.electronAPI;
    let live = true;
    api.getProviders()
      .then(saved => {
        if (!live) return;
        if (saved.activeProviderId === ProviderId.JIRA && saved.jiraSite) {
          setChoice('jira');
          setSite(saved.jiraSite);
          setEmail(saved.jiraEmail);
          setToken(saved.jiraApiToken);
        } else if (saved.activeProviderId === ProviderId.OPENPROJECT && saved.opDomain) {
          setChoice('openproject');
          setSite(saved.opDomain);
          setToken(saved.opApiKey);
        }
      })
      .catch(warn('Reading the saved account'));
    api.getFlowSetting(FlowSettingKey.START_SIDE_EFFECTS)
      .then(setting => {
        if (!live) return;
        setStartUpdates(setting.enabled);
        setAfterSeconds(setting.afterSeconds);
      })
      .catch(warn('Reading the start setting'));
    return () => { live = false; };
  }, []);

  const account = choice === 'jira' || choice === 'openproject' ? choice : null;
  const name = account ? providerDisplayName(account) : '';
  const passed = test.state === 'done' && test.result.ok ? test.result : null;
  const failed = test.state === 'done' && !test.result.ok ? test.result : null;

  /** A changed field is untested again. */
  const edit = (set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setTest({ state: 'idle' });
  };

  const runTest = () => {
    if (!account) return;
    setTest({ state: 'testing' });
    window.electronAPI.testProviderConnection({ providerId: account, site, email, token })
      .then(result => setTest({ state: 'done', result }))
      .catch(err => setTest({ state: 'done', result: { ok: false, reason: 'failed', host: null, detail: ipcErrorMessage(err) } }));
  };

  const openTokenPage = () => {
    if (account) window.electronAPI.openTokenPage(account, site).catch(warn('Opening the token page'));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: ProviderSettingsUpdateDTO =
        account === 'jira'
          ? { providerId: ProviderId.JIRA, jiraSite: site.trim(), jiraEmail: email.trim(), jiraApiToken: token.trim() }
          : account === 'openproject'
            ? { providerId: ProviderId.OPENPROJECT, opDomain: site.trim(), opApiKey: token.trim() }
            : { providerId: ProviderId.ADHOC };
      if (!(await window.electronAPI.setActiveProvider(payload))) throw new Error('the account was not saved');
      if (account) {
        await window.electronAPI.saveFlowSetting(FlowSettingKey.START_SIDE_EFFECTS, { enabled: startUpdates, afterSeconds });
      }
      onNext();
    } catch (err) {
      setError(`Not saved: ${ipcErrorMessage(err)}. You can finish this in Settings › Account.`);
    } finally {
      setSaving(false);
    }
  };

  const canContinue = choice === 'none' || passed !== null;

  return (
    <StepFrame
      step={1}
      title="Where are your tasks?"
      intro="SprintTicker times the tasks you already have, and sends the time back there."
      error={error}
      footer={
        <>
          <button type="button" className={quietButton} onClick={onLater}>Set up later</button>
          <span className="flex-1" />
          <button type="button" className={primaryButton} disabled={!canContinue || saving} onClick={() => void save()}>
            Continue
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Where are your tasks?" className="space-y-2">
        {([
          ['jira', 'Jira', 'Your site, email and an API token.'],
          ['openproject', 'OpenProject', "Your server's address and an API key."],
          ['none', 'No account — my own tasks only', 'Time stays on this computer. You can add an account later in Settings › Account.']
        ] as const).map(([value, label, hint]) => (
          <div key={value} className={choiceCard(choice === value)}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="first-run-provider"
                className="mt-0.5"
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                  setTest({ state: 'idle' });
                }}
              />
              <span>
                <span className="block text-sm font-semibold text-white">{label}</span>
                <span className="block text-xs text-text-secondary">{hint}</span>
              </span>
            </label>

            {choice === value && account && (
              <div className="mt-3 space-y-3 pl-7">
                <label className="block text-xs text-text-secondary">
                  {account === 'jira' ? 'Jira site' : 'Server address'}
                  <input className={`${fieldClass} mt-1`} value={site} onChange={edit(setSite)}
                    placeholder={account === 'jira' ? 'https://your-team.atlassian.net' : 'https://openproject.example.com'} />
                </label>
                {account === 'jira' && (
                  <label className="block text-xs text-text-secondary">
                    Your email
                    <input className={`${fieldClass} mt-1`} value={email} onChange={edit(setEmail)} placeholder="you@your-team.com" />
                  </label>
                )}
                {/* The link sits outside the label: a label names its first
                    control, and a button inside it took the field's name. */}
                <div className="text-xs text-text-secondary">
                  <span id="first-run-token">
                    {account === 'jira'
                      ? 'API token: a password for apps, made in your Atlassian account in a minute'
                      : 'API key: made on your account page in OpenProject'}
                  </span>
                  {' · '}
                  <button type="button" className="text-text-primary underline hover:text-white" onClick={openTokenPage}>
                    make one ↗
                  </button>
                  <input type="password" aria-labelledby="first-run-token" className={`${fieldClass} mt-1`} value={token} onChange={edit(setToken)} />
                </div>

                <div className="flex items-center gap-3">
                  <button type="button" className={secondaryButton} disabled={test.state === 'testing'} onClick={runTest}>
                    {test.state === 'testing' ? 'Testing…' : 'Test connection'}
                  </button>
                  {passed && (
                    <span role="status" className="flex items-center gap-1.5 text-xs text-accent-green">
                      <CircleCheck className="w-4 h-4" aria-hidden="true" />
                      Connected as {passed.userName} · {passed.projectCount} {passed.projectCount === 1 ? 'project' : 'projects'}
                    </span>
                  )}
                </div>
                {failed && <TestFailure failure={failed} providerName={name} onMakeToken={openTokenPage} />}

                {passed && (
                  <div className="rounded-lg border border-border-dark p-3 space-y-2">
                    <p className="text-xs text-text-primary font-semibold">
                      When you start a task, should SprintTicker change it in {name}?
                    </p>
                    <p className="text-xs text-text-secondary">
                      Once it has run {Math.round(afterSeconds / MINUTE)} minutes: move it to In Progress, and make it yours if
                      nobody has it.
                    </p>
                    <div role="group" aria-label={`Change it in ${name}?`} className="flex gap-2">
                      {([[true, `Yes, update ${name}`], [false, 'No, only time it']] as const).map(([value, label]) => (
                        <button key={label} type="button" aria-pressed={startUpdates === value}
                          onClick={() => setStartUpdates(value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                            startUpdates === value ? 'bg-select text-text-primary border-focus' : 'border-border-dark text-text-secondary hover:text-white'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-text-secondary">Change it later in Settings › Account.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </StepFrame>
  );
};

/** A failed test, written out (S31): what went wrong, and what to do about it. */
const TestFailure: React.FC<{
  failure: Extract<ConnectionTestDTO, { ok: false }>;
  providerName: string;
  onMakeToken: () => void;
}> = ({ failure, providerName, onMakeToken }) => {
  const text = connectionFailureText(failure, providerName);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 p-3 text-xs">
      <CircleAlert className="w-4 h-4 shrink-0 text-accent-red" aria-hidden="true" />
      <span>
        <span className="block font-semibold text-accent-red">{text.headline}</span>
        <span className="block text-text-secondary">
          {text.hint}
          {failure.reason === 'refused' && (
            <>
              {' '}
              <button type="button" className="text-text-primary underline hover:text-white" onClick={onMakeToken}>
                Make a new one ↗
              </button>
            </>
          )}
        </span>
      </span>
    </div>
  );
};
