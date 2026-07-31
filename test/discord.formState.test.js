import { describe, it, expect } from 'vitest';
import {
  initState,
  isAnswered,
  isComplete,
  answeredCount,
  pickOption,
  openOtherModal,
  cancelOtherModal,
  submitOtherModal,
  submit,
} from '../src/discord/formState.js';

const SINGLE_SELECT = [{ question: 'Pick one', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }];
const MULTI_SELECT = [{ question: 'Pick many', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }];
const TWO_QUESTIONS = [...SINGLE_SELECT, ...MULTI_SELECT];

describe('discord/formState.js', () => {
  it('initState starts every question unanswered, not submitted', () => {
    const state = initState(TWO_QUESTIONS);
    expect(state.answers).toEqual([null, null]);
    expect(state.submitted).toBe(false);
    expect(state.otherModalFor).toBeNull();
    expect(isComplete(state)).toBe(false);
    expect(answeredCount(state)).toBe(0);
  });

  it('picking an option on a single-select question replaces the answer', () => {
    let state = initState(SINGLE_SELECT);
    state = pickOption(state, 0, 0);
    expect(state.answers[0]).toEqual({ type: 'options', indexes: [0] });

    state = pickOption(state, 0, 1);
    expect(state.answers[0]).toEqual({ type: 'options', indexes: [1] });
    expect(isAnswered(state, 0)).toBe(true);
  });

  it('picking an option on a multi-select question toggles it in place', () => {
    let state = initState(MULTI_SELECT);
    state = pickOption(state, 0, 0);
    state = pickOption(state, 0, 2);
    expect(state.answers[0]).toEqual({ type: 'options', indexes: [0, 2] });

    // Pick again to un-pick.
    state = pickOption(state, 0, 0);
    expect(state.answers[0]).toEqual({ type: 'options', indexes: [2] });
  });

  it('un-picking every option on a multi-select question resets the answer to unanswered', () => {
    let state = initState(MULTI_SELECT);
    state = pickOption(state, 0, 1);
    state = pickOption(state, 0, 1);
    expect(state.answers[0]).toBeNull();
    expect(isAnswered(state, 0)).toBe(false);
  });

  it('openOtherModal/cancelOtherModal track ephemeral UI state without touching answers', () => {
    let state = initState(SINGLE_SELECT);
    state = openOtherModal(state, 0);
    expect(state.otherModalFor).toBe(0);
    expect(state.answers[0]).toBeNull();

    state = cancelOtherModal(state);
    expect(state.otherModalFor).toBeNull();
    expect(state.answers[0]).toBeNull();
  });

  it('submitOtherModal records a trimmed free-text answer and closes the modal', () => {
    let state = initState(SINGLE_SELECT);
    state = openOtherModal(state, 0);
    state = submitOtherModal(state, 0, '  a custom answer  ');
    expect(state.answers[0]).toEqual({ type: 'other', text: 'a custom answer' });
    expect(state.otherModalFor).toBeNull();
  });

  it('submitOtherModal rejects blank text — structurally can never record an empty "Other" answer', () => {
    let state = initState(SINGLE_SELECT);
    state = openOtherModal(state, 0);
    const next = submitOtherModal(state, 0, '   ');
    expect(next.answers[0]).toBeNull();
    expect(next.otherModalFor).toBe(0);
  });

  it('an "Other" answer replaces any previously-picked options for that question, and vice versa', () => {
    let state = initState(MULTI_SELECT);
    state = pickOption(state, 0, 0);
    state = submitOtherModal(openOtherModal(state, 0), 0, 'custom');
    expect(state.answers[0]).toEqual({ type: 'other', text: 'custom' });

    state = pickOption(state, 0, 1);
    expect(state.answers[0]).toEqual({ type: 'options', indexes: [1] });
  });

  it('submit only takes effect once every question is answered', () => {
    let state = initState(TWO_QUESTIONS);
    state = pickOption(state, 0, 0);
    let submitted = submit(state);
    expect(submitted.submitted).toBe(false);

    state = pickOption(state, 1, 1);
    submitted = submit(state);
    expect(submitted.submitted).toBe(true);
  });

  it('answeredCount reflects partial progress', () => {
    let state = initState(TWO_QUESTIONS);
    state = pickOption(state, 0, 0);
    expect(answeredCount(state)).toBe(1);
  });
});
