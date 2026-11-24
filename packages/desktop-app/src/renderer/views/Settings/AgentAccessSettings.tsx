import React, { useEffect, useState } from 'react';
import type { AgentAccessDTO } from '../../../shared/agent-setup';
import { ipcErrorMessage } from '../../utils/formatters';
import { SettingButton, SettingProblem, SettingRow, SettingSwitch } from '../../components/SettingRow';
import { useAnnounce } from '../../components/LiveAnnouncer';

/**
 * Settings · Data · AI agents (AGENT-INTERFACE.md §5): the switch that lets
 * an agent -- Claude Code, Claude desktop -- read the user's time and start
 * or stop a task, and the token it needs. Off until turned on; a new token
 * revokes every agent given the old one.
 */
export const AgentAccessSettings: React.FC = () => {
  const [access, setAccess] = useState<AgentAccessDTO | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useAnnounce(note, note ?? '');

  useEffect(() => {
    let live = true;
    window.electronAPI.getAgentAccess().then(
      read => { if (live) setAccess(read); },
      (err: unknown) => { if (live) setProblem(`Could not read the access: ${ipcErrorMessage(err)}`); }
    );
    return () => { live = false; };
  }, []);

  const apply = (change: Promise<AgentAccessDTO>, said: string | null) => {
    setProblem(null);
    setNote(null);
    change.then(
      next => { setAccess(next); setNote(said); },
      (err: unknown) => setProblem(`Not changed: ${ipcErrorMessage(err)}`)
    );
  };

  const copy = (text: string, said: string) => {
    setProblem(null);
    navigator.clipboard.writeText(text).then(
      () => setNote(said),
      (err: unknown) => setProblem(`Could not copy: ${ipcErrorMessage(err)}`)
    );
  };

  return (
    <SettingRow
      title="AI agents"
      description={'Lets Claude Code or Claude desktop read your time, and start, pause or stop a task, through the sprintticker tool. '
        + 'What it reads -- task keys and titles, entries and their notes -- goes to the AI with your conversation.'}
      control={(
        <SettingSwitch
          label="Let AI agents use SprintTicker"
          checked={access?.enabled ?? false}
          disabled={!access}
          onChange={on => apply(window.electronAPI.setAgentAccess(on), null)}
        />
      )}
    >
      {access?.enabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="agent-token" className="text-xs text-text-secondary">Token</label>
            <input
              id="agent-token"
              type="password"
              readOnly
              value={access.token}
              className="min-w-0 flex-1 rounded-lg border border-border-field bg-dark-900 px-2 py-1 font-mono text-xs text-text-primary"
            />
            <SettingButton onClick={() => copy(access.token, 'Token copied.')}>Copy</SettingButton>
            <SettingButton tone="ghost" onClick={() => apply(window.electronAPI.newAgentToken(), 'A new token is made. Give it to your agents again.')}>
              Make a new one
            </SettingButton>
          </div>
          <p className="text-xs text-text-secondary">
            An agent gives it as SPRINTTICKER_TOKEN. A new one stops every agent given the old one.
          </p>
          {access.setup && (
            <>
              <SetupLine
                label="Claude Code: run this once in a terminal"
                text={access.setup.claudeCode}
                onCopy={() => copy(access.setup!.claudeCode, 'Claude Code line copied.')}
              />
              <SetupLine
                label="Claude desktop: add this to claude_desktop_config.json (Settings › Developer › Edit Config), then restart it"
                text={access.setup.claudeDesktop}
                onCopy={() => copy(access.setup!.claudeDesktop, 'Claude desktop entry copied.')}
              />
              {access.setup.command && (
                <SetupLine
                  label="The command, for an agent that runs commands"
                  text={access.setup.command}
                  onCopy={() => copy(access.setup!.command!, 'Command path copied.')}
                />
              )}
              <p className="text-xs text-text-secondary">These lines carry the token: a new one means giving them again.</p>
            </>
          )}
          {access.missing === 'portable' && (
            <p className="text-xs text-text-secondary">
              The portable build cannot give an agent the command: it runs from a folder that is gone once it closes. Install SprintTicker to use it.
            </p>
          )}
          {access.missing === 'not-built' && (
            <p className="text-xs text-text-secondary">This build has no sprintticker command: run pnpm agent:build.</p>
          )}
        </div>
      )}
      {note && <p className="text-xs text-text-secondary">{note}</p>}
      {problem && <SettingProblem>{problem}</SettingProblem>}
    </SettingRow>
  );
};

/** One line to give an agent, shown as it will be pasted. */
const SetupLine: React.FC<{ label: string; text: string; onCopy: () => void }> = ({ label, text, onCopy }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <SettingButton onClick={onCopy}>Copy</SettingButton>
    </div>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border-dark bg-dark-900 px-2 py-1 font-mono text-xs text-text-primary">{text}</pre>
  </div>
);
