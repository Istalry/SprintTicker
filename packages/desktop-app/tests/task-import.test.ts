import { describe, it, expect } from 'vitest';
import { parseImport } from '../src/renderer/utils/task-import';

/** Tasks' Import (S13): CSV lines or a JSON array, every task with a title and a known status. */
describe('parseImport', () => {
  it('ParseImport_CsvLines_KeyTitleStatus_OrATitleAlone', () => {
    expect(parseImport('A-1, First, in_progress\nSecond\nA-3, Third, bogus')).toEqual([
      { key: 'A-1', title: 'First', status: 'in_progress' },
      { key: 'IMP-2', title: 'Second', status: 'todo' },
      { key: 'A-3', title: 'Third', status: 'todo' }
    ]);
  });

  it('ParseImport_Json_UnknownStatusIsTodo_NoKeyIsMade', () => {
    expect(parseImport('[{ "key": "A-1", "title": "First", "status": "done" }, { "title": "Second", "status": "later" }]')).toEqual([
      { key: 'A-1', title: 'First', status: 'done' },
      { key: 'IMP-2', title: 'Second', status: 'todo' }
    ]);
  });

  it('ParseImport_JsonWithoutATitle_Throws', () => {
    expect(() => parseImport('[{ "key": "A-1" }]')).toThrow('entry 1 has no title');
    expect(() => parseImport('[{ "key"')).toThrow();
  });
});
