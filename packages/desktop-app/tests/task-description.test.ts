import { describe, it, expect } from 'vitest';
import {
  adfMentionsAccount,
  adfToPlainText,
  clampDescription,
  markdownToPlainText,
  TASK_DESCRIPTION_MAX_CHARS
} from '../src/main/providers/task-description';

describe('task descriptions', () => {
  describe('clampDescription', () => {
    it('ClampDescription_LinesAndRuns_BecomeOneLine', () => {
      expect(clampDescription('  First line\n\n  second\tline  ')).toBe('First line second line');
    });

    it.each([['', undefined], ['   \n ', undefined], [null, undefined], [undefined, undefined]])(
      'ClampDescription_%j_IsNone',
      (input, expected) => {
        expect(clampDescription(input)).toBe(expected);
      }
    );

    it('ClampDescription_TooLong_IsCutToTheLimitWithAnEllipsis', () => {
      const clamped = clampDescription('word '.repeat(TASK_DESCRIPTION_MAX_CHARS));

      expect(clamped!.length).toBeLessThanOrEqual(TASK_DESCRIPTION_MAX_CHARS);
      expect(clamped!.endsWith('…')).toBe(true);
    });

    it('ClampDescription_ExactlyAtTheLimit_IsKeptWhole', () => {
      const text = 'x'.repeat(TASK_DESCRIPTION_MAX_CHARS);

      expect(clampDescription(text)).toBe(text);
    });
  });

  describe('adfToPlainText', () => {
    it('AdfToPlainText_Blocks_DoNotRunTheirWordsTogether', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', content: [{ type: 'text', text: 'Goal' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }
          ] }
        ]
      };

      expect(clampDescription(adfToPlainText(doc))).toBe('Goal one two');
    });

    it('AdfToPlainText_InlineNodes_KeepTheirVisibleText', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [
          { type: 'emoji', attrs: { shortName: ':tada:', text: '🎉' } },
          { type: 'text', text: ' see ' },
          { type: 'inlineCard', attrs: { url: 'https://x/y' } },
          { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'img' } }] }
        ] }]
      };

      expect(adfToPlainText(doc)).toBe('🎉 see https://x/y\n');
    });

    it.each([null, undefined, 'plain string', 42])('AdfToPlainText_NotATree_IsEmpty', value => {
      expect(adfToPlainText(value)).toBe('');
    });
  });

  describe('markdownToPlainText', () => {
    it('MarkdownToPlainText_Markup_LeavesTheWords', () => {
      const md = '# Title\n> quoted\n- item\n1. first\n**bold** *it* `code` ~~gone~~ ![img](a.png) [link](http://x)';

      expect(clampDescription(markdownToPlainText(md))).toBe('Title quoted item first bold it code gone link');
    });

    it('MarkdownToPlainText_CodeFenceAndHtml_AreDropped', () => {
      expect(clampDescription(markdownToPlainText('Before\n```\nconst x = 1;\n```\n<br/>After'))).toBe('Before After');
    });

    it('MarkdownToPlainText_UnderscoreInsideAWord_IsKept', () => {
      // Identifiers are common in task descriptions; `user_id` is not emphasis.
      expect(markdownToPlainText('Rename user_id to account_id, _really_.')).toBe('Rename user_id to account_id, really.');
    });
  });
  describe('adfMentionsAccount', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'mention', attrs: { id: 'acc-1', text: '@Somebody Else Now' } }
      ] }] }] }]
    };

    it('AdfMentionsAccount_NestedMention_MatchesOnTheAccountIdNotTheName', () => {
      expect(adfMentionsAccount(doc, 'acc-1')).toBe(true);
      expect(adfMentionsAccount(doc, 'acc-2')).toBe(false);
    });

    it.each([[null], ['text'], [{ type: 'doc' }]])('AdfMentionsAccount_%j_IsFalse', input => {
      expect(adfMentionsAccount(input, 'acc-1')).toBe(false);
    });

    it('AdfMentionsAccount_NoAccount_IsFalse', () => {
      expect(adfMentionsAccount(doc, '')).toBe(false);
    });
  });
});
