import { describe, it, expect } from 'vitest';
import { truncate, formatToolInput, summarizeToolCall, MAX_PREVIEW_LENGTH } from '../src/daemon/toolCallFormat.js';

describe('daemon/toolCallFormat.js', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello')).toBe('hello');
  });

  it('truncates text past the max length with an explicit marker', () => {
    const text = 'x'.repeat(MAX_PREVIEW_LENGTH + 500);
    const result = truncate(text);
    expect(result).toContain('…truncated');
    expect(result.length).toBeLessThan(text.length);
  });

  it('renders Bash with the command in a code block, plus description if present', () => {
    const out = formatToolInput('Bash', { command: 'echo hi', description: 'say hi' });
    expect(out).toContain('say hi');
    expect(out).toContain('```\necho hi\n```');
  });

  it('renders Edit as a file path plus a diff-style preview', () => {
    const out = formatToolInput('Edit', { file_path: '/a.js', old_string: 'foo', new_string: 'bar' });
    expect(out).toContain('/a.js');
    expect(out).toContain('- foo');
    expect(out).toContain('+ bar');
  });

  it('renders MultiEdit as a file path plus a diff-style preview per edit', () => {
    const out = formatToolInput('MultiEdit', {
      file_path: '/a.js',
      edits: [
        { old_string: 'foo', new_string: 'bar' },
        { old_string: 'baz', new_string: 'qux' },
      ],
    });
    expect(out).toContain('- foo');
    expect(out).toContain('+ bar');
    expect(out).toContain('- baz');
    expect(out).toContain('+ qux');
  });

  it('renders Write as a file path plus a content preview', () => {
    const out = formatToolInput('Write', { file_path: '/notes.txt', content: 'hello world' });
    expect(out).toContain('/notes.txt');
    expect(out).toContain('hello world');
  });

  it('falls back to pretty-printed JSON for any other tool', () => {
    const out = formatToolInput('WebFetch', { url: 'https://example.com' });
    expect(out).toContain('"url": "https://example.com"');
  });

  it('falls back to generic JSON rendering for a missing/unknown tool name', () => {
    const out = formatToolInput(undefined, { foo: 'bar' });
    expect(out).toContain('"foo": "bar"');
  });
});

describe('daemon/toolCallFormat.js summarizeToolCall', () => {
  it('renders Bash as tool name plus the command', () => {
    expect(summarizeToolCall('Bash', { command: 'npm test' })).toBe('Bash(npm test)');
  });

  it('renders Edit/MultiEdit/Write as tool name plus the file path', () => {
    expect(summarizeToolCall('Edit', { file_path: 'src/foo.js' })).toBe('Edit(src/foo.js)');
    expect(summarizeToolCall('MultiEdit', { file_path: 'src/foo.js' })).toBe('MultiEdit(src/foo.js)');
    expect(summarizeToolCall('Write', { file_path: 'src/foo.js' })).toBe('Write(src/foo.js)');
  });

  it('falls back to the first string-valued field for tools without a dedicated extractor', () => {
    expect(summarizeToolCall('WebFetch', { url: 'https://example.com' })).toBe('WebFetch(https://example.com)');
  });

  it('falls back to the bare tool name when no string-valued field is found', () => {
    expect(summarizeToolCall('SomeTool', { count: 3, nested: { a: 1 } })).toBe('SomeTool');
  });

  it('truncates a long key argument to 100 chars with an ellipsis', () => {
    const command = 'x'.repeat(200);
    expect(summarizeToolCall('Bash', { command })).toBe(`Bash(${'x'.repeat(100)}…)`);
  });

  it('collapses whitespace/newlines in the key argument onto a single line', () => {
    expect(summarizeToolCall('Bash', { command: 'line one\nline two' })).toBe('Bash(line one line two)');
  });
});
