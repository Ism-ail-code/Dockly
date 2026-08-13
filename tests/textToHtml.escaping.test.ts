import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textToHtml } from '../src/renderer/lib/clipboardText';

describe('textToHtml — escaping and unicode', () => {
  it('escapes HTML special characters in paragraphs', () => {
    assert.equal(textToHtml('a & b < c > d'), '<p>a &amp; b &lt; c &gt; d</p>');
  });

  it('escapes HTML special characters in list items', () => {
    assert.equal(textToHtml('- <b>bold</b> & more'), '<ul><li>&lt;b&gt;bold&lt;/b&gt; &amp; more</li></ul>');
  });

  it('keeps unicode text intact', () => {
    assert.equal(textToHtml('étude — naïve ✓'), '<p>étude — naïve ✓</p>');
  });

  it('keeps unicode inside list items', () => {
    assert.equal(textToHtml('- café ☕'), '<ul><li>café ☕</li></ul>');
  });
});

describe('textToHtml — empty inputs', () => {
  it('returns null for an empty string', () => {
    assert.equal(textToHtml(''), null);
  });

  it('returns null for whitespace-only input', () => {
    assert.equal(textToHtml('   \n \t '), null);
  });

  it('returns null for newline-only input', () => {
    assert.equal(textToHtml('\n\n\n'), null);
  });

  it('strips leading and trailing blank lines', () => {
    assert.equal(textToHtml('\n- list\n'), '<ul><li>list</li></ul>');
  });
});
