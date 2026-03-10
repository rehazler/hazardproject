// ── Configuration ─────────────────────────────────────────────────────────
// Replace with your deployed Cloudflare Worker URL after deployment.
// e.g. 'https://notion-wiki.your-name.workers.dev'
const WORKER_URL = 'https://old-bush-385d.hazardousmadness.workers.dev';

// Client-side cache lifetime (ms). Set to 0 to disable (useful while editing content).
// Restore to 5 * 60 * 1000 (5 minutes) for production use.
const CACHE_TTL = 0;
const CACHE_NS  = 'notion-wiki-v2';

// ── localStorage cache with TTL ────────────────────────────────────────────

function cacheGet(key) {
    try {
        const raw = localStorage.getItem(`${CACHE_NS}:${key}`);
        if (!raw) return null;
        const { data, exp } = JSON.parse(raw);
        if (Date.now() > exp) { localStorage.removeItem(`${CACHE_NS}:${key}`); return null; }
        return data;
    } catch { return null; }
}

function cacheSet(key, data) {
    try {
        localStorage.setItem(`${CACHE_NS}:${key}`, JSON.stringify({
            data, exp: Date.now() + CACHE_TTL,
        }));
    } catch {} // storage full — silently ignore
}

// ── Request deduplication ──────────────────────────────────────────────────
// If the same key is already in-flight, return the existing promise
// instead of firing a second request.

const inflight = {};

function dedupe(key, fetcher) {
    if (inflight[key]) return inflight[key];
    inflight[key] = fetcher().finally(() => delete inflight[key]);
    return inflight[key];
}

// ── API ────────────────────────────────────────────────────────────────────

class RateLimitError extends Error {}

async function apiFetch(path) {
    const res = await fetch(`${WORKER_URL}${path}`);
    if (res.status === 429) {
        throw new RateLimitError(
            'The wiki is receiving too many requests right now. Please wait a moment and try again.'
        );
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

async function fetchCampaigns() {
    const cached = cacheGet('campaigns');
    if (cached) return cached;
    return dedupe('campaigns', async () => {
        const data = await apiFetch('/campaigns');
        cacheSet('campaigns', data);
        return data;
    });
}

async function fetchCategories(campaign) {
    const key    = `categories:${campaign}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    return dedupe(key, async () => {
        const data = await apiFetch(`/categories?campaign=${encodeURIComponent(campaign)}`);
        cacheSet(key, data);
        return data;
    });
}

async function fetchEntries(campaign, category) {
    const key    = `entries:${campaign}:${category}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    return dedupe(key, async () => {
        const data = await apiFetch(
            `/entries?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(category)}`
        );
        cacheSet(key, data);
        return data;
    });
}

async function fetchEntry(id) {
    const key    = `entry:${id}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    return dedupe(key, async () => {
        const data = await apiFetch(`/entry/${encodeURIComponent(id)}`);
        cacheSet(key, data);
        return data;
    });
}

// ── HTML helpers ───────────────────────────────────────────────────────────

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeURL(url) {
    const s = String(url ?? '');
    return /^https?:\/\//.test(s) ? s : '';
}

function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

// ── Recently Viewed ────────────────────────────────────────────────────────

const RV_KEY = 'notion-wiki-recently-viewed';
const RV_MAX = 5;

function getRecentlyViewed() {
    try { return JSON.parse(localStorage.getItem(RV_KEY) ?? '[]'); } catch { return []; }
}

function addRecentlyViewed(campaign, category, id, name) {
    const items = getRecentlyViewed().filter(x => x.id !== id);
    items.unshift({ campaign, category, id, name });
    try { localStorage.setItem(RV_KEY, JSON.stringify(items.slice(0, RV_MAX))); } catch {}
}

// ── Category icons ─────────────────────────────────────────────────────────
// Rules are checked top-to-bottom; first match wins.
// Single-word keywords match whole words in the category name.
// Multi-word keywords (containing a space) match as a substring of the full name.
// Add rows here to cover new category naming conventions.

const CAT_ICON_RULES = [
    { keywords: ['player character', 'player characters'], icon: '🎲' },
    { keywords: ['art', 'artwork', 'gallery'],             icon: '🎨' },
    { keywords: ['npc', 'npcs', 'person', 'people'], icon: '👤' },
    { keywords: ['location', 'locations', 'place', 'places', 'region', 'area'], icon: '🗺️' },
    { keywords: ['event', 'events'],                       icon: '🎭' },
    { keywords: ['recap', 'recaps', 'session', 'sessions'], icon: '📜' },
    { keywords: ['lore', 'history'],                       icon: '📖' },
    { keywords: ['faction', 'factions', 'guild', 'guilds', 'organisation', 'organisations', 'organization', 'organizations'], icon: '⚔️' },
    { keywords: ['item', 'items', 'artifact', 'artifacts', 'equipment', 'relic', 'relics'], icon: '💎' },
    { keywords: ['monster', 'monsters', 'creature', 'creatures', 'bestiary'], icon: '👹' },
    { keywords: ['god', 'gods', 'deity', 'deities', 'religion'],              icon: '✨' },
    { keywords: ['player', 'players', 'pc', 'pcs', 'character', 'characters' ],        icon: '🎲' },
    { keywords: ['quest', 'quests', 'mission', 'missions'], icon: '📋' },
    { keywords: ['magic', 'spell', 'spells'],               icon: '🔮' },
    { keywords: ['world', 'plane', 'planes'],               icon: '🌍' },
];

function getCatIcon(name) {
    const lower = name.toLowerCase();
    const words = lower.split(/\W+/);
    for (const rule of CAT_ICON_RULES) {
        if (rule.keywords.some(kw =>
            kw.includes(' ') ? lower.includes(kw) : words.includes(kw)
        )) return rule.icon;
    }
    return '◆';
}

// ── Notion block renderer ──────────────────────────────────────────────────

function renderRichText(richText) {
    return (richText ?? []).map(rt => {
        let text = escapeHTML(rt.plain_text);
        const a  = rt.annotations ?? {};
        if (a.bold)          text = `<strong>${text}</strong>`;
        if (a.italic)        text = `<em>${text}</em>`;
        if (a.strikethrough) text = `<s>${text}</s>`;
        if (a.underline)     text = `<u>${text}</u>`;
        if (a.code)          text = `<code>${text}</code>`;
        if (rt.href)         text = `<a href="${escapeHTML(rt.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        return text;
    }).join('');
}

