import type { Origin } from './protocol.ts';

/** ADR 0003: contributor-facing text comes from the configured App, says whether it is deterministic housekeeping or AI-assisted (drafted by a model under the maintainers' rules), and never poses as a
 *  personal message from a maintainer. The configured style picks the wording; the configured signature, when there is one, closes the message. Applied when a comment is posted, so the ledger keeps the plain text. */
export interface Voice { style: 'neutral' | 'friendly' | 'terse'; signature: string }
const HEAD: Record<Voice['style'], { auto: string; ai: string }> = {
  neutral: { auto: 'Automated notice from Warden.', ai: "AI-assisted note from Warden, drafted by a model under the maintainers' rules. A maintainer decides." },
  friendly: { auto: 'Hi, this is an automated notice from Warden.', ai: "Hi, this is an AI-assisted note from Warden (drafted by a model under the maintainers' rules). A maintainer decides." },
  terse: { auto: '[Warden: automated]', ai: '[Warden: AI-assisted]' },
};
export function voiced(text: string, origin: Origin, v: Voice | undefined): string {
  const style = v?.style ?? 'neutral'; const head = origin === 'ai' ? HEAD[style].ai : HEAD[style].auto;
  return `_${head}_\n\n${text}${v?.signature?.trim() ? `\n\n${v.signature.trim()}` : ''}`;
}
