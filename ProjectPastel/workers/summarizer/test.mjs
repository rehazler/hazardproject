import assert from 'node:assert/strict';
import { cycleBounds } from './billing.js';

const env = { BILLING_CYCLE_DAY: '14' };
let b = cycleBounds(env, new Date('2026-11-17T00:00:00Z'));
assert.equal(b.start.toISOString().slice(0, 10), '2026-11-14');
assert.equal(b.end.toISOString().slice(0, 10), '2026-12-14');
b = cycleBounds(env, new Date('2026-01-05T00:00:00Z'));        // before renewal day, crosses year
assert.equal(b.start.toISOString().slice(0, 10), '2025-12-14');
assert.equal(b.end.toISOString().slice(0, 10), '2026-01-14');
assert.equal(cycleBounds({ BILLING_CYCLE_DAY: '31' }, new Date('2026-02-20Z')).start.getUTCDate(), 28);
console.log('billing ok');

// ── Line edits (scripts/summarizer-edits.js) ────────────────────────────────
import { createRequire } from 'node:module';
const { apply, number } = createRequire(import.meta.url)('../../scripts/summarizer-edits.js');

const base = 'a\nb\nc\nd';
assert.equal(number('x\ny'), '1| x\n2| y');
assert.deepEqual(apply(base, []), { text: base, conflicts: [] });
// replace, delete range, append, insert at top and after a line
let r = apply(base, [
    { op: 'replace', line: 2, end_line: 2, text: 'B' },
    { op: 'delete', line: 3, end_line: 4 },
    { op: 'append', line: 1, text: 'more' },
    { op: 'insert_after', line: 0, text: 'top' },
    { op: 'insert_after', line: 2, text: 'new1\nnew2' },
]);
assert.equal(r.text, 'top\na more\nB\nnew1\nnew2');
assert.deepEqual(r.conflicts, []);
// overlapping edits and bad line numbers are skipped, not guessed
r = apply(base, [
    { op: 'replace', line: 2, end_line: 3, text: 'X' },
    { op: 'delete', line: 3, end_line: 3 },        // overlaps edit 0
    { op: 'append', line: 2, text: 'y' },          // line already replaced
    { op: 'replace', line: 9, end_line: 9, text: 'z' }, // out of range
    { op: 'explode', line: 1 },                    // unknown op
]);
assert.equal(r.text, 'a\nX\nd');
assert.deepEqual(r.conflicts, [1, 2, 3, 4]);
// empty doc: only insert_after 0 works (first reference doc for a campaign)
assert.equal(apply('', [{ op: 'insert_after', line: 0, text: 'The Party\n  Bob' }]).text, 'The Party\n  Bob');
console.log('edits ok');