function renderBlocks(blocks) {
    let html     = '';
    let listType = null; // 'ul' | 'ol' | null

    function flushList() {
        if (!listType) return;
        html    += `</${listType}>`;
        listType = null;
    }

    for (const block of (blocks ?? [])) {
        const t = block.type;

        // Close any open list if this block isn't a list item
        if (t !== 'bulleted_list_item' && t !== 'numbered_list_item') flushList();

        switch (t) {
            case 'paragraph': {
                const p = renderRichText(block.paragraph.rich_text);
                if (p) html += `<p>${p}</p>`;
                break;
            }

            case 'bulleted_list_item':
                if (listType !== 'ul') { flushList(); html += '<ul>'; listType = 'ul'; }
                html += `<li>${renderRichText(block.bulleted_list_item.rich_text)}${
                    block.children ? renderBlocks(block.children) : ''
                }</li>`;
                break;

            case 'numbered_list_item':
                if (listType !== 'ol') { flushList(); html += '<ol>'; listType = 'ol'; }
                html += `<li>${renderRichText(block.numbered_list_item.rich_text)}${
                    block.children ? renderBlocks(block.children) : ''
                }</li>`;
                break;

            case 'image': {
                const imgSrc = safeURL(
                    block.image.type === 'external'
                        ? block.image.external?.url
                        : block.image.file?.url
                );
                const cap = renderRichText(block.image.caption);
                html += `<figure>
                    <img src="${escapeHTML(imgSrc)}" alt="${escapeHTML(block.image.caption?.[0]?.plain_text ?? 'image')}" style="max-width:100%;">
                    ${cap ? `<figcaption>${cap}</figcaption>` : ''}
                </figure>`;
                break;
            }

            case 'divider':
                html += '<hr>';
                break;

            case 'quote':
                html += `<blockquote>${renderRichText(block.quote.rich_text)}</blockquote>`;
                break;

            case 'callout': {
                const icon = block.callout.icon?.emoji ?? '';
                html += `<div class="notion-callout">
                    ${icon ? `<span class="notion-callout-icon">${icon}</span>` : ''}
                    <div>${renderRichText(block.callout.rich_text)}</div>
                </div>`;
                break;
            }

            case 'table': {
                html += '<table class="notion-table">';
                (block.children ?? []).forEach((row, i) => {
                    const isHeader = block.table.has_column_header && i === 0;
                    const tag      = isHeader ? 'th' : 'td';
                    html += '<tr>' + (row.table_row?.cells ?? []).map(cell =>
                        `<${tag}>${renderRichText(cell)}</${tag}>`
                    ).join('') + '</tr>';
                });
                html += '</table>';
                break;
            }

            case 'column_list':
                html += `<div class="notion-columns">${
                    (block.children ?? []).map(col =>
                        `<div class="notion-column">${renderBlocks(col.children ?? [])}</div>`
                    ).join('')
                }</div>`;
                break;

            // Toggles — collapsible sections (great for backstory, spoilers, etc.)
            case 'toggle': {
                const summary = renderRichText(block.toggle.rich_text);
                html += `<details class="notion-toggle" open>
                    <summary>${summary}</summary>
                    <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                </details>`;
                break;
            }

            // Heading toggles (Notion lets headings be toggleable)
            case 'heading_1':
                if (block.heading_1.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h2" open>
                        <summary><h2>${renderRichText(block.heading_1.rich_text)}</h2></summary>
                        <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                    </details>`;
                } else {
                    html += `<h2>${renderRichText(block.heading_1.rich_text)}</h2>`;
                }
                break;

            case 'heading_2':
                if (block.heading_2.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h3" open>
                        <summary><h3>${renderRichText(block.heading_2.rich_text)}</h3></summary>
                        <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                    </details>`;
                } else {
                    html += `<h3>${renderRichText(block.heading_2.rich_text)}</h3>`;
                }
                break;

            case 'heading_3':
                if (block.heading_3.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h4" open>
                        <summary><h4>${renderRichText(block.heading_3.rich_text)}</h4></summary>
                        <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                    </details>`;
                } else {
                    html += `<h4>${renderRichText(block.heading_3.rich_text)}</h4>`;
                }
                break;

            // Audio — voicelines, sound clips
            case 'audio': {
                const audioSrc = safeURL(
                    block.audio.type === 'external'
                        ? block.audio.external?.url
                        : block.audio.file?.url
                );
                const audioCap = renderRichText(block.audio.caption);
                if (audioSrc) {
                    html += `<div class="notion-audio-player" data-src="${escapeHTML(audioSrc)}">
                        <button class="notion-audio-btn" aria-label="Play audio">▶</button>
                        ${audioCap ? `<span class="notion-audio-caption">${audioCap}</span>` : ''}
                    </div>`;
                }
                break;
            }

            // Video — session highlights, cutscenes
            case 'video': {
                const videoSrc = block.video.type === 'external'
                    ? block.video.external?.url
                    : block.video.file?.url;
                const videoCap = renderRichText(block.video.caption);
                const ytMatch  = videoSrc?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (ytMatch) {
                    html += `<figure class="notion-video">
                        <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen
                            style="width:100%;aspect-ratio:16/9;border-radius:4px;"></iframe>
                        ${videoCap ? `<figcaption>${videoCap}</figcaption>` : ''}
                    </figure>`;
                } else if (safeURL(videoSrc)) {
                    html += `<figure class="notion-video">
                        <video controls src="${escapeHTML(safeURL(videoSrc))}" style="max-width:100%;border-radius:4px;"></video>
                        ${videoCap ? `<figcaption>${videoCap}</figcaption>` : ''}
                    </figure>`;
                }
                break;
            }

            // Embeds — YouTube, Spotify, SoundCloud, etc.
            case 'embed': {
                const embedSrc = block.embed?.url ?? '';
                const embedCap = renderRichText(block.embed?.caption ?? []);
                const ytEmbed  = embedSrc.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (ytEmbed) {
                    html += `<figure class="notion-video">
                        <iframe src="https://www.youtube.com/embed/${ytEmbed[1]}" frameborder="0" allowfullscreen
                            style="width:100%;aspect-ratio:16/9;border-radius:4px;"></iframe>
                        ${embedCap ? `<figcaption>${embedCap}</figcaption>` : ''}
                    </figure>`;
                } else if (safeURL(embedSrc)) {
                    html += `<figure class="notion-embed">
                        <iframe src="${escapeHTML(safeURL(embedSrc))}" frameborder="0"
                            style="width:100%;min-height:300px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);"></iframe>
                        ${embedCap ? `<figcaption>${embedCap}</figcaption>` : ''}
                    </figure>`;
                }
                break;
            }

            // Bookmarks — artist credits, external links, references
            case 'bookmark':
            case 'link_preview': {
                const bmUrl = safeURL(block[t]?.url ?? '');
                const bmCap = renderRichText(block[t]?.caption ?? []);
                if (bmUrl) {
                    html += `<div class="notion-bookmark">
                        <a href="${escapeHTML(bmUrl)}" target="_blank" rel="noopener noreferrer">
                            ${bmCap || escapeHTML(bmUrl)}
                        </a>
                    </div>`;
                }
                break;
            }
        }
    }

    flushList();
    return html;
}

// ── Nav helpers ────────────────────────────────────────────────────────────

function makeBackButton(label, onClick) {
    const btn = document.createElement('button');
    btn.id = 'back-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function makeBreadcrumb(crumbs) {
    const nav = document.createElement('nav');
    nav.id    = 'wiki-breadcrumb';
    nav.innerHTML = crumbs.map((c, i) =>
        i < crumbs.length - 1
            ? `<a href="#" data-crumb="${i}">${escapeHTML(c.label)}</a>`
            : `<span>${escapeHTML(c.label)}</span>`
    ).join(' › ');
    crumbs.forEach((c, i) => {
        if (i < crumbs.length - 1) {
            nav.querySelectorAll('[data-crumb]')[i]?.addEventListener('click', e => {
                e.preventDefault();
                c.onClick();
            });
        }
    });
    return nav;
}

function showLoading(msg = 'Loading…') {
    document.getElementById('wiki-container').innerHTML = `
        <div class="wiki-loading">
            <div class="wiki-spinner"></div>
            <p>${escapeHTML(msg)}</p>
        </div>`;
}

function showError(msg, isRateLimit = false) {
    document.getElementById('wiki-container').innerHTML = `
        <div class="wiki-error">
            <p>${escapeHTML(msg)}</p>
            ${isRateLimit
                ? '<p class="wiki-error-hint">Wiki data is temporarily unavailable due to high traffic. Please refresh in a minute.</p>'
                : ''}
        </div>`;
}

// ── Extra props processor ──────────────────────────────────────────────────
// Naming convention (set in Notion):
//   • ALL CAPS name (no lowercase letters) → stat attribute box  e.g. RACE, HP, AC
//   • Mixed/lowercase name                 → body key-value row  e.g. Alignment, Height
//   • Optional numeric prefix for sort order (stripped on display):
//       "01 RACE", "02 CLASS", "01 Alignment", "02 Background"
//     Unprefixed properties sort alphabetically after all numbered ones.

const PROP_PREFIX_RE = /^(\d+)\s+(.+)$/;

function processExtraProps(extraProps) {
    const entries = Object.entries(extraProps ?? {}).map(([rawKey, value]) => {
        const m     = PROP_PREFIX_RE.exec(rawKey);
        const order = m ? parseInt(m[1], 10) : Infinity;
        const key   = m ? m[2] : rawKey;
        const isStat = /^[^a-z]+$/.test(key); // no lowercase → stat attr
        return { order, key, value, isStat };
    });
    entries.sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.key.localeCompare(b.key)
    );
    return {
        stats: entries.filter(e => e.isStat),
        body:  entries.filter(e => !e.isStat),
    };
}

// ── Stat block renderer ────────────────────────────────────────────────────

function renderStatBlock(entry, category) {
    const { stats, body } = processExtraProps(entry.extraProps);

    const attrsHtml = stats.length ? `
        <div class="stat-attrs">
            ${stats.map(({ key, value }) =>
                `<div><span>${escapeHTML(key)}</span><strong>${escapeHTML(String(value))}</strong></div>`
            ).join('')}
        </div>
        <hr class="stat-rule">
    ` : '';

    const bodyHtml = body.map(({ key, value }) =>
        `<p><strong>${escapeHTML(key)}:</strong> ${escapeHTML(String(value))}</p>`
    ).join('');

    const blocksHtml = entry.blocks?.length
        ? `<hr class="stat-rule">${renderBlocks(entry.blocks)}`
        : '';

    const imgHtml = entry.profileImage
        ? `<img src="${escapeHTML(safeURL(entry.profileImage))}" alt="${escapeHTML(entry.name)}"
               class="wiki-zoomable" style="max-width:140px;float:right;margin:0 0 12px 16px;border-radius:6px;cursor:zoom-in;">`
        : '';

    return `<div class="stat-block">
        ${imgHtml}
        <h3 class="stat-block-name">${escapeHTML(entry.name)}</h3>
        <p class="stat-block-type">${escapeHTML(category)}</p>
        <hr class="stat-rule">
        ${attrsHtml}
        ${bodyHtml}
        ${blocksHtml}
    </div>`;
}

// ── Views ──────────────────────────────────────────────────────────────────

async function showCampaignList() {
    showLoading('Loading campaigns…');
    const container = document.getElementById('wiki-container');
    try {
        const campaigns = await fetchCampaigns();
        container.innerHTML = '';

        // Global search button
        const gsBtn = document.createElement('button');
        gsBtn.className = 'wiki-global-search-btn';
        gsBtn.innerHTML = '<img src="Assets/TransparentIcons/Crystal_Ball_18x18.png" alt="" class="wiki-search-icon" style="width:18px;height:18px;vertical-align:middle;;margin-bottom:3px;border:none;border-radius:0;"> Search All Campaigns';
        gsBtn.addEventListener('click', () => { history.pushState(null, '', '?search=1'); showGlobalSearch(); });
        container.appendChild(gsBtn);

        // Recently viewed
        const rv = getRecentlyViewed();
        if (rv.length) {
            const rvSection = document.createElement('div');
            rvSection.className = 'wiki-recently-viewed';
            rvSection.innerHTML = '<h3>Recently Viewed</h3>';
            const rvList = document.createElement('ul');
            rv.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<a href="?campaign=${encodeURIComponent(item.campaign)}&category=${encodeURIComponent(item.category)}&entry=${encodeURIComponent(item.id)}"
                    data-id="${escapeHTML(item.id)}" data-campaign="${escapeHTML(item.campaign)}"
                    data-category="${escapeHTML(item.category)}" data-name="${escapeHTML(item.name)}">
                    <span class="rv-name">${escapeHTML(item.name)}</span>
                    <span class="rv-path">${escapeHTML(item.campaign)} › ${escapeHTML(item.category)}</span>
                </a>`;
                rvList.appendChild(li);
            });
            rvSection.appendChild(rvList);
            container.appendChild(rvSection);
            rvSection.querySelectorAll('[data-id]').forEach(link => {
                link.addEventListener('click', e => {
                    e.preventDefault();
                    const a = e.target.closest('[data-id]');
                    history.pushState(null, '', `?campaign=${encodeURIComponent(a.dataset.campaign)}&category=${encodeURIComponent(a.dataset.category)}&entry=${encodeURIComponent(a.dataset.id)}`);
                    showEntryDetail(a.dataset.campaign, a.dataset.category, a.dataset.id, a.dataset.name);
                });
            });
        }

        const sectionTitle = document.createElement('h3');
        sectionTitle.className = 'wiki-section-title';
        sectionTitle.textContent = 'Select a Campaign';
        container.appendChild(sectionTitle);

        const grid = document.createElement('div');
        grid.className = 'wiki-campaign-cards';
        container.appendChild(grid);

        campaigns.forEach(name => {
            const card = document.createElement('a');
            card.className = 'wiki-campaign-card';
            card.href = `?campaign=${encodeURIComponent(name)}`;
            card.innerHTML = `
                <span class="quest-rank">◆</span>
                <div class="quest-info">
                    <span class="quest-title">${escapeHTML(name)}</span>
                    <span class="quest-desc wiki-cat-count" data-campaign="${escapeHTML(name)}">Loading…</span>
                </div>
                <span class="quest-arrow">→</span>
            `;
            card.addEventListener('click', e => {
                e.preventDefault();
                history.pushState(null, '', `?campaign=${encodeURIComponent(name)}`);
                showCategoryList(name);
            });
            grid.appendChild(card);
        });

        // Lazy-load category counts
        grid.querySelectorAll('.wiki-cat-count').forEach(async el => {
            try {
                const cats = await fetchCategories(el.dataset.campaign);
                el.textContent = `${cats.length} ${cats.length === 1 ? 'category' : 'categories'}`;
            } catch { el.textContent = ''; }
        });
    } catch (err) {
        showError(err.message, err instanceof RateLimitError);
    }
}

