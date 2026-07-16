import { badRequest } from '../middleware/errors.js';

// The commission state machine. A transition not listed here cannot happen —
// this is the single source of truth the whole app goes through.
const TRANSITIONS_MAP = {
  pending: ['approved', 'rejected'],
  approved: ['processing'], // only via payout batch creation
  processing: ['paid'], // only via payout mark-paid
  rejected: [],
  paid: [],
};

export function assertTransition(fromStatus, toStatus) {
  const allowedList = TRANSITIONS_MAP[fromStatus] || [];
  if (!allowedList.includes(toStatus)) {
    throw badRequest(`Cannot move a commission from '${fromStatus}' to '${toStatus}'`);
  }
}

export function historyEntryMap(fromStatus, toStatus, actorMap, note = null) {
  return {
    from: fromStatus,
    to: toStatus,
    byUserId: actorMap ? actorMap.id : null,
    byName: actorMap ? actorMap.name : null,
    note: note || null,
    at: new Date(),
  };
}

// Transition a single commission document (validates + records audit entry).
// Caller is responsible for save().
export function applyTransition(commission, toStatus, actorMap, note = null) {
  assertTransition(commission.status, toStatus);
  commission.statusHistoryList.push(historyEntryMap(commission.status, toStatus, actorMap, note));
  commission.status = toStatus;
  return commission;
}
