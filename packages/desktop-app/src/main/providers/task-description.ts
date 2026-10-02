/**
 * A task's description as the app shows it: plain text on one line, short.
 *
 * Both providers send rich text -- Jira its Atlassian Document Format tree,
 * OpenProject Markdown -- and neither form is any use on a 72-pixel row or in
 * a one-line list entry. What is kept is the start of the prose, which is
 * what says what the task is.
 */

/**
 * How much of a description is stored.
 *
 * The bar shows a handful of characters after the key and the app one line, so
 * 500 is already generous. The limit is about the database: a Jira description
 * can hold pages of specification, pasted logs and tables, and the cache holds
 * every task of every project.
 */
export const TASK_DESCRIPTION_MAX_CHARS = 500;

const ELLIPSIS = '…';

/** Collapses whitespace and cuts to the limit; undefined when nothing is left. */
export function clampDescription(
  text: string | null | undefined,
  maxChars: number = TASK_DESCRIPTION_MAX_CHARS
): string | undefined {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > maxChars
    ? flat.slice(0, maxChars - 1).trimEnd() + ELLIPSIS
    : flat;
}

/** One ADF node, as far as this reader cares. */
interface AdfNode {
  type?: string;
  text?: string;
  attrs?: { id?: string; text?: string; shortName?: string; url?: string };
  content?: unknown;
}

/** Nodes whose text ends a line, so words either side of them do not run together. */
const ADF_BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader', 'panel', 'rule']);

/**
 * The text of an Atlassian Document Format tree.
 *
 * Walked rather than read from a rendered field: `renderedFields` would be
 * HTML, a second format to strip, and asking for it doubles what each issue
 * costs to fetch. Mentions and emoji keep their visible text; media, which has
 * none, is dropped.
 */
export function adfToPlainText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as AdfNode;
    switch (n.type) {
      case 'text':
        parts.push(n.text ?? '');
        return;
      case 'hardBreak':
        parts.push('\n');
        return;
      case 'mention':
        parts.push(n.attrs?.text ?? '');
        return;
      case 'emoji':
        parts.push(n.attrs?.text ?? n.attrs?.shortName ?? '');
        return;
      case 'inlineCard':
        parts.push(n.attrs?.url ?? '');
        return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && ADF_BLOCKS.has(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts.join('');
}

/**
 * Whether an Atlassian Document Format tree mentions an account.
 *
 * By `attrs.id`, the account id, never by the visible `@Name`: display names
 * are neither unique nor stable, and the text is whatever the name was when
 * the comment was written.
 */
export function adfMentionsAccount(doc: unknown, accountId: string): boolean {
  if (!accountId) return false;
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as AdfNode;
    if (n.type === 'mention' && n.attrs?.id === accountId) return true;
    return Array.isArray(n.content) && n.content.some(visit);
  };
  return visit(doc);
}

/**
 * The prose of a Markdown description, as OpenProject stores it in
 * `description.raw`.
 *
 * Not a Markdown parser: it removes the markup that would otherwise show up as
 * stray characters on a one-line preview -- images, link targets, emphasis,
 * code fences, heading and list markers -- and leaves the words.
 */
export function markdownToPlainText(markdown: string | null | undefined): string {
  return (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    // Single `*` or `_` only where it wraps words: `user_id` keeps its underscore.
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, '$1$2');
}
