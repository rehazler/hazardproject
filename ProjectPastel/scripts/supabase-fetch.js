// ─────────────────────────────────────────────────────────────────────────────
// supabase-fetch.js — Supabase wiki renderer
// Depends on: api-client.js, auth.js  (both loaded before this script)
//
// Exposes window.WikiSB for editor integration (wiki-editor.js).
// WikiSB is defined synchronously so wiki-editor.js (loaded after) can
// register its hooks before the async init microtask runs.
// ─────────────────────────────────────────────────────────────────────────────

window.WikiSB = {
    // Current navigation state — read by wiki-editor.js
    state: { campaign: null, category: null, entryId: null, entryName: null },

    // Navigation functions — set below, called by wiki-editor.js
    nav: {
        showCampaignList: null,
        showCampaign:     null,
        showEntry:        null,
    },

    // Lifecycle hooks — set by wiki-editor.js to inject editor UI.
    // Each is called after the corresponding view finishes rendering.
    onCampaignList: null,   // (campaigns) => void
    onCampaign:     null,   // (campaignId, categories) => void
    onEntries:      null,   // (categoryId, entries, areaEl) => void
    onEntryDetail:  null,   // (entry, containerEl) => void
};

(function () {
    'use strict';

    const container = document.getElementById('wiki-container');

    // ── Category icons ────────────────────────────────────────────────────────
    // Identical rule set to notion-fetch.js — first match wins.

    const CAT_ICON_RULES = [
        { keywords: ['player character', 'player characters'], icon: '🎲' },
        { keywords: ['art', 'artwork', 'gallery'],             icon: '🎨' },
        { keywords: ['npc', 'npcs', 'person', 'people'],       icon: '👤' },
        { keywords: ['location', 'locations', 'place', 'places', 'region', 'area'], icon: '🗺️' },
        { keywords: ['event', 'events'],                        icon: '🎭' },
        { keywords: ['recap', 'recaps', 'session', 'sessions'], icon: '📜' },
        { keywords: ['lore', 'history'],                        icon: '📖' },
        { keywords: ['faction', 'factions', 'guild', 'guilds', 'organisation', 'organisations', 'organization', 'organizations'], icon: '⚔️' },
        { keywords: ['item', 'items', 'artifact', 'artifacts', 'equipment', 'relic', 'relics'], icon: '💎' },
        { keywords: ['monster', 'monsters', 'creature', 'creatures', 'bestiary'], icon: '👹' },
        { keywords: ['god', 'gods', 'deity', 'deities', 'religion'],              icon: '✨' },
        { keywords: ['player', 'players', 'pc', 'pcs', 'character', 'characters'], icon: '🎲' },
        { keywords: ['quest', 'quests', 'mission', 'missions'], icon: '📋' },
        { keywords: ['magic', 'spell', 'spells'],               icon: '🔮' },
        { keywords: ['world', 'plane', 'planes'],               icon: '🌍' },
    ];

    function getCatIcon(name) {
        const lower = (name || '').toLowerCase();
        const words = lower.split(/\W+/);
        for (const rule of CAT_ICON_RULES) {
            if (rule.keywords.some(kw =>
                kw.includes(' ') ? lower.includes(kw) : words.includes(kw)
            )) return rule.icon;
        }
        return '◆';
    }

    // If the stored name starts with an emoji the editor placed there as an
    // override (e.g. "🐉 Dragons"), use that emoji and the rest as display name.
    // Otherwise fall back to keyword matching.
    const LEADING_EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;

    function parseCatName(name) {
        const match = (name || '').match(LEADING_EMOJI_RE);
        if (match) {
            const displayName = name.slice(match[0].length).trim();
            return { icon: match[1], displayName: displayName || name };
        }
        return { icon: getCatIcon(name), displayName: name || '' };
    }

    // Same pattern for campaign names — returns null icon if no leading emoji.
    function parseCampName(name) {
        const match = (name || '').match(LEADING_EMOJI_RE);
        if (match) {
            const displayName = name.slice(match[0].length).trim();
            return { icon: match[1], displayName: displayName || name };
        }
        return { icon: null, displayName: name || '' };
    }

    // Renders an icon value (emoji string or https:// URL) as safe HTML.
    function renderIconHTML(icon, size) {
        if (!icon) return '';
        if (/^(https?:|\/\/|data:)/i.test(icon)) {
            return `<img src="${esc(icon)}" alt="" style="width:${size};height:${size};object-fit:contain;display:block">`;
        }
        return esc(icon);
    }

    // ── Campaign cache (for accent colour lookup in showCampaign) ─────────────
    let _campaignCache = [];

    // Set to true while a campaign-view search query has ≥2 chars.
    // showEntries checks this flag and skips DOM updates when set.
    let _campSearchActive = false;

    // ── Helpers ───────────────────────────────────────────────────────────────

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Builds the full banner HTML with all display layers from a layout object.
    function _bannerHtml(url, layout, cssClass) {
        const _fitMap  = { contain: 'contain', stretch: '100% 100%', cover: 'cover' };
        const fit      = (layout.bannerFit && layout.bannerFit !== 'tile') ? layout.bannerFit : 'cover';
        const bgSize   = fit === 'actual' ? `${layout.bannerZoom ?? 100}%` : (_fitMap[fit] || 'cover');
        const bgRep    = (layout.bannerTile || layout.bannerFit === 'tile') ? 'repeat' : 'no-repeat';
        const bgPos    = `${layout.bannerFocalX ?? 50}% ${layout.bannerFocalY ?? 50}%`;
        const bgOpac   = layout.bannerOpacity != null ? (layout.bannerOpacity / 100).toFixed(2) : '1';
        const bgAttach = layout.bannerParallax ? 'fixed' : 'scroll';

        const _radMap  = { none: '0px', slight: '4px', rounded: '10px', pill: '50px' };
        const radius   = _radMap[layout.bannerRadius] ?? '10px';
        const height   = layout.bannerHeight ? `height:${layout.bannerHeight}px;` : '';

        const bgStyle = [
            `background-image:url('${esc(url)}')`,
            `background-size:${bgSize}`,
            `background-repeat:${bgRep}`,
            `background-position:${bgPos}`,
            `background-attachment:${bgAttach}`,
            `opacity:${bgOpac}`,
        ].join(';');

        let inner = `<div class="wiki-banner-bg" style="${bgStyle}"></div>`;

        if (layout.bannerOverlayColor) {
            const hex   = layout.bannerOverlayColor.replace('#', '').padEnd(6, '0').slice(0, 6);
            const r = parseInt(hex.slice(0,2), 16) || 0;
            const g = parseInt(hex.slice(2,4), 16) || 0;
            const b = parseInt(hex.slice(4,6), 16) || 0;
            const a = ((layout.bannerOverlayOpacity ?? 40) / 100).toFixed(2);
            inner += `<div class="wiki-banner-overlay" style="background:rgba(${r},${g},${b},${a})"></div>`;
        }

        if (layout.bannerBottomFade) {
            inner += `<div class="wiki-banner-fade"></div>`;
        }

        if (layout.bannerText) {
            const pos   = layout.bannerTextPos   || 'bottom-left';
            const sz    = layout.bannerTextSize   || 'md';
            const col   = layout.bannerTextColor  || '#ffffff';
            inner += `<div class="wiki-banner-text wiki-banner-text--${esc(pos)} wiki-banner-text--${esc(sz)}" style="color:${esc(col)}">${esc(layout.bannerText)}</div>`;
        }

        const altAttr = layout.bannerAlt ? ` role="img" aria-label="${esc(layout.bannerAlt)}"` : '';
        return `<div class="${cssClass} wiki-banner-clickable" data-src="${esc(url)}"${altAttr} style="${height}border-radius:${radius}">
        ${inner}
    </div>`;
    }

    function showLoading(msg) {
        container.innerHTML = `
            <div class="wiki-loading">
                <div class="wiki-spinner"></div>
                <p>${esc(msg || 'Loading…')}</p>
            </div>`;
    }

    function showError(msg, hint) {
        container.innerHTML = `
            <div class="wiki-error">
                <p>${esc(msg)}</p>
                ${hint ? `<p class="wiki-error-hint">${esc(hint)}</p>` : ''}
            </div>`;
    }

    // ── Extra-props rendering ─────────────────────────────────────────────────
    // Property names with NO lowercase letters → compact stat boxes (top row).
    // Mixed-case names → key: value body rows.
    // A leading number prefix controls sort order and is stripped from display.
    // Special value patterns:
    //   "true" / "yes"  → ✓ checkbox
    //   "false" / "no"  → ✗ checkbox
    //   "N/M"           → progress bar

    function renderPropValue(v) {
        const s = String(v ?? '');
        if (/^(true|yes)$/i.test(s))  return '<span class="wiki-prop-bool wiki-prop-bool--yes">✓</span>';
        if (/^(false|no)$/i.test(s))  return '<span class="wiki-prop-bool wiki-prop-bool--no">✗</span>';
        const prog = s.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (prog) {
            const pct = Math.min(100, Math.round((+prog[1] / +prog[2]) * 100));
            return `<span class="wiki-prop-progress">
                <span class="wiki-prop-progress-bar" style="width:${pct}%"></span>
                <span class="wiki-prop-progress-text">${esc(prog[1])}/${esc(prog[2])}</span>
            </span>`;
        }
        return esc(s);
    }

    function renderExtraProps(props) {
        const entries = Object.entries(props || {});
        if (!entries.length) return '';

        const sorted = entries.map(([k, v]) => {
            const m       = k.match(/^(\d+)\s+(.+)$/);
            const sort    = m ? parseInt(m[1], 10) : 999;
            const display = m ? m[2] : k;
            const isStat  = display === display.toUpperCase() && /[A-Z]/.test(display);
            return { display, value: v, sort, isStat };
        }).sort((a, b) => a.sort - b.sort);

        const stats = sorted.filter(p => p.isStat);
        const body  = sorted.filter(p => !p.isStat);
        let html = '<div class="wiki-extra-props">';

        if (stats.length) {
            html += '<div class="wiki-stat-boxes">';
            for (const p of stats) {
                html += `<div class="wiki-stat-box">
                    <div class="wiki-stat-val">${renderPropValue(p.value)}</div>
                    <div class="wiki-stat-key">${esc(p.display)}</div>
                </div>`;
            }
            html += '</div>';
        }
        if (body.length) {
            html += '<div class="wiki-prop-rows">';
            for (const p of body) {
                html += `<div class="wiki-prop-row">
                    <span class="wiki-prop-key">${esc(p.display)}</span>
                    <span class="wiki-prop-val">${renderPropValue(p.value)}</span>
                </div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // ── Block renderer ────────────────────────────────────────────────────────
    // Converts the internal block array into HTML.
    // Block content schema is documented in supabase-schema.sql.

    function renderBlocks(blocks) {
        if (!blocks || blocks.length === 0) {
            return '<p><em>No content yet.</em></p>';
        }

        let out         = '';
        let pendingType = null;  // 'bulleted_list' | 'numbered_list' | null
        let pendingItems = [];

        function flushList() {
            if (!pendingItems.length) return;
            const tag = pendingType === 'numbered_list' ? 'ol' : 'ul';
            out += `<${tag}>${pendingItems.map(i => `<li>${i}</li>`).join('')}</${tag}>`;
            pendingType  = null;
            pendingItems = [];
        }

        for (const blk of blocks) {
            const c      = blk.content || {};
            const isList = blk.type === 'bulleted_list' || blk.type === 'numbered_list';

            if (!isList)                                  flushList();
            else if (pendingType && blk.type !== pendingType) flushList();

            switch (blk.type) {
                case 'paragraph':
                    out += `<p>${c.html || ''}</p>`;
                    break;

                case 'heading_2':
                case 'heading_3':
                case 'heading_4': {
                    const _lvl = blk.type.replace('heading_', '');
                    const _div = c.divider !== undefined ? c.divider : (blk.type === 'heading_3' ? 'full' : 'none');
                    const _styles = [];
                    if (c.color) _styles.push(`color:${esc(c.color)}`);
                    if (c.align) _styles.push(`text-align:${esc(c.align)}`);
                    if (c.bold)  _styles.push('font-weight:bold');
                    const _cls = ['wiki-heading'];
                    if (_div === 'full') _cls.push('wiki-heading--divider-full');
                    if (_div === 'text') _cls.push('wiki-heading--divider-text');
                    const _sa = _styles.length ? ` style="${_styles.join(';')}"` : '';
                    out += `<h${_lvl} class="${_cls.join(' ')}"${_sa}>${c.html || ''}</h${_lvl}>`;
                    break;
                }

                case 'bulleted_list':
                case 'numbered_list':
                    pendingType = blk.type;
                    (c.items || []).forEach(item => pendingItems.push(item));
                    break;

                case 'image':
                    out += `<figure class="notion-image">
                        <img src="${esc(c.url)}" alt="${esc(c.caption || '')}"
                             class="wiki-zoomable" data-src="${esc(c.url)}">
                        ${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ''}
                    </figure>`;
                    break;

                case 'audio':
                    if (c.label) out += `<div class="wiki-block-label">${esc(c.label)}</div>`;
                    out += `<div class="notion-audio-player">
                        <button class="notion-audio-btn" data-src="${esc(c.url)}" type="button">▶</button>
                        <span class="notion-audio-caption">${esc(c.caption || '')}</span>
                    </div>`;
                    break;

                case 'quote': {
                    const _qs  = c.style        || 'none';
                    const _qta = c.textAlign    || 'left';
                    const _qca = c.captionAlign || 'right';
                    out += `<figure class="wiki-quote wiki-quote--${esc(_qs)}">
                        <blockquote style="text-align:${_qta}">${c.html || ''}</blockquote>
                        ${c.caption ? `<figcaption style="text-align:${_qca}">— ${esc(c.caption)}</figcaption>` : ''}
                    </figure>`;
                    break;
                }

                case 'callout':
                    out += `<div class="notion-callout notion-callout--${esc(c.variant || 'info')}">
                        <span class="notion-callout-icon">${esc(c.emoji || 'ℹ️')}</span>
                        <div>${c.html || ''}</div>
                    </div>`;
                    break;

                case 'divider': {
                    const _dc = { default: '#503554', lavender: '#d3b3e7', mint: '#98e6d6', pink: '#f3b0c3' };
                    const color = _dc[c.color || 'default'] || '#503554';
                    const px    = (c.thickness || '1') + 'px';
                    const ls    = `height:${px};background:`;
                    if ((c.style || 'line') === 'moon') {
                        out += `<div class="wiki-divider wiki-divider--moon">
                            <div class="wiki-divider-line" style="${ls}linear-gradient(to right,transparent,${color})"></div>
                            <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                            <div class="wiki-divider-line" style="${ls}linear-gradient(to left,transparent,${color})"></div>
                        </div>`;
                    } else if (c.style === 'moon-full') {
                        out += `<div class="wiki-divider wiki-divider--moon-full">
                            <div class="wiki-divider-through-line" style="${ls}linear-gradient(to right,transparent,${color},transparent)"></div>
                            <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                        </div>`;
                    } else {
                        out += `<hr style="border-top:${px} solid ${color};border-bottom:none;border-left:none;border-right:none">`;
                    }
                    break;
                }

                case 'spacer':
                    out += `<div class="wiki-spacer" style="height:${Math.max(10, parseInt(c.height) || 60)}px"></div>`;
                    break;

                case 'toggle': {
                    const hRaw = c.heading;
                    const hObj = (hRaw && typeof hRaw === 'object')
                        ? hRaw
                        : { html: (typeof hRaw === 'string' ? esc(hRaw) : ''), level: 2, color: '', align: '', bold: false, divider: 'none' };
                    const _lvl = hObj.level || 2;
                    const _div = hObj.divider || 'none';
                    const _hStyles = [];
                    if (hObj.color) _hStyles.push(`color:${esc(hObj.color)}`);
                    if (hObj.align) _hStyles.push(`text-align:${esc(hObj.align)}`);
                    if (hObj.bold)  _hStyles.push('font-weight:bold');
                    const _hCls = [];
                    if (_div === 'full') _hCls.push('wiki-heading--divider-full');
                    if (_div === 'text') _hCls.push('wiki-heading--divider-text');
                    const _sa = _hStyles.length ? ` style="${_hStyles.join(';')}"` : '';
                    const _ca = _hCls.length   ? ` class="${_hCls.join(' ')}"` : '';
                    // Outer wrapper classes
                    const _wCls = ['wiki-toggle'];
                    if (c.border) _wCls.push('wiki-toggle--bordered');
                    // Body classes
                    const _bCls = ['wiki-toggle-body'];
                    if (c.separator) _bCls.push('wiki-toggle--separator');
                    // Backwards compat: old format had body as plain string
                    let tBlocks = Array.isArray(c.blocks) ? c.blocks : [];
                    if (!tBlocks.length && c.body) tBlocks = [{ type: 'paragraph', content: { html: esc(c.body) } }];
                    const bodyHtml = tBlocks.length ? renderBlocks(tBlocks) : '';
                    out += `<details class="${_wCls.join(' ')}" open>
                        <summary class="wiki-toggle-heading"><h${_lvl}${_ca}${_sa}>${hObj.html || ''}</h${_lvl}></summary>
                        <div class="${_bCls.join(' ')}">${bodyHtml}</div>
                    </details>`;
                    break;
                }

                case 'table': {
                    const rows = c.content || [];
                    if (rows.length) {
                        let t = '<div class="wiki-table-wrap"><table class="wiki-table">';
                        if (c.withHeadings) {
                            t += '<thead><tr>' + rows[0].map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead>';
                            t += '<tbody>' + rows.slice(1).map(r => '<tr>' + r.map(d => `<td>${esc(d)}</td>`).join('') + '</tr>').join('') + '</tbody>';
                        } else {
                            t += '<tbody>' + rows.map(r => '<tr>' + r.map(d => `<td>${esc(d)}</td>`).join('') + '</tr>').join('') + '</tbody>';
                        }
                        out += t + '</table></div>';
                    }
                    break;
                }

                case 'embed': {
                    const src = esc(c.embed || c.source || '');
                    const cap = c.caption ? `<p class="wiki-embed-caption">${esc(c.caption)}</p>` : '';
                    out += `<div class="wiki-embed">
                        <div class="wiki-embed-frame">
                            <iframe src="${src}" frameborder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen></iframe>
                        </div>${cap}
                    </div>`;
                    break;
                }

                case 'bookmark': {
                    if (c.label) out += `<div class="wiki-block-label">${esc(c.label)}</div>`;
                    const url      = esc(c.url || '');
                    const bmkLabel = esc(c.caption || c.url || '');
                    out += `<a class="wiki-bookmark" href="${url}" target="_blank" rel="noopener noreferrer">
                        <span class="wiki-bookmark-label">${bmkLabel}</span>
                        <span class="wiki-bookmark-arrow">↗</span>
                    </a>`;
                    break;
                }

                case 'columns': {
                    const BORDERS = { lavender: '1px solid rgba(211,179,231,0.3)', mint: '1px solid rgba(152,230,214,0.3)', pink: '1px solid rgba(243,176,195,0.3)', subtle: '1px solid rgba(255,255,255,0.1)' };
                    const BKGS    = { dark: '#2b1b2e', darker: '#1a0b1e', lavender: 'rgba(211,179,231,0.06)', mint: 'rgba(152,230,214,0.06)', pink: 'rgba(243,176,195,0.06)' };
                    const PADS    = { sm: '8px', md: '14px', lg: '20px' };
                    const RADII   = { sm: '4px', md: '8px',  lg: '12px' };

                    // Normalise items — support legacy array-of-blocks format
                    const items = (c.items || []).map(item =>
                        Array.isArray(item) ? { blocks: item, width: 1, style: {} }
                        : (item && typeof item === 'object' ? item : { blocks: [], width: 1, style: {} })
                    );

                    const gridTpl = items.map(it => `${Math.max(1, it.width || 1)}fr`).join(' ');
                    if (c.label) out += `<div class="wiki-block-label">${esc(c.label)}</div>`;
                    out += `<div class="wiki-columns" style="grid-template-columns:${gridTpl}">`;
                    items.forEach(item => {
                        const s = item.style || {};
                        const colStyle = [
                            BORDERS[s.border]     ? `border:${BORDERS[s.border]}`         : '',
                            BKGS[s.background]    ? `background:${BKGS[s.background]}`    : '',
                            PADS[s.padding]       ? `padding:${PADS[s.padding]}`           : '',
                            RADII[s.radius]       ? `border-radius:${RADII[s.radius]}`     : '',
                            s.align               ? `text-align:${s.align}`                : '',
                        ].filter(Boolean).join(';');
                        const blocks   = Array.isArray(item.blocks) ? item.blocks : [];
                        const colHTML  = blocks.length ? renderBlocks(blocks) : '';
                        out += `<div class="wiki-column"${colStyle ? ` style="${colStyle}"` : ''}>${colHTML}</div>`;
                    });
                    out += '</div>';
                    break;
                }

                case 'props_block': {
                    const rows = c.rows || [];
                    if (rows.length) {
                        if (c.label) out += `<div class="wiki-block-label">${esc(c.label)}</div>`;
                        const mode = c.mode || 'horizontal';
                        const alignStyle = c.align && c.align !== 'left' ? ` style="text-align:${esc(c.align)}"` : '';
                        if (alignStyle) out += `<div${alignStyle}>`;
                        if (mode === 'horizontal') {
                            out += '<div class="wiki-stat-boxes">';
                            for (const r of rows) {
                                out += `<div class="wiki-stat-box">
                                    <div class="wiki-stat-val">${renderPropValue(r.value)}</div>
                                    <div class="wiki-stat-key">${esc(r.key)}</div>
                                </div>`;
                            }
                            out += '</div>';
                        } else if (mode === 'vertical') {
                            out += '<div class="wiki-prop-rows">';
                            for (const r of rows) {
                                out += `<div class="wiki-prop-row">
                                    <span class="wiki-prop-key">${esc(r.key)}</span>
                                    <span class="wiki-prop-val">${renderPropValue(r.value)}</span>
                                </div>`;
                            }
                            out += '</div>';
                        } else if (mode === 'stat-attrs') {
                            out += '<div class="stat-attrs">';
                            for (const r of rows) {
                                out += `<div><span>${esc(r.key)}</span><strong>${renderPropValue(r.value)}</strong></div>`;
                            }
                            out += '</div>';
                        } else if (mode === 'stat-block') {
                            // Split rows: ALL-CAPS keys → .stat-attrs flex row; mixed-case → body <p> rows
                            const attrRows = rows.filter(r => r.key === r.key.toUpperCase() && r.key.trim() !== '');
                            const bodyRows = rows.filter(r => r.key !== r.key.toUpperCase() || r.key.trim() === '');
                            out += '<div class="wiki-props-statblock">';
                            if (attrRows.length) {
                                out += '<div class="stat-attrs">';
                                for (const r of attrRows) {
                                    out += `<div><span>${esc(r.key)}</span><strong>${renderPropValue(r.value)}</strong></div>`;
                                }
                                out += '</div>';
                            }
                            if (attrRows.length && bodyRows.length) out += '<hr class="stat-rule">';
                            for (const r of bodyRows) {
                                out += `<p><strong>${esc(r.key)}:</strong> ${renderPropValue(r.value)}</p>`;
                            }
                            out += '</div>';
                        } else if (mode === 'class-wiki') {
                            out += '<table class="wiki-props-table"><tbody>';
                            for (const r of rows) {
                                out += `<tr>
                                    <td class="wiki-props-table-key">${esc(r.key)}</td>
                                    <td class="wiki-props-table-val">${renderPropValue(r.value)}</td>
                                </tr>`;
                            }
                            out += '</tbody></table>';
                        }
                        if (alignStyle) out += '</div>';
                    }
                    break;
                }

                case 'entry_link': {
                    const id  = esc(c.entryId || '');
                    const nm  = esc(c.entryName || '');
                    const cat = c.categoryName ? ` <span class="wiki-count"> — ${esc(c.categoryName)}</span>` : '';
                    out += `<a class="wiki-entry-ref" href="#"
                               data-entry-id="${id}" data-entry-name="${esc(c.entryName || '')}">
                        ${c.profileImage ? `<img src="${esc(c.profileImage)}" class="wiki-entry-thumb" alt="">` : ''}
                        <span>${nm}${cat}</span>
                        <span class="wiki-entry-ref-arrow">→</span>
                    </a>`;
                    break;
                }

                default:
                    if (c.html) out += `<p>${c.html}</p>`;
            }
        }

        flushList();
        return out;
    }

    // ── Audio player wiring ───────────────────────────────────────────────────

    function attachAudio(root) {
        root.querySelectorAll('.notion-audio-btn').forEach(btn => {
            let audio = null;
            btn.addEventListener('click', () => {
                if (!audio) {
                    audio = new Audio(btn.dataset.src);
                    audio.addEventListener('ended', () => {
                        btn.textContent = '▶';
                        btn.classList.remove('playing');
                    });
                }
                if (audio.paused) {
                    audio.play();
                    btn.textContent = '■';
                    btn.classList.add('playing');
                } else {
                    audio.pause();
                    btn.textContent = '▶';
                    btn.classList.remove('playing');
                }
            });
        });
    }

    // ── URL helpers ───────────────────────────────────────────────────────────

    function _pushState() {
        const u = new URL(location.href);
        u.search = '';
        const { campaign, category, entryId } = WikiSB.state;
        if (campaign) u.searchParams.set('campaign', campaign.name);
        if (category) u.searchParams.set('category', category.name);
        if (entryId)  u.searchParams.set('entry', entryId);
        history.pushState({}, '', u);
        _renderBreadcrumbs();
    }

    function _renderBreadcrumbs() {
        const bc = document.getElementById('wiki-breadcrumb');
        if (!bc) return;
        const { campaign, category, entryId, entryName } = WikiSB.state;
        if (!campaign) { bc.hidden = true; bc.innerHTML = ''; return; }
        const campDisplay = parseCampName(campaign.name).displayName;
        let html = `<a href="#" id="bc-home">Campaigns</a> <span>›</span> `;
        if (entryId && entryName) {
            html += `<a href="#" id="bc-camp">${esc(campDisplay)}</a>`;
            if (category) {
                html += ` <span>›</span> <a href="#" id="bc-cat">${esc(parseCatName(category.name).displayName)}</a>`;
            }
            html += ` <span>›</span> <span>${esc(entryName)}</span>`;
        } else if (category) {
            html += `<a href="#" id="bc-camp">${esc(campDisplay)}</a> <span>›</span> <span>${esc(parseCatName(category.name).displayName)}</span>`;
        } else {
            html += `<span>${esc(campDisplay)}</span>`;
        }
        bc.innerHTML = html;
        bc.hidden = false;
        document.getElementById('bc-home')?.addEventListener('click', e => { e.preventDefault(); showCampaignList(); });
        document.getElementById('bc-camp')?.addEventListener('click', e => {
            e.preventDefault();
            showCampaign(campaign.id, campaign.name, category ? { initialCategoryId: category.id } : {});
        });
        document.getElementById('bc-cat')?.addEventListener('click', e => {
            e.preventDefault();
            showCampaign(campaign.id, campaign.name, { initialCategoryId: category.id });
        });
    }

    // ── Campaign list ─────────────────────────────────────────────────────────

    async function showCampaignList() {
        WikiSB.state = { campaign: null, category: null, entryId: null, entryName: null };
        _pushState();
        showLoading('Loading campaigns…');

        let campaigns;
        try {
            campaigns = await API.getCampaigns();
        } catch (e) {
            showError('Could not load campaigns.', e.message);
            return;
        }
        _campaignCache = campaigns; // keep for accent-colour lookup
        container.style.removeProperty('--wiki-accent'); // clear any campaign tint

        let html = `
            <div class="wiki-search-wrap">
                <img src="Assets/TransparentIcons/Crystal_Ball_18x18.png"
                     class="wiki-search-icon" alt="">
                <input type="text" id="sb-search" class="wiki-search-bar"
                       placeholder="Search campaigns or entries…" autocomplete="off">
            </div>`;

        if (campaigns.length === 0) {
            html += `<p class="wiki-empty">No campaigns yet.</p>`;
        } else {
            html += `<ul class="wiki-campaign-list" id="sb-camp-list">`;
            for (const c of campaigns) {
                const cp = parseCampName(c.name);
                const rawIcon = c.icon || cp.icon;
                const isImgIcon = rawIcon && /^(https?:|\/\/|data:)/i.test(rawIcon);
                const iconHTML = renderIconHTML(rawIcon, '36px');
                html += `
                    <li data-id="${esc(c.id)}" data-name="${esc(c.name)}">
                        <a class="quest-item wiki-campaign-card" href="#"
                           data-id="${esc(c.id)}" data-name="${esc(c.name)}">
                            <span class="quest-rank${rawIcon ? (isImgIcon ? ' quest-rank--img' : ' quest-rank--emoji') : ''}">${iconHTML}</span>
                            <div class="quest-info">
                                <span class="quest-title">${esc(cp.displayName)}</span>
                                ${c.description
                                    ? `<span class="quest-desc">${esc(c.description)}</span>`
                                    : ''}
                            </div>
                            <span class="quest-arrow">→</span>
                        </a>
                    </li>`;
            }
            html += '</ul>';
        }

        container.innerHTML = html;

        const searchEl = container.querySelector('#sb-search');
        let _gsTimer = null;
        if (searchEl) {
            searchEl.addEventListener('input', e => {
                clearTimeout(_gsTimer);
                const q = e.target.value.trim();

                // Remove any previous entry results
                container.querySelector('#sb-entry-results')?.remove();

                if (q.length < 2) {
                    // Restore full campaign list
                    container.querySelectorAll('#sb-camp-list li').forEach(li => li.style.display = '');
                    return;
                }

                // Filter campaigns by name
                container.querySelectorAll('#sb-camp-list li').forEach(li => {
                    li.style.display = li.dataset.name.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
                });

                // Debounced entry search — results injected below the campaign list
                const area = document.createElement('div');
                area.id = 'sb-entry-results';
                area.innerHTML = `<div class="wiki-loading" style="padding:1rem 0"><div class="wiki-spinner"></div></div>`;
                container.querySelector('#sb-camp-list')?.after(area);

                _gsTimer = setTimeout(async () => {
                    try {
                        const hits = await API.searchEntries(q);
                        if (!hits.length) { area.remove(); return; }
                        let h = `<p class="wiki-count" style="margin:12px 0 4px;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.06em">Entries matching &#8220;${esc(q)}&#8221;</p><ul class="wiki-entry-list">`;
                        for (const hit of hits) {
                            const campObj  = hit.categories?.campaigns;
                            const campName = campObj?.name || '';
                            const catName  = parseCatName(hit.categories?.name || '').displayName;
                            const campDisp = campName ? parseCampName(campName).displayName : '';
                            h += `
                                <li>
                                    <a class="wiki-entry-link" href="#"
                                       data-entry-id="${esc(hit.id)}"
                                       data-entry-name="${esc(hit.name)}"
                                       data-camp-id="${esc(campObj?.id || '')}"
                                       data-camp-name="${esc(campName)}"
                                       data-cat-id="${esc(hit.category_id)}"
                                       data-cat-name="${esc(hit.categories?.name || '')}">
                                        ${hit.profile_image ? `<img src="${esc(hit.profile_image)}" alt="" class="wiki-entry-thumb">` : ''}
                                        <span>
                                            <span>${esc(hit.name)}</span>
                                            <span class="wiki-count"> — ${esc(catName)}${campDisp ? ', ' + esc(campDisp) : ''}</span>
                                        </span>
                                    </a>
                                </li>`;
                        }
                        h += '</ul>';
                        area.innerHTML = h;
                        area.querySelectorAll('.wiki-entry-link').forEach(a => {
                            a.addEventListener('click', async ev => {
                                ev.preventDefault();
                                const campId   = a.dataset.campId;
                                const campName = a.dataset.campName;
                                if (campId && campName) {
                                    const campData = _campaignCache.find(c => c.id === campId) || {};
                                    WikiSB.state.campaign = { id: campId, name: campName, ...campData };
                                    WikiSB.state.category = a.dataset.catId
                                        ? { id: a.dataset.catId, name: a.dataset.catName } : null;
                                }
                                await showEntry(a.dataset.entryId, a.dataset.entryName);
                            });
                        });
                    } catch { area.remove(); }
                }, 300);
            });
        }

        container.querySelectorAll('#sb-camp-list a').forEach(a => {
            a.addEventListener('click', ev => {
                ev.preventDefault();
                showCampaign(a.dataset.id, a.dataset.name);
            });
        });

        // Lazy-load total entry counts for each campaign card
        if (campaigns.length > 0) {
            Promise.all(campaigns.map(async camp => {
                try {
                    const count = await API.getCampaignEntryCount(camp.id);
                    const li = container.querySelector(`#sb-camp-list li[data-id="${camp.id}"]`);
                    if (!li) return;
                    const info = li.querySelector('.quest-info');
                    if (info) {
                        const badge = document.createElement('span');
                        badge.className = 'wiki-count';
                        badge.textContent = count + (count === 1 ? ' entry' : ' entries');
                        info.appendChild(badge);
                    }
                } catch { /* non-fatal */ }
            }));
        }

        if (WikiSB.onCampaignList) WikiSB.onCampaignList(campaigns);
    }

    // ── Campaign view ─────────────────────────────────────────────────────────

    async function showCampaign(campaignId, campaignName, opts = {}) {
        _campSearchActive = false;
        const campData = _campaignCache.find(c => c.id === campaignId) || {};
        WikiSB.state = {
            campaign:  { id: campaignId, name: campaignName, ...campData },
            category:  null,
            entryId:   null,
            entryName: null,
        };
        _pushState();
        showLoading('Loading campaign…');

        // Apply campaign accent colour as CSS custom property
        if (campData.accent_color) {
            container.style.setProperty('--wiki-accent', campData.accent_color);
        } else {
            container.style.removeProperty('--wiki-accent');
        }

        let categories;
        try {
            categories = await API.getCategories(campaignId);
        } catch (e) {
            showError('Could not load campaign.', e.message);
            return;
        }

        let html = `
            <div class="wiki-entry-btns">
                <button id="sb-back-camp" class="wiki-back-btn">← Campaigns</button>
            </div>`;

        if (campData.banner_image) {
            html += _bannerHtml(campData.banner_image, campData.layout || {}, 'wiki-campaign-banner');
        }

        html += `<h2 style="margin-top:0">${esc(campaignName)}</h2>
            <div class="wiki-search-wrap">
                <img src="Assets/TransparentIcons/Crystal_Ball_18x18.png"
                     class="wiki-search-icon" alt="">
                <input type="text" id="sb-camp-search" class="wiki-search-bar"
                       placeholder="Search categories or entries…" autocomplete="off">
            </div>
            <div class="wiki-category-pills" id="sb-cat-pills">`;

        for (const cat of categories) {
            const { icon: nameIcon, displayName } = parseCatName(cat.name);
            const rawIcon = cat.icon || nameIcon;
            const isImgIcon = rawIcon && /^(https?:|\/\/|data:)/i.test(rawIcon);
            const iconHTML = renderIconHTML(rawIcon, '20px');
            html += `<button class="wiki-cat-pill"
                             data-id="${esc(cat.id)}"
                             data-name="${esc(cat.name)}">
                        <span class="wiki-cat-icon${isImgIcon ? ' wiki-cat-icon--img' : ''}">${iconHTML}</span>
                        <span class="wiki-cat-name">${esc(displayName)}</span>
                     </button>`;
        }

        html += `</div><div id="sb-search-results" style="display:none"></div><div id="sb-entry-area"></div>`;
        container.innerHTML = html;

        document.getElementById('sb-back-camp').addEventListener('click', showCampaignList);

        const pills = Array.from(container.querySelectorAll('.wiki-cat-pill'));
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                // Clear search and show normal entry area
                const campSrch = container.querySelector('#sb-camp-search');
                if (campSrch) campSrch.value = '';
                container.querySelectorAll('.wiki-cat-pill').forEach(p => p.style.display = '');
                const sr = document.getElementById('sb-search-results');
                const ea = document.getElementById('sb-entry-area');
                if (sr) { sr.style.display = 'none'; sr.innerHTML = ''; }
                if (ea) ea.style.display = '';
                WikiSB.state.category  = { id: pill.dataset.id, name: pill.dataset.name };
                WikiSB.state.entryId   = null;
                WikiSB.state.entryName = null;
                _pushState();
                showEntries(pill.dataset.id, pill.dataset.name);
            });
        });

        if (opts.initialCategoryId) {
            const target = pills.find(p => p.dataset.id === opts.initialCategoryId);
            if (target) target.click();
            else if (pills.length) pills[0].click();
        } else if (pills.length) {
            pills[0].click();
        }

        // Lazy-load entry counts for category pills
        Promise.all(categories.map(async cat => {
            try {
                const count = await API.getEntryCount(cat.id);
                const pill  = container.querySelector(`.wiki-cat-pill[data-id="${cat.id}"]`);
                if (!pill) return;
                const nameEl = pill.querySelector('.wiki-cat-name');
                if (nameEl) nameEl.insertAdjacentHTML('beforeend', ` <span class="wiki-count">(${count})</span>`);
            } catch { /* non-fatal */ }
        }));

        // Campaign-scoped search
        const campSearchEl = container.querySelector('#sb-camp-search');
        const categoryIds  = categories.map(c => c.id);
        let _campTimer    = null;
        let _campSearchGen = 0;
        if (campSearchEl) {
            campSearchEl.addEventListener('input', e => {
                clearTimeout(_campTimer);
                const q   = e.target.value.trim();
                const gen = ++_campSearchGen;

                // Always filter pills by display name
                container.querySelectorAll('.wiki-cat-pill').forEach(p => {
                    const { displayName } = parseCatName(p.dataset.name);
                    p.style.display = (!q || displayName.toLowerCase().includes(q.toLowerCase())) ? '' : 'none';
                });

                const sr = document.getElementById('sb-search-results');
                const ea = document.getElementById('sb-entry-area');

                if (q.length < 2) {
                    // Restore: hide results pane, show normal entry area
                    if (sr) { sr.style.display = 'none'; sr.innerHTML = ''; }
                    if (ea) ea.style.display = '';
                    const active = container.querySelector('.wiki-cat-pill.active');
                    if (active) showEntries(active.dataset.id, active.dataset.name);
                    return;
                }

                // q ≥ 2 — show dedicated results pane, hide normal entry area
                if (ea) ea.style.display = 'none';
                if (sr) {
                    sr.style.display = '';
                    sr.innerHTML = `<div class="wiki-loading" style="padding:1rem 0"><div class="wiki-spinner"></div></div>`;
                }

                _campTimer = setTimeout(async () => {
                    if (gen !== _campSearchGen) return;
                    const resultsEl = document.getElementById('sb-search-results');
                    if (!resultsEl) return;
                    try {
                        const allHits = await API.searchEntries(q);
                        if (gen !== _campSearchGen) return;
                        const hits = allHits.filter(h => categoryIds.includes(h.category_id));
                        if (!hits.length) {
                            resultsEl.innerHTML = `<p class="wiki-empty">No entries found.</p>`;
                            return;
                        }
                        let h = `<ul class="wiki-entry-list">`;
                        for (const hit of hits) {
                            const catName = parseCatName(hit.categories?.name || '').displayName;
                            h += `
                                <li>
                                    <a class="wiki-entry-link" href="#"
                                       data-id="${esc(hit.id)}" data-name="${esc(hit.name)}"
                                       data-cat-id="${esc(hit.category_id)}"
                                       data-cat-name="${esc(hit.categories?.name || '')}">
                                        ${hit.profile_image ? `<img src="${esc(hit.profile_image)}" alt="" class="wiki-entry-thumb">` : ''}
                                        <span>
                                            <span>${esc(hit.name)}</span>
                                            <span class="wiki-count"> — ${esc(catName)}</span>
                                        </span>
                                    </a>
                                </li>`;
                        }
                        h += '</ul>';
                        resultsEl.innerHTML = h;
                        resultsEl.querySelectorAll('.wiki-entry-link').forEach(a => {
                            a.addEventListener('click', ev => {
                                ev.preventDefault();
                                WikiSB.state.category = a.dataset.catId
                                    ? { id: a.dataset.catId, name: a.dataset.catName } : null;
                                showEntry(a.dataset.id, a.dataset.name);
                            });
                        });
                    } catch (err) {
                        if (gen === _campSearchGen && resultsEl)
                            resultsEl.innerHTML = `<p class="wiki-error-hint">${esc(err.message)}</p>`;
                    }
                }, 300);
            });
        }

        if (WikiSB.onCampaign) WikiSB.onCampaign(campaignId, categories);
    }

    // ── Entry list ────────────────────────────────────────────────────────────

    async function showEntries(categoryId) {
        const area = document.getElementById('sb-entry-area');
        area.innerHTML = `
            <div class="wiki-loading" style="padding:2rem 0">
                <div class="wiki-spinner"></div>
            </div>`;

        let entries;
        try {
            entries = await API.getEntries(categoryId);
        } catch (e) {
            area.innerHTML = `<p class="wiki-error-hint">${esc(e.message)}</p>`;
            return;
        }

        const PAGE_SIZE = 20;

        if (entries.length === 0) {
            area.innerHTML = `<p class="wiki-empty">No entries in this category yet.</p>`;
        } else {
            let html = `<ul class="wiki-entry-list" id="sb-entry-list">`;
            for (const entry of entries) {
                html += `
                    <li data-id="${esc(entry.id)}">
                        <a class="wiki-entry-link" href="#"
                           data-id="${esc(entry.id)}" data-name="${esc(entry.name)}">
                            ${entry.profile_image
                                ? `<img src="${esc(entry.profile_image)}" alt="" class="wiki-entry-thumb">`
                                : ''}
                            <span>${esc(entry.name)}</span>
                        </a>
                    </li>`;
            }
            html += '</ul>';
            area.innerHTML = html;

            area.querySelectorAll('.wiki-entry-link').forEach(a => {
                a.addEventListener('click', ev => {
                    ev.preventDefault();
                    showEntry(a.dataset.id, a.dataset.name);
                });
            });

            // Paginate long lists — hide items beyond page size
            if (entries.length > PAGE_SIZE) {
                const allItems = [...area.querySelectorAll('#sb-entry-list li')];
                let shown = PAGE_SIZE;
                allItems.forEach((li, i) => { if (i >= PAGE_SIZE) li.hidden = true; });

                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.className = 'et-btn wiki-load-more-btn';
                loadMoreBtn.textContent = `Load ${Math.min(PAGE_SIZE, entries.length - shown)} more (${entries.length - shown} remaining)`;
                loadMoreBtn.addEventListener('click', () => {
                    const nextBatch = Math.min(shown + PAGE_SIZE, entries.length);
                    allItems.forEach((li, i) => { if (i >= shown && i < nextBatch) li.hidden = false; });
                    shown = nextBatch;
                    if (shown >= entries.length) loadMoreBtn.remove();
                    else loadMoreBtn.textContent = `Load ${Math.min(PAGE_SIZE, entries.length - shown)} more (${entries.length - shown} remaining)`;
                });
                area.querySelector('#sb-entry-list').after(loadMoreBtn);
            }
        }

        if (WikiSB.onEntries) WikiSB.onEntries(categoryId, entries, area);
    }

    // ── Entry detail ──────────────────────────────────────────────────────────

    async function showEntry(entryId, entryName) {
        WikiSB.state.entryId   = entryId;
        WikiSB.state.entryName = entryName || null;
        _pushState();
        showLoading(`Loading ${entryName || 'entry'}…`);

        let entry;
        try {
            entry = await API.getEntry(entryId);
        } catch (e) {
            showError('Could not load entry.', e.message);
            return;
        }

        const layout               = entry.layout  || {};
        const sidebar              = layout.sidebar              || 'right';
        const pageStyle            = layout.pageStyle            || 'full';
        // normalise legacy 'moon' value → 'moon-full'
        const titleDivider         = layout.titleDivider === 'moon' ? 'moon-full' : (layout.titleDivider || '');
        const titleDividerColor    = layout.titleDividerColor    || 'default';
        const titleDividerThickness= layout.titleDividerThickness|| '1';

        const _tdc     = { default: '#503554', lavender: '#d3b3e7', mint: '#98e6d6', pink: '#f3b0c3' };
        const _tdColor = _tdc[titleDividerColor] || '#503554';
        const _tdPx    = titleDividerThickness + 'px';
        const _tdLs    = `height:${_tdPx};background:`;

        const _renderTitleDiv = (style) => {
            if (style === 'moon-split') {
                return `<div class="wiki-divider wiki-divider--moon">
                    <div class="wiki-divider-line" style="${_tdLs}linear-gradient(to right,transparent,${_tdColor})"></div>
                    <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                    <div class="wiki-divider-line" style="${_tdLs}linear-gradient(to left,transparent,${_tdColor})"></div>
                </div>`;
            } else if (style === 'line') {
                return `<hr style="border-top:${_tdPx} solid ${_tdColor};border-bottom:none;border-left:none;border-right:none">`;
            } else { // moon-full
                return `<div class="wiki-divider wiki-divider--moon-full">
                    <div class="wiki-divider-through-line" style="${_tdLs}linear-gradient(to right,transparent,${_tdColor},transparent)"></div>
                    <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                </div>`;
            }
        };

        // Apply entry accent colour (overrides campaign colour if set)
        if (layout.accentColor) {
            container.style.setProperty('--wiki-accent', layout.accentColor);
        }

        let html = `
            <div class="wiki-entry-btns">
                <button id="sb-back-entry" class="wiki-back-btn">← Back</button>
            </div>`;

        if (pageStyle === 'section') {
            // Any explicit value suppresses the CSS-default moon (section > h2::before/::after)
            const secCls = titleDivider ? ' class="wiki-section--no-head-divider"' : '';
            html += `<section${secCls}>
                <h2>${esc(entry.name)}</h2>`;
            if (titleDivider && titleDivider !== 'none') html += _renderTitleDiv(titleDivider);

            if (entry.subtitle) {
                html += `<p class="wiki-entry-subtitle">${esc(entry.subtitle)}</p>`;
            }

            if (entry.profile_image && sidebar !== 'none') {
                const isLeft = sidebar === 'left' || sidebar === 'float-left';
                const floatCls = isLeft ? 'wiki-section-float-img--left' : 'wiki-section-float-img';
                html += `<img src="${esc(entry.profile_image)}" alt="${esc(entry.name)}"
                              class="wiki-profile-img wiki-zoomable ${floatCls}"
                              data-src="${esc(entry.profile_image)}">`;
            }

            html += `<div id="sb-entry-main">
                        <div id="sb-blocks-area">${renderBlocks(entry.blocks)}</div>
                     </div>
                     <div style="clear:both"></div>
                 </section>`;
        } else {
            if (entry.banner_image) {
                html += _bannerHtml(entry.banner_image, layout, 'wiki-entry-banner');
            }

            const isFloat = sidebar.startsWith('float-');
            const sidebarHTML = (entry.profile_image && sidebar !== 'none')
                ? `<div class="wiki-entry-sidebar" id="sb-entry-sidebar">
                        <img src="${esc(entry.profile_image)}"
                             alt="${esc(entry.name)}" class="wiki-profile-img wiki-zoomable"
                             data-src="${esc(entry.profile_image)}">
                   </div>`
                : '';

            html += `<div class="wiki-entry-layout wiki-sidebar-${esc(sidebar)}">`;

            // Float layouts: sidebar must come first in DOM so content wraps around it
            if (isFloat) html += sidebarHTML;

            html += `<div class="wiki-entry-main" id="sb-entry-main">
                        <h2>${esc(entry.name)}</h2>`;
            if (titleDivider && titleDivider !== 'none') html += _renderTitleDiv(titleDivider);

            if (entry.subtitle) {
                html += `<p class="wiki-entry-subtitle">${esc(entry.subtitle)}</p>`;
            }

            html += `<div id="sb-blocks-area">${renderBlocks(entry.blocks)}</div>
                    </div>`;

            // Non-float layouts: sidebar comes after main (flex handles visual order)
            if (!isFloat) html += sidebarHTML;

            html += '</div>';
        }

        container.innerHTML = html;

        document.getElementById('sb-back-entry').addEventListener('click', () => {
            const { campaign, category } = WikiSB.state;
            if (campaign) showCampaign(campaign.id, campaign.name, category ? { initialCategoryId: category.id } : {});
            else showCampaignList();
        });

        attachAudio(container);

        if (WikiSB.onEntryDetail) WikiSB.onEntryDetail(entry, container);
    }

    // ── Deep-link restore ─────────────────────────────────────────────────────

    async function restoreFromURL() {
        const p            = new URLSearchParams(location.search);
        const campaignName = p.get('campaign');
        const categoryName = p.get('category');
        const entryId      = p.get('entry');

        if (!campaignName) {
            await showCampaignList();
            return;
        }

        try {
            const campaigns = await API.getCampaigns();
            const campaign  = campaigns.find(c => c.name === campaignName);
            if (!campaign) { await showCampaignList(); return; }

            if (entryId) {
                try {
                    const [entry, categories] = await Promise.all([
                        API.getEntry(entryId),
                        API.getCategories(campaign.id),
                    ]);
                    const cat = categories.find(c => c.id === entry.category_id);
                    await showCampaign(campaign.id, campaign.name, cat ? { initialCategoryId: cat.id } : {});
                    if (cat) WikiSB.state.category = { id: cat.id, name: cat.name };
                    await showEntry(entry.id, entry.name);
                } catch { await showCampaign(campaign.id, campaign.name); }
            } else if (categoryName) {
                const categories = await API.getCategories(campaign.id);
                const cat        = categories.find(c => c.name === categoryName);
                await showCampaign(campaign.id, campaign.name, cat ? { initialCategoryId: cat.id } : {});
            } else {
                await showCampaign(campaign.id, campaign.name);
            }
        } catch {
            await showCampaignList();
        }
    }

    window.addEventListener('popstate', () => restoreFromURL());

    // ── Image lightbox ────────────────────────────────────────────────────────

    let _lb = null;
    function openLightbox(src) {
        if (!_lb) {
            _lb = document.getElementById('wiki-lightbox') || document.createElement('div');
            if (!_lb.id) {
                _lb.id = 'wiki-lightbox';
                const img = document.createElement('img');
                img.alt = '';
                _lb.appendChild(img);
                document.body.appendChild(_lb);
                img.addEventListener('click', e => e.stopPropagation());
                document.addEventListener('keydown', e => {
                    if (e.key === 'Escape') _lb.classList.remove('open');
                });
            }
            _lb.addEventListener('click', () => _lb.classList.remove('open'));
        }
        _lb.querySelector('img').src = src;
        _lb.classList.add('open');
    }

    container.addEventListener('click', e => {
        const img = e.target.closest('.wiki-zoomable');
        if (img) { e.preventDefault(); openLightbox(img.dataset.src || img.src); return; }
        const banner = e.target.closest('.wiki-banner-clickable[data-src]');
        if (banner) { openLightbox(banner.dataset.src); return; }
        const entryRef = e.target.closest('.wiki-entry-ref[data-entry-id]');
        if (entryRef && entryRef.dataset.entryId) {
            e.preventDefault();
            showEntry(entryRef.dataset.entryId, entryRef.dataset.entryName);
        }
    });

    // ── Expose navigation for editor ──────────────────────────────────────────

    WikiSB.nav.showCampaignList = showCampaignList;
    WikiSB.nav.showCampaign     = showCampaign;
    WikiSB.nav.showEntry        = showEntry;

    // ── Init — deferred one microtask so wiki-editor.js (loaded after this
    //    script) can register its hooks before the first render fires. ─────────
    Promise.resolve().then(async () => {
        await auth.init();
        await restoreFromURL();
    });

}());
