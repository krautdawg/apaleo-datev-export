#!/usr/bin/env node
import { createNodeContext } from './context.js';
import { runCli } from './run.js';

process.exitCode = await runCli(process.argv.slice(2), createNodeContext());
