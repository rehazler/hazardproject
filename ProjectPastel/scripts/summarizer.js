// ─────────────────────────────────────────────────────────────────────────────
// summarizer.js — editor-only session summarizer (summarizer.html)
// Depends on: api-client.js, auth.js
//
// Flow per campaign (state lives in Supabase summary_jobs, so it survives
// refreshes, closed tabs and other devices):
//   draft   (batch running) -> clarify (editor answers questions)
//   final   (batch running) -> review  (copy / download / save to wiki,
//                                       review + save reference doc update)
//   done
// Claude runs as a Message Batch through workers/summarizer; the API key never
// reaches the browser. This page parses results and logs usage.
// ─────────────────────────────────────────────────────────────────────────────

const SUMMARIZER_WORKER_URL = 'https://voidverse-summarizer.hazardousmadness.workers.dev';
const _POLL_MS = 30 * 1000;
const _CAMPAIGN_KEY = 'ppastel-summarizer-campaign';
const _MODEL_KEY = 'ppastel-summarizer-model';
const _MODEL_NAMES = { opus: 'Opus', sonnet: 'Sonnet' };

(async function () {
    await auth.init();
    if (!auth.isEditor()) { location.replace('login.html'); return; }
    document.getElementById('nav-editor-guide')?.style.removeProperty('display');
    document.getElementById('nav-summarizer')?.style.removeProperty('display');

    const $ = id => document.getElementById(id);
    const STEPS = ['input', 'wait', 'error', 'clarify', 'review'];

    let campaign = null;  // { id, name }
    let job = null;       // summary_jobs row
    let pollTimer = null;

    // ── Small helpers ─────────────────────────────────────────────────────────

    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const time = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    // Only the current step is visible; the stepper shows where the editor is.
    function show(step) {
        STEPS.forEach(s => { $('sum-step-' + s).hidden = s !== step; });
        const n = step === 'input' ? 1 : step === 'clarify' ? 2
            : step === 'review' ? (job?.final_md ? 4 : 3)
            : (job?.stage === 'final' ? 2 : 1);   // waiting / error
        document.querySelectorAll('#sum-stepper li').forEach(li => {
            const i = Number(li.dataset.n);
            li.classList.toggle('is-current', i === n);
            li.classList.toggle('is-done', i < n);
            li.toggleAttribute('aria-current', i === n);
        });
    }

    // Tabs inside a step: a .sum-tabgroup holds .sum-tab buttons (data-pane) and .sum-pane panels.
    function selectTab(group, paneId) {
        group.querySelectorAll('.sum-tab').forEach(t => {
            const on = t.dataset.pane === paneId;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', on);
        });
        group.querySelectorAll('.sum-pane').forEach(p => { p.hidden = p.id !== paneId; });
    }
    document.addEventListener('click', e => {
        const tab = e.target.closest('.sum-tab');
        if (tab) selectTab(tab.closest('.sum-tabgroup'), tab.dataset.pane);
    });
    const firstTab = group => selectTab(group, group.querySelector('.sum-tab').dataset.pane);

    function note(id, text, isError) {
        const el = $(id);
        el.textContent = text || '';
        el.hidden = !text;
        el.classList.toggle('login-error', !!isError);
    }

    // Tells the editor a batch finished even if this tab is in the background.
    const _baseTitle = document.title;
    function notifyDone(text) {
        if (!document.hidden) return;
        document.title = '✓ ' + text + ' — ' + _baseTitle;
        try { if (Notification.permission === 'granted') new Notification('Voidverse Summarizer', { body: text, icon: 'favicon.ico' }); }
        catch { /* not supported */ }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = _baseTitle; });
    function askNotify() {
        try { if (Notification.permission === 'default') Notification.requestPermission(); } catch { /* not supported */ }
    }

    function friendly(msg) {
        if (/credit balance is too low/i.test(msg)) return 'Monthly API credits are used up. They refresh with your next Max billing cycle.';
        if (/overloaded|rate.?limit/i.test(msg)) return 'Claude is busy right now. Try again in a minute.';
        return msg;
    }

    // ── Worker calls ──────────────────────────────────────────────────────────

    async function call(path, body) {
        const s = await API.getSession();
        if (!s) { location.replace('login.html'); throw new Error('Signed out'); }
        const res = await fetch(SUMMARIZER_WORKER_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
            body: JSON.stringify(body || {}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            // Worker errors: { error: "..." }. Claude errors relayed: { error: { message } }.
            throw new Error(friendly(err.error?.message || err.error || `Request failed (${res.status})`));
        }
        return res;
    }

    function refreshUsage() {
        return call('/usage').then(r => r.json()).then(u => {
            $('sum-usage-bar').value = u.percent;
            $('sum-usage-text').textContent = `${Math.round(u.percent)}% of this month's credits used · resets ${u.resetsOn}`;
        }).catch(e => { $('sum-usage-text').textContent = 'Usage unavailable: ' + e.message; });
    }

    // Submits one stage as a batch. `from` is the state the job must still be in:
    // claiming it first means a second tab (or double click) can never submit
    // the same stage twice and double-bill.
    async function submit(stage, from, extra) {
        const claimed = await API.claimSummaryJob(job.id, from, { stage, status: 'submitting', error: null });
        if (!claimed) { job = await API.getSummaryJob(job.id); render(); return; }
        job = claimed;
        try {
            const ref = await API.getCampaignReference(campaign.id);
            const batch = await (await call('/submit', {
                stage, transcript: job.transcript, reference: ref.content, model: job.model_choice, fallback: job.use_fallback, ...extra,
            })).json();
            // reference_base = the exact text the final pass numbered; its line edits refer to it.
            job = await API.updateSummaryJob(job.id, { status: 'running', batch_id: batch.id, reference_base: ref.content.trim() });
        } catch (e) {
            job = await API.updateSummaryJob(job.id, { status: 'error', error: e.message });
        }
        render();
    }

    // ── Batch polling ─────────────────────────────────────────────────────────

    function schedulePoll(delay = _POLL_MS) {
        clearTimeout(pollTimer);
        if (job?.status === 'running') pollTimer = setTimeout(poll, delay);
        else if (['new', 'submitting', 'processing'].includes(job?.status)) {
            // Another tab (or this one) is mid-step: re-read the job shortly.
            const id = job.id;
            pollTimer = setTimeout(async () => {
                if (job?.id !== id) return;
                job = await API.getSummaryJob(id).catch(() => job);
                render();
            }, 10 * 1000);
        }
    }

    async function poll() {
        const j = job;
        if (!j || j.status !== 'running') return;
        try {
            const batch = await (await call('/status', { batch_id: j.batch_id })).json();
            $('sum-wait-status').textContent = `Submitted ${time(batch.created_at)} · last checked ${time(Date.now())}`;
            if (batch.processing_status !== 'ended') { schedulePoll(); return; }

            // Claim the finished batch so only one tab processes it.
            const claimed = await API.claimSummaryJob(j.id, { status: 'running', batch_id: j.batch_id }, { status: 'processing' });
            if (!claimed) { job = await API.getSummaryJob(j.id); render(); return; }
            const out = await processBatch(claimed);
            if (job?.id === j.id) {
                job = out;
                render();
                notifyDone(out.status === 'error' ? 'Summary run failed'
                    : out.status === 'running' ? 'Draft done, writing final summary'
                    : out.stage === 'clarify' ? 'Draft ready, questions waiting' : 'Final summary ready');
            }
        } catch (e) {
            // Network hiccup: keep polling, just show it.
            $('sum-wait-status').textContent = `Check failed (${e.message}) — retrying.`;
            schedulePoll();
        }
    }

    async function fetchResult(batchId) {
        const line = (await (await call('/results', { batch_id: batchId })).text()).trim().split('\n')[0];
        return JSON.parse(line).result;
    }

    // Logs usage for a succeeded result. message_id makes repeats a no-op.
    async function logResult(stage, result) {
        if (result.type !== 'succeeded') return;
        await API.logAiUsage(stage, result.message)
            .catch(e => console.warn('[summarizer] usage log failed', e));
        refreshUsage();
    }

    async function processBatch(j) {
        try { return await handleResult(j, await fetchResult(j.batch_id)); }
        catch (e) {
            // Couldn't read results: release the claim so the next check retries.
            await API.updateSummaryJob(j.id, { status: 'running' });
            throw e;
        }
    }

    // Turns a batch result into the job's next state.
    async function handleResult(j, result) {
        const fail = error => API.updateSummaryJob(j.id, { status: 'error', error });
        if (result.type !== 'succeeded') {
            return fail(result.type === 'errored'
                ? friendly(result.error?.error?.message || result.error?.message || 'Claude returned an error.')
                : `The request ${result.type} before Claude finished. Try again.`);
        }
        const msg = result.message;
        await logResult(j.stage, result);

        if (msg.stop_reason === 'refusal') {
            if (j.use_fallback) return fail('Both the main and the fallback model declined this transcript.');
            // Remember it: "Try again" (and every later step of this run) uses the fallback model.
            return API.updateSummaryJob(j.id, {
                status: 'error', use_fallback: true,
                error: 'Claude declined to process this transcript. "Try again" will retry on a different Claude model.',
            });
        }
        if (msg.stop_reason === 'max_tokens') return fail('Output hit the length limit before finishing. Try splitting the transcript into parts.');

        let data;
        try { data = JSON.parse(msg.content.filter(b => b.type === 'text').map(b => b.text).join('')); }
        catch { return fail('Claude returned an unreadable result. Try again.'); }

        if (j.stage === 'draft') {
            const clar = data.clarifications || [];
            const next = await API.updateSummaryJob(j.id, {
                stage: 'clarify', status: 'ready', draft: data.summary_markdown,
                clarifications: clar, answers: clar.map(() => ''),
            });
            if (!clar.length) {   // nothing to ask: go straight to the final pass
                job = next;
                await submit('final', { stage: 'clarify', status: 'ready' }, { draft: next.draft, answers: [] });
                return job;
            }
            return next;
        }
        return API.updateSummaryJob(j.id, {
            stage: 'review', status: 'ready',
            summary_edits: data.summary_edits || [], reference_edits: data.reference_edits || [],
            final_md: null, reference_proposed: null,
        });
    }

    // ── Markdown -> wiki blocks / HTML ────────────────────────────────────────

    const inline = s => esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

    // Produces the same block shapes the wiki renderer (supabase-fetch.js) reads.
    function mdToBlocks(md) {
        const blocks = [];
        let list = null, quote = null, para = null;
        const flush = () => {
            if (list)  blocks.push(list);
            if (quote) blocks.push({ type: 'quote', content: { html: quote.join('<br>') } });
            if (para)  blocks.push({ type: 'paragraph', content: { html: para.join(' ') } });
            list = quote = para = null;
        };
        for (const raw of md.split('\n')) {
            const line = raw.trim();
            let m;
            if (!line) { flush(); continue; }
            if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
                flush();
                const lvl = Math.min(4, Math.max(2, m[1].length + 1)); // wiki has no h1
                blocks.push({ type: 'heading_' + lvl, content: { html: inline(m[2]) } });
            } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
                flush(); blocks.push({ type: 'divider', content: {} });
            } else if ((m = /^>\s?(.*)$/.exec(line))) {
                if (!quote) { flush(); quote = []; }
                quote.push(inline(m[1]));
            } else if ((m = /^([-*+]|\d+\.)\s+(.*)$/.exec(line))) {
                const type = /\d/.test(m[1]) ? 'numbered_list' : 'bulleted_list';
                if (!list || list.type !== type) { flush(); list = { type, content: { items: [] } }; }
                list.content.items.push(inline(m[2]));
            } else {
                if (list || quote) flush();
                (para ||= []).push(inline(line));
            }
        }
        flush();
        return blocks;
    }

    function blocksToHtml(blocks) {
        return blocks.map(b => {
            const c = b.content;
            if (b.type.startsWith('heading_')) return `<h${b.type.slice(8)}>${c.html}</h${b.type.slice(8)}>`;
            if (b.type === 'divider') return '<hr>';
            if (b.type === 'quote') return `<blockquote>${c.html}</blockquote>`;
            if (b.type.endsWith('_list')) {
                const t = b.type === 'numbered_list' ? 'ol' : 'ul';
                return `<${t}>${c.items.map(i => `<li>${i}</li>`).join('')}</${t}>`;
            }
            return `<p>${c.html}</p>`;
        }).join('');
    }

    const renderMd = md => blocksToHtml(mdToBlocks(md || ''));
    const titleOf  = md => (/^#\s+(.+)$/m.exec(md || '')?.[1] || '').replace(/[*`_]/g, '').trim();

    // ── Render current job ────────────────────────────────────────────────────

    function render() {
        clearTimeout(pollTimer);
        stopWave();
        if (!job) { show('input'); return; }
        const stale = Date.now() - new Date(job.updated_at) > 2 * 60 * 1000;
        if (job.status === 'processing' && stale) {
            // A tab died mid-processing: hand it back to polling (usage logging is deduped).
            API.claimSummaryJob(job.id, { status: 'processing', updated_at: job.updated_at }, { status: 'running' })
                .then(async r => { job = r || await API.getSummaryJob(job.id); render(); })
                .catch(() => schedulePoll());
            return;
        }
        if ((job.status === 'submitting' || job.status === 'new') && stale) {
            // ponytail: a tab died mid-submit; the batch may or may not exist. Retrying
            // can double-bill that one request. Fix by tagging custom_id with job.id and
            // listing batches, if it ever happens in practice.
            job.status = 'error';
            job.error = 'The submission was interrupted. Check the Console usage page, then try again if needed.';
        }
        if (job.status === 'error') {
            $('sum-error-text').textContent = job.error || 'Unknown error.';
            show('error');
        } else if (['running', 'submitting', 'processing', 'new'].includes(job.status)) {
            const who = 'Claude ' + (_MODEL_NAMES[job.model_choice] || '');
            $('sum-wait-title').textContent = job.stage === 'draft'
                ? `${who} is reading the transcript…` : `${who} is writing the final summary and reference update…`;
            $('sum-wait-status').textContent = 'Checking…';
            show('wait');
            startWave();
            schedulePoll(0);
        } else if (job.stage === 'clarify') {
            renderClarify();
        } else if (job.stage === 'review') {
            renderReview();
        } else {
            show('input');
        }
    }

    // ── Waiting indicator: rotating silly phrases in a letter wave ────────────

    const WAVE_PHRASES = [
        'Rolling for Insight',
        'Reading the transcript (again)',
        'Untangling crosstalk',
        'Spell-checking NPC names',
        'Bribing the scribe',
        'Asking the dice nicely',
        'Sharpening quills',
        'Separating table talk from lore',
        'Following the plot threads',
        'Arguing with the timeline',
        'Checking who stabbed whom',
        'Inking the chronicle',
        'Looking up how to spell that town',
        'Rereading the cliffhanger',
        'Herding the party into order',
        'Making a Perception check',
        'Brewing a potion of Clarity',
        'Writing it all down, carefully',
        'Skipping the snack break',
        'Ignoring the pizza order',
        'Figuring out who said "wait, what?"',
        'Rerolling a natural 1',
        'Counting the loot twice',
        'Remembering every NPC the party adopted',
        'Filing the rules debate under "later"',
        'Waiting for the GM to stop laughing',
        'Taking notes the players forgot to',
        'Translating "I attack the darkness"',
        'Pretending that plan was always the plan',
        'Fact-checking the bard',
        'Untying the knot of side quests',
        'Resolving the inter-party argument (on paper)',
        'Counting the bard\'s spell slots',
        'Consulting the campaign archives',
        'Mapping the dungeon from memory',
        'Checking for mimics',
        'Calculating attacks of opportunity',
        'Identifying the cursed item',
        'Pathfinding through Golarion',
        'Tallying the action economy',
        'Sorting the bag of holding',
        'Reading the fine print on the wish',
        'Interrogating the tavern keeper',
        'Asking the owlbear to hold still',
        'Escaping the Shadowfell paperwork',
        'Restocking the healing potions',
        'Navigating the Camarilla politics',
        'Tracking the Masquerade breaches',
        'Measuring everyone\'s Hunger',
        'Keeping the Prince informed',
        'Counting who owes whom a boon',
        'Checking for frenzy',
        'Ignoring the Nosferatu in the vents',
        'Avoiding sunrise',
        'Consulting the Primogen',
        'Calming the Garou\'s Rage',
        'Bending reality, Mage-style (gently)',
        'Remembering the Changeling\'s true name',
        'Hunting the hunters',
        'Rolling Sanity (and failing)',
        'Not reading the Necronomicon aloud',
        'Investigating the strange library',
        'Researching suspicious cults',
        'Steadying the Investigator\'s hands',
        'Pulling one more block from the tower',
        'Lighting the last of ten candles',
        'Counting the Delta Green redactions',
        'Hiding from the Unnatural',
        'Checking the Mothership oxygen gauge',
        'Panicking calmly, Mothership-style',
        'Reading the Kult fine print',
        'Searching the folklore of the Vaesen',
        'Jacking into the transcript',
        'Decking into the Shadowrun Matrix',
        'Paying the Shadowrun fixer',
        'Checking the Cyberpunk RED street cred',
        'Installing chrome (carefully)',
        'Plotting a Traveller jump route',
        'Refueling at the starport',
        'Running from the Xenomorph',
        'Recalibrating the Lancer mech',
        'Charting a course through the Expanse',
        'Rolling Star Wars destiny points',
        'Plotting a Starfinder drift jump',
        'Filing a Paranoia report (Friend Computer is watching)',
        'Denying all treason, citizen',
        'Engaging the Blades in the Dark heist',
        'Adding a flashback',
        'Clocking the faction tick',
        'Hunting the Monster of the Week',
        'Marking experience',
        'Rolling plus Weird',
        'Labeling the teen heroes of Masks',
        'Shuffling the Fiasco dice',
        'Drawing from the Deck of Fate',
        'Invoking an Aspect',
        'Counting GURPS skill points',
        'Shuffling the Savage Worlds initiative cards',
        'Exploding the dice (Savage Worlds style)',
        'Biking through Kids on Bikes town',
        'Pulling a Honey Heist',
        'Wandering through Wanderhome',
        'Navigating the Woodland of Root',
        'Questing for Pendragon glory',
        'Honoring the Legend of the Five Rings',
        'Stunting, Exalted-style',
        'Burning a Burning Wheel Belief',
        'Surviving a Warhammer Fantasy critical hit',
        'Defacing the Mörk Borg zine',
        'Picking a 13th Age icon',
        'Taking a Dungeon World move',
        'Adding an Alien RPG stress die',
    ];
    let waveTimer = null;

    function setWave(text) {
        const el = $('sum-wave');
        // Spaces stay plain text so long phrases can wrap on phones.
        el.innerHTML = [...text + '…'].map((ch, i) => ch === ' ' ? ' '
            : `<span style="animation-delay:${(i * 0.06).toFixed(2)}s">${esc(ch)}</span>`).join('');
    }

    function startWave() {
        if (waveTimer) return;
        let last = -1;
        const next = () => {
            let i;
            do { i = Math.floor(Math.random() * WAVE_PHRASES.length); } while (i === last);
            last = i;
            setWave(WAVE_PHRASES[i]);
        };
        next();
        waveTimer = setInterval(next, 4000);
    }

    function stopWave() { clearInterval(waveTimer); waveTimer = null; }

    // ── Campaign + reference doc ──────────────────────────────────────────────

    let refSaved = '';   // text as last saved, to detect unsaved edits in the dialog

    async function loadReference() {
        const ref = await API.getCampaignReference(campaign.id);
        refSaved = ref.content;
        $('sum-ref-text').value = ref.content;
        $('sum-ref-title').textContent = `Reference doc — ${campaign.name}`;
        $('sum-ref-status').textContent = ref.content
            ? `· ${(ref.content.length / 1024).toFixed(1)} KB`
            : '· none yet';
        const versions = await API.getCampaignReferenceVersions(campaign.id);
        $('sum-ref-versions').innerHTML = versions.length
            ? versions.map(v => `<option value="${v.id}">${new Date(v.created_at).toLocaleString()}</option>`).join('')
            : '<option value="">No earlier versions</option>';
        $('sum-ref-versions').dataset.versions = JSON.stringify(versions);
    }

    async function selectCampaign(id) {
        const camps = await API.getCampaigns();
        const c = camps.find(x => x.id === id) || camps[0];
        if (!c) { note('sum-input-err', 'Create a campaign in the wiki first.', true); return; }
        campaign = { id: c.id, name: c.name };
        $('sum-campaign').value = c.id;
        try { localStorage.setItem(_CAMPAIGN_KEY, c.id); } catch { /* private mode */ }
        const url = new URL(location.href);
        url.searchParams.set('campaign', c.id);
        history.replaceState(null, '', url);

        note('sum-ref-msg', '');
        await loadReference();
        job = await API.getOpenSummaryJob(c.id);
        render();
    }

    const camps = await API.getCampaigns();
    $('sum-campaign').innerHTML = camps.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('sum-campaign').addEventListener('change', e => selectCampaign(e.target.value));

    // ── Reference doc dialog ──────────────────────────────────────────────────

    const refDialog = $('sum-ref-dialog');
    const refDirty = () => $('sum-ref-text').value.trim() !== refSaved.trim();

    function openRef() {
        if (!campaign || refDialog.open) return;
        note('sum-ref-msg', '');
        refDialog.showModal();
        history.replaceState(null, '', location.pathname + location.search + '#reference');
    }

    // Esc, ✕ and any other close route go through here so unsaved edits aren't lost by accident.
    function closeRef() {
        if (refDirty() && !confirm('You have unsaved changes to the reference doc.\n\nClose without saving them?')) return;
        $('sum-ref-text').value = refSaved;
        refDialog.close();
    }

    $('sum-ref-open').addEventListener('click', openRef);
    $('sum-ref-open-2').addEventListener('click', openRef);
    $('sum-ref-close').addEventListener('click', closeRef);
    refDialog.addEventListener('cancel', e => { e.preventDefault(); closeRef(); });
    refDialog.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));

    $('sum-ref-file').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (f) $('sum-ref-text').value = await f.text();
    });

    async function saveReference(text, msgId) {
        await API.saveCampaignReference(campaign.id, text);
        await loadReference();
        note(msgId, `Saved ${time(Date.now())}. The previous version was kept.`);
    }

    $('sum-ref-save').addEventListener('click', () =>
        saveReference($('sum-ref-text').value.trim(), 'sum-ref-msg').catch(e => note('sum-ref-msg', e.message, true)));

    $('sum-ref-restore').addEventListener('click', () => {
        const versions = JSON.parse($('sum-ref-versions').dataset.versions || '[]');
        const v = versions.find(x => x.id === $('sum-ref-versions').value);
        if (!v) return;
        $('sum-ref-text').value = v.content;
        note('sum-ref-msg', 'Version loaded into the editor. Click "Save reference doc" to make it current.');
    });

    // ── Step 1: input ─────────────────────────────────────────────────────────

    $('sum-transcript-file').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (f) $('sum-transcript').value = await f.text();
    });

    $('sum-run').addEventListener('click', async () => {
        const transcript = $('sum-transcript').value.trim();
        if (!transcript) { note('sum-input-err', 'Paste or upload a transcript first.', true); return; }
        note('sum-input-err', '');
        $('sum-run').disabled = true;
        askNotify();
        try {
            // Another tab may already have started a run for this campaign.
            const open = await API.getOpenSummaryJob(campaign.id);
            if (open) { job = open; render(); return; }
            const model_choice = document.querySelector('input[name="sum-model"]:checked')?.value || 'opus';
            try { localStorage.setItem(_MODEL_KEY, model_choice); } catch { /* private mode */ }
            job = await API.createSummaryJob({ campaign_id: campaign.id, transcript, model_choice, stage: 'draft', status: 'new' });
            await submit('draft', { status: 'new' });
            $('sum-transcript').value = '';
        } catch (e) {
            note('sum-input-err', e.message, true);
        } finally { $('sum-run').disabled = false; }
    });

    // ── Waiting / error ───────────────────────────────────────────────────────

    $('sum-wait-check').addEventListener('click', () => schedulePoll(0));

    $('sum-retry').addEventListener('click', async () => {
        $('sum-retry').disabled = true;
        try {
            // updated_at changes on every write, so it acts as a version check.
            const from = { updated_at: job.updated_at };
            if (job.draft && job.stage !== 'draft') await submit('final', from, { draft: job.draft, answers: answersPayload() });
            else await submit('draft', from);
        } catch (e) { $('sum-error-text').textContent = e.message; }
        finally { $('sum-retry').disabled = false; }
    });

    // Discarding a running batch cancels it on Anthropic's side; whatever Claude
    // already finished is still billed, and sweepCanceled() logs that usage.
    document.querySelectorAll('.sum-discard').forEach(btn => btn.addEventListener('click', async () => {
        if (!job) return;
        const live = job.batch_id && ['running', 'processing'].includes(job.status);
        const msg = live
            ? 'Cancel this summary run?\n\nClaude stops working on it and the run is deleted. Any part Claude already finished is still billed. This cannot be undone.'
            : 'Discard this run?\n\nThe draft, your answers and the transcript for this run are cleared from the page. This cannot be undone.';
        if (!confirm(msg)) return;
        if (live) await call('/cancel', { batch_id: job.batch_id }).catch(e => console.warn('[summarizer] cancel failed', e));
        await API.updateSummaryJob(job.id, { stage: 'done', status: live ? 'canceled' : 'closed' });
        job = null;
        render();
    }));

    // Canceled batches can still finish (cancel isn't instant): once they end,
    // log any usage they incurred so the meter stays accurate.
    async function sweepCanceled() {
        for (const j of await API.getCanceledSummaryJobs()) {
            const batch = await (await call('/status', { batch_id: j.batch_id })).json();
            if (batch.processing_status !== 'ended') continue;
            await logResult(j.stage, await fetchResult(j.batch_id));
            await API.updateSummaryJob(j.id, { status: 'closed' });
        }
    }

    // ── Step 2: clarifications ────────────────────────────────────────────────

    const answersPayload = () => (job.clarifications || []).map((c, i) => ({ ...c, answer: job.answers?.[i] || '' }));

    function renderClarify() {
        $('sum-draft').innerHTML = renderMd(job.draft);
        $('sum-clarify-count').textContent = job.clarifications.length;
        $('sum-questions').innerHTML = job.clarifications.map((c, i) => `
            <div class="sum-question">
                <p class="sum-q-loc">${esc(c.location)}</p>
                ${c.excerpt ? `<blockquote>${esc(c.excerpt)}</blockquote>` : ''}
                <label for="sum-a-${i}">${esc(c.question)}</label>
                <textarea id="sum-a-${i}" rows="2" data-i="${i}"
                    placeholder="Your clarification (leave blank to keep Claude's best guess)">${esc(job.answers?.[i] || '')}</textarea>
            </div>`).join('');
        note('sum-clarify-err', '');
        show('clarify');
    }

    let saveAnswersTimer = null;
    $('sum-questions').addEventListener('input', e => {
        const i = e.target.dataset.i;
        if (i === undefined) return;
        job.answers[i] = e.target.value;
        clearTimeout(saveAnswersTimer);
        const id = job.id, answers = [...job.answers];
        saveAnswersTimer = setTimeout(() => API.updateSummaryJob(id, { answers })
            .catch(err => note('sum-clarify-err', 'Answers not saved: ' + err.message, true)), 800);
    });

    $('sum-finalize').addEventListener('click', async () => {
        clearTimeout(saveAnswersTimer);
        $('sum-finalize').disabled = true;
        try {
            await API.updateSummaryJob(job.id, { answers: job.answers });
            await submit('final', { stage: 'clarify', status: 'ready' }, { draft: job.draft, answers: answersPayload() });
        } catch (e) { note('sum-clarify-err', e.message, true); }
        finally { $('sum-finalize').disabled = false; }
    });

    // ── Step 3: review ────────────────────────────────────────────────────────

    const NEW_CAT = '__new__';

    async function loadCategories() {
        const cats = await API.getCategories(campaign.id);
        const recap = cats.find(c => /recap|summar|session/i.test(c.name));
        $('sum-category').innerHTML = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
            + `<option value="${NEW_CAT}">+ New category…</option>`;
        $('sum-category').value = recap ? recap.id : NEW_CAT;
        $('sum-new-cat-field').hidden = $('sum-category').value !== NEW_CAT;
    }

    // ── Step 3a: review Claude's line edits ───────────────────────────────────

    const OP_LABEL = { replace: 'Change', delete: 'Remove', append: 'Add to end of line', insert_after: 'Add new line(s)' };

    function lineRange(text, a, b) { return text.split('\n').slice(a - 1, b).join('\n'); }

    function renderEditList(listId, countId, base, edits, kind) {
        // Edits that can't apply even when all are selected (bad line numbers / overlaps) are flagged.
        const { conflicts } = SummarizerEdits.apply(base, edits);
        $(countId).textContent = edits.length;
        $(listId).innerHTML = edits.length ? edits.map((e, i) => {
            const bad = conflicts.includes(i);
            const last = Math.max(e.end_line || e.line, e.line);
            const where = e.op === 'insert_after'
                ? (e.line === 0 ? 'at the top' : `after line ${e.line}`)
                : e.line === last ? `line ${e.line}` : `lines ${e.line}–${last}`;
            let old = '', ctx = '';
            if (e.op === 'replace' || e.op === 'delete') old = lineRange(base, e.line, last);
            else if (e.op === 'append') ctx = '…' + lineRange(base, e.line, e.line).slice(-160);
            else if (e.line > 0) ctx = lineRange(base, e.line, e.line).slice(0, 160) + '…';
            return `<label class="sum-diff-item${bad ? ' is-conflict' : ''}">
                <input type="checkbox" data-kind="${kind}" data-i="${i}" ${bad ? 'disabled' : 'checked'}>
                <span class="sum-diff-body">
                    <span class="sum-diff-meta">${OP_LABEL[e.op] || esc(e.op)} · ${where}${bad ? ' · can\'t apply (overlaps another change or bad line number) — fix by hand after applying' : ''}</span>
                    <span class="sum-diff-reason">${esc(e.reason)}</span>
                    ${ctx ? `<pre class="sum-diff-ctx">${esc(ctx)}</pre>` : ''}
                    ${old ? `<pre class="sum-diff-old">${esc(old)}</pre>` : ''}
                    ${e.op !== 'delete' ? `<pre class="sum-diff-new">${esc(e.text)}</pre>` : ''}
                </span>
            </label>`;
        }).join('') : '<p class="sum-hint">No changes.</p>';
    }

    function renderDiff() {
        renderEditList('sum-diff-summary', 'sum-diff-sum-count', job.draft, job.summary_edits, 'summary');
        renderEditList('sum-diff-reference', 'sum-diff-ref-count', job.reference_base || '', job.reference_edits, 'reference');
        $('sum-diff').hidden = false;
        $('sum-output').hidden = true;
        firstTab($('sum-diff'));
        show('review');
    }

    $('sum-diff-apply').addEventListener('click', async () => {
        const picked = kind => [...document.querySelectorAll(`#sum-step-review input[data-kind="${kind}"]:checked`)]
            .map(cb => job[kind + '_edits'][cb.dataset.i]);
        const summary = SummarizerEdits.apply(job.draft, picked('summary'));
        const reference = SummarizerEdits.apply(job.reference_base || '', picked('reference'));
        $('sum-diff-apply').disabled = true;
        try {
            job = await API.updateSummaryJob(job.id, {
                final_md: summary.text.trim(),
                // null = no reference changes accepted, nothing to save
                reference_proposed: picked('reference').length ? reference.text.trim() : null,
            });
            renderReview();
        } catch (e) { alert('Could not save: ' + e.message); }
        finally { $('sum-diff-apply').disabled = false; }
    });

    $('sum-diff-back').addEventListener('click', async () => {
        if (!confirm('Go back to the change list?\n\nAny edits you typed into the reference doc box below will be lost.')) return;
        job = await API.updateSummaryJob(job.id, { final_md: null, reference_proposed: null });
        renderDiff();
    });

    // ── Step 3b: final output ─────────────────────────────────────────────────

    function renderReview() {
        if (!job.final_md) { renderDiff(); return; }
        $('sum-diff').hidden = true;
        $('sum-output').hidden = false;
        $('sum-tab-ref-out').hidden = job.reference_proposed == null;
        firstTab($('sum-output'));
        $('sum-final').innerHTML = renderMd(job.final_md);
        const title = titleOf(job.final_md);
        const num = sessionNumber();
        $('sum-entry-name').value = title || (num ? `Session ${num} Recap` : 'Session Recap');
        $('sum-entry-subtitle').value = num ? `Session ${num} recap · ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}` : '';
        showSaved();
        $('sum-ref-proposed').value = job.reference_proposed || '';
        note('sum-save-msg', '');
        note('sum-ref-apply-msg', '');
        show('review');
        loadCategories().catch(e => note('sum-save-msg', e.message, true));
    }

    $('sum-category').addEventListener('change', () => {
        $('sum-new-cat-field').hidden = $('sum-category').value !== NEW_CAT;
    });

    $('sum-copy').addEventListener('click', async () => {
        await navigator.clipboard.writeText(job.final_md);
        $('sum-copy').textContent = 'Copied!';
        setTimeout(() => { $('sum-copy').textContent = 'Copy Markdown'; }, 1500);
    });

    $('sum-download').addEventListener('click', () => {
        const n = /session\s*(\d+)/i.exec(titleOf(job.final_md))?.[1];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([job.final_md], { type: 'text/markdown' }));
        a.download = n ? `session-${n}-summary.md` : 'session-summary.md';
        a.click();
        URL.revokeObjectURL(a.href);
    });

    // Session number from the summary title or the transcript header ("Chapter_10", "Session 31").
    function sessionNumber() {
        const hay = titleOf(job.final_md) + '\n' + (job.transcript || '').slice(0, 400);
        return /(?:session|chapter|episode|ep)[\s_#-]*(\d+)/i.exec(hay)?.[1] || '';
    }

    function showSaved() {
        if (!job.wiki_entry_url) { note('sum-save-msg', ''); $('sum-save').textContent = 'Create wiki entry'; return; }
        $('sum-save-msg').hidden = false;
        $('sum-save-msg').classList.remove('login-error');
        $('sum-save-msg').innerHTML = `Saved. <a href="${esc(job.wiki_entry_url)}">Open it in the wiki →</a>`;
        $('sum-save').textContent = 'Save another copy';
    }

    $('sum-save').addEventListener('click', async () => {
        const name = $('sum-entry-name').value.trim();
        if (!name) { note('sum-save-msg', 'Give the entry a name.', true); return; }
        if (job.wiki_entry_url && !confirm('This summary is already saved to the wiki.\n\nCreate a second, separate copy?')) return;
        $('sum-save').disabled = true;
        try {
            let categoryId = $('sum-category').value;
            let catName = $('sum-category').selectedOptions[0].textContent;
            let existing = [];
            if (categoryId === NEW_CAT) {
                catName = $('sum-new-cat').value.trim() || 'Session Recaps';
                categoryId = (await API.createCategory(campaign.id, { name: catName })).id;
            } else {
                existing = await API.getEntries(categoryId);
                if (existing.some(e => e.name.trim().toLowerCase() === name.toLowerCase())
                    && !confirm(`"${catName}" already has an entry named "${name}".\n\nCreate another one with the same name?`)) return;
            }

            // Same fields as "+ New Entry" in the wiki editor, placed after the existing entries.
            const entry = await API.createEntry(categoryId, {
                name,
                subtitle: $('sum-entry-subtitle').value.trim() || null,
                extra_props: {},
                sort_order: existing.reduce((m, e) => Math.max(m, e.sort_order ?? 0), -1) + 1,
            });
            // The entry name is already the page title, so drop a matching top heading from the body.
            const blocks = mdToBlocks(job.final_md);
            if (blocks[0]?.type === 'heading_2' && titleOf(job.final_md)) blocks.shift();
            await API.saveBlocks(entry.id, blocks);

            const url = `wiki-supabase.html?campaign=${encodeURIComponent(campaign.name)}&category=${encodeURIComponent(catName)}&entry=${entry.id}`;
            job = await API.updateSummaryJob(job.id, { wiki_entry_url: url });
            showSaved();
            await loadCategories();
            $('sum-category').value = categoryId;
        } catch (e) { note('sum-save-msg', e.message, true); }
        finally { $('sum-save').disabled = false; }
    });

    $('sum-ref-apply').addEventListener('click', async () => {
        // Line edits were made against reference_base; warn if the doc was edited since.
        const current = (await API.getCampaignReference(campaign.id)).content.trim();
        if (current !== (job.reference_base || '') && !confirm('The reference doc was edited after this run started.\n\n'
            + 'Saving replaces it with the version below, so those later edits would be lost (the old version is still kept in history). Save anyway?')) return;
        saveReferenceFromReview();
    });
    const saveReferenceFromReview = () =>
        saveReference($('sum-ref-proposed').value.trim(), 'sum-ref-apply-msg').catch(e => note('sum-ref-apply-msg', e.message, true));

    $('sum-finish').addEventListener('click', async () => {
        const ok = confirm('Finish this session?\n\nThis closes the run. Make sure you copied, downloaded or saved the summary, '
            + 'and saved the reference doc update if you want it. They cannot be recovered from this page afterwards.');
        if (!ok) return;
        await API.updateSummaryJob(job.id, { stage: 'done', status: 'closed' });
        job = null;
        render();
    });

    // ── Start ─────────────────────────────────────────────────────────────────

    refreshUsage();
    sweepCanceled().catch(e => console.warn('[summarizer] cancel sweep failed', e));
    let startId = new URLSearchParams(location.search).get('campaign');
    try { startId ||= localStorage.getItem(_CAMPAIGN_KEY); } catch { /* private mode */ }
    try {
        const m = localStorage.getItem(_MODEL_KEY);
        const radio = m && document.querySelector(`input[name="sum-model"][value="${m}"]`);
        if (radio) radio.checked = true;
    } catch { /* private mode */ }
    await selectCampaign(startId);
    if (location.hash === '#reference') openRef();
})().catch(e => {
    // Never fail silently: show why the page could not start.
    console.error('[summarizer]', e);
    const el = document.getElementById('sum-fatal');
    if (el) { el.hidden = false; el.textContent = 'The summarizer could not start: ' + (e.message || e); }
    const u = document.getElementById('sum-usage-text');
    if (u) u.textContent = 'Usage unavailable.';
});
