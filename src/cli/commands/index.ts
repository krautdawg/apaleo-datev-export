import type { Command } from '../command.js';
import { doctor } from './doctor.js';
import { exportCommand } from './export.js';
import { initMapping } from './init-mapping.js';
import { liveSmoke } from './live-smoke.js';
import { mapping } from './mapping.js';
import { properties } from './properties.js';
import { schedule } from './schedule.js';

/** Every subcommand. Later slices add one file and one entry here. */
export const COMMANDS: readonly Command[] = [doctor, properties, liveSmoke, initMapping, mapping, exportCommand, schedule];
