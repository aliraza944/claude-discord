import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * `perm:<messageId>:allow|always|deny` — keyed by message id since permission
 * requests are only known by that id (pending.js's Map key) and the id
 * itself is only available after the message is first posted, so callers
 * build this row in a follow-up `message.edit()`, not the initial send.
 */
export function permCustomIdFor(messageId) {
  return (action) => `perm:${messageId}:${action}`;
}

/**
 * `attach:<sessionId>:accept|discard` — keyed by session id directly, since
 * (unlike a permission request) the session id is already known before the
 * approval message is ever posted, so no extra messageId->sessionId lookup
 * table is needed the way reactions.js used to require.
 */
export function attachCustomIdFor(sessionId) {
  return (action) => `attach:${sessionId}:${action}`;
}

/**
 * Builds the two-button Allow/Deny (or Accept/Discard) row for a decision
 * message. Pass `disabled: true` to get the same row disabled — used to
 * redraw the message in place once a decision is recorded.
 */
export function buildDecisionRow({ customIdFor, allowAction = 'allow', denyAction = 'deny', allowLabel, denyLabel, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customIdFor(allowAction)).setLabel(allowLabel).setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customIdFor(denyAction)).setLabel(denyLabel).setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

/**
 * The three-button Allow / Always Allow / Deny row for a permission-request
 * message — the "Always Allow" middle button mirrors Claude Code CLI's "don't
 * ask again this session" prompt option (see sessionAllowlist.js). Only used
 * for tool permission requests; the attach accept/discard row has no
 * equivalent and stays on the plain two-button `buildDecisionRow`.
 */
export function buildPermissionDecisionRow({ customIdFor, disabled = false }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customIdFor('allow')).setLabel('Allow').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customIdFor('always')).setLabel('Always Allow').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customIdFor('deny')).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}
