#!/usr/bin/env node
import { main } from './cli.js';
import { processIo } from './io.js';

main(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  },
);
