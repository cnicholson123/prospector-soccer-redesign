import type { Store } from '../../store/types.js';
import { settleSchedules } from '../../content/schedule.js';
import { ApiError } from './errors.js';
/** One limiter and settlement coordinator per warm function instance. */
export function instanceWork() {
  const limits = new Map<string, { count: number; until: number }>();
  let sweepAt = 0;
  let settling: Promise<void> | undefined;
  let nextDueAt = Infinity, scheduleVersion = -1;
  return {
    rateLimit(hash: string, now: number) {
      if (now >= sweepAt) { for (const [key, value] of limits) if (value.until <= now) limits.delete(key); sweepAt = now + 300000; }
      let limit = limits.get(hash);
      if (!limit || limit.until <= now) { limit = { count: 0, until: now + 300000 }; limits.set(hash, limit); }
      if (++limit.count > 600) throw new ApiError(429, 'rate_limited', 'Too many requests', undefined, Math.max(1, Math.ceil((limit.until - now) / 1000)));
    },
    async settle(store: Store, now: Date, index: { scheduleVersion: number; nextDueAt: string | null }) {
      // Authentication observes the current snapshot generation in its single read.
      // Cache the index, with no stale window across concurrent function instances.
      const changed = scheduleVersion !== index.scheduleVersion;
      if (changed) {
        scheduleVersion = index.scheduleVersion;
        nextDueAt = index.nextDueAt ? Date.parse(index.nextDueAt) : Infinity;
      }
      if (now.getTime() < nextDueAt) {
        // Cancellation/repair may remove the failing due item on another instance.
        if (changed && await store.getMeta('schedule-error')) await store.setScheduleError(null);
        return false;
      }
      if (!settling) settling = (async () => {
        try {
          await settleSchedules(store, now);
          if (await store.getMeta('schedule-error')) await store.setScheduleError(null);
        } catch {
          if (!await store.getMeta('schedule-error')) await store.setScheduleError({ at: now.toISOString() });
        }
      })().finally(() => { settling = undefined; });
      await settling;
      return true;
    },
  };
}
