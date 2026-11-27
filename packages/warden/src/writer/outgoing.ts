import { redact } from '../util.ts';

/** PRD section 3 [R]: every outgoing comment, review and card is validated before posting: a length cap, no secrets or credential-like strings, no @mentions or team pings except
 *  configured maintainers, no external images, labels only from the task's allowlist. A failed check blocks that effect visibly (the writer rejects the operation with the reason);
 *  nothing is trimmed, redacted or rewritten and then posted. */
export interface OutgoingRules {
  /** GitHub's own limit for a comment body is 65,536 characters; the default stays under it. */
  maxChars: number;
  /** Logins that may be @mentioned (the configured maintainers). Compared case-insensitively. */
  mentionable: ReadonlySet<string>;
  /** Label names Warden may add or remove. */
  labels: ReadonlySet<string>;
}
export const DEFAULT_MAX_OUTGOING_CHARS = 65_000;

export class OutgoingBlocked extends Error {}

const MENTION = /(^|[^A-Za-z0-9_`/.])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(\/[A-Za-z0-9_.-]+)?/g;
const EXTERNAL_IMAGE_MD = /!\[[^\]]*\]\(\s*(?:https?:)?\/\//i;
const EXTERNAL_IMAGE_HTML = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i;

/** Returns the reason a text must not be posted, or null when it may be. */
export function checkOutgoingText(text: string, r: OutgoingRules): string | null {
  if (text.length > r.maxChars) return `too long: ${text.length} characters, limit ${r.maxChars}`;
  if (redact(text) !== text) return 'contains a secret or credential-like string';
  for (const m of text.matchAll(MENTION)) {
    const login = m[2]; const team = m[3];
    if (team) return `team ping @${login}${team}`;
    if (!r.mentionable.has(login.toLowerCase())) return `mentions @${login}, who is not a configured maintainer`;
  }
  if (EXTERNAL_IMAGE_MD.test(text) || EXTERNAL_IMAGE_HTML.test(text)) return 'embeds an external image';
  return null;
}

/** Returns the reason a label change must not be applied, or null when every label is allowed. */
export function checkOutgoingLabels(names: readonly string[], r: OutgoingRules): string | null {
  const bad = names.filter((n) => !r.labels.has(n));
  return bad.length ? `label(s) outside the allowlist: ${bad.join(', ')}` : null;
}
