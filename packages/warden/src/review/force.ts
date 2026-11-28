import type { Ledger } from '../state/model.ts';

/** `/warden review` leaves a request in the ledger. A local accepted review that predates the request must not be reused for the unchanged head: the next run reviews again. A review accepted after the
 *  request (or no request at all) is left alone, so the command cannot cause a loop. */
export function mustReviewAgain(ledger: Pick<Ledger, 'forceReview'> | null | undefined, marker: { acceptedAt: string } | null | undefined): boolean {
  const f = ledger?.forceReview; if (!f || !marker) return false;
  const asked = Date.parse(f.at); const done = Date.parse(marker.acceptedAt);
  return Number.isFinite(asked) && Number.isFinite(done) && done < asked;
}
