/**
 * Measures the shortest worklog a real Jira Cloud site will accept.
 *
 * `JiraProvider.minimumLoggableSeconds` is 60, and that number came from
 * Jira's documented minute granularity plus one observed failure, not from a
 * measurement:
 *
 *   HTTP 400 - Le journal de travail ne doit pas avoir pour valeur Null
 *
 * The engine now refuses to queue anything below the declared floor, so if the
 * real threshold is lower than 60 this app is silently discarding time a user
 * worked. That is the failure worth checking, and it cannot be checked from a
 * unit test: only the live API knows.
 *
 * Credentials come from the environment, never from an argument, so the token
 * does not land in shell history or in a process list. Nothing is written to
 * this repository.
 *
 * Usage (PowerShell):
 *   $env:JIRA_SITE  = "https://your-team.atlassian.net"
 *   $env:JIRA_EMAIL = "you@your-team.com"
 *   $env:JIRA_TOKEN = "..."
 *   node scripts/jira-worklog-probe.js SCRUM-1
 *
 * **This writes to the issue you name.** Every worklog it creates is deleted
 * again immediately, and the ids are printed so you can check by hand if a
 * delete fails -- but point it at a throwaway issue, not at real work.
 */

const DURATIONS_SECONDS = [1, 5, 30, 59, 60, 61, 120];

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the usage block at the top of this file.`);
    process.exit(1);
  }
  return value.trim();
}

/**
 * `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with a numeric offset.
 *
 * Deliberately a copy of `JiraProvider.toJiraTimestamp` rather than an import:
 * this script probes the live API, and sharing the formatter would mean a
 * defect in it could hide itself from the probe meant to catch it. Jira
 * rejects both `toISOString()` and the `+02:00` form.
 */
function toJiraTimestamp(date) {
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}` +
    `${sign}${pad(offsetMinutes / 60)}${pad(offsetMinutes % 60)}`
  );
}

async function main() {
  const issueKey = process.argv[2];
  if (!issueKey) {
    console.error('Usage: node scripts/jira-worklog-probe.js <ISSUE-KEY>');
    console.error('Use a throwaway issue: this writes worklogs to it.');
    process.exit(1);
  }

  const site = required('JIRA_SITE').replace(/\/+$/, '');
  const auth =
    'Basic ' + Buffer.from(`${required('JIRA_EMAIL')}:${required('JIRA_TOKEN')}`).toString('base64');
  const worklogUrl = `${site}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`;

  console.log(`Probing ${site} on ${issueKey}.`);
  console.log('Each accepted worklog is deleted again immediately.\n');

  const accepted = [];
  const refused = [];

  for (const seconds of DURATIONS_SECONDS) {
    let res;
    try {
      res = await fetch(worklogUrl, {
        method: 'POST',
        headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeSpentSeconds: seconds,
          started: toJiraTimestamp(new Date()),
          comment: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SprintTicker probe' }] }]
          }
        })
      });
    } catch (err) {
      console.error(`${String(seconds).padStart(3)}s  could not reach Jira: ${err.message}`);
      process.exit(1);
    }

    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      accepted.push(seconds);
      console.log(`${String(seconds).padStart(3)}s  accepted  (worklog ${body.id ?? 'unknown'})`);
      await deleteWorklog(worklogUrl, body.id, auth);
    } else {
      const detail = await res.text().catch(() => '');
      refused.push(seconds);
      console.log(`${String(seconds).padStart(3)}s  refused   HTTP ${res.status} ${detail.slice(0, 160)}`);
    }
  }

  const lowestAccepted = accepted.length > 0 ? Math.min(...accepted) : null;
  console.log('\n--- result ---');
  if (lowestAccepted === null) {
    console.log('Every duration was refused. Check the issue key and the permissions first.');
    return;
  }
  console.log(`Shortest accepted worklog: ${lowestAccepted}s`);
  console.log(`Refused: ${refused.length > 0 ? refused.join('s, ') + 's' : 'none'}`);
  console.log(
    lowestAccepted === 60
      ? 'Matches JiraProvider.minimumLoggableSeconds = 60. Nothing to change.'
      : `JiraProvider.minimumLoggableSeconds is 60, so anything between ${lowestAccepted}s and 59s ` +
          'is being discarded that Jira would have stored. Lower it to match.'
  );
}

/**
 * Removes a probe worklog.
 *
 * Reported rather than thrown: a failed delete leaves a stray minute on the
 * issue, which is worth saying out loud, but it is not a reason to abandon the
 * measurement half-finished.
 */
async function deleteWorklog(worklogUrl, worklogId, auth) {
  if (!worklogId) {
    console.warn('      no worklog id returned; nothing to clean up, check the issue by hand');
    return;
  }
  const res = await fetch(`${worklogUrl}/${encodeURIComponent(worklogId)}`, {
    method: 'DELETE',
    headers: { Authorization: auth }
  }).catch((err) => ({ ok: false, status: err.message }));

  if (!res.ok) {
    console.warn(`      could not delete worklog ${worklogId} (${res.status}); remove it by hand`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
