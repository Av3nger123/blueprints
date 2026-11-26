import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSectionOrder, parseChecklist, parseHeadings, sectionBodies } from './markdown.js';

test('parseHeadings ignores headings inside fenced code', () => {
  const md = '# Title\n\n```md\n## Not a heading\n```\n\n## Real\ntext\n~~~\n# also not\n~~~\n';
  assert.deepEqual(parseHeadings(md).map((h) => `${h.level}:${h.text}`), ['1:Title', '2:Real']);
});

test('sectionBodies returns trimmed text between level-2 headings', () => {
  const bodies = sectionBodies('# T\n## A\n\nalpha\n### sub\nmore\n## B\n\n');
  assert.equal(bodies.get('A'), 'alpha\n### sub\nmore');
  assert.equal(bodies.get('B'), '');
});

test('checkSectionOrder reports missing, empty, out-of-order and misplaced extra sections', () => {
  assert.deepEqual(checkSectionOrder('## A\nx\n## B\ny\n## Extra\nz\n', ['A', 'B']), []);
  assert.deepEqual(checkSectionOrder('## A\nx\n', ['A', 'B']), ['missing section "## B"']);
  assert.deepEqual(checkSectionOrder('## A\n## B\ny\n', ['A', 'B']), ['section "## A" is empty']);
  assert.deepEqual(checkSectionOrder('## B\ny\n## A\nx\n', ['A', 'B']), ['section "## B" is out of order']);
  assert.deepEqual(checkSectionOrder('## A\nx\n## Extra\nz\n## B\ny\n', ['A', 'B']), [
    'extra section "## Extra" must come after "## B"',
  ]);
});

test('parseChecklist reads ids and tags, and flags untagged or duplicate ids', () => {
  const md = [
    '1. **AUTH-01** `[automated]` First check.',
    '2. **AUTH-02** `[manual]` Second check.',
    '- PAY-10 [automated] Bare style also works.',
    '3. **AUTH-03** forgot the tag',
    '4. **AUTH-01** `[manual]` dup',
  ].join('\n');
  const { items, problems } = parseChecklist(md);
  assert.deepEqual(items.map((i) => `${i.id}:${i.kind}`), ['AUTH-01:automated', 'AUTH-02:manual', 'PAY-10:automated', 'AUTH-01:manual']);
  assert.deepEqual(problems, ['check AUTH-03 is not tagged [automated] or [manual]', 'duplicate check id AUTH-01']);
  assert.ok(parseChecklist('nothing here').problems[0]?.startsWith('no checks found'));
});
