/**
 * Basic guardrail layer. In production, pair this with a dedicated
 * moderation model/classifier call — this keyword layer is a fast,
 * cheap first line of defense, not the only line.
 */

const SELF_HARM_PATTERNS = [
  /\bkill myself\b/i,
  /\bsuicide\b/i,
  /\bend my life\b/i,
  /\bwant to die\b/i,
  /\bhurt myself\b/i,
];

const BLOCK_PATTERNS = [
  /\bhow to make (a )?bomb\b/i,
  /\bmake .*(virus|malware|ransomware)\b/i,
];

export type ModerationResult =
  | { action: "allow" }
  | { action: "crisis" }
  | { action: "block"; reason: string };

export function moderateInput(text: string): ModerationResult {
  if (SELF_HARM_PATTERNS.some((p) => p.test(text))) {
    return { action: "crisis" };
  }
  if (BLOCK_PATTERNS.some((p) => p.test(text))) {
    return { action: "block", reason: "unsafe_request" };
  }
  return { action: "allow" };
}

export const CRISIS_RESPONSE_EN = `I'm really sorry you're feeling this way. You're not alone, and it's worth talking to someone who can help right now.

- If you're in immediate danger, please contact your local emergency number.
- You can also reach out to a crisis line in your country for confidential support.

I'm here to keep talking with you too, if that helps.`;

export const CRISIS_RESPONSE_HA = `Na yi matukar bakin ciki da jin haka. Ba ku kadai ba, kuma ya kamata ku yi magana da wanda zai iya taimaka muku yanzu.

- Idan kuna cikin hatsari na gaggawa, don Allah ku tuntubi lambar gaggawa ta yankinku.
- Za ku iya kuma tuntubar layin taimako na rikici a ƙasarku don tallafi na sirri.

Ina nan don in ci gaba da yin magana da ku idan hakan zai taimaka.`;
