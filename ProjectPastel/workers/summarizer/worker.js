// ─────────────────────────────────────────────────────────────────────────────
// summarizer/worker.js — Cloudflare Worker for the editor-only session summarizer
//
// Thin pass-through to the Claude Message Batches API. It checks the caller is
// the editor and the monthly budget isn't spent, wraps the input with the
// ttrpg-summarizer skill (SKILL.md, bundled at deploy time), submits a batch,
// and relays batch status/results untouched. Batches run on Anthropic's side,
// so a run survives the editor closing or refreshing the page. The worker
// never parses Claude's output (CPU stays tiny); summarizer.js does that and
// logs usage to Supabase.
//
// Secrets / vars (wrangler secret put <NAME>, or [vars] in wrangler.toml):
//   ANTHROPIC_API_KEY   key from the Console org linked to the Max plan
//   SUPABASE_URL        e.g. https://lzvvdjnjgvhdwlimidge.supabase.co
//   SUPABASE_ANON_KEY   the public anon key (same one as api-client.js)
//   EDITOR_USER_ID      Supabase auth user id(s) allowed to use this worker; several editors = comma-separated (uid1,uid2)
//   BILLING_CYCLE_DAY   day of month the Max plan renews (credits refresh), e.g. 14
//
// Routes (all POST, all require the editor's Supabase Bearer token):
//   /usage    {}                                   -> { percent, resetsOn }
//   /submit   { stage: 'draft', model, transcript, reference, fallback? }
//             { stage: 'final', model, transcript, reference, draft, answers, fallback? }
//             model: 'opus' | 'sonnet' (defaults to 'opus')
//                                                  -> Claude batch object (has .id)
//   /status   { batch_id }                         -> Claude batch object
//   /results  { batch_id }                         -> Claude results JSONL
//   /cancel   { batch_id }                         -> Claude batch object (cancel requested)
// ─────────────────────────────────────────────────────────────────────────────

import SKILL from './SKILL.md';
import { BUDGET_USD, cycleBounds } from './billing.js';

// The editor picks 'opus' or 'sonnet'. `fallback` is used only when the editor
// retries after Claude declines a transcript (Batches can't use the API's
// automatic `fallbacks`, so the page offers it as a button).
// Keep in sync with the price table in supabase-migration-v6.sql.
const MODELS = {
    opus:   { main: 'claude-opus-5-5',   fallback: 'claude-opus-5' },
    sonnet: { main: 'claude-sonnet-5-5', fallback: 'claude-sonnet-5' },
};
const CLAUDE = 'https://api.anthropic.com/v1/messages/batches';
const ALLOWED_ORIGINS = ['https://themadhazard.com', 'http://localhost:8000', 'http://127.0.0.1:8000'];

const WEB_MODE = `
# Web mode (overrides file-system instructions above)

You are running inside a website tool, not a file system.
- The transcript and the campaign reference file (if one exists yet) are provided in the user message. There are no files to open, locate, or write; ignore every instruction about paths, folders and output files.
- Step 6 (reference file update) happens only when the message asks for it, and is returned as line edits (see the message) instead of writing a file. If no reference file was provided, create one from this session with a single insert at line 0, using the section layout "The Party", then NPCs grouped sensibly, then "Locations".
- Follow every other rule (scope, accuracy, chronology, formatting, verification, continuity section) exactly.
- Whenever you are not confident about something — a misheard or inconsistent name, an unclear speaker, an ambiguous event, a garbled or missing stretch of the transcript, a contradiction with the reference file — do NOT guess silently. Write your best version in the summary and list the point as a clarification so the DM can correct it.`;

const DRAFT_SCHEMA = {
    type: 'object',
    properties: {
        summary_markdown: { type: 'string', description: 'The full session summary in Markdown.' },
        clarifications: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    location: { type: 'string', description: 'Timestamp or scene where the issue occurs.' },
                    excerpt:  { type: 'string', description: 'Short quote of the unclear transcript text.' },
                    question: { type: 'string', description: 'What the DM needs to clarify.' },
                },
                required: ['location', 'excerpt', 'question'],
                additionalProperties: false,
            },
        },
    },
    required: ['summary_markdown', 'clarifications'],
    additionalProperties: false,
};

// Final pass returns line edits, not full rewrites: output tokens (the
// expensive part) scale with the number of changes, not the document size.
// Applied in the browser by scripts/summarizer-edits.js.
const EDIT_LIST = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            op:       { type: 'string', enum: ['replace', 'delete', 'append', 'insert_after'] },
            line:     { type: 'integer', description: 'First line number it applies to (insert_after may use 0 for the very top).' },
            end_line: { type: 'integer', description: 'Last line number for replace/delete; same as line otherwise.' },
            text:     { type: 'string', description: 'New text (may contain newlines). Empty for delete.' },
            reason:   { type: 'string', description: 'Short reason shown to the DM, e.g. "Clarification 3: Sarah said this, not John".' },
        },
        required: ['op', 'line', 'end_line', 'text', 'reason'],
        additionalProperties: false,
    },
};

const FINAL_SCHEMA = {
    type: 'object',
    properties: {
        summary_edits:   EDIT_LIST,
        reference_edits: EDIT_LIST,
    },
    required: ['summary_edits', 'reference_edits'],
    additionalProperties: false,
};

const numbered = text => text.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');

