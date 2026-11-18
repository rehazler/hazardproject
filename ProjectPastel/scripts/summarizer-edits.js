// ─────────────────────────────────────────────────────────────────────────────
// summarizer-edits.js — applies Claude's line edits to a text (summary draft or
// campaign reference doc). Loaded before summarizer.js; also run by
// workers/summarizer/test.mjs.
//
// Line numbers are 1-based and always refer to the ORIGINAL text Claude saw,
// so edits can be accepted or skipped in any combination.
//   { op: 'replace',      line, end_line, text }  lines line..end_line -> text
//   { op: 'delete',       line, end_line }        remove lines line..end_line
//   { op: 'append',       line, text }            add text to the end of a line
//   { op: 'insert_after', line, text }            new line(s) after a line (0 = top)
// `text` may contain newlines.
// ─────────────────────────────────────────────────────────────────────────────

const SummarizerEdits = (() => {

    // Line-numbered copy of a text, as sent to Claude ("12| text").
    function number(text) {
        return text.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
    }

    // Returns { text, conflicts: [index, ...] }. An edit is a conflict (and is
    // skipped) if its line numbers are out of range or it touches lines that an
    // earlier accepted edit already replaced or deleted.
    function apply(text, edits) {
        const lines = text === '' ? [] : text.split('\n');
        const n = lines.length;
        const owner   = new Array(n + 1).fill(-1);  // line -> index of replace/delete edit
        const start   = new Map();                  // first line -> replacement text
        const appends = new Map();                  // line -> [text]
        const inserts = new Map();                  // line -> [text]
        const conflicts = [];

        edits.forEach((e, idx) => {
            const a = e.line, b = Math.max(e.end_line || e.line, e.line);
            const inRange = x => Number.isInteger(x) && x >= 1 && x <= n;

            if (e.op === 'replace' || e.op === 'delete') {
                if (!inRange(a) || !inRange(b)) return conflicts.push(idx);
                for (let i = a; i <= b; i++) if (owner[i] !== -1 || appends.has(i)) return conflicts.push(idx);
                for (let i = a; i <= b; i++) owner[i] = idx;
                if (e.op === 'replace') start.set(a, e.text ?? '');
            } else if (e.op === 'append') {
                if (!inRange(a) || owner[a] !== -1) return conflicts.push(idx);
                appends.set(a, [...(appends.get(a) || []), e.text ?? '']);
            } else if (e.op === 'insert_after') {
                if (!(a === 0 || inRange(a))) return conflicts.push(idx);
                inserts.set(a, [...(inserts.get(a) || []), e.text ?? '']);
            } else {
                conflicts.push(idx);
            }
        });

        const out = [...(inserts.get(0) || [])];
        for (let i = 1; i <= n; i++) {
            if (owner[i] === -1) out.push(lines[i - 1] + (appends.get(i) || []).map(t => (/^\s/.test(t) ? '' : ' ') + t).join(''));
            else if (start.has(i)) out.push(start.get(i));
            out.push(...(inserts.get(i) || []));
        }
        return { text: out.join('\n'), conflicts };
    }

    return { number, apply };
})();

if (typeof module !== 'undefined') module.exports = SummarizerEdits;
