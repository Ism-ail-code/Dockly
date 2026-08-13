import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textToHtml } from '../src/renderer/lib/clipboardText';

describe('textToHtml — bullet lists', () => {
  it('renders hyphen bullets as a single <ul>', () => {
    assert.equal(textToHtml('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  });

  it('accepts asterisk bullets', () => {
    assert.equal(textToHtml('* one\n* two'), '<ul><li>one</li><li>two</li></ul>');
  });

  it('accepts unicode bullet markers', () => {
    assert.equal(textToHtml('• one\n‣ two'), '<ul><li>one</li><li>two</li></ul>');
  });

  it('accepts indented bullet lines', () => {
    assert.equal(textToHtml('  - indented'), '<ul><li>indented</li></ul>');
  });

  it('trims list item text', () => {
    assert.equal(textToHtml('-  spaced item  '), '<ul><li>spaced item</li></ul>');
  });
});

describe('textToHtml — numbered lists', () => {
  it('renders "1." style lists as an <ol>', () => {
    assert.equal(textToHtml('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
  });

  it('renders "1)" style lists as an <ol>', () => {
    assert.equal(textToHtml('1) first\n2) second'), '<ol><li>first</li><li>second</li></ol>');
  });

  it('handles up to four-digit numbers', () => {
    assert.equal(textToHtml('10. ten\n100. hundred'), '<ol><li>ten</li><li>hundred</li></ol>');
  });
});

describe('textToHtml — list mixing and termination', () => {
  it('switches from a bullet list to a numbered list across a blank line', () => {
    assert.equal(
      textToHtml('- a\n- b\n\n1. x\n2. y'),
      '<ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>',
    );
  });

  it('closes a list when a plain paragraph follows', () => {
    assert.equal(textToHtml('- item\nplain text'), '<ul><li>item</li></ul><p>plain text</p>');
  });

  it('splits a list into two lists across a blank line', () => {
    assert.equal(textToHtml('- a\n\n- b'), '<ul><li>a</li></ul><ul><li>b</li></ul>');
  });

  it('interleaves paragraphs and lists in sequence', () => {
    assert.equal(
      textToHtml('intro\n\n- one\n- two\n\noutro'),
      '<p>intro</p><ul><li>one</li><li>two</li></ul><p>outro</p>',
    );
  });
});
