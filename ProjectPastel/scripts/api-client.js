// ─────────────────────────────────────────────────────────────────────────────
// api-client.js — Supabase abstraction layer for ProjectPastel wiki
//
// SETUP REQUIRED — replace the two placeholder values below.
// See SUPABASE_SETUP.md for step-by-step instructions.
//
// Future migration note: to swap to a self-hosted server, replace the
// _sb.from(...) / _sb.auth calls with fetch() calls against your own API.
// All call sites (supabase-fetch.js, wiki-editor.js) remain unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = 'https://lzvvdjnjgvhdwlimidge.supabase.co';       // e.g. https://lzvvdjnjgvhdwlimidge.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6dnZkam5qZ3ZoZHdsaW1pZGdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzA5MTcsImV4cCI6MjA4OTQ0NjkxN30._dGX6vNtk_8JgLy4lIoolTCVryMRIeIUGEvDZsnWOUY';  // starts with eyJ...

// Supabase JS client — loaded via CDN in wiki-supabase.html and login.html
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Cache ─────────────────────────────────────────────────────────────────────

const _NS  = 'ppastel-sb-v1';
const _TTL = 5 * 60 * 1000; // 5 min

function _cacheGet(key) {
    try {
        const raw = localStorage.getItem(_NS + ':' + key);
        if (!raw) return null;
        const { data, exp } = JSON.parse(raw);
        if (Date.now() > exp) { localStorage.removeItem(_NS + ':' + key); return null; }
        return data;
    } catch { return null; }
}

function _cacheSet(key, data, ttl = _TTL) {
    try {
        localStorage.setItem(_NS + ':' + key, JSON.stringify({ data, exp: Date.now() + ttl }));
    } catch { /* storage full or private browsing — silently ignore */ }
}

function _cacheDel(key) {
    try { localStorage.removeItem(_NS + ':' + key); } catch { /* ignore */ }
}

// ── API ───────────────────────────────────────────────────────────────────────

