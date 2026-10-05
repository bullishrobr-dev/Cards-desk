import type { Unit } from '../adapters/types.ts';

export type UnitKind = 'root' | 'page' | 'followup' | 'listing';

export type JobMessage =
  | { type: 'fetch'; sourceKind: 'calendar' | 'retailer'; unitKind: UnitKind; unit: Unit }
  | { type: 'llm' }
  | { type: 'maintenance' };

/** The subset of a Queue binding the scheduler uses, so tests can capture messages. */
export interface JobQueue {
  sendBatch(messages: Array<{ body: JobMessage; delaySeconds?: number }>): Promise<unknown>;
}

/** Queue delivery delay is capped at 12 h; we never need more than 15 min of spacing. */
export const MAX_DELAY_SECONDS = 15 * 60;