const EDIT_RULES = `How to return changes — line edits only, never the whole document:
- Line numbers refer to the numbered <draft> and <campaign_reference> exactly as given. Never renumber; every edit refers to the original numbers, and no two edits may touch the same line (one replace may cover a range).
- "replace": lines line..end_line become text. Use it only for lines that are actually wrong or need rewording.
- "delete": remove lines line..end_line (draft only — never delete reference entries; mark them deceased/departed instead).
- "append": add text to the end of an existing line. Prefer this for adding new session facts to an existing reference entry.
- "insert_after": add new line(s) after line (0 = top). Use for new entries, bullets or sections.
- Do not include the "12| " numbering prefix in text. Match the surrounding format and indentation.
- Every edit has a short reason; cite the clarification number when it comes from a DM answer.
- If nothing needs to change in a document, return an empty list for it.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', ...cors },
    });
}

// Returns the access token if the caller is the editor, else a Response.
async function verifyEditor(request, env, cors) {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401, cors);
    const token = authHeader.slice(7);
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return json({ error: 'Unauthorized' }, 401, cors);
    const user = await res.json();
    const editors = (env.EDITOR_USER_ID || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!editors.includes(user.id)) return json({ error: 'Forbidden' }, 403, cors);
    return token;
}

async function usageStatus(env, token) {
    const { start, end } = cycleBounds(env);
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ai_usage?select=cost_usd&created_at=gte.${start.toISOString()}`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Usage lookup failed: ' + (await res.text()));
    const spent = (await res.json()).reduce((s, r) => s + Number(r.cost_usd), 0);
    return { percent: Math.min(100, (spent / BUDGET_USD) * 100), resetsOn: end.toISOString().slice(0, 10) };
}

// Builds the Messages request for one stage. No prompt caching: the draft and
// final stages are usually far more than an hour apart (the DM answers
// questions in between), so a cache write would cost more than it saves.
function messageParams(body) {
    const content = [{ type: 'text', text: `<transcript>\n${body.transcript.trim()}\n</transcript>` }];
    const reference = (body.reference || '').trim();
    content.push({
        type: 'text',
        text: reference ? `<campaign_reference>\n${reference}\n</campaign_reference>` : '<campaign_reference>(none yet)</campaign_reference>'
    });

    let schema;
    if (body.stage === 'draft') {
        schema = DRAFT_SCHEMA;
        content.push({ type: 'text', text: 'Summarize this session following the skill (skip Step 6). Return the summary and every clarification you need from the DM.' });
    } else {
        schema = FINAL_SCHEMA;
        const answers = Array.isArray(body.answers) ? body.answers : [];
        const qa = answers.length
            ? answers.map((a, i) => `${i + 1}. [${a.location || ''}] ${a.question}\n   DM answer: ${a.answer?.trim() || '(no answer — keep your best judgment)'}`).join('\n')
            : '(no clarifications were needed)';
        // Number the reference for this stage (draft-stage reference stays plain above).
        if (reference) content[1].text = `<campaign_reference>\n${numbered(reference)}\n</campaign_reference>`;
        content.push({
            type: 'text',
            text: `Here is your draft summary of this session, with line numbers:\n<draft>\n${numbered(body.draft || '')}\n</draft>\n\n`
                + `The DM answered your clarification questions:\n<answers>\n${qa}\n</answers>\n\n`
                + '1. summary_edits: edit the draft so every answer is applied, and fix anything else that re-verifying against the transcript shows is wrong. '
                + 'Answers may affect several places (e.g. a corrected speaker or name); fix each one.\n'
                + '2. reference_edits: perform Step 6 on the campaign reference file — add new entries, and append this session\'s new facts '
                + 'to existing entries, keeping its existing format and every existing entry.\n'
                + "Treat the DM's answers as authoritative for names and facts.\n\n" + EDIT_RULES,
        });
    }

    return {
        model: (MODELS[body.model] || MODELS.opus)[body.fallback ? 'fallback' : 'main'],
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema } },
        system: [
            { type: 'text', text: SKILL },
            { type: 'text', text: WEB_MODE },
        ],
        messages: [{ role: 'user', content }],
    };
}

// Relays a Claude API response to the browser without reading it.
function relay(upstream, cors) {
    return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...cors },
    });
}

// ── Entry point ──────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const cors = {
            'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            Vary: 'Origin',
        };
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

        const token = await verifyEditor(request, env, cors);
        if (token instanceof Response) return token;

        const path = new URL(request.url).pathname;
        const body = await request.json().catch(() => ({}));
        const claudeHeaders = {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2026-10-21',
        };

        if (path === '/usage') {
            try { return json(await usageStatus(env, token), 200, cors); }
            catch (err) { return json({ error: err.message }, 500, cors); }
        }

        if (path === '/status' || path === '/results' || path === '/cancel') {
            if (!/^msgbatch_[A-Za-z0-9]+$/.test(body.batch_id || '')) return json({ error: 'Bad batch_id' }, 400, cors);
            const url = `${CLAUDE}/${body.batch_id}` + (path === '/status' ? '' : path);
            return relay(await fetch(url, { method: path === '/cancel' ? 'POST' : 'GET', headers: claudeHeaders }), cors);
        }

        if (path === '/submit') {
            if (body.stage !== 'draft' && body.stage !== 'final') return json({ error: 'Bad stage' }, 400, cors);
            if (!(body.transcript || '').trim()) return json({ error: 'Transcript is empty.' }, 400, cors);

            let usage;
            try { usage = await usageStatus(env, token); }
            catch (err) { return json({ error: err.message }, 500, cors); }
            if (usage.percent >= 100) return json({ error: `Monthly budget used up. Resets ${usage.resetsOn}.` }, 402, cors);

            const upstream = await fetch(CLAUDE, {
                method: 'POST',
                headers: claudeHeaders,
                body: JSON.stringify({ requests: [{ custom_id: body.stage, params: messageParams(body) }] }),
            });
            return relay(upstream, cors);
        }

        return json({ error: 'Not found' }, 404, cors);
    },
};
