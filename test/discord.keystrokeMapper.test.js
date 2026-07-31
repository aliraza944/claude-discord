import { describe, it, expect } from 'vitest';
import { buildKeystrokePlan, planToTmuxArgs, parseReviewScreen, verifyReview } from '../src/discord/keystrokeMapper.js';

const SINGLE_SELECT_Q = { question: 'What is your favorite color?', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }, { label: 'Green' }] };
const MULTI_SELECT_Q = { question: 'Which fruits do you like?', multiSelect: true, options: [{ label: 'Banana' }, { label: 'Apple' }, { label: 'Cherry' }] };
const OTHER_Q = { question: 'What is your favorite pet?', multiSelect: false, options: [{ label: 'Dog' }, { label: 'Cat' }] };

describe('discord/keystrokeMapper.js buildKeystrokePlan', () => {
  it('single-select answer maps to one number-key press', () => {
    const plan = buildKeystrokePlan([SINGLE_SELECT_Q], [{ type: 'options', indexes: [2] }]);
    expect(plan).toEqual([{ number: 3 }, { key: 'Enter' }]);
  });

  it('multi-select answer maps to one number-key press per checked option plus a trailing Tab', () => {
    const plan = buildKeystrokePlan([MULTI_SELECT_Q], [{ type: 'options', indexes: [0, 2] }]);
    expect(plan).toEqual([{ number: 1 }, { number: 3 }, { key: 'Tab' }, { key: 'Enter' }]);
  });

  it('"Other" answer maps to Down x(N options) to reach "Type something.", the literal text, then Enter', () => {
    const plan = buildKeystrokePlan([OTHER_Q], [{ type: 'other', text: 'Hamster' }]);
    expect(plan).toEqual([{ key: 'Down' }, { key: 'Down' }, { text: 'Hamster' }, { key: 'Enter' }, { key: 'Enter' }]);
  });

  it('a mixed multi-question plan concatenates each question in order, with one final Review-screen Enter', () => {
    const plan = buildKeystrokePlan(
      [SINGLE_SELECT_Q, MULTI_SELECT_Q],
      [{ type: 'options', indexes: [0] }, { type: 'options', indexes: [1] }]
    );
    expect(plan).toEqual([{ number: 1 }, { number: 2 }, { key: 'Tab' }, { key: 'Enter' }]);
  });

  it('throws if any question is unanswered', () => {
    expect(() => buildKeystrokePlan([SINGLE_SELECT_Q], [null])).toThrow(/unanswered/);
  });
});

describe('discord/keystrokeMapper.js planToTmuxArgs', () => {
  it('converts each op to the literal tmux send-keys argv', () => {
    const plan = [{ number: 3 }, { key: 'Tab' }, { text: 'Hamster' }, { key: 'Enter' }];
    expect(planToTmuxArgs(plan, 'sess:0.0')).toEqual([
      ['send-keys', '-t', 'sess:0.0', '-l', '--', '3'],
      ['send-keys', '-t', 'sess:0.0', 'Tab'],
      ['send-keys', '-t', 'sess:0.0', '-l', '--', 'Hamster'],
      ['send-keys', '-t', 'sess:0.0', 'Enter'],
    ]);
  });
});

describe('discord/keystrokeMapper.js parseReviewScreen', () => {
  it('parses question/answer pairs from the ● / → format', () => {
    const paneText = [
      'Review your answers',
      '',
      ' ● Which fruits do you like?',
      '   → Banana, Apple',
      ' ● What size?',
      '   → Large',
      '',
      'Ready to submit your answers?',
      '',
      '❯ 1. Submit answers',
      '  2. Cancel',
    ].join('\n');

    expect(parseReviewScreen(paneText)).toEqual([
      { question: 'Which fruits do you like?', answer: 'Banana, Apple' },
      { question: 'What size?', answer: 'Large' },
    ]);
  });

  it('returns an empty array for unparseable/garbage text', () => {
    expect(parseReviewScreen('nothing here matches the format\njust noise')).toEqual([]);
  });
});

describe('discord/keystrokeMapper.js verifyReview', () => {
  it('reports ok:true when every question matches its expected rendered answer', () => {
    const reviewEntries = [
      { question: SINGLE_SELECT_Q.question, answer: 'Green' },
      { question: MULTI_SELECT_Q.question, answer: 'Banana, Cherry' },
    ];
    const answers = [{ type: 'options', indexes: [2] }, { type: 'options', indexes: [0, 2] }];

    const result = verifyReview(reviewEntries, [SINGLE_SELECT_Q, MULTI_SELECT_Q], answers);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it('reports a mismatch when the review screen text differs from the expected answer', () => {
    const reviewEntries = [{ question: SINGLE_SELECT_Q.question, answer: 'Blue' }];
    const answers = [{ type: 'options', indexes: [2] }];

    const result = verifyReview(reviewEntries, [SINGLE_SELECT_Q], answers);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { question: SINGLE_SELECT_Q.question, expected: 'Green', actual: 'Blue', reason: 'answer text differs' },
    ]);
  });

  it('reports a mismatch when a question is missing from the review screen entirely', () => {
    const result = verifyReview([], [SINGLE_SELECT_Q], [{ type: 'options', indexes: [0] }]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { question: SINGLE_SELECT_Q.question, expected: 'Red', actual: null, reason: 'missing from review screen' },
    ]);
  });

  it('renders an "other" answer as its literal text for comparison', () => {
    const reviewEntries = [{ question: OTHER_Q.question, answer: 'Hamster' }];
    const result = verifyReview(reviewEntries, [OTHER_Q], [{ type: 'other', text: 'Hamster' }]);
    expect(result.ok).toBe(true);
  });
});
