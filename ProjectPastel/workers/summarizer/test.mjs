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

// ── Transcript cleaner (scripts/transcript-clean.js) ────────────────────────
const { clean: c } = createRequire(import.meta.url)('../../scripts/transcript-clean.js');
const clean = t => c(t).text;
assert.equal(clean('0:00\n0 seconds\n[music]\n0:05\n5 seconds\n[music]'), '[00:00:00] [music]\n[00:00:05] [music]');
assert.equal(clean('10:52\n10 minutes, 52 seconds\nback. Hey\n17:00\n17 minutes\nthem are'), '[00:10:52] back. Hey\n[00:17:00] them are');
assert.equal(clean('1:00:04\n1 hour, 4 seconds\nYeah.\n1:01:35\n1 hour, 1 minute, 35 seconds\nI I could'), '[01:00:04] Yeah.\n[01:01:35] I I could');
assert.equal(clean('1:02:001 hour, 2 minutes So, after swallowing'), '[01:02:00] So, after swallowing');
assert.equal(clean('17:0017 minutes them\n0:055 seconds hi'), '[00:17:00] them\n[00:00:05] hi');
assert.equal(clean('We met at 3:30 sharp'), 'We met at 3:30 sharp');   // no duration -> untouched
assert.equal(clean('1:05\nhello'), '[00:01:05]\nhello');            // bare stamp line
assert.equal(clean('1:02:00\n1 hour, 2 minutes 5 people came'), '[01:02:00] 5 people came');
assert.deepEqual(c('1:02:00\n1 hour, 2 minutes\nok\n0:10\n10 seconds\nbacktrack').flags.length, 1);   // goes backward
assert.equal(c('1:02:00\n1 hour, 3 minutes\nok').flags.length, 1);   // duration mismatch
assert.equal(c('0:05\n5 seconds\nfine').flags.length, 0);
const mid = c('so then 1:02:00 1 hour, 2 minutes he left');
assert.equal(mid.text, 'so then 1:02:00 1 hour, 2 minutes he left');   // mid-line: skipped + flagged
assert.equal(mid.flags.length, 1);
console.log('transcript-clean ok');
