/**
 * Pure mapping from resolved Discord-side answers to the `tmux send-keys`
 * sequence Claude Code's own AskUserQuestion terminal prompt expects
 * (behavior verified empirically against CLI v2.1.220 — see
 * .scratch/discord-interactive-components/issues/05-research-findings.md;
 * re-verify against whatever `claude` version the daemon actually drives
 * before relying on this in production), plus a parser for that prompt's own
 * Review screen so the daemon can verify the plan actually landed before
 * sending the final, irreversible submit keystroke. No I/O — the submit
 * handler in askQuestionForm.js is the only thing that calls tmux for real.
 *
 * Op shapes: { key: 'Down' | 'Tab' | 'Enter' } | { number: N } | { text: S }
 */

/**
 * Assumes each question tab starts with row 1 highlighted — true both on
 * first load and after auto-advance/Tab per ticket 05's findings ("Default
 * highlight is always row 1", preserved even across Left/Right between
 * already-answered tabs).
 *
 * Deliberately unsupported: combining a multi-select question's checked
 * options with an "Other" pick on the same question. Ticket 05 didn't
 * establish whether typing on the "Type something." row toggles-in-place
 * (multi-select semantics) or submits-and-advances (single-select/Other
 * semantics) when the two are mixed — so the Discord form (formState.js)
 * only ever produces one or the other per question, never both, sidestepping
 * the ambiguity rather than resolving it here.
 */
export function buildKeystrokePlan(questions, answers) {
  const ops = [];

  questions.forEach((q, qIndex) => {
    const answer = answers[qIndex];
    if (answer == null) throw new Error(`Question ${qIndex} is unanswered`);

    if (answer.type === 'other') {
      const otherRow = q.options.length + 1; // "N+1. Type something."
      for (let row = 1; row < otherRow; row++) ops.push({ key: 'Down' });
      ops.push({ text: answer.text });
      ops.push({ key: 'Enter' }); // submits the free text and auto-advances
    } else if (!q.multiSelect) {
      ops.push({ number: answer.indexes[0] + 1 }); // selects + auto-advances
    } else {
      for (const idx of answer.indexes) ops.push({ number: idx + 1 }); // toggles, no advance
      ops.push({ key: 'Tab' }); // multi-select needs an explicit advance
    }
  });

  ops.push({ key: 'Enter' }); // Review screen: "1. Submit answers" is pre-highlighted
  return ops;
}

/** Converts a plan into the literal `tmux send-keys` argv calls to run in order. */
export function planToTmuxArgs(plan, target) {
  return plan.map((op) => {
    if ('text' in op) return ['send-keys', '-t', target, '-l', '--', op.text];
    if ('number' in op) return ['send-keys', '-t', target, '-l', '--', String(op.number)];
    return ['send-keys', '-t', target, op.key];
  });
}

/**
 * The Review screen (ticket 05) renders every question's resolved answer as
 * plain text before the final commit keystroke — parsing it is a genuine
 * verify-before-commit checkpoint, not blind fire-and-hope. Format observed:
 *
 *   ● <question text>
 *     → <answer text>
 */
export function parseReviewScreen(paneText) {
  const lines = paneText.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const q = lines[i].match(/^\s*[●○]\s*(.+?)\s*$/);
    if (!q) continue;
    const a = lines[i + 1]?.match(/^\s*→\s*(.+?)\s*$/);
    entries.push({ question: q[1], answer: a ? a[1] : null });
  }
  return entries;
}

/** Renders the expected answer text for one question, in the Review screen's own format. */
function expectedAnswerText(q, answer) {
  if (answer.type === 'other') return answer.text;
  return answer.indexes.map((i) => q.options[i].label).join(', ');
}

/**
 * Compares the parsed Review screen against what the plan was supposed to
 * produce. The daemon should only send the final "Submit answers" keystroke
 * when this reports `ok: true` — otherwise abort and surface an error
 * (mis-rendered prompt, a keystroke that didn't land, a CLI version whose
 * prompt behavior drifted from ticket 05's) rather than blindly finalizing.
 */
export function verifyReview(reviewEntries, questions, answers) {
  const mismatches = [];
  questions.forEach((q, qIndex) => {
    const expected = expectedAnswerText(q, answers[qIndex]);
    const entry = reviewEntries.find((e) => e.question === q.question);
    if (!entry) {
      mismatches.push({ question: q.question, expected, actual: null, reason: 'missing from review screen' });
    } else if (entry.answer !== expected) {
      mismatches.push({ question: q.question, expected, actual: entry.answer, reason: 'answer text differs' });
    }
  });
  return { ok: mismatches.length === 0, mismatches };
}
