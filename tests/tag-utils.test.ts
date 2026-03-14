import { addTag, normalizeTag, removeTag } from '../src/tasknotes';

describe('Tag utils', () => {
  it('normalizes tags', () => {
    expect(normalizeTag('  foo  bar  ')).toBe('foo bar');
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag('a'.repeat(40))).toBe('a'.repeat(32));
  });

  it('adds tags case-insensitive', () => {
    expect(addTag(['foo'], 'FOO')).toEqual(['foo']);
    expect(addTag([], 'bar')).toEqual(['bar']);
  });

  it('removes tags case-insensitive', () => {
    expect(removeTag(['foo', 'bar'], 'FOO')).toEqual(['bar']);
    expect(removeTag(['foo', 'bar'], 'bar')).toEqual(['foo']);
  });
});
