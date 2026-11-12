/**
 * What a provider said when it refused an entry for good (redesign P11c), as
 * a clause: "PF-44, 30m: time tracking is off on this issue".
 *
 * The queue keeps the error verbatim -- "Logging time failed: HTTP 400 -
 * Time tracking is not enabled" -- because the panel in Settings shows it
 * whole. The card wants the provider's own words, which follow the status;
 * with none, what the status means.
 */
const ANSWER = /HTTP (\d{3})(?: - ([\s\S]+))?$/;

export function refusalReason(refusal: string | null | undefined): string {
  if (!refusal) return 'no reason was given';
  const answer = ANSWER.exec(refusal.trim());
  if (!answer) return trimSentence(refusal);
  const words = answer[2] ? trimSentence(answer[2]) : '';
  if (words) return words;
  return answer[1] === '404' ? 'the task is not there any more' : `it answered ${answer[1]}`;
}

/** Without the closing full stop: the clause goes inside a sentence. */
function trimSentence(text: string): string {
  return text.trim().replace(/[.\s]+$/, '');
}