const API = {

    // ── Read ──────────────────────────────────────────────────────────────────

    async getCampaigns() {
        const hit = _cacheGet('campaigns');
        if (hit) return hit;
        const { data, error } = await _sb.from('campaigns').select('*').order('sort_order');
        if (error) throw new Error(error.message);
        _cacheSet('campaigns', data);
        return data;
    },

    async getCategories(campaignId) {
        const key = 'cats:' + campaignId;
        const hit = _cacheGet(key);
        if (hit) return hit;
        const { data, error } = await _sb
            .from('categories').select('*').eq('campaign_id', campaignId).order('sort_order');
        if (error) throw new Error(error.message);
        _cacheSet(key, data);
        return data;
    },

    async getEntries(categoryId) {
        const key = 'ents:' + categoryId;
        const hit = _cacheGet(key);
        if (hit) return hit;
        const { data, error } = await _sb
            .from('entries').select('*').eq('category_id', categoryId).order('sort_order');
        if (error) throw new Error(error.message);
        _cacheSet(key, data);
        return data;
    },

    async getEntry(entryId) {
        const key = 'entry:' + entryId;
        const hit = _cacheGet(key);
        if (hit) return hit;
        const [entRes, blkRes] = await Promise.all([
            _sb.from('entries').select('*').eq('id', entryId).single(),
            _sb.from('blocks').select('*').eq('entry_id', entryId).order('sort_order'),
        ]);
        if (entRes.error) throw new Error(entRes.error.message);
        if (blkRes.error) throw new Error(blkRes.error.message);
        const result = { ...entRes.data, blocks: blkRes.data };
        _cacheSet(key, result);
        return result;
    },

    // ── Write ─────────────────────────────────────────────────────────────────

    async createCampaign(fields) {
        const { data, error } = await _sb.from('campaigns').insert(fields).select().single();
        if (error) throw new Error(error.message);
        _cacheDel('campaigns');
        return data;
    },

    async updateCampaign(id, fields) {
        const { error } = await _sb.from('campaigns').update(fields).eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('campaigns');
    },

    async deleteCampaign(id) {
        const { error } = await _sb.from('campaigns').delete().eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('campaigns');
    },

    async createCategory(campaignId, fields) {
        const { data, error } = await _sb
            .from('categories').insert({ ...fields, campaign_id: campaignId }).select().single();
        if (error) throw new Error(error.message);
        _cacheDel('cats:' + campaignId);
        return data;
    },

    async updateCategory(id, fields) {
        const { data: row } = await _sb.from('categories').select('campaign_id').eq('id', id).single();
        const { error } = await _sb.from('categories').update(fields).eq('id', id);
        if (error) throw new Error(error.message);
        if (row) _cacheDel('cats:' + row.campaign_id);
    },

    async deleteCategory(id) {
        const { data: row } = await _sb.from('categories').select('campaign_id').eq('id', id).single();
        const { error } = await _sb.from('categories').delete().eq('id', id);
        if (error) throw new Error(error.message);
        if (row) _cacheDel('cats:' + row.campaign_id);
    },

    async createEntry(categoryId, fields) {
        const { data, error } = await _sb
            .from('entries').insert({ ...fields, category_id: categoryId }).select().single();
        if (error) throw new Error(error.message);
        _cacheDel('ents:' + categoryId);
        return data;
    },

    async updateEntry(id, fields) {
        const { data: row } = await _sb.from('entries').select('category_id').eq('id', id).single();
        const { error } = await _sb.from('entries').update(fields).eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('entry:' + id);
        if (row) _cacheDel('ents:' + row.category_id);
        // When moving to a different category, also clear the destination cache
        if (fields.category_id && fields.category_id !== row?.category_id) {
            _cacheDel('ents:' + fields.category_id);
        }
    },

    async deleteEntry(id) {
        const { data: row } = await _sb.from('entries').select('category_id').eq('id', id).single();
        const { error } = await _sb.from('entries').delete().eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('entry:' + id);
        if (row) _cacheDel('ents:' + row.category_id);
    },

    // Delete all blocks for an entry then insert the new set.
    // Not a true DB transaction but safe for single-editor use.
    async saveBlocks(entryId, blocks) {
        const { error: delErr } = await _sb.from('blocks').delete().eq('entry_id', entryId);
        if (delErr) throw new Error(delErr.message);
        if (blocks.length > 0) {
            const rows = blocks.map((b, i) => ({
                entry_id:   entryId,
                type:       b.type,
                content:    b.content,
                sort_order: i,
            }));
            const { error: insErr } = await _sb.from('blocks').insert(rows);
            if (insErr) throw new Error(insErr.message);
        }
        _cacheDel('entry:' + entryId);
    },

    // ── Search ────────────────────────────────────────────────────────────────

    async getEntryCount(categoryId) {
        const { count, error } = await _sb
            .from('entries')
            .select('*', { count: 'exact', head: true })
            .eq('category_id', categoryId);
        if (error) throw new Error(error.message);
        return count ?? 0;
    },

    async getCampaignEntryCount(campaignId) {
        const { data: cats } = await _sb.from('categories').select('id').eq('campaign_id', campaignId);
        if (!cats?.length) return 0;
        const { count, error } = await _sb
            .from('entries')
            .select('*', { count: 'exact', head: true })
            .in('category_id', cats.map(c => c.id));
        if (error) return 0;
        return count ?? 0;
    },

    async searchEntries(query) {
        const { data, error } = await _sb
            .from('entries')
            .select('id, name, profile_image, category_id, categories(id, name, campaigns(id, name))')
            .ilike('name', `%${query}%`)
            .order('name')
            .limit(30);
        if (error) throw new Error(error.message);
        return data;
    },

    async searchEntriesInCategories(categoryIds, query) {
        if (!categoryIds.length) return [];
        const { data, error } = await _sb
            .from('entries')
            .select('id, name, profile_image, category_id, categories(id, name)')
            .in('category_id', categoryIds)
            .ilike('name', `%${query}%`)
            .order('name')
            .limit(30);
        if (error) throw new Error(error.message);
        return data;
    },

    // ── Templates ─────────────────────────────────────────────────────────────

    async getTemplates() {
        const hit = _cacheGet('templates');
        if (hit) return hit;
        const { data, error } = await _sb.from('templates').select('*').order('name');
        if (error) throw new Error(error.message);
        _cacheSet('templates', data);
        return data;
    },

    async createTemplate(fields) {
        const { data, error } = await _sb.from('templates').insert(fields).select().single();
        if (error) throw new Error(error.message);
        _cacheDel('templates');
        return data;
    },

    async updateTemplate(id, fields) {
        const { error } = await _sb.from('templates').update(fields).eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('templates');
    },

    async deleteTemplate(id) {
        const { error } = await _sb.from('templates').delete().eq('id', id);
        if (error) throw new Error(error.message);
        _cacheDel('templates');
    },

    // ── Media assets ──────────────────────────────────────────────────────────

    async createMediaAsset({ url, public_id, filename, resource_type, format, bytes, width, height, folder }) {
        const { data, error } = await _sb
            .from('media_assets')
            .insert({ url, public_id, filename: filename || '', resource_type: resource_type || 'image', format, bytes, width, height, folder: folder || 'Uncategorized' })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async getMediaAssets() {
        const { data, error } = await _sb
            .from('media_assets')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data;
    },

    async updateMediaAsset(id, fields) {
        const { error } = await _sb.from('media_assets').update(fields).eq('id', id);
        if (error) throw new Error(error.message);
    },

    async deleteMediaAsset(id) {
        const { error } = await _sb.from('media_assets').delete().eq('id', id);
        if (error) throw new Error(error.message);
    },

    // ── Auth ──────────────────────────────────────────────────────────────────

    async signIn(email, password) {
        const { data, error } = await _sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        return data;
    },

    async signOut() {
        const { error } = await _sb.auth.signOut();
        if (error) throw new Error(error.message);
    },

    // ── AI summarizer (editor-only tables, never cached) ──────────────────────

    // One row per Claude message; message_id makes repeat calls a no-op.
    // cost_usd is computed by the DB.
    async logAiUsage(kind, message) {
        const u = message.usage;
        const { error } = await _sb.from('ai_usage').upsert({
            message_id:         message.id,
            kind,
            batch:              true,
            model:              message.model,
            input_tokens:       u.input_tokens || 0,
            output_tokens:      u.output_tokens || 0,
            cache_write_tokens: u.cache_creation_input_tokens || 0,
            cache_read_tokens:  u.cache_read_input_tokens || 0,
        }, { onConflict: 'message_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
    },

    async getCampaignReference(campaignId) {
        const { data, error } = await _sb
            .from('campaign_references').select('content, updated_at').eq('campaign_id', campaignId).maybeSingle();
        if (error) throw new Error(error.message);
        return data || { content: '', updated_at: null };
    },

    // Previous text is kept automatically by a DB trigger.
    async saveCampaignReference(campaignId, content) {
        const { error } = await _sb
            .from('campaign_references').upsert({ campaign_id: campaignId, content }, { onConflict: 'campaign_id' });
        if (error) throw new Error(error.message);
    },

    async getCampaignReferenceVersions(campaignId) {
        const { data, error } = await _sb
            .from('campaign_reference_versions').select('id, content, created_at')
            .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(20);
        if (error) throw new Error(error.message);
        return data;
    },

    // Latest unfinished summarizer job for a campaign, or null.
    async getOpenSummaryJob(campaignId) {
        const { data, error } = await _sb
            .from('summary_jobs').select('*').eq('campaign_id', campaignId).neq('stage', 'done')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    },

    async createSummaryJob(fields) {
        const { data, error } = await _sb.from('summary_jobs').insert(fields).select().single();
        if (error) throw new Error(error.message);
        return data;
    },

    // Atomic compare-and-set: applies `fields` only if the row still matches
    // `match`. Returns the updated row, or null if another tab got there first.
    async claimSummaryJob(id, match, fields) {
        let q = _sb.from('summary_jobs').update(fields).eq('id', id);
        for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
        const { data, error } = await q.select();
        if (error) throw new Error(error.message);
        return data[0] || null;
    },

    async getSummaryJob(id) {
        const { data, error } = await _sb.from('summary_jobs').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
    },

    async getCanceledSummaryJobs() {
        const { data, error } = await _sb.from('summary_jobs').select('id, stage, batch_id').eq('status', 'canceled');
        if (error) throw new Error(error.message);
        return data;
    },

    async updateSummaryJob(id, fields) {
        const { data, error } = await _sb.from('summary_jobs').update(fields).eq('id', id).select().single();
        if (error) throw new Error(error.message);
        return data;
    },

    async getSession() {
        const { data } = await _sb.auth.getSession();
        return data.session;
    },

    onAuthChange(cb) {
        _sb.auth.onAuthStateChange((_event, session) => cb(session));
    },
};
