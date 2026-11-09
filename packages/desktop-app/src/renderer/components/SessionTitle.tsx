import React from 'react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { isAdHocSession } from '../../shared/interruption';
import { InlineRename } from './InlineRename';

interface SessionTitleProps {
  session: ActiveSessionDTO;
  /** For the title as text, and for the input while it is renamed. */
  className: string;
  inputClassName: string;
}

/**
 * The open session's title, which can be renamed in place when the session
 * is ad-hoc -- an interruption, named for the time it started until the user
 * gives it a name. A provider's task keeps the provider's name, and shows
 * it as plain text.
 *
 * What main answers comes back on the session channel, so the field only
 * closes. Bound to the session it was opened on: one that ended elsewhere
 * takes the field with it.
 */
export const SessionTitle: React.FC<SessionTitleProps> = ({ session, className, inputClassName }) => {
  if (!isAdHocSession(session)) return <span className={className} title={session.taskTitle}>{session.taskTitle}</span>;
  return (
    <InlineRename
      title={session.taskTitle}
      ownerId={session.sessionId}
      onRename={name => window.electronAPI.renameSession(name)}
      className={className}
      inputClassName={inputClassName}
    />
  );
};
