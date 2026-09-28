import type { InboxSource } from '../inbox-source';
import { connectionErrorSource } from './connection-error.source';
import { findingRegressionSource } from './finding-regression.source';
import { taskFailedSource } from './task-failed.source';

export const INBOX_SOURCES: readonly InboxSource[] = [
  taskFailedSource,
  findingRegressionSource,
  connectionErrorSource,
];
