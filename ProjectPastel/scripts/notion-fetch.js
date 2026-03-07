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
                html += `<details class="notion-toggle">
                    <summary>${summary}</summary>
                    <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                </details>`;
                break;
            }

            // Heading toggles (Notion lets headings be toggleable)
            case 'heading_1':
                if (block.heading_1.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h2">
                        <summary><h2>${renderRichText(block.heading_1.rich_text)}</h2></summary>
                        <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                    </details>`;
                } else {
                    html += `<h2>${renderRichText(block.heading_1.rich_text)}</h2>`;
                }
                break;

            case 'heading_2':
                if (block.heading_2.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h3">
                        <summary><h3>${renderRichText(block.heading_2.rich_text)}</h3></summary>
                        <div class="notion-toggle-content">${renderBlocks(block.children ?? [])}</div>
                    </details>`;
                } else {
                    html += `<h3>${renderRichText(block.heading_2.rich_text)}</h3>`;
                }
                break;

            case 'heading_3':
                if (block.heading_3.is_toggleable) {
                    html += `<details class="notion-toggle notion-toggle-h4">
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
                    html += `<figure class="notion-audio">
                        <audio controls src="${escapeHTML(audioSrc)}" style="width:100%;"></audio>
                        ${audioCap ? `<figcaption>${audioCap}</figcaption>` : ''}
                    </figure>`;
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

// ── Views ──────────────────────────────────────────────────────────────────

async function showCampaignList() {
    showLoading('Loading campaigns…');
    const container = document.getElementById('wiki-container');
    try {
        const campaigns = await fetchCampaigns();
        container.innerHTML = `
            <input type="text" id="search-campaigns" placeholder="Search campaigns…" />
            <h3 style="color:#f4f4f4;border-bottom:unset;padding-bottom:unset;margin-bottom:-15px;">
                Select a Campaign:
            </h3>
            <ul id="sheet-list"></ul>
        `;
        const list = document.getElementById('sheet-list');

        function render(filter = '') {
            list.innerHTML = '';
            campaigns
                .filter(n => n.toLowerCase().includes(filter.toLowerCase()))
                .forEach(name => {
                    const li = document.createElement('li');
                    li.innerHTML = `<a href="?campaign=${encodeURIComponent(name)}" data-campaign="${escapeHTML(name)}">${escapeHTML(name)}</a>`;
                    list.appendChild(li);
                });
            list.querySelectorAll('[data-campaign]').forEach(link => {
                link.addEventListener('click', e => {
                    e.preventDefault();
                    const c = e.target.getAttribute('data-campaign');
                    history.pushState(null, '', `?campaign=${encodeURIComponent(c)}`);
                    showCategoryList(c);
                });
            });
        }

        render();
        document.getElementById('search-campaigns').addEventListener('input', e => render(e.target.value));
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

        const list = document.createElement('ul');
        list.id = 'sheet-list';
        categories.forEach(cat => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(cat)}" data-category="${escapeHTML(cat)}">${escapeHTML(cat)}</a>`;
            list.appendChild(li);
        });
        container.appendChild(list);

        list.querySelectorAll('[data-category]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const cat = e.target.getAttribute('data-category');
                history.pushState(null, '', `?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(cat)}`);
                showEntryList(campaign, cat);
            });
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

        const list = document.createElement('ul');
        list.id = 'sheet-list';
        entries.forEach(entry => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="?campaign=${encodeURIComponent(campaign)}&category=${encodeURIComponent(category)}&entry=${encodeURIComponent(entry.id)}" data-id="${escapeHTML(entry.id)}" data-name="${escapeHTML(entry.name)}">${escapeHTML(entry.name)}</a>`;
            list.appendChild(li);
        });
        container.appendChild(list);

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
        const hasProfile = entry.profileImage || Object.keys(entry.extraProps ?? {}).length > 0;

        container.innerHTML = '';
        container.appendChild(makeBreadcrumb([
            { label: 'Campaigns', onClick: goToCampaigns },
            { label: campaign,    onClick: goToCategories },
            { label: category,    onClick: goToEntries },
            { label: entry.name },
        ]));
        container.appendChild(makeBackButton(`← Back to ${category}`, goToEntries));

        const section = document.createElement('section');
        section.innerHTML = `
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
                        ? `<img src="${escapeHTML(safeURL(entry.profileImage))}" alt="${escapeHTML(entry.name)}" style="max-width:100%;margin-bottom:1rem;">`
                        : ''}
                    ${Object.keys(entry.extraProps ?? {}).length ? `
                        <table style="width:100%;border:1px solid #ccc;text-align:left;margin-bottom:1rem;table-layout:fixed;">
                            ${Object.entries(entry.extraProps).map(([k, v]) => `
                                <tr>
                                    <td style="width:50%;font-weight:bold;">${escapeHTML(k)}</td>
                                    <td>${escapeHTML(v)}</td>
                                </tr>
                            `).join('')}
                        </table>
                    ` : ''}
                </div>` : ''}
            </div>
        `;
        container.appendChild(section);
    } catch (err) {
        showError(err.message, err instanceof RateLimitError);
    }
}

// ── Router ─────────────────────────────────────────────────────────────────

function route() {
    const campaign = getParam('campaign');
    const category = getParam('category');
    const entry    = getParam('entry');

    if (campaign && category && entry) showEntryDetail(campaign, category, entry);
    else if (campaign && category)     showEntryList(campaign, category);
    else if (campaign)                 showCategoryList(campaign);
    else                               showCampaignList();
}

document.addEventListener('DOMContentLoaded', route);
window.addEventListener('popstate', route);
