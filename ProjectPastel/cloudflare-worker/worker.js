/**
 * Cloudflare Worker — Notion API proxy for Voidverse Wiki
 *
 * Environment variables (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   NOTION_TOKEN        — your Notion integration secret (starts with "secret_...")
 *   DATABASE_ID         — the ID of your Notion wiki database
 *   TWITCH_CLIENT_ID    — Twitch application Client ID (from dev.twitch.tv)
 *   TWITCH_CLIENT_SECRET— Twitch application Client Secret
 *   TWITCH_CHANNEL      — Twitch username to check for live status
 *
 * Endpoints:
 *   GET /campaigns                          → string[]
 *   GET /categories?campaign=X              → string[]
 *   GET /entries?campaign=X&category=Y      → { id, name, profileImage }[]
 *   GET /entry/:id                          → { id, name, campaign, category, profileImage, extraProps, blocks }
 *   GET /twitch-live                        → { live: boolean }
 */

const NOTION_API    = 'https://api.notion.com/v1';
const NOTION_VER    = '2022-06-28';
const CACHE_TTL     = 0; // seconds — set to 300 (5 min) for production, 0 to disable while editing
const RESERVED_PROPS = new Set(['Name', 'Campaign', 'Category', 'Profile Image']);

// ── CORS ───────────────────────────────────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}

function errResp(msg, status = 500) {
    return jsonResp({ error: msg }, status);
}

// ── Notion requests ────────────────────────────────────────────────────────

