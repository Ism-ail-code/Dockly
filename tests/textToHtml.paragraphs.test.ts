import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textToHtml } from '../src/renderer/lib/clipboardText';

describe('textToHtml — paragraphs and line breaks', () => {
  it('wraps a single line in a paragraph', () => {
    assert.equal(textToHtml('Hello world'), '<p>Hello world</p>');
  });

  it('joins consecutive lines with <br/> inside one paragraph', () => {
    assert.equal(textToHtml('line one\nline two'), '<p>line one<br/>line two</p>');
  });

  it('splits paragraphs on blank lines', () => {
    assert.equal(textToHtml('first\n\nsecond'), '<p>first</p><p>second</p>');
  });

  it('collapses multiple blank lines into a single paragraph break', () => {
    assert.equal(textToHtml('a\n\n\nb'), '<p>a</p><p>b</p>');
  });

  it('trims surrounding whitespace from each line', () => {
    assert.equal(textToHtml('  padded  '), '<p>padded</p>');
  });

  it('normalizes CRLF and lone-CR line endings', () => {
    assert.equal(textToHtml('a\r\nb'), '<p>a<br/>b</p>');
    assert.equal(textToHtml('a\rb'), '<p>a<br/>b</p>');
  });

  it('treats whitespace-only lines as paragraph separators', () => {
    assert.equal(textToHtml('a\n   \nb'), '<p>a</p><p>b</p>');
  });
});
