// Which Guesty reservation statuses the agent may reply to.
//
// An allow-list, not a block-list: inquiries, requests to book ("reserved"),
// declined/expired inquiries, cancellations and any status Guesty adds later all
// get silence. Inquiries are sales conversations the team answers by hand
// (17 Nov 2026 call). Applies in both test mode and live mode.
export const ANSWERABLE_STATUSES = ["confirmed", "checked_in", "checked_out"] as const;

export function isAnswerableReservation(status: string | undefined | null): boolean {
  if (!status) return false; // unknown status → fail closed, never answer
  return (ANSWERABLE_STATUSES as readonly string[]).includes(status.trim().toLowerCase());
}
