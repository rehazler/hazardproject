// transcript-clean.js — normalises YouTube copy/paste transcripts (optional, editor-triggered).
//   "1:02:00\n1 hour, 2 minutes\ntext"  and  "1:02:001 hour, 2 minutes text"
//   both become "[01:02:00] text", one stamp per line.
// clean(text) -> { text, converted, flags: [string] }. Flags mark spots worth a look.
// Loaded before summarizer.js; also run by workers/summarizer/test.mjs.

const TranscriptClean = (() => {
    // stamp = [H:]MM:SS ; spoken duration = "1 hour, 2 minutes, 5 seconds" (zero units omitted).
    // Fixed 2-digit seconds/minutes make the glued form ("1:02:001 hour") split correctly.
    // Units must be comma-joined, so "2 minutes 5 people" only consumes "2 minutes".
    const UNIT = '(\\d+) (hour|minute|second)s?';
    const WITH_DURATION = new RegExp(`(?<!\\d)(?:(\\d{1,2}):)?(\\d{1,2}):(\\d{2})[ \\t]*\\r?\\n?[ \\t]*(${UNIT}(?:, ${UNIT})*)[ \\t]*\\r?\\n?[ \\t]*`, 'g');
    const BARE_LINE = /^[ \t]*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[ \t]*$/gm;   // stamp alone, no duration line
    const pad = n => String(n).padStart(2, '0');
    const SECS = { hour: 3600, minute: 60, second: 1 };

    function clean(text) {
        const flags = [];
        let converted = 0;
        const stamp = (h, m, s) => { converted++; return `\n[${pad(h || 0)}:${pad(m)}:${s}] `; };
        const out = text
            .replace(WITH_DURATION, (whole, h, m, s, dur, ...rest) => {
                const [at, src] = rest.slice(-2);
                if (src.slice(src.lastIndexOf('\n', at - 1) + 1, at).trim()) {   // mid-line: not a real stamp line
                    flags.push(`left alone, text before it: "${src.slice(Math.max(0, at - 20), at + whole.trim().length)}"`);
                    return whole;
                }
                const spoken = [...dur.matchAll(/(\d+) (hour|minute|second)/g)].reduce((t, [, n, u]) => t + n * SECS[u], 0);
                const actual = (+h || 0) * 3600 + +m * 60 + +s;
                const st = stamp(h, m, s);
                if (spoken !== actual) flags.push(`${st.trim()} says "${dur}", which doesn't match the time`);
                return st;
            })
            .replace(BARE_LINE, (_, h, m, s) => stamp(h, m, s))
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{2,}(?=\[\d\d:)/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        let prev = -1;
        for (const line of out.split('\n')) {
            const t = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(line);
            if (t) {
                const secs = +t[1] * 3600 + +t[2] * 60 + +t[3];
                if (secs < prev) flags.push(`${t[0]} is earlier than the stamp before it`);
                prev = secs;
            }
            if (/^(\[[\d:]+\] )?\d+ (hour|minute|second)s?\b/.test(line)) flags.push(`leftover duration text: "${line.slice(0, 50)}"`);
        }
        return { text: out, converted, flags };
    }
    return { clean };
})();

if (typeof module !== 'undefined') module.exports = TranscriptClean;
