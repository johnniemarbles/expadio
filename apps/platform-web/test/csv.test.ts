import assert from 'node:assert/strict';
import test from 'node:test';
import { csvField, toCsv } from '../lib/csv.ts';

test('csvField quotes only when needed and doubles embedded quotes', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
  assert.equal(csvField(42), '42');
});

test('toCsv writes a header then rows, CRLF-separated with a trailing CRLF', () => {
  const csv = toCsv(['a', 'b'], [['1', '2'], ['x,y', 'z']]);
  assert.equal(csv, 'a,b\r\n1,2\r\n"x,y",z\r\n');
});

test('toCsv on no rows still emits the header', () => {
  assert.equal(toCsv(['a', 'b'], []), 'a,b\r\n');
});
