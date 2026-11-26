#!/usr/bin/env node
// Runs the auth verification suite: every *.test.mjs in this directory, one file at a time, in name
// order (99-rate-limit runs last on purpose). Exit code is non-zero if any check failed.
//
//   BASE_URL=http://localhost:3000 node verify/tests/run.mjs
//   BLUEPRINT_TEST_REPORTER=tap ...   machine-readable output (used by `blueprints verify`)
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec, tap } from 'node:test/reporters';

if (!process.env.BASE_URL) {
  console.error('BASE_URL is required, e.g. BASE_URL=http://localhost:3000 node verify/tests/run.mjs');
  process.exit(2);
}

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(dir, f));

const reporter = process.env.BLUEPRINT_TEST_REPORTER === 'tap' ? tap : new spec();

run({ files, concurrency: 1 })
  .on('test:fail', () => {
    process.exitCode = 1;
  })
  .compose(reporter)
  .pipe(process.stdout);
