/**
 * Pure state model for the Discord-side AskUserQuestion form. No I/O — the
 * message-rendering/interaction-handling code in askQuestionForm.js is the
 * only thing that touches Discord or tmux.
 *
 * `answers` is an array, one slot per question:
 *   null                              — unanswered
 *   { type: 'options', indexes: [i] } — single-select pick, or one-or-more
 *                                       multi-select picks
 *   { type: 'other', text }           — free-text "Other" answer
 */

export function initState(questions) {
  return {
    questions,
    answers: questions.map(() => null),
    otherModalFor: null, // ephemeral UI-only state, not a real "answer"
    submitted: false,
  };
}

export function isAnswered(state, qIndex) {
  return state.answers[qIndex] != null;
}

export function isComplete(state) {
  return state.answers.every((a) => a != null);
}

export function answeredCount(state) {
  return state.answers.filter((a) => a != null).length;
}

/**
 * Picking an option in a single-select question replaces the answer.
 * Picking one in a multi-select question toggles it — mirrors the real
 * terminal prompt's own number-key semantics (ticket 05), so the Discord
 * side and the keystroke mapping agree on what "picking option N" means.
 */
export function pickOption(state, qIndex, optIndex) {
  const q = state.questions[qIndex];
  const current = state.answers[qIndex];
  const answers = state.answers.slice();

  if (!q.multiSelect) {
    answers[qIndex] = { type: 'options', indexes: [optIndex] };
  } else {
    const existing = current?.type === 'options' ? current.indexes : [];
    const indexes = existing.includes(optIndex)
      ? existing.filter((i) => i !== optIndex)
      : [...existing, optIndex].sort((a, b) => a - b);
    answers[qIndex] = indexes.length > 0 ? { type: 'options', indexes } : null;
  }

  return { ...state, answers };
}

export function openOtherModal(state, qIndex) {
  return { ...state, otherModalFor: qIndex };
}

export function cancelOtherModal(state) {
  return { ...state, otherModalFor: null };
}

/**
 * Mirrors a Discord modal text input with `required: true` — submitting
 * blank text is not a legal action, unlike the raw terminal path (ticket 05
 * found a bare Enter on the "Type something." row silently declines the
 * whole question). The Discord form structurally can't hit that hazard.
 */
export function submitOtherModal(state, qIndex, text) {
  const trimmed = text.trim();
  if (trimmed === '') return state;
  const answers = state.answers.slice();
  answers[qIndex] = { type: 'other', text: trimmed };
  return { ...state, answers, otherModalFor: null };
}

export function submit(state) {
  if (!isComplete(state)) return state;
  return { ...state, submitted: true };
}