async function showCategoryList(campaign) {
    showLoading(`Loading ${campaign}…`);
    const container = document.getElementById('wiki-container');

    const goToCampaigns = () => {
        history.pushState(null, '', window.location.pathname);
        showCampaignList();
    };

    try {
        const categories = await fetchCategories(campaign);

        container.innerHTML = '';
        container.appendChild(makeBreadcrumb([
            { label: 'Campaigns', onClick: goToCampaigns },
            { label: campaign },
        ]));
        container.appendChild(makeBackButton('← Back to Campaigns', goToCampaigns));

        const title = document.createElement('h1');
        title.textContent = campaign;
        container.appendChild(title);

        if (!categories.length) {
            container.appendChild(Object.assign(document.createElement('p'), { textContent: 'No categories found.' }));
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'wiki-cat-grid';
        categories.forEach(cat => {
            const pill = document.createElement('a');
            pill.className = 'wiki-cat-pill';
            pill.href = `?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(cat)}`;
            pill.innerHTML = `
                <span class="wiki-cat-icon">${getCatIcon(cat)}</span>
                <span class="wiki-cat-name">${escapeHTML(cat)}</span>
                <span class="wiki-cat-count-badge" data-campaign="${escapeHTML(campaign)}" data-category="${escapeHTML(cat)}"></span>
            `;
            pill.addEventListener('click', e => {
                e.preventDefault();
                history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(cat)}`);
                showEntryList(campaign, cat);
            });
            grid.appendChild(pill);
        });
        container.appendChild(grid);

        // Lazy-load entry counts
        grid.querySelectorAll('.wiki-cat-count-badge').forEach(async badge => {
            try {
                const entries = await fetchEntries(badge.dataset.campaign, badge.dataset.category);
                badge.textContent = entries.length;
            } catch { badge.textContent = ''; }
        });
    } catch (err) {
        showError(err.message, err instanceof RateLimitError);
    }
}

async function showEntryList(campaign, category) {
    showLoading(`Loading ${category}…`);
    const container = document.getElementById('wiki-container');

    const goToCampaigns  = () => { history.pushState(null, '', window.location.pathname); showCampaignList(); };
    const goToCategories = () => { history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}`); showCategoryList(campaign); };

    try {
        const entries = await fetchEntries(campaign, category);

        container.innerHTML = '';
        container.appendChild(makeBreadcrumb([
            { label: 'Campaigns', onClick: goToCampaigns },
            { label: campaign,    onClick: goToCategories },
            { label: category },
        ]));
        container.appendChild(makeBackButton(`← Back to ${campaign}`, goToCategories));

        const title = document.createElement('h1');
        title.textContent = category;
        container.appendChild(title);

        if (!entries.length) {
            container.appendChild(Object.assign(document.createElement('p'), { textContent: `No entries in ${category}.` }));
            return;
        }

        // Search bar
        const searchWrap = document.createElement('div');
        searchWrap.className = 'wiki-search-wrap';
        const searchIcon = new Image();
        searchIcon.src = 'Assets/TransparentIcons/Crystal_Ball_18x18.png';
        searchIcon.className = 'wiki-search-icon';
        searchIcon.alt = '';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'wiki-search-bar';
        searchInput.placeholder = `Search ${category}…`;
        searchInput.dataset.wikiSearch = '1';
        searchWrap.appendChild(searchIcon);
        searchWrap.appendChild(searchInput);
        container.appendChild(searchWrap);

        const list = document.createElement('ul');
        list.id = 'sheet-list';
        container.appendChild(list);

        function render(filter = '') {
            list.innerHTML = '';
            entries
                .filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
                .forEach(entry => {
                    const li = document.createElement('li');
                    li.innerHTML = `<a href="?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(category)}&entry=${encodeURIComponent(entry.id)}"
                        data-id="${escapeHTML(entry.id)}" data-name="${escapeHTML(entry.name)}">
                        ${entry.profileImage ? `<img class="wiki-entry-thumb" src="${escapeHTML(safeURL(entry.profileImage))}" alt="">` : ''}
                        <span>${escapeHTML(entry.name)}</span>
                    </a>`;
                    list.appendChild(li);
                });
            list.querySelectorAll('[data-id]').forEach(link => {
                link.addEventListener('click', e => {
                    e.preventDefault();
                    const a    = e.target.closest('[data-id]');
                    const id   = a.getAttribute('data-id');
                    const name = a.getAttribute('data-name');
                    history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(category)}&entry=${encodeURIComponent(id)}`);
                    showEntryDetail(campaign, category, id, name);
                });
            });
        }

        render();
        searchInput.addEventListener('input', e => render(e.target.value));
    } catch (err) {
        showError(err.message, err instanceof RateLimitError);
    }
}

async function showEntryDetail(campaign, category, entryId, entryName) {
    if (!entryName) {
        const cached = cacheGet(`entries:${campaign}:${category}`);
        entryName = cached?.find(e => e.id === entryId)?.name;
    }
    showLoading(entryName ? `Loading ${entryName}…` : 'Loading…');
    const container = document.getElementById('wiki-container');

    const goToCampaigns  = () => { history.pushState(null, '', window.location.pathname); showCampaignList(); };
    const goToCategories = () => { history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}`); showCategoryList(campaign); };
    const goToEntries    = () => { history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(category)}`); showEntryList(campaign, category); };

    try {
        const entry = await fetchEntry(entryId);
        addRecentlyViewed(campaign, category, entryId, entry.name);
        const hasProfile = entry.profileImage || Object.keys(entry.extraProps ?? {}).length > 0;

        container.innerHTML = '';
        container.appendChild(makeBreadcrumb([
            { label: 'Campaigns', onClick: goToCampaigns },
            { label: campaign,    onClick: goToCategories },
            { label: category,    onClick: goToEntries },
            { label: entry.name },
        ]));
        // Back + toggle row
        let statView = false;
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'wiki-view-btn';
        toggleBtn.textContent = '◆ Stat Block View';

        const btnRow = document.createElement('div');
        btnRow.className = 'wiki-entry-btns';
        btnRow.appendChild(makeBackButton(`← Back to ${category}`, goToEntries));
        btnRow.appendChild(toggleBtn);
        container.appendChild(btnRow);

        let currentSection = null;

        function buildSection() {
            if (currentSection) currentSection.remove();
            currentSection = document.createElement('section');
            if (statView) {
                currentSection.innerHTML = `
                    <h2>${escapeHTML(entry.name)}</h2>
                    ${renderStatBlock(entry, category)}
                `;
            } else {
                currentSection.innerHTML = `
                    <h2>${escapeHTML(entry.name)}</h2>
                    <div class="wiki-entry-layout">
                        <div class="wiki-entry-main">
                            ${entry.blocks?.length
                                ? renderBlocks(entry.blocks)
                                : '<p style="color:#aaa;font-style:italic;">No content yet.</p>'}
                        </div>
                        ${hasProfile ? `
                        <div class="wiki-entry-sidebar">
                            <h3>${escapeHTML(entry.name)}</h3>
                            ${entry.profileImage
                                ? `<img src="${escapeHTML(safeURL(entry.profileImage))}" alt="${escapeHTML(entry.name)}" class="wiki-zoomable" style="max-width:100%;margin-bottom:1rem;cursor:zoom-in;">`
                                : ''}
                            ${Object.keys(entry.extraProps ?? {}).length ? (() => {
                                const { stats, body } = processExtraProps(entry.extraProps);
                                const all = [...stats, ...body];
                                return `<table style="width:100%;border:1px solid #ccc;text-align:left;margin-bottom:1rem;table-layout:fixed;word-break:break-word;overflow-wrap:break-word;">
                                    ${all.map(({ key, value }) => `
                                        <tr>
                                            <td style="width:40%;font-weight:bold;padding:4px 6px;vertical-align:top;">${escapeHTML(key)}</td>
                                            <td style="padding:4px 6px;vertical-align:top;">${escapeHTML(String(value))}</td>
                                        </tr>
                                    `).join('')}
                                </table>`;
                            })() : ''}
                        </div>` : ''}
                    </div>
                `;
            }
            container.appendChild(currentSection);
        }

        buildSection();

        toggleBtn.addEventListener('click', () => {
            statView = !statView;
            toggleBtn.textContent = statView ? '◆ Normal View' : '◆ Stat Block View';
            toggleBtn.classList.toggle('active', statView);
            buildSection();
        });
    } catch (err) {
        showError(err.message, err instanceof RateLimitError);
    }
}

// ── Global Search ──────────────────────────────────────────────────────────

async function showGlobalSearch() {
    const container = document.getElementById('wiki-container');
    const goToCampaigns = () => {
        history.pushState(null, '', window.location.pathname);
        showCampaignList();
    };

    container.innerHTML = '';
    container.appendChild(makeBackButton('← Back to Campaigns', goToCampaigns));

    const title = document.createElement('h2');
    title.textContent = 'Search All Campaigns';
    container.appendChild(title);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'wiki-search-wrap';
    const searchIcon = new Image();
    searchIcon.src = 'Assets/TransparentIcons/Crystal_Ball_18x18.png';
    searchIcon.className = 'wiki-search-icon';
    searchIcon.alt = '';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'wiki-search-bar';
    searchInput.placeholder = 'Search across all campaigns…';
    searchInput.dataset.wikiSearch = '1';
    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    const resultsEl = document.createElement('div');
    resultsEl.id = 'global-search-results';
    resultsEl.innerHTML = '<p style="color:#aaa;font-style:italic;">Type at least 2 characters to search…</p>';
    container.appendChild(resultsEl);

    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) {
            resultsEl.innerHTML = '<p style="color:#aaa;font-style:italic;">Type at least 2 characters to search…</p>';
            return;
        }
        resultsEl.innerHTML = '<p style="color:#aaa;font-style:italic;">Searching…</p>';
        debounceTimer = setTimeout(() => doGlobalSearch(q, resultsEl), 400);
    });

    searchInput.focus();
}

async function doGlobalSearch(query, resultsEl) {
    try {
        const campaigns = await fetchCampaigns();
        const q = query.toLowerCase();
        const catsByC = await Promise.all(
            campaigns.map(c =>
                fetchCategories(c).then(cats => ({ campaign: c, cats })).catch(() => ({ campaign: c, cats: [] }))
            )
        );
        const allEntries = [];
        await Promise.all(
            catsByC.map(({ campaign, cats }) =>
                Promise.all(
                    cats.map(cat =>
                        fetchEntries(campaign, cat)
                            .then(entries => entries.forEach(e => allEntries.push({ ...e, campaign, category: cat })))
                            .catch(() => {})
                    )
                )
            )
        );
        const matches = allEntries.filter(e => e.name.toLowerCase().includes(q));

        if (!matches.length) {
            resultsEl.innerHTML = `<p style="color:#aaa;font-style:italic;">No results for "${escapeHTML(query)}".</p>`;
            return;
        }

        const countEl = document.createElement('p');
        countEl.style.cssText = 'color:#98e6d6;margin-bottom:8px;';
        countEl.textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''}`;

        const list = document.createElement('ul');
        list.id = 'sheet-list';
        matches.forEach(entry => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="?campaign=${encodeURIComponent(entry.campaign)}&category=${encodeURIComponent(entry.category)}&entry=${encodeURIComponent(entry.id)}"
                data-id="${escapeHTML(entry.id)}" data-name="${escapeHTML(entry.name)}"
                data-campaign="${escapeHTML(entry.campaign)}" data-category="${escapeHTML(entry.category)}">
                ${entry.profileImage ? `<img class="wiki-entry-thumb" src="${escapeHTML(safeURL(entry.profileImage))}" alt="">` : ''}
                <span>${escapeHTML(entry.name)}</span>
                <span class="rv-path">${escapeHTML(entry.campaign)} › ${escapeHTML(entry.category)}</span>
            </a>`;
            list.appendChild(li);
        });

        resultsEl.innerHTML = '';
        resultsEl.appendChild(countEl);
        resultsEl.appendChild(list);

        list.querySelectorAll('[data-id]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const a = e.target.closest('[data-id]');
                history.pushState(null, '', `?campaign=${encodeURIComponent(a.dataset.campaign)}&category=${encodeURIComponent(a.dataset.category)}&entry=${encodeURIComponent(a.dataset.id)}`);
                showEntryDetail(a.dataset.campaign, a.dataset.category, a.dataset.id, a.dataset.name);
            });
        });
    } catch (err) {
        resultsEl.innerHTML = `<p style="color:#f3b0c3;">Error: ${escapeHTML(err.message)}</p>`;
    }
}

// ── Lightbox ───────────────────────────────────────────────────────────────

let _lightbox = null;

function getLightbox() {
    if (_lightbox) return _lightbox;
    _lightbox = document.createElement('div');
    _lightbox.id = 'wiki-lightbox';
    const img = document.createElement('img');
    _lightbox.appendChild(img);
    // Click overlay to close; click image itself does nothing (stop propagation)
    _lightbox.addEventListener('click', () => _lightbox.classList.remove('open'));
    img.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') _lightbox.classList.remove('open');
    });
    document.body.appendChild(_lightbox);
    return _lightbox;
}

function openLightbox(src, alt) {
    const lb  = getLightbox();
    const img = lb.querySelector('img');
    img.src = src;
    img.alt = alt;
    lb.classList.add('open');
}

// ── Router ─────────────────────────────────────────────────────────────────

function route() {
    const campaign = getParam('campaign');
    const category = getParam('category');
    const entry    = getParam('entry');
    const search   = getParam('search');

    if (campaign && category && entry) showEntryDetail(campaign, category, entry);
    else if (campaign && category)     showEntryList(campaign, category);
    else if (campaign)                 showCategoryList(campaign);
    else if (search)                   showGlobalSearch();
    else                               showCampaignList();
}

document.addEventListener('DOMContentLoaded', () => {
    route();
    document.getElementById('wiki-container')?.addEventListener('click', e => {
        // Lightbox
        const img = e.target.closest('img.wiki-zoomable');
        if (img) { e.preventDefault(); openLightbox(img.src, img.alt); }

        // Themed audio player
        const btn = e.target.closest('.notion-audio-btn');
        if (!btn) return;
        const player = btn.closest('.notion-audio-player');
        const src = player?.dataset.src;
        if (!src) return;

        if (!player._audio) {
            player._audio = new Audio(src);
            player._audio.addEventListener('ended', () => {
                const b = player.querySelector('.notion-audio-btn');
                if (b) { b.textContent = '▶'; b.setAttribute('aria-label', 'Play audio'); b.classList.remove('playing'); }
            });
        }

        const audio = player._audio;
        if (audio.paused) {
            // Stop any other playing snippet first
            document.querySelectorAll('.notion-audio-player').forEach(p => {
                if (p !== player && p._audio && !p._audio.paused) {
                    p._audio.pause();
                    const ob = p.querySelector('.notion-audio-btn');
                    if (ob) { ob.textContent = '▶'; ob.setAttribute('aria-label', 'Play audio'); ob.classList.remove('playing'); }
                }
            });
            audio.play().then(() => {
                btn.textContent = '⏸';
                btn.setAttribute('aria-label', 'Pause audio');
                btn.classList.add('playing');
            }).catch(() => {});
        } else {
            audio.pause();
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Play audio');
            btn.classList.remove('playing');
        }
    });
});
window.addEventListener('popstate', route);

// ── Keyboard shortcut: / focuses the active search bar ────────────────────
document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const bar = document.querySelector('[data-wiki-search="1"]');
    if (bar) { e.preventDefault(); bar.focus(); }
});
