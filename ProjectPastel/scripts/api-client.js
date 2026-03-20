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

    async getSession() {
        const { data } = await _sb.auth.getSession();
        return data.session;
    },

    onAuthChange(cb) {
        _sb.auth.onAuthStateChange((_event, session) => cb(session));
    },
};