async function notionFetch(path, options = {}, env) {
    return fetch(`${NOTION_API}${path}`, {
        ...options,
        headers: {
            Authorization:    `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': NOTION_VER,
            'Content-Type':   'application/json',
        },
    });
}

/** Paginate through all results from a database query. */
async function queryAll(filter, env) {
    const results = [];
    let cursor;
    do {
        const body = { page_size: 100 };
        if (filter) body.filter = filter;
        if (cursor)  body.start_cursor = cursor;

        const res = await notionFetch(`/databases/${env.DATABASE_ID}/query`, {
            method: 'POST',
            body:   JSON.stringify(body),
        }, env);

        if (!res.ok) {
            const text = await res.text();
            throw Object.assign(new Error(text), { status: res.status });
        }

        const data = await res.json();
        results.push(...data.results);
        cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    return results;
}

/** Recursively fetch all blocks for a page. */
async function getBlocks(pageId, env) {
    const blocks = [];
    let cursor;
    do {
        const params = new URLSearchParams({ page_size: '100' });
        if (cursor) params.set('start_cursor', cursor);

        const res = await notionFetch(`/blocks/${pageId}/children?${params}`, { method: 'GET' }, env);
        if (!res.ok) {
            const text = await res.text();
            throw Object.assign(new Error(text), { status: res.status });
        }

        const data = await res.json();
        for (const block of data.results) {
            if (block.has_children) {
                block.children = await getBlocks(block.id, env);
            }
            blocks.push(block);
        }
        cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    return blocks;
}

// ── Worker-side cache (Cloudflare Cache API) ───────────────────────────────

async function withCache(cacheKey, ctx, producer) {
    const cache   = caches.default;
    const cacheReq = new Request(`https://notion-wiki-proxy.cache/${cacheKey}`);
    const hit      = await cache.match(cacheReq);

    if (hit) {
        const data = await hit.json();
        return jsonResp(data);
    }

    const data     = await producer();
    const storeRes = new Response(JSON.stringify(data), {
        headers: {
            'Content-Type':  'application/json',
            'Cache-Control': `public, max-age=${CACHE_TTL}`,
        },
    });
    ctx.waitUntil(cache.put(cacheReq, storeRes));
    return jsonResp(data);
}

// ── Property value extractor ───────────────────────────────────────────────

function extractPropValue(prop) {
    if (!prop) return null;
    switch (prop.type) {
        case 'title':        return prop.title?.map(rt => rt.plain_text).join('') || null;
        case 'rich_text':    return prop.rich_text?.map(rt => rt.plain_text).join('') || null;
        case 'select':       return prop.select?.name ?? null;
        case 'multi_select': return prop.multi_select?.map(s => s.name).join(', ') || null;
        case 'number':       return prop.number !== null ? String(prop.number) : null;
        case 'checkbox':     return prop.checkbox ? 'Yes' : 'No';
        case 'date':         return prop.date?.start ?? null;
        case 'url':          return prop.url ?? null;
        case 'email':        return prop.email ?? null;
        case 'phone_number': return prop.phone_number ?? null;
        default:             return null;
    }
}

function extractProfileImage(prop) {
    if (!prop) return '';
    if (prop.type === 'url') return prop.url ?? '';
    if (prop.type === 'files') {
        const f = prop.files?.[0];
        if (!f) return '';
        return f.type === 'external' ? (f.external?.url ?? '') : (f.file?.url ?? '');
    }
    return '';
}

function extractExtraProps(properties) {
    const result = {};
    for (const [key, value] of Object.entries(properties)) {
        if (RESERVED_PROPS.has(key)) continue;
        // Skip file-type props (URLs expire)
        if (value.type === 'files') continue;
        const val = extractPropValue(value);
        if (val !== null && val !== '') result[key] = val;
    }
    return result;
}

// ── Route handlers ─────────────────────────────────────────────────────────

async function handleCampaigns(env, ctx) {
    return withCache('campaigns', ctx, async () => {
        const pages = await queryAll(null, env);
        return [...new Set(
            pages.map(p => extractPropValue(p.properties?.Campaign)).filter(Boolean)
        )].sort();
    });
}

async function handleCategories(campaign, env, ctx) {
    return withCache(`categories:${campaign}`, ctx, async () => {
        const pages = await queryAll({
            property: 'Campaign',
            select:   { equals: campaign },
        }, env);
        return [...new Set(
            pages.map(p => extractPropValue(p.properties?.Category)).filter(Boolean)
        )].sort();
    });
}

async function handleEntries(campaign, category, env, ctx) {
    return withCache(`entries:${campaign}:${category}`, ctx, async () => {
        const pages = await queryAll({
            and: [
                { property: 'Campaign', select: { equals: campaign } },
                { property: 'Category', select: { equals: category } },
            ],
        }, env);
        return pages
            .map(p => ({
                id:           p.id,
                name:         extractPropValue(p.properties?.Name) ?? '',
                profileImage: extractProfileImage(p.properties?.['Profile Image']),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
}

async function handleEntry(pageId, env, ctx) {
    return withCache(`entry:${pageId}`, ctx, async () => {
        const [pageRes, blocks] = await Promise.all([
            notionFetch(`/pages/${pageId}`, { method: 'GET' }, env),
            getBlocks(pageId, env),
        ]);
        if (!pageRes.ok) {
            const text = await pageRes.text();
            throw Object.assign(new Error(text), { status: pageRes.status });
        }
        const page = await pageRes.json();
        const props = page.properties ?? {};
        return {
            id:           page.id,
            name:         extractPropValue(props.Name) ?? '',
            campaign:     extractPropValue(props.Campaign) ?? '',
            category:     extractPropValue(props.Category) ?? '',
            profileImage: extractProfileImage(props['Profile Image']),
            extraProps:   extractExtraProps(props),
            blocks,
        };
    });
}

// ── Twitch helpers ─────────────────────────────────────────────────────────

async function getTwitchToken(env, ctx) {
    const cache    = caches.default;
    const tokenReq = new Request('https://notion-wiki-proxy.cache/twitch-token');
    const hit      = await cache.match(tokenReq);
    if (hit) return (await hit.json()).access_token;

    const resp = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id:     env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type:    'client_credentials',
        }),
    });
    if (!resp.ok) throw new Error(`Twitch token error: ${resp.status}`);
    const data = await resp.json();
    const storeRes = new Response(JSON.stringify(data), {
        headers: {
            'Content-Type':  'application/json',
            'Cache-Control': 'public, max-age=14400', // 4 hours
        },
    });
    ctx.waitUntil(cache.put(tokenReq, storeRes));
    return data.access_token;
}

async function handleTwitchLive(env, ctx) {
    const cache   = caches.default;
    const liveReq = new Request('https://notion-wiki-proxy.cache/twitch-live');
    const hit     = await cache.match(liveReq);
    if (hit) return jsonResp(await hit.json());

    const token  = await getTwitchToken(env, ctx);
    const resp   = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(env.TWITCH_CHANNEL)}`,
        { headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID } }
    );
    if (!resp.ok) throw new Error(`Twitch API error: ${resp.status}`);
    const data   = await resp.json();
    const result = { live: data.data.length > 0 };

    const storeRes = new Response(JSON.stringify(result), {
        headers: {
            'Content-Type':  'application/json',
            'Cache-Control': 'public, max-age=60', // 1 minute
        },
    });
    ctx.waitUntil(cache.put(liveReq, storeRes));
    return jsonResp(result);
}

// ── Supabase keep-alive ────────────────────────────────────────────────────
// Runs on cron schedule to prevent free-tier pausing after 1 week inactivity.
// Requires SUPABASE_URL + SUPABASE_ANON_KEY env vars in Cloudflare dashboard.

async function pingSupabase(env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        console.log('[keep-alive] SUPABASE_URL or SUPABASE_ANON_KEY not set — skipping');
        return;
    }

    const base = env.SUPABASE_URL;
    const headers = {
        apikey:        env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    };
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const pause = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    const sbGet = async path => {
        const r = await fetch(`${base}/rest/v1/${path}`, { headers });
        return r.ok ? r.json() : [];
    };

    // Walk the data tree: campaigns → random categories → random entries → random blocks
    const campaigns = await sbGet('campaigns?select=id,name');
    console.log(`[keep-alive] campaigns → ${campaigns.length} rows`);
    if (!campaigns.length) return;

    const campaign = pick(campaigns);
    await pause();
    const categories = await sbGet(`categories?select=id,name&campaign_id=eq.${campaign.id}`);
    console.log(`[keep-alive] categories for "${campaign.name}" → ${categories.length} rows`);
    if (!categories.length) return;

    let category = pick(categories);
    await pause();
    let entries = await sbGet(`entries?select=id,name&category_id=eq.${category.id}`);
    console.log(`[keep-alive] entries for "${category.name}" → ${entries.length} rows`);
    if (!entries.length) {
        const retry = pick(categories.filter(c => c.id !== category.id));
        if (retry) {
            category = retry;
            await pause();
            entries = await sbGet(`entries?select=id,name&category_id=eq.${category.id}`);
            console.log(`[keep-alive] retry entries for "${category.name}" → ${entries.length} rows`);
        }
        if (!entries.length) return;
    }

    const entry = pick(entries);
    await pause();
    const blocks = await sbGet(`blocks?select=id,type&entry_id=eq.${entry.id}`);
    console.log(`[keep-alive] blocks for "${entry.name}" → ${blocks.length} rows`);
}

// ── Main fetch handler ─────────────────────────────────────────────────────

export default {
    async scheduled(_event, env, _ctx) {
        await pingSupabase(env);
    },

    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }
        if (request.method !== 'GET') {
            return errResp('Method not allowed', 405);
        }

        const url  = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === '/campaigns') {
                return handleCampaigns(env, ctx);
            }

            if (path === '/categories') {
                const campaign = url.searchParams.get('campaign');
                if (!campaign) return errResp('campaign parameter required', 400);
                return handleCategories(campaign, env, ctx);
            }

            if (path === '/entries') {
                const campaign = url.searchParams.get('campaign');
                const category = url.searchParams.get('category');
                if (!campaign || !category) return errResp('campaign and category required', 400);
                return handleEntries(campaign, category, env, ctx);
            }

            const entryMatch = path.match(/^\/entry\/([a-zA-Z0-9-]+)$/);
            if (entryMatch) {
                return handleEntry(entryMatch[1], env, ctx);
            }

            if (path === '/twitch-live') {
                if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TWITCH_CHANNEL) {
                    return jsonResp({ live: false });
                }
                return handleTwitchLive(env, ctx);
            }

            return errResp('Not found', 404);
        } catch (err) {
            if (err.status === 429) return errResp('Rate limited by Notion API', 429);
            if (err.status)        return errResp(err.message, err.status);
            console.error(err);
            return errResp('Internal server error');
        }
    },
};
