# 04 — Permission approval via reactions

**What to build:** remote approve/deny of Claude Code permission prompts using ✅/❌ reactions in a session's Discord thread.

From the user's perspective: when a tool call needs permission, the local terminal does not show its own prompt; instead a message with ✅/❌ reactions appears in that session's thread. Tapping ✅ actually allows the tool call to proceed; tapping ❌ actually denies it. If the daemon is down, the hook falls back to the normal local prompt within about 1-2 seconds instead of hanging. A reaction in one session's thread never resolves another session's pending request.

**Blocked by:** 03 — session start, thread creation, and session identification

**Status:** ready-for-agent

- [ ] `src/daemon/pending.js` maintains an in-memory `Map<messageId, PendingPermissionRequest>`.
- [ ] `src/daemon/routes/permission-request.js` holds the HTTP response open while it posts a ✅/❌-reactable message to the session's thread, then awaits a resolving reaction (or the safety timeout / paused flag / unregistered session, any of which resolve as defer).
- [ ] `src/discord/reactions.js` handles `MessageReactionAdd`, resolving the matching pending request by message ID only — never affecting another session's pending request.
- [ ] `src/hooks/permissionRequestHook.js` implements the two-phase flow: a fast liveness probe against `/health` (~1.5s timeout) that, on failure, exits 0 printing nothing so Claude Code falls through to its normal local prompt; otherwise a no-client-timeout POST to `/hook/permission-request` that prints `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}` on resolution, or nothing on defer.
- [ ] Auto-allowed tool calls (ones the permission system wouldn't have prompted for) never produce a Discord message, since the hook only fires when a prompt is already required.
- [ ] With the daemon stopped, triggering a permission call falls back to the local prompt within roughly 1-2 seconds.
- [ ] With two sessions registered, a reaction on one session's permission message never allows/denies the other session's pending request.
