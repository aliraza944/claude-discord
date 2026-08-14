# Live Feed tool-call lines are permanent Tool-Call Summaries, feed-only

The Live Feed originally posted each tool call's full formatted detail (diff, file content, or JSON input) as its own message, which was noisy enough that a collapsed view was requested. The obvious shape for "collapsed" is collapsed-with-expand — a summary line plus some way to reveal the detail behind it, mirroring how Claude Code's own CLI hides tool detail behind a keypress. We deliberately built only the summary half: Tool-Call Summaries in the Live Feed have no reveal mechanism, are not user-togglable, and once posted cannot show more than the one line. This was a direct choice, not an oversight — the user confirmed twice, unprompted, that a reveal mechanism has no value to them ("I never use it").

Two related boundary decisions from the same session:

- **Feed-only.** Permission Requests keep their pre-existing full-detail rendering unchanged. Collapsing those too would have removed the information needed to make an informed Allow/Deny call, which is a safety-relevant regression, not a noise-reduction win.
- **Successful tool results produce no Live Feed message at all** (only `is_error` results do, as a single capped line). The prior behavior posted a message for every result regardless of outcome.

A future engineer who notices the Live Feed's collapsed lines and reaches for "let's add a button to expand it" should know that was considered and explicitly rejected, not simply never built.
