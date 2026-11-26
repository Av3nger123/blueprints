import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, parseVersion, satisfies } from './semver.js';

test('parseVersion accepts semver and rejects junk', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseVersion('1.0.0-rc.1')?.prerelease, ['rc', '1']);
  for (const bad of ['1.2', 'v1.2.3', '01.2.3', '1.2.3.4', '']) assert.equal(parseVersion(bad), null, bad);
});

test('compareVersions orders prereleases below releases', () => {
  const v = (s: string) => parseVersion(s)!;
  assert.ok(compareVersions(v('1.0.0-alpha'), v('1.0.0')) < 0);
  assert.ok(compareVersions(v('1.0.0-alpha.2'), v('1.0.0-alpha.10')) < 0);
  assert.ok(compareVersions(v('1.0.0-alpha'), v('1.0.0-beta')) < 0);
  assert.ok(compareVersions(v('2.0.0'), v('1.9.9')) > 0);
  assert.equal(compareVersions(v('1.2.3'), v('1.2.3')), 0);
});

test('satisfies: exact, caret, tilde and star with npm 0.x semantics', () => {
  const cases: [string, string, boolean][] = [
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.9.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['1.2.2', '^1.2.3', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['5.0.0', '*', true],
    ['1.3.0-rc.1', '^1.2.0', false],
    ['1.2.0-rc.2', '^1.2.0-rc.1', true],
    ['nope', '*', false],
    ['1.0.0', 'latest', false],
  ];
  for (const [v, r, want] of cases) assert.equal(satisfies(v, r), want, `${v} vs ${r}`);
});
