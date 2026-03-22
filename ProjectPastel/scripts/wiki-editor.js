// ─────────────────────────────────────────────────────────────────────────────
// wiki-editor.js — Inline WYSIWYG editor for the Supabase wiki
// Depends on: api-client.js, auth.js, supabase-fetch.js (WikiSB)
//
// Load order in wiki-supabase.html:
//   1. api-client.js   2. auth.js   3. supabase-fetch.js   4. wiki-editor.js
//
// WikiSB is defined synchronously by supabase-fetch.js. By the time this
// script runs, WikiSB exists and its async init hasn't fired yet, so hooks
// registered here are in place before the first render.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ── Toolbar ───────────────────────────────────────────────────────────────

    const toolbar = document.createElement('div');
    toolbar.id = 'wiki-edit-toolbar';
    toolbar.style.display = 'none'; // hidden until auth confirmed by first hook call
    toolbar.innerHTML = `
        <span id="et-status" class="et-status"></span>
        <div class="et-btn-row">
            <button id="et-edit"      class="et-btn">✏ Edit</button>
            <button id="et-save"      class="et-btn et-primary" style="display:none">✓ Save</button>
            <button id="et-cancel"    class="et-btn"            style="display:none">✗ Cancel</button>
            <button id="et-templates" class="et-btn">📋 Templates</button>
            <button id="et-media"     class="et-btn">📁 Media</button>
            <button id="et-logout"    class="et-btn et-danger">⏻ Log out</button>
        </div>`;
    document.body.appendChild(toolbar);

    const etEdit      = document.getElementById('et-edit');
    const etSave      = document.getElementById('et-save');
    const etCancel    = document.getElementById('et-cancel');
    const etTemplates = document.getElementById('et-templates');
    const etMedia     = document.getElementById('et-media');
    const etLogout    = document.getElementById('et-logout');
    const etStatus    = document.getElementById('et-status');

    function setStatus(msg, isErr) {
        etStatus.textContent = msg;
        etStatus.style.color = isErr ? '#f3b0c3' : '#a08ab0';
    }

    // Hide the "Edit" button when not on an entry detail view
    function resetToolbar() {
        etEdit.style.display   = 'none';
        etSave.style.display   = 'none';
        etCancel.style.display = 'none';
        setStatus('');
    }

    etLogout.addEventListener('click', async () => {
        await auth.signOut();
        location.reload();
    });

    // ── Guard: only show editor UI to authenticated editors ───────────────────

    function editorGuard() {
        if (!auth.isEditor()) return false;
        toolbar.style.display = '';
        return true;
    }

    // ── Cloudinary signed upload ──────────────────────────────────────────────
    // Credentials never appear here — the Worker signs the request after
    // verifying the caller holds a valid Supabase editor session.

    const _SIGN_WORKER_URL = 'voidverse-upload-sign.hazardousmadness.workers.dev';

    async function _cloudinaryUpload(file, folder = 'Uncategorized') {
        // 1. Get the current Supabase session token
        const session = await API.getSession();
        if (!session?.access_token) throw new Error('Not logged in');

        // 2. Ask the Worker to sign an upload (verifies editor auth server-side)
        const sigRes = await fetch(`https://${_SIGN_WORKER_URL}`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (!sigRes.ok) throw new Error('Could not get upload token (' + sigRes.status + ')');
        const { cloud_name, api_key, signature, timestamp, folder: cloudFolder } = await sigRes.json();

        // 3. Upload directly to Cloudinary using the signed parameters
        const fd = new FormData();
        fd.append('file',      file);
        fd.append('api_key',   api_key);
        fd.append('timestamp', timestamp);
        fd.append('signature', signature);
        fd.append('folder',    cloudFolder);
        const upRes = await fetch(
            `https://api.cloudinary.com/v1_1/${cloud_name}/auto/upload`,
            { method: 'POST', body: fd }
        );
        if (!upRes.ok) throw new Error('Upload failed (' + upRes.status + ')');
        const json = await upRes.json();
        if (json.error) throw new Error(json.error.message);

        // 4. Save metadata to Supabase media library (swallow failures — upload already succeeded)
        API.createMediaAsset({
            url:           json.secure_url,
            public_id:     json.public_id,
            filename:      file.name || json.original_filename || '',
            resource_type: json.resource_type || 'image',
            format:        json.format,
            bytes:         json.bytes,
            width:         json.width,
            height:        json.height,
            folder,
        }).catch(() => {});

        return json.secure_url;
    }

    // ── Editor.js lazy loading ────────────────────────────────────────────────

    const EDITORJS_CDNS = [
        'https://cdn.jsdelivr.net/npm/@editorjs/editorjs@latest',
        'https://cdn.jsdelivr.net/npm/@editorjs/list@1',
        // @editorjs/image replaced by local ImageTool below
        // @editorjs/quote replaced by local QuoteTool below
        // @editorjs/delimiter replaced by local DelimiterTool below
        'https://cdn.jsdelivr.net/npm/@editorjs/table@2',
        'https://cdn.jsdelivr.net/npm/@editorjs/embed@2',
    ];

    let _editorJsReady = false;

    async function ensureEditorJS() {
        if (_editorJsReady) return;
        for (const src of EDITORJS_CDNS) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = () => reject(new Error('Failed to load: ' + src));
                document.head.appendChild(s);
            });
        }
        _editorJsReady = true;
    }

    // ── Custom Editor.js tools ────────────────────────────────────────────────

    // ── Custom heading tool (replaces @editorjs/header CDN) ─────────────────

    class HeadingTool {
        static get toolbox() {
            return { title: 'Heading', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 20h-2v-7H4v7H2V4h2v7h7V4h2v16zm5.5-2.5 1.5 1.5-3.75 3.75L14.5 21l1.5-1.5 1 1 2.5-3z"/></svg>' };
        }
        static get sanitize() {
            return { text: { b: true, i: true, em: true, strong: true, u: true, a: { href: true } } };
        }
        static get conversionConfig() { return { export: 'text', import: 'text' }; }
        static get pasteConfig() { return { tags: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] }; }

        constructor({ data }) {
            this._data = {
                text:    data.text    || '',
                level:   data.level   || 2,
                color:   data.color   || '',
                align:   data.align   || '',
                bold:    !!data.bold,
                divider: data.divider || 'none',
            };
            this._wrap = null;
            this._el   = null;
        }

        render() {
            this._wrap = document.createElement('div');
            this._wrap.className = 'ej-heading-wrap';
            this._el = this._makeEl();
            this._wrap.appendChild(this._el);
            this._applyStyles();
            return this._wrap;
        }

        _makeEl() {
            const el = document.createElement(`h${this._data.level}`);
            el.contentEditable = 'true';
            el.className = 'ej-heading-el';
            el.dataset.placeholder = `Heading ${this._data.level}`;
            el.innerHTML = this._data.text;
            return el;
        }

        _applyStyles() {
            if (!this._el || !this._wrap) return;
            this._el.style.color      = this._data.color || '';
            this._el.style.textAlign  = this._data.align || '';
            this._el.style.fontWeight = this._data.bold  ? 'bold' : '';
            this._wrap.classList.toggle('ej-heading--divider-full', this._data.divider === 'full');
            this._wrap.classList.toggle('ej-heading--divider-text', this._data.divider === 'text');
        }

        renderSettings() {
            const root = document.createElement('div');

            const sep = () => {
                const s = document.createElement('div');
                s.className = 'ce-popover-item-separator';
                s.innerHTML = '<div class="ce-popover-item-separator__line"></div>';
                return s;
            };

            const mkGroup = (defs) => {
                const els = defs.map(({ icon, label, isActive, onSelect }) => {
                    const el = document.createElement('div');
                    el.className = 'ce-popover-item' + (isActive() ? ' ce-popover-item--active' : '');
                    el.innerHTML = `<div class="ce-popover-item__icon">${icon}</div><div class="ce-popover-item__title">${label}</div>`;
                    el.addEventListener('click', () => {
                        els.forEach(e => e.classList.remove('ce-popover-item--active'));
                        el.classList.add('ce-popover-item--active');
                        onSelect();
                    });
                    return el;
                });
                return els;
            };

            const mkToggle = (icon, label, isActive, onToggle) => {
                const el = document.createElement('div');
                el.className = 'ce-popover-item' + (isActive() ? ' ce-popover-item--active' : '');
                el.innerHTML = `<div class="ce-popover-item__icon">${icon}</div><div class="ce-popover-item__title">${label}</div>`;
                el.addEventListener('click', () => {
                    el.classList.toggle('ce-popover-item--active');
                    onToggle();
                });
                return el;
            };

            // Level
            mkGroup([
                { icon: '<b>H2</b>', label: 'Heading 2', isActive: () => this._data.level === 2, onSelect: () => this._changeLevel(2) },
                { icon: '<b>H3</b>', label: 'Heading 3', isActive: () => this._data.level === 3, onSelect: () => this._changeLevel(3) },
                { icon: '<b>H4</b>', label: 'Heading 4', isActive: () => this._data.level === 4, onSelect: () => this._changeLevel(4) },
            ]).forEach(el => root.appendChild(el));

            root.appendChild(sep());

            // Colour
            const swatch = (col) => col
                ? `<span style="width:12px;height:12px;border-radius:50%;background:${col};display:block;margin:auto"></span>`
                : '<span style="font-size:10px;line-height:1">✕</span>';
            mkGroup([
                { icon: swatch(''),        label: 'Default',  isActive: () => this._data.color === '',        onSelect: () => { this._data.color = '';        this._applyStyles(); } },
                { icon: swatch('#d3b3e7'), label: 'Lavender', isActive: () => this._data.color === '#d3b3e7', onSelect: () => { this._data.color = '#d3b3e7'; this._applyStyles(); } },
                { icon: swatch('#98e6d6'), label: 'Mint',     isActive: () => this._data.color === '#98e6d6', onSelect: () => { this._data.color = '#98e6d6'; this._applyStyles(); } },
                { icon: swatch('#f3b0c3'), label: 'Pink',     isActive: () => this._data.color === '#f3b0c3', onSelect: () => { this._data.color = '#f3b0c3'; this._applyStyles(); } },
                { icon: swatch('#f4f4f4'), label: 'White',    isActive: () => this._data.color === '#f4f4f4', onSelect: () => { this._data.color = '#f4f4f4'; this._applyStyles(); } },
            ]).forEach(el => root.appendChild(el));

            root.appendChild(sep());

            // Alignment
            mkGroup([
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm0 4h12v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z"/></svg>', label: 'Left',   isActive: () => this._data.align === '',       onSelect: () => { this._data.align = '';       this._applyStyles(); } },
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm3 4h12v2H6V9zm-3 4h18v2H3v-2zm3 4h12v2H6v-2z"/></svg>', label: 'Center', isActive: () => this._data.align === 'center', onSelect: () => { this._data.align = 'center'; this._applyStyles(); } },
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm6 4h12v2H9V9zm-6 4h18v2H3v-2zm6 4h12v2H9v-2z"/></svg>', label: 'Right',  isActive: () => this._data.align === 'right',  onSelect: () => { this._data.align = 'right';  this._applyStyles(); } },
            ]).forEach(el => root.appendChild(el));

            root.appendChild(sep());

            // Bold
            root.appendChild(mkToggle('<b>B</b>', 'Bold', () => this._data.bold, () => { this._data.bold = !this._data.bold; this._applyStyles(); }));

            root.appendChild(sep());

            // Divider
            mkGroup([
                { icon: '✕',
                  label: 'No divider',
                  isActive: () => this._data.divider === 'none',
                  onSelect: () => { this._data.divider = 'none'; this._applyStyles(); } },
                { icon: '<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor"><rect y="3" width="14" height="2"/></svg>',
                  label: 'Full-width divider',
                  isActive: () => this._data.divider === 'full',
                  onSelect: () => { this._data.divider = 'full'; this._applyStyles(); } },
                { icon: '<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor"><rect y="3" width="7" height="2"/></svg>',
                  label: 'Text-width divider',
                  isActive: () => this._data.divider === 'text',
                  onSelect: () => { this._data.divider = 'text'; this._applyStyles(); } },
            ]).forEach(el => root.appendChild(el));

            return root;
        }

        _changeLevel(lvl) {
            if (this._el) this._data.text = this._el.innerHTML; // preserve current content
            this._data.level = lvl;
            const newEl = this._makeEl();
            this._wrap.replaceChild(newEl, this._el);
            this._el = newEl;
            this._applyStyles();
        }

        save(wrap) {
            const el = wrap.querySelector('.ej-heading-el');
            return {
                text:    el ? el.innerHTML : '',
                level:   this._data.level,
                color:   this._data.color  || '',
                align:   this._data.align  || '',
                bold:    this._data.bold   || false,
                divider: this._data.divider || 'none',
            };
        }
    }

    class AudioTool {
        static get toolbox() {
            return { title: 'Audio', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>' };
        }
        constructor({ data }) { this._data = data || {}; }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap';

            // Upload row
            const uploadRow = document.createElement('div');
            uploadRow.className = 'ej-upload-row';
            const fileInp = document.createElement('input');
            fileInp.type = 'file'; fileInp.accept = 'audio/*'; fileInp.style.display = 'none';
            const uploadBtn = document.createElement('button');
            uploadBtn.type = 'button';
            uploadBtn.className = 'et-btn ej-upload-btn';
            uploadBtn.textContent = '⬆ Upload audio';
            const uploadStatus = document.createElement('span');
            uploadStatus.className = 'ej-upload-status';
            uploadRow.appendChild(fileInp);
            uploadRow.appendChild(uploadBtn);
            uploadRow.appendChild(uploadStatus);

            const urlInp = document.createElement('input');
            urlInp.className = 'ej-input'; urlInp.type = 'url';
            urlInp.placeholder = 'Audio URL (.mp3, .ogg, .wav) — or upload above';
            urlInp.value = this._data.url || '';
            const capInp = document.createElement('input');
            capInp.className = 'ej-input'; capInp.type = 'text';
            capInp.placeholder = 'Caption / label (optional)';
            capInp.value = this._data.caption || '';
            const labelInp = document.createElement('input');
            labelInp.className = 'ej-input ej-label-input'; labelInp.type = 'text';
            labelInp.placeholder = 'Section label (optional, e.g. "SOUNDTRACK")';
            labelInp.value = this._data.label || '';

            uploadBtn.addEventListener('click', () => fileInp.click());
            fileInp.addEventListener('change', async () => {
                const file = fileInp.files[0];
                if (!file) return;
                uploadBtn.disabled = true;
                uploadStatus.textContent = 'Uploading…';
                try {
                    const url = await _cloudinaryUpload(file);
                    urlInp.value = url;
                    uploadStatus.textContent = '✓ ' + file.name;
                } catch (err) {
                    uploadStatus.textContent = '✕ ' + err.message;
                } finally {
                    uploadBtn.disabled = false;
                }
            });

            const browseBtn = document.createElement('button');
            browseBtn.type = 'button';
            browseBtn.className = 'et-btn ej-upload-btn';
            browseBtn.textContent = '📂 Library';
            browseBtn.addEventListener('click', () =>
                _showMediaPicker(url => { urlInp.value = url; uploadStatus.textContent = '✓ from library'; }, { accept: 'audio' })
            );
            uploadRow.appendChild(browseBtn);

            wrap.appendChild(uploadRow);
            wrap.appendChild(urlInp); wrap.appendChild(capInp); wrap.appendChild(labelInp);
            return wrap;
        }
        save(el) {
            const [u, c] = el.querySelectorAll('input[type="url"], input[type="text"]:not(.ej-label-input)');
            const label = el.querySelector('.ej-label-input')?.value.trim() || '';
            return { url: u.value.trim(), caption: c.value.trim(), label };
        }
        validate(d) { return !!d.url; }
    }

    class CalloutTool {
        static get toolbox() {
            return { title: 'Callout', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>' };
        }
        constructor({ data }) { this._data = data || {}; }
        render() {
            const _VARIANTS = [['info','💡 Info'],['warning','⚠️ Warning'],['danger','🔴 Danger'],['success','✅ Success']];
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap';
            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;gap:6px;align-items:center';
            const varSel = document.createElement('select');
            varSel.className = 'ej-input ej-select'; varSel.style.width = 'auto';
            _VARIANTS.forEach(([v, l]) => {
                const opt = document.createElement('option');
                opt.value = v; opt.textContent = l;
                if (v === (this._data.variant || 'info')) opt.selected = true;
                varSel.appendChild(opt);
            });
            const emojiInp = document.createElement('input');
            emojiInp.className = 'ej-input ej-emoji'; emojiInp.type = 'text';
            emojiInp.placeholder = '(emoji)'; emojiInp.maxLength = 4;
            emojiInp.value = this._data.emoji || '';
            topRow.appendChild(varSel); topRow.appendChild(emojiInp);
            const textInp = document.createElement('input');
            textInp.className = 'ej-input'; textInp.type = 'text';
            textInp.placeholder = 'Callout text';
            textInp.value = this._data.html || '';
            wrap.appendChild(topRow); wrap.appendChild(textInp);
            return wrap;
        }
        save(el) {
            const varSel   = el.querySelector('select');
            const [ei, ti] = el.querySelectorAll('input');
            const defEmoji = { info:'💡', warning:'⚠️', danger:'🔴', success:'✅' };
            const variant  = varSel.value;
            return { variant, emoji: ei.value.trim() || defEmoji[variant], html: ti.value.trim() };
        }
        validate(d) { return !!d.html; }
    }

    class ColumnsTool {
        static get toolbox() {
            return { title: 'Columns', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5v14h8V5H3zm10 0v14h8V5h-8z"/></svg>' };
        }

        // Normalise any legacy item format to the new {blocks, width, style} shape
        static _normaliseItem(item) {
            if (Array.isArray(item)) return { blocks: item, width: 1, style: {} };
            if (item && typeof item === 'object') {
                return {
                    blocks: Array.isArray(item.blocks) ? item.blocks : (Array.isArray(item) ? item : []),
                    width:  item.width  || 1,
                    style:  item.style  || {},
                };
            }
            return { blocks: [], width: 1, style: {} };
        }

        constructor({ data, api }) {
            this._api        = api;
            this._subEditors = [];
            this._colWrappers = []; // [{ wrapEl, holderEl, widthInp, borderSel, bgSel, padSel, radiusSel }]
            this._grid       = null;
            this._addColBtn  = null;
            this._remColBtn  = null;
            this._tools      = null;

            const rawItems = data?.items?.length
                ? data.items.map(ColumnsTool._normaliseItem)
                : [{ blocks: [], width: 1, style: {} }, { blocks: [], width: 1, style: {} }];
            this._data = { label: data?.label || '', items: rawItems };
        }

        _syncGrid() {
            const tpl = this._colWrappers.map(c => `${Math.max(1, parseInt(c.widthInp.value) || 1)}fr`).join(' ');
            this._grid.style.gridTemplateColumns = tpl;
            this._addColBtn.disabled = this._colWrappers.length >= 6;
            this._remColBtn.disabled = this._colWrappers.length <= 1;
        }

        _makeColWrap(itemData) {
            const d = ColumnsTool._normaliseItem(itemData);
            const s = d.style || {};

            const wrapEl = document.createElement('div');
            wrapEl.className = 'ej-col-wrap';

            // ── Settings header ──────────────────────────────────────────────
            const hdr = document.createElement('div');
            hdr.className = 'ej-col-settings-hdr';

            const toggle = document.createElement('button');
            toggle.className = 'ej-col-settings-toggle';
            toggle.type = 'button'; toggle.title = 'Column settings';
            toggle.innerHTML = '⚙';
            hdr.appendChild(toggle);

            const panel = document.createElement('div');
            panel.className = 'ej-col-settings-panel';

            // Width
            const widthInp = document.createElement('input');
            widthInp.type = 'number'; widthInp.className = 'ej-input ej-col-width-inp';
            widthInp.min = '1'; widthInp.max = '12'; widthInp.value = d.width || 1;
            widthInp.title = 'Relative width (e.g. 1 = equal share, 2 = twice as wide)';
            widthInp.addEventListener('input', () => this._syncGrid());

            const widthRow = document.createElement('div');
            widthRow.className = 'ej-col-settings-row';
            widthRow.innerHTML = '<span>Width (fr):</span>';
            widthRow.appendChild(widthInp);
            panel.appendChild(widthRow);

            // Style selects
            const mkSel = (label, opts, current) => {
                const row = document.createElement('div');
                row.className = 'ej-col-settings-row';
                row.innerHTML = `<span>${label}:</span>`;
                const sel = document.createElement('select');
                sel.className = 'ej-input ej-select ej-col-style-sel';
                opts.forEach(([v, l]) => {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = l;
                    if (v === (current || 'none')) o.selected = true;
                    sel.appendChild(o);
                });
                row.appendChild(sel);
                panel.appendChild(row);
                return sel;
            };

            const borderSel = mkSel('Border', [
                ['none','None'], ['lavender','Lavender'], ['mint','Mint'],
                ['pink','Pink'], ['subtle','Subtle'],
            ], s.border);
            const bgSel = mkSel('Background', [
                ['none','None'], ['dark','Dark'], ['darker','Darker'],
                ['lavender','Lavender tint'], ['mint','Mint tint'], ['pink','Pink tint'],
            ], s.background);
            const padSel = mkSel('Padding', [
                ['none','None'], ['sm','Small'], ['md','Medium'], ['lg','Large'],
            ], s.padding);
            const radiusSel = mkSel('Radius', [
                ['none','None'], ['sm','Small'], ['md','Medium'], ['lg','Large'],
            ], s.radius);
            const alignSel = mkSel('Align', [
                ['','Default'], ['left','Left'], ['center','Center'], ['right','Right'], ['justify','Justify'],
            ], s.align || '');

            toggle.addEventListener('click', () => {
                const open = panel.classList.toggle('ej-col-settings-panel--open');
                toggle.classList.toggle('ej-col-settings-toggle--active', open);
            });

            wrapEl.appendChild(hdr);
            wrapEl.appendChild(panel);

            // ── EditorJS holder ──────────────────────────────────────────────
            const holderEl = document.createElement('div');
            holderEl.className = 'ej-col-holder';
            holderEl.id = `ej-col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            wrapEl.appendChild(holderEl);

            return { wrapEl, holderEl, widthInp, borderSel, bgSel, padSel, radiusSel, alignSel, blocks: d.blocks };
        }

        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap';

            const labelInp = document.createElement('input');
            labelInp.className = 'ej-input ej-label-input'; labelInp.type = 'text';
            labelInp.placeholder = 'Section label (optional)';
            labelInp.value = this._data.label || '';
            wrap.appendChild(labelInp);

            const hdr = document.createElement('div');
            hdr.className = 'ej-cols-header';

            this._addColBtn = document.createElement('button');
            this._addColBtn.className = 'et-btn ej-cols-ctrl-btn'; this._addColBtn.type = 'button';
            this._addColBtn.textContent = '+ Add column';
            this._addColBtn.disabled = this._data.items.length >= 6;

            this._remColBtn = document.createElement('button');
            this._remColBtn.className = 'et-btn ej-cols-ctrl-btn'; this._remColBtn.type = 'button';
            this._remColBtn.textContent = '− Remove last';
            this._remColBtn.disabled = this._data.items.length <= 1;

            hdr.appendChild(this._addColBtn);
            hdr.appendChild(this._remColBtn);
            wrap.appendChild(hdr);

            this._grid = document.createElement('div');
            this._grid.className = 'ej-cols-grid';
            this._grid.style.gridTemplateColumns = this._data.items.map(it => `${it.width || 1}fr`).join(' ');

            this._colWrappers = [];
            for (const itemData of this._data.items) {
                const colObj = this._makeColWrap(itemData);
                this._colWrappers.push(colObj);
                this._grid.appendChild(colObj.wrapEl);
            }

            wrap.appendChild(this._grid);
            return wrap;
        }

        rendered() {
            // Guard against re-initialization when EditorJS reorders blocks (DOM move + re-call)
            if (this._subEditors.length > 0 && this._colWrappers.every(c => c.holderEl.isConnected)) {
                return;
            }
            this._subEditors.forEach(ed => { try { ed.destroy(); } catch {} });
            this._subEditors = [];

            this._tools = {
                header: { class: HeadingTool, inlineToolbar: true },
                list:        { class: List,       inlineToolbar: true },
                image:       { class: ImageTool },
                quote:       { class: QuoteTool, inlineToolbar: true },
                delimiter:   { class: DelimiterTool },
                audio:       { class: AudioTool },
                callout:     { class: CalloutTool },
                toggle:      { class: ToggleTool, inlineToolbar: true },
                bookmark:    { class: BookmarkTool },
                spacer:      { class: SpacerTool },
                props_block: { class: PropsBlockTool },
                duplicate:   { class: DuplicateTune },
            };

            this._subEditors = this._colWrappers.map((colObj, i) => new EditorJS({
                holder:      colObj.holderEl,
                data:        blocksToEditorData(colObj.blocks || []),
                placeholder: `Column ${i + 1}…`,
                minHeight:   80,
                tools:       this._tools,
                tunes:       ['duplicate'],
            }));

            this._addColBtn.addEventListener('click', () => {
                if (this._colWrappers.length >= 6) return;
                const colObj = this._makeColWrap({ blocks: [], width: 1, style: {} });
                this._colWrappers.push(colObj);
                this._grid.appendChild(colObj.wrapEl);
                this._subEditors.push(new EditorJS({
                    holder:      colObj.holderEl,
                    data:        { blocks: [] },
                    placeholder: `Column ${this._colWrappers.length}…`,
                    minHeight:   80,
                    tools:       this._tools,
                }));
                this._syncGrid();
            });

            this._remColBtn.addEventListener('click', async () => {
                if (this._colWrappers.length <= 1) return;
                const lastEditor = this._subEditors[this._subEditors.length - 1];
                try {
                    await lastEditor.isReady;
                    const saved = await lastEditor.save();
                    const hasContent = (saved.blocks || []).some(b =>
                        b.data?.text || b.data?.items?.length || b.data?.url || b.data?.rows?.length
                    );
                    if (hasContent && !await _dlgConfirm('Remove Column', 'The last column has content that will be lost.', { okLabel: 'Remove', danger: true })) return;
                    await lastEditor.destroy();
                } catch {}
                this._subEditors.pop();
                this._colWrappers.pop().wrapEl.remove();
                this._syncGrid();
            });
        }

        async save(el) {
            const label = el.querySelector('.ej-label-input')?.value.trim() || '';
            const items = [];
            for (let i = 0; i < this._subEditors.length; i++) {
                const editor = this._subEditors[i];
                const c = this._colWrappers[i];
                let blocks = [];
                try { await editor.isReady; blocks = editorDataToBlocks(await editor.save()); } catch {}
                items.push({
                    blocks,
                    width: Math.max(1, parseInt(c.widthInp.value) || 1),
                    style: {
                        border:     c.borderSel.value,
                        background: c.bgSel.value,
                        padding:    c.padSel.value,
                        radius:     c.radiusSel.value,
                        align:      c.alignSel.value,
                    },
                });
            }
            return { items, label };
        }
        destroy() {
            this._subEditors.forEach(ed => { try { ed.destroy(); } catch {} });
            this._subEditors = [];
        }
        validate() { return true; }
    }

    class ToggleTool {
        static get toolbox() {
            return { title: 'Toggle', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>' };
        }
        static get sanitize() {
            return { text: { b: true, i: true, em: true, strong: true, u: true, a: { href: true } } };
        }

        constructor({ data }) {
            this._subEditor          = null;
            this._wrapEl             = null;
            this._holderEl           = null;
            this._headEl             = null;
            this._headWrap           = null;
            this._openBtn            = null;
            this._bodyWrap           = null;
            this._closeOnOutsideClick = null;
            this._border             = !!data?.border;
            this._separator          = !!data?.separator;

            const hRaw = data?.heading;
            this._headData = (hRaw && typeof hRaw === 'object') ? {
                html:    hRaw.html    || '',
                level:   hRaw.level   || 2,
                color:   hRaw.color   || '',
                align:   hRaw.align   || '',
                bold:    !!hRaw.bold,
                divider: hRaw.divider || 'none',
            } : {
                html:    (typeof hRaw === 'string' ? hRaw : ''),
                level:   2,
                color:   '',
                align:   '',
                bold:    false,
                divider: 'none',
            };
            // Backwards compat: old body string → single paragraph block
            this._blocks = Array.isArray(data?.blocks) ? data.blocks
                : (data?.body ? [{ type: 'paragraph', content: { html: data.body } }] : []);
            this._open = true; // always open in editor
        }

        render() {
            const wrap = document.createElement('div');
            this._wrapEl = wrap;
            wrap.className = 'ej-toggle-wrap';
            if (this._border) wrap.classList.add('ej-toggle--bordered');

            // ── Header row: chevron + editable heading ────────────────────
            const headRow = document.createElement('div');
            headRow.className = 'ej-toggle-head-row';

            this._openBtn = document.createElement('button');
            this._openBtn.type = 'button';
            this._openBtn.className = 'ej-toggle-chevron';
            if (this._open) this._openBtn.classList.add('ej-toggle-chevron--open');
            this._openBtn.innerHTML = '▶';
            this._openBtn.addEventListener('click', () => {
                this._open = !this._open;
                this._openBtn.classList.toggle('ej-toggle-chevron--open', this._open);
                this._bodyWrap.classList.toggle('ej-toggle-body--open', this._open);
                // Trigger resize so EditorJS recalculates toolbar positions after becoming visible
                if (this._open) window.dispatchEvent(new Event('resize'));
            });
            headRow.appendChild(this._openBtn);

            this._headWrap = document.createElement('div');
            this._headWrap.className = 'ej-toggle-head-wrap ej-heading-wrap';
            this._headEl = this._makeHeadEl();
            this._headWrap.appendChild(this._headEl);
            this._applyHeadStyles();
            headRow.appendChild(this._headWrap);
            wrap.appendChild(headRow);

            // ── Body (nested EditorJS) ─────────────────────────────────────
            this._bodyWrap = document.createElement('div');
            this._bodyWrap.className = 'ej-toggle-body';
            if (this._open)     this._bodyWrap.classList.add('ej-toggle-body--open');
            if (this._separator) this._bodyWrap.classList.add('ej-toggle--separator');

            this._holderEl = document.createElement('div');
            this._holderEl.className = 'ej-col-holder ej-toggle-holder';
            this._holderEl.id = `ej-toggle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            this._bodyWrap.appendChild(this._holderEl);
            wrap.appendChild(this._bodyWrap);

            return wrap;
        }

        _makeHeadEl() {
            const el = document.createElement(`h${this._headData.level}`);
            el.contentEditable = 'true';
            el.className = 'ej-heading-el ej-toggle-head-el';
            el.dataset.placeholder = 'Toggle heading';
            el.innerHTML = this._headData.html;
            return el;
        }

        _applyHeadStyles() {
            if (!this._headEl || !this._headWrap) return;
            const h = this._headData;
            this._headEl.style.color      = h.color || '';
            this._headEl.style.textAlign  = h.align || '';
            this._headEl.style.fontWeight = h.bold  ? 'bold' : '';
            this._headWrap.classList.toggle('ej-heading--divider-full', h.divider === 'full');
            this._headWrap.classList.toggle('ej-heading--divider-text', h.divider === 'text');
        }

        _changeLevel(lvl) {
            if (this._headEl) this._headData.html = this._headEl.innerHTML; // preserve current content
            this._headData.level = lvl;
            const newEl = this._makeHeadEl();
            this._headWrap.replaceChild(newEl, this._headEl);
            this._headEl = newEl;
            this._applyHeadStyles();
        }

        renderSettings() {
            const root = document.createElement('div');
            const sep = () => {
                const s = document.createElement('div');
                s.className = 'ce-popover-item-separator';
                s.innerHTML = '<div class="ce-popover-item-separator__line"></div>';
                return s;
            };
            const mkGroup = (defs) => {
                const els = defs.map(({ icon, label, isActive, onSelect }) => {
                    const el = document.createElement('div');
                    el.className = 'ce-popover-item' + (isActive() ? ' ce-popover-item--active' : '');
                    el.innerHTML = `<div class="ce-popover-item__icon">${icon}</div><div class="ce-popover-item__title">${label}</div>`;
                    el.addEventListener('click', () => {
                        els.forEach(e => e.classList.remove('ce-popover-item--active'));
                        el.classList.add('ce-popover-item--active');
                        onSelect();
                    });
                    return el;
                });
                return els;
            };
            const mkToggle = (icon, label, isActive, onToggle) => {
                const el = document.createElement('div');
                el.className = 'ce-popover-item' + (isActive() ? ' ce-popover-item--active' : '');
                el.innerHTML = `<div class="ce-popover-item__icon">${icon}</div><div class="ce-popover-item__title">${label}</div>`;
                el.addEventListener('click', () => { el.classList.toggle('ce-popover-item--active'); onToggle(); });
                return el;
            };

            // Level
            mkGroup([
                { icon: '<b>H2</b>', label: 'Heading 2', isActive: () => this._headData.level === 2, onSelect: () => this._changeLevel(2) },
                { icon: '<b>H3</b>', label: 'Heading 3', isActive: () => this._headData.level === 3, onSelect: () => this._changeLevel(3) },
                { icon: '<b>H4</b>', label: 'Heading 4', isActive: () => this._headData.level === 4, onSelect: () => this._changeLevel(4) },
            ]).forEach(el => root.appendChild(el));
            root.appendChild(sep());

            // Colour
            const swatch = (col) => col
                ? `<span style="width:12px;height:12px;border-radius:50%;background:${col};display:block;margin:auto"></span>`
                : '<span style="font-size:10px;line-height:1">✕</span>';
            mkGroup([
                { icon: swatch(''),        label: 'Default',  isActive: () => this._headData.color === '',        onSelect: () => { this._headData.color = '';        this._applyHeadStyles(); } },
                { icon: swatch('#d3b3e7'), label: 'Lavender', isActive: () => this._headData.color === '#d3b3e7', onSelect: () => { this._headData.color = '#d3b3e7'; this._applyHeadStyles(); } },
                { icon: swatch('#98e6d6'), label: 'Mint',     isActive: () => this._headData.color === '#98e6d6', onSelect: () => { this._headData.color = '#98e6d6'; this._applyHeadStyles(); } },
                { icon: swatch('#f3b0c3'), label: 'Pink',     isActive: () => this._headData.color === '#f3b0c3', onSelect: () => { this._headData.color = '#f3b0c3'; this._applyHeadStyles(); } },
                { icon: swatch('#f4f4f4'), label: 'White',    isActive: () => this._headData.color === '#f4f4f4', onSelect: () => { this._headData.color = '#f4f4f4'; this._applyHeadStyles(); } },
            ]).forEach(el => root.appendChild(el));
            root.appendChild(sep());

            // Alignment
            mkGroup([
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm0 4h12v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z"/></svg>', label: 'Left',   isActive: () => this._headData.align === '',       onSelect: () => { this._headData.align = '';       this._applyHeadStyles(); } },
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm3 4h12v2H6V9zm-3 4h18v2H3v-2zm3 4h12v2H6v-2z"/></svg>', label: 'Center', isActive: () => this._headData.align === 'center', onSelect: () => { this._headData.align = 'center'; this._applyHeadStyles(); } },
                { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm6 4h12v2H9V9zm-6 4h18v2H3v-2zm6 4h12v2H9v-2z"/></svg>', label: 'Right',  isActive: () => this._headData.align === 'right',  onSelect: () => { this._headData.align = 'right';  this._applyHeadStyles(); } },
            ]).forEach(el => root.appendChild(el));
            root.appendChild(sep());

            // Bold
            root.appendChild(mkToggle('<b>B</b>', 'Bold', () => this._headData.bold, () => { this._headData.bold = !this._headData.bold; this._applyHeadStyles(); }));
            root.appendChild(sep());

            // Divider
            mkGroup([
                { icon: '✕',
                  label: 'No divider',
                  isActive: () => this._headData.divider === 'none',
                  onSelect: () => { this._headData.divider = 'none'; this._applyHeadStyles(); } },
                { icon: '<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor"><rect y="3" width="14" height="2"/></svg>',
                  label: 'Full-width divider',
                  isActive: () => this._headData.divider === 'full',
                  onSelect: () => { this._headData.divider = 'full'; this._applyHeadStyles(); } },
                { icon: '<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor"><rect y="3" width="7" height="2"/></svg>',
                  label: 'Text-width divider',
                  isActive: () => this._headData.divider === 'text',
                  onSelect: () => { this._headData.divider = 'text'; this._applyHeadStyles(); } },
            ]).forEach(el => root.appendChild(el));

            root.appendChild(sep());

            // Outer border
            root.appendChild(mkToggle(
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
                'Outer border',
                () => this._border,
                () => {
                    this._border = !this._border;
                    if (this._wrapEl) this._wrapEl.classList.toggle('ej-toggle--bordered', this._border);
                }
            ));

            // Separator between heading and body
            root.appendChild(mkToggle(
                '<svg width="14" height="8" viewBox="0 0 14 8" fill="currentColor"><rect y="3" width="14" height="2"/></svg>',
                'Separator line',
                () => this._separator,
                () => {
                    this._separator = !this._separator;
                    if (this._bodyWrap) this._bodyWrap.classList.toggle('ej-toggle--separator', this._separator);
                }
            ));

            return root;
        }

        rendered() {
            if (this._subEditor && this._holderEl.isConnected) return;
            if (this._subEditor) { try { this._subEditor.destroy(); } catch {} this._subEditor = null; }

            const tools = {
                header:      { class: HeadingTool, inlineToolbar: true },
                list:        { class: List,         inlineToolbar: true },
                image:       { class: ImageTool },
                quote:       { class: QuoteTool, inlineToolbar: true },
                delimiter:   { class: DelimiterTool },
                audio:       { class: AudioTool },
                callout:     { class: CalloutTool },
                bookmark:    { class: BookmarkTool },
                spacer:      { class: SpacerTool },
                props_block: { class: PropsBlockTool },
                duplicate:   { class: DuplicateTune },
            };

            // Briefly reveal body so EditorJS can measure the holder
            const alreadyOpen = this._bodyWrap.classList.contains('ej-toggle-body--open');
            if (!alreadyOpen) this._bodyWrap.classList.add('ej-toggle-body--init');

            this._subEditor = new EditorJS({
                holder:      this._holderEl,
                data:        blocksToEditorData(this._blocks || []),
                placeholder: 'Toggle body content…',
                minHeight:   60,
                tools,
                tunes: ['duplicate'],
            });

            this._subEditor.isReady
                .then(() => { if (!alreadyOpen) this._bodyWrap.classList.remove('ej-toggle-body--init'); })
                .catch(() => { if (!alreadyOpen) this._bodyWrap.classList.remove('ej-toggle-body--init'); });

            // Close inner editor toolbar/popover when clicking outside the toggle body.
            // Uses capture phase so it fires before EditorJS's own document listeners.
            if (this._closeOnOutsideClick) {
                document.removeEventListener('mousedown', this._closeOnOutsideClick, true);
            }
            this._closeOnOutsideClick = (e) => {
                if (!this._holderEl || this._holderEl.contains(e.target)) return;
                try { this._subEditor.toolbar.close(); } catch {}
                // Escape closes the block-picker popover (separate from toolbar in EditorJS v2)
                try {
                    this._holderEl.dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
                    );
                } catch {}
            };
            document.addEventListener('mousedown', this._closeOnOutsideClick, true);
        }

        async save(wrap) {
            const headEl = wrap.querySelector('.ej-toggle-head-el');
            let blocks = this._blocks;
            try {
                if (this._subEditor) {
                    await this._subEditor.isReady;
                    blocks = editorDataToBlocks(await this._subEditor.save());
                }
            } catch {}
            return {
                heading: {
                    html:    headEl ? headEl.innerHTML : this._headData.html,
                    level:   this._headData.level,
                    color:   this._headData.color  || '',
                    align:   this._headData.align  || '',
                    bold:    this._headData.bold   || false,
                    divider: this._headData.divider || 'none',
                },
                blocks,
                open:      this._open,
                border:    this._border,
                separator: this._separator,
            };
        }

        destroy() {
            if (this._subEditor) { try { this._subEditor.destroy(); } catch {} this._subEditor = null; }
            if (this._closeOnOutsideClick) {
                document.removeEventListener('mousedown', this._closeOnOutsideClick, true);
                this._closeOnOutsideClick = null;
            }
        }

        validate(d) {
            const h = d.heading;
            return !!(h && typeof h === 'object' ? h.html : h);
        }
    }

    class DuplicateTune {
        static get isTune() { return true; }
        constructor({ api }) { this._api = api; }
        wrap(blockContent) { return blockContent; }
        render() {
            const btn = document.createElement('div');
            btn.classList.add('ce-popover-item');
            btn.innerHTML = `
                <div class="ce-popover-item__icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
                </div>
                <div class="ce-popover-item__title">Duplicate</div>`;
            btn.addEventListener('click', async () => {
                const idx = this._api.blocks.getCurrentBlockIndex();
                const { blocks } = await this._api.saver.save();
                const target = blocks[idx];
                if (target) this._api.blocks.insert(target.type, target.data, undefined, idx + 1, true);
            });
            return btn;
        }
        save() { return {}; }
    }

    class SpacerTool {
        static get toolbox() {
            return { title: 'Spacer', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 5h18v2H3V5zm0 12h18v2H3v-2zm7.5-9l1.5-2 1.5 2H13v8h1.5l-1.5 2-1.5-2H13V8h-1.5z"/></svg>' };
        }
        constructor({ data }) { this._height = (data && data.height) || 60; }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-spacer-wrap';
            const visual = document.createElement('div');
            visual.className = 'ej-spacer-visual';
            visual.style.height = this._height + 'px';
            const lbl = document.createElement('span');
            lbl.className = 'ej-spacer-label';
            lbl.textContent = '↕ ' + this._height + 'px';
            visual.appendChild(lbl);
            const ctrl = document.createElement('div');
            ctrl.className = 'ej-spacer-ctrl';
            ctrl.innerHTML = `<label class="ej-spacer-lbl">Height</label>
                <input type="range" min="10" max="400" step="5" value="${this._height}" class="ej-spacer-range">
                <span class="ej-spacer-val">${this._height}px</span>`;
            wrap.appendChild(visual);
            wrap.appendChild(ctrl);
            const range  = ctrl.querySelector('.ej-spacer-range');
            const valEl  = ctrl.querySelector('.ej-spacer-val');
            range.addEventListener('input', () => {
                this._height = parseInt(range.value);
                const txt = this._height + 'px';
                valEl.textContent   = txt;
                lbl.textContent     = '↕ ' + txt;
                visual.style.height = txt;
            });
            return wrap;
        }
        save() { return { height: this._height }; }
    }

    class PropsBlockTool {
        static get toolbox() {
            return { title: 'Properties', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>' };
        }
        constructor({ data }) { this._data = data || { mode: 'horizontal', align: 'left', rows: [], label: '' }; }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap';

            const labelInp = document.createElement('input');
            labelInp.className = 'ej-input ej-label-input'; labelInp.type = 'text';
            labelInp.placeholder = 'Section label (optional, e.g. "Properties")';
            labelInp.value = this._data.label || '';
            wrap.appendChild(labelInp);

            const topRow = document.createElement('div');
            topRow.className = 'ej-props-display-row';

            const displayGroup = document.createElement('div');
            displayGroup.style.cssText = 'display:flex;flex-direction:column;flex:1 1 140px;gap:4px;min-width:0;overflow:hidden';
            const displayLbl = document.createElement('span');
            displayLbl.className = 'ej-props-display-label';
            displayLbl.textContent = 'Display:';
            displayGroup.appendChild(displayLbl);
            const modeSel = document.createElement('select');
            modeSel.className = 'ej-input ej-select ej-props-mode-sel';
            [['horizontal','Horizontal (stat boxes)'],['vertical','Vertical (list)'],['stat-attrs','Stat Attributes'],['stat-block','Stat Block'],['class-wiki','Class Wiki Table']].forEach(([v, l]) => {
                const o = document.createElement('option');
                o.value = v; o.textContent = l;
                if (v === (this._data.mode || 'horizontal')) o.selected = true;
                modeSel.appendChild(o);
            });
            displayGroup.appendChild(modeSel);
            topRow.appendChild(displayGroup);

            const alignGroup = document.createElement('div');
            alignGroup.style.cssText = 'display:flex;flex-direction:column;flex:1 1 140px;gap:4px';
            const alignLbl = document.createElement('span');
            alignLbl.className = 'ej-props-display-label';
            alignLbl.textContent = 'Align:';
            alignGroup.appendChild(alignLbl);
            const alignSel = document.createElement('select');
            alignSel.className = 'ej-input ej-select ej-props-align-sel';
            [['left','Left'],['center','Center'],['right','Right']].forEach(([v, l]) => {
                const o = document.createElement('option');
                o.value = v; o.textContent = l;
                if (v === (this._data.align || 'left')) o.selected = true;
                alignSel.appendChild(o);
            });
            alignGroup.appendChild(alignSel);
            topRow.appendChild(alignGroup);
            wrap.appendChild(topRow);

            const rowsDiv = document.createElement('div');
            rowsDiv.className = 'ej-props-rows';

            const mkRowBtn = (label, title) => {
                const b = document.createElement('button');
                b.className = 'pe-del'; b.type = 'button';
                b.textContent = label; b.title = title;
                return b;
            };
            const buildRow = (k, v) => {
                const row = document.createElement('div');
                row.className = 'ej-props-row';
                const fields = document.createElement('div');
                fields.className = 'ej-props-fields';
                const keyInp = document.createElement('input');
                keyInp.className = 'ej-input ej-props-key-inp'; keyInp.type = 'text';
                keyInp.placeholder = 'Key'; keyInp.value = k || '';
                const valInp = document.createElement('input');
                valInp.className = 'ej-input ej-props-val-inp'; valInp.type = 'text';
                valInp.placeholder = 'Value'; valInp.value = v || '';
                fields.appendChild(keyInp); fields.appendChild(valInp);

                const btns = document.createElement('div');
                btns.className = 'ej-props-row-btns';
                const upBtn  = mkRowBtn('↑', 'Move up');
                const delBtn = mkRowBtn('✕', 'Remove row');
                const dnBtn  = mkRowBtn('↓', 'Move down');
                upBtn.addEventListener('click', () => {
                    if (row.previousElementSibling) rowsDiv.insertBefore(row, row.previousElementSibling);
                });
                dnBtn.addEventListener('click', () => {
                    if (row.nextElementSibling) rowsDiv.insertBefore(row.nextElementSibling, row);
                });
                delBtn.addEventListener('click', () => row.remove());
                btns.appendChild(upBtn); btns.appendChild(delBtn); btns.appendChild(dnBtn);

                row.appendChild(fields); row.appendChild(btns);
                return row;
            };

            (this._data.rows || []).forEach(r => rowsDiv.appendChild(buildRow(r.key, r.value)));
            wrap.appendChild(rowsDiv);

            const addBtn = document.createElement('button');
            addBtn.className = 'et-btn ej-props-add-btn'; addBtn.type = 'button'; addBtn.textContent = '+ Add Row';
            addBtn.addEventListener('click', () => rowsDiv.appendChild(buildRow('', '')));
            wrap.appendChild(addBtn);
            return wrap;
        }
        save(el) {
            const modeSel = el.querySelector('.ej-props-mode-sel');
            const label   = el.querySelector('.ej-label-input')?.value.trim() || '';
            const rows = [];
            el.querySelectorAll('.ej-props-row').forEach(row => {
                const k = row.querySelector('.ej-props-key-inp');
                const v = row.querySelector('.ej-props-val-inp');
                if (k?.value.trim()) rows.push({ key: k.value.trim(), value: v?.value.trim() || '' });
            });
            const alignSel = el.querySelector('.ej-props-align-sel');
            return { mode: modeSel?.value || 'horizontal', align: alignSel?.value || 'left', rows, label };
        }
        validate(d) { return d.rows && d.rows.length > 0; }
    }

    class QuoteTool {
        static get toolbox() {
            return { title: 'Quote', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>' };
        }
        static get sanitize() {
            return { text: { b: true, i: true, em: true, strong: true, u: true, a: { href: true } } };
        }
        constructor({ data }) {
            this._data = {
                text:         data.text         || '',
                caption:      data.caption      || '',
                style:        data.style        || 'none',
                textAlign:    data.textAlign    || 'left',
                captionAlign: data.captionAlign || 'right',
            };
        }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap ej-quote-wrap';

            const ctrlRow = document.createElement('div');
            ctrlRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center';

            const mkSel = (label, options, current) => {
                const g = document.createElement('div');
                g.style.cssText = 'display:flex;align-items:center;gap:4px';
                g.innerHTML = `<span style="font-size:0.78rem;color:#a08ab0">${label}:</span>`;
                const sel = document.createElement('select');
                sel.className = 'ej-input ej-select'; sel.style.width = 'auto';
                options.forEach(([v, l]) => {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = l;
                    if (v === current) o.selected = true;
                    sel.appendChild(o);
                });
                g.appendChild(sel);
                return { g, sel };
            };

            const { g: sg, sel: styleSel }    = mkSel('Style',          [['none','None'],['line','Line'],['box','Box'],['shade','Shade']],       this._data.style);
            const { g: tag, sel: textAlignSel }= mkSel('Text',           [['left','Left'],['center','Center'],['right','Right']],                 this._data.textAlign);
            const { g: cag, sel: captAlignSel }= mkSel('Caption',        [['left','Left'],['center','Center'],['right','Right']],                 this._data.captionAlign);
            ctrlRow.appendChild(sg); ctrlRow.appendChild(tag); ctrlRow.appendChild(cag);
            wrap.appendChild(ctrlRow);

            const textEl = document.createElement('div');
            textEl.contentEditable = 'true';
            textEl.className = 'ej-input ej-quote-text';
            textEl.dataset.placeholder = 'Quote text…';
            textEl.innerHTML = this._data.text;
            wrap.appendChild(textEl);

            const capInp = document.createElement('input');
            capInp.type = 'text';
            capInp.className = 'ej-input';
            capInp.placeholder = 'Attribution (optional)';
            capInp.value = this._data.caption;
            wrap.appendChild(capInp);

            return wrap;
        }
        save(el) {
            const textEl       = el.querySelector('.ej-quote-text');
            const capInp       = el.querySelector('input');
            const [styleSel, textAlignSel, captAlignSel] = el.querySelectorAll('select');
            return {
                text:         textEl        ? textEl.innerHTML     : '',
                caption:      capInp        ? capInp.value.trim()  : '',
                style:        styleSel      ? styleSel.value       : 'none',
                textAlign:    textAlignSel  ? textAlignSel.value   : 'left',
                captionAlign: captAlignSel  ? captAlignSel.value   : 'right',
            };
        }
        validate(d) { return !!(d.text && d.text.replace(/<[^>]+>/g, '').trim()); }
    }

    class DelimiterTool {
        static get toolbox() {
            return { title: 'Divider', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h16v1H4z"/></svg>' };
        }
        static get colorMap() {
            return { default: '#503554', lavender: '#d3b3e7', mint: '#98e6d6', pink: '#f3b0c3' };
        }
        constructor({ data }) { this._data = data || { style: 'line', thickness: '1', color: 'default' }; }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap ej-delimiter-wrap';

            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap';

            const mkGroup = (label, options, current) => {
                const g = document.createElement('div');
                g.style.cssText = 'display:flex;align-items:center;gap:6px';
                g.innerHTML = `<span style="font-size:0.8rem;color:#a08ab0">${label}:</span>`;
                const sel = document.createElement('select');
                sel.className = 'ej-input ej-select'; sel.style.width = 'auto';
                options.forEach(([v, l]) => {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = l;
                    if (v === current) o.selected = true;
                    sel.appendChild(o);
                });
                g.appendChild(sel);
                return { g, sel };
            };

            const { g: sg, sel: styleSel }  = mkGroup('Style',     [['line','Line'],['moon','Moon'],['moon-full','Moon (full)']],            this._data.style     || 'line');
            const { g: tg, sel: thickSel }  = mkGroup('Thickness', [['0.5','Very Thin'],['1','Thin'],['2','Medium'],['3','Thick']],            this._data.thickness || '1');
            const { g: cg, sel: colorSel }  = mkGroup('Color',     [['default','Default'],['lavender','Lavender'],['mint','Mint'],['pink','Pink']], this._data.color || 'default');

            topRow.appendChild(sg); topRow.appendChild(tg); topRow.appendChild(cg);
            wrap.appendChild(topRow);

            const preview = document.createElement('div');
            preview.className = 'ej-delimiter-preview';
            const updatePreview = () => {
                const color = DelimiterTool.colorMap[colorSel.value] || '#503554';
                const px    = thickSel.value + 'px';
                const ls    = `height:${px};background:`;
                if (styleSel.value === 'moon') {
                    preview.innerHTML = `<div class="wiki-divider wiki-divider--moon">
                        <div class="wiki-divider-line" style="${ls}linear-gradient(to right,transparent,${color})"></div>
                        <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                        <div class="wiki-divider-line" style="${ls}linear-gradient(to left,transparent,${color})"></div>
                    </div>`;
                } else if (styleSel.value === 'moon-full') {
                    preview.innerHTML = `<div class="wiki-divider wiki-divider--moon-full">
                        <div class="wiki-divider-through-line" style="${ls}linear-gradient(to right,transparent,${color},transparent)"></div>
                        <img src="Assets/TransparentIcons/Moon_18x18.png" class="wiki-divider-icon" alt="">
                    </div>`;
                } else {
                    preview.innerHTML = `<hr style="border-top:${px} solid ${color};border-bottom:none;border-left:none;border-right:none;margin:8px 0">`;
                }
            };
            [styleSel, thickSel, colorSel].forEach(s => s.addEventListener('change', updatePreview));
            updatePreview();
            wrap.appendChild(preview);
            return wrap;
        }
        save(el) {
            const [styleSel, thickSel, colorSel] = el.querySelectorAll('select');
            return {
                style:     styleSel ? styleSel.value : 'line',
                thickness: thickSel ? thickSel.value : '1',
                color:     colorSel ? colorSel.value : 'default',
            };
        }
    }

    class EntryLinkTool {
        static get toolbox() {
            return { title: 'Entry Link', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.71-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>' };
        }
        constructor({ data }) {
            this._data = { entryId: data.entryId || '', entryName: data.entryName || '', categoryName: data.categoryName || '', profileImage: data.profileImage || '' };
            this._debounce = null;
        }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap ej-entry-link-wrap';

            const searchInp = document.createElement('input');
            searchInp.type = 'text';
            searchInp.className = 'ej-input';
            searchInp.placeholder = 'Search for an entry…';
            searchInp.value = this._data.entryName || '';
            wrap.appendChild(searchInp);

            const results = document.createElement('div');
            results.className = 'ej-entry-link-results';
            wrap.appendChild(results);

            const selected = document.createElement('div');
            selected.className = 'ej-entry-link-selected';
            selected.textContent = this._data.entryId ? `✓ ${this._data.entryName}` : '';
            selected.style.display = this._data.entryId ? '' : 'none';
            wrap.appendChild(selected);

            const _setSelected = (id, name, cat, img) => {
                this._data = { entryId: id, entryName: name, categoryName: cat, profileImage: img };
                searchInp.value = name;
                selected.textContent = `✓ ${name}`;
                selected.style.display = '';
                results.innerHTML = '';
                results.style.display = 'none';
            };

            searchInp.addEventListener('input', () => {
                clearTimeout(this._debounce);
                const q = searchInp.value.trim();
                if (q.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }
                results.innerHTML = '<div class="ej-entry-link-loading">Searching…</div>';
                results.style.display = '';
                this._debounce = setTimeout(async () => {
                    try {
                        const hits = await API.searchEntries(q);
                        if (!hits.length) { results.innerHTML = '<div class="ej-entry-link-loading">No results</div>'; return; }
                        results.innerHTML = '';
                        hits.slice(0, 8).forEach(h => {
                            const el = document.createElement('div');
                            el.className = 'ej-entry-link-result';
                            const catName = h.categories?.name || '';
                            el.innerHTML = `${h.profile_image ? `<img src="${h.profile_image.replace(/"/g,'&quot;')}" class="wiki-entry-thumb" alt="">` : ''}<span>${(h.name||'').replace(/</g,'&lt;')}</span>${catName ? `<span class="wiki-count"> — ${catName.replace(/</g,'&lt;')}</span>` : ''}`;
                            el.addEventListener('click', () => _setSelected(h.id, h.name, catName, h.profile_image || ''));
                            results.appendChild(el);
                        });
                    } catch { results.innerHTML = '<div class="ej-entry-link-loading">Search failed</div>'; }
                }, 300);
            });

            return wrap;
        }
        save() { return { entryId: this._data.entryId || '', entryName: this._data.entryName || '', categoryName: this._data.categoryName || '', profileImage: this._data.profileImage || '' }; }
        validate(d) { return !!d.entryId; }
    }

    class BookmarkTool {
        static get toolbox() {
            return { title: 'Bookmark', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>' };
        }
        constructor({ data }) { this._data = data || {}; }
        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap';
            const urlInp = document.createElement('input');
            urlInp.className = 'ej-input'; urlInp.type = 'url';
            urlInp.placeholder = 'Link URL (https://…)';
            urlInp.value = this._data.url || '';
            const capInp = document.createElement('input');
            capInp.className = 'ej-input'; capInp.type = 'text';
            capInp.placeholder = 'Display label (optional — falls back to URL)';
            capInp.value = this._data.caption || '';
            const labelInp = document.createElement('input');
            labelInp.className = 'ej-input ej-label-input'; labelInp.type = 'text';
            labelInp.placeholder = 'Section label (optional, e.g. "REFERENCES")';
            labelInp.value = this._data.label || '';
            wrap.appendChild(urlInp); wrap.appendChild(capInp); wrap.appendChild(labelInp);
            return wrap;
        }
        save(el) {
            const [u, c] = el.querySelectorAll('input');
            const label = el.querySelector('.ej-label-input')?.value.trim() || '';
            return { url: u.value.trim(), caption: c.value.trim(), label };
        }
        validate(d) { return !!d.url; }
    }

    // ── Custom image tool (replaces @editorjs/image CDN) ─────────────────────
    // Adds upload, media library picker, and direct URL entry in one block.

    class ImageTool {
        static get toolbox() {
            return { title: 'Image', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>' };
        }

        constructor({ data }) {
            this._data = {
                file:    data.file    || { url: '' },
                caption: data.caption || '',
            };
        }

        render() {
            const wrap = document.createElement('div');
            wrap.className = 'ej-tool-wrap ej-image-wrap';

            // ── Upload row ────────────────────────────────────────────────────
            const uploadRow = document.createElement('div');
            uploadRow.className = 'ej-upload-row';

            const fileInp = document.createElement('input');
            fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.style.display = 'none';

            const uploadBtn = document.createElement('button');
            uploadBtn.type = 'button'; uploadBtn.className = 'et-btn ej-upload-btn';
            uploadBtn.textContent = '⬆ Upload';

            const libraryBtn = document.createElement('button');
            libraryBtn.type = 'button'; libraryBtn.className = 'et-btn ej-upload-btn';
            libraryBtn.textContent = '📂 Library';

            const uploadStatus = document.createElement('span');
            uploadStatus.className = 'ej-upload-status';

            uploadRow.appendChild(fileInp);
            uploadRow.appendChild(uploadBtn);
            uploadRow.appendChild(libraryBtn);
            uploadRow.appendChild(uploadStatus);

            // ── URL input ─────────────────────────────────────────────────────
            const urlInp = document.createElement('input');
            urlInp.className = 'ej-input'; urlInp.type = 'url';
            urlInp.placeholder = 'Image URL (https://…) — or upload / pick above';
            urlInp.value = this._data.file?.url || '';

            // ── Preview ───────────────────────────────────────────────────────
            const preview = document.createElement('img');
            preview.className = 'ej-img-preview';
            preview.style.display = this._data.file?.url ? '' : 'none';
            if (this._data.file?.url) preview.src = this._data.file.url;

            // ── Caption ───────────────────────────────────────────────────────
            const capInp = document.createElement('input');
            capInp.className = 'ej-input'; capInp.type = 'text';
            capInp.placeholder = 'Caption (optional)';
            capInp.value = this._data.caption || '';

            // ── Wire events ───────────────────────────────────────────────────
            const _updatePreview = () => {
                const url = urlInp.value.trim();
                preview.style.display = url ? '' : 'none';
                if (url) preview.src = url;
            };
            urlInp.addEventListener('input', _updatePreview);

            uploadBtn.addEventListener('click', () => fileInp.click());
            fileInp.addEventListener('change', async () => {
                const file = fileInp.files[0];
                if (!file) return;
                uploadBtn.disabled = true;
                uploadStatus.textContent = 'Uploading…';
                try {
                    const url = await _cloudinaryUpload(file);
                    urlInp.value = url;
                    _updatePreview();
                    uploadStatus.textContent = '✓ ' + file.name;
                } catch (err) {
                    uploadStatus.textContent = '✕ ' + err.message;
                } finally {
                    uploadBtn.disabled = false;
                }
            });

            libraryBtn.addEventListener('click', () => {
                _showMediaPicker(url => {
                    urlInp.value = url;
                    _updatePreview();
                    uploadStatus.textContent = '✓ from library';
                }, { accept: 'image' });
            });

            wrap.appendChild(uploadRow);
            wrap.appendChild(urlInp);
            wrap.appendChild(preview);
            wrap.appendChild(capInp);
            return wrap;
        }

        save(el) {
            const urlInp = el.querySelector('input[type="url"]');
            const capInp = el.querySelector('input[type="text"]');
            return {
                file:    { url: urlInp?.value.trim() || '' },
                caption: capInp?.value.trim() || '',
            };
        }

        validate(d) { return !!(d.file?.url); }
    }

    // ── Block format converters ───────────────────────────────────────────────

    // Internal blocks → Editor.js data format
    function blocksToEditorData(blocks) {
        const out  = [];
        let pending = null; // { type, items }

        function flushList() {
            if (!pending) return;
            out.push({
                type: 'list',
                data: {
                    style: pending.type === 'numbered_list' ? 'ordered' : 'unordered',
                    items: pending.items.slice(),
                },
            });
            pending = null;
        }

        for (const blk of (blocks || [])) {
            const c      = blk.content || {};
            const isList = blk.type === 'bulleted_list' || blk.type === 'numbered_list';

            if (!isList)                                      flushList();
            else if (pending && blk.type !== pending.type)   flushList();

            switch (blk.type) {
                case 'paragraph':
                    out.push({ type: 'paragraph', data: { text: c.html || '' } });
                    break;
                case 'heading_2':
                case 'heading_3':
                case 'heading_4': {
                    const _lvl = parseInt(blk.type.replace('heading_', ''));
                    out.push({ type: 'header', data: {
                        text:    c.html    || '',
                        level:   _lvl,
                        color:   c.color   || '',
                        align:   c.align   || '',
                        bold:    c.bold    || false,
                        divider: c.divider !== undefined ? c.divider : (_lvl === 3 ? 'full' : 'none'),
                    }});
                    break;
                }
                case 'bulleted_list':
                case 'numbered_list':
                    if (!pending) pending = { type: blk.type, items: [] };
                    (c.items || []).forEach(i => pending.items.push(i));
                    break;
                case 'image':
                    out.push({ type: 'image', data: { file: { url: c.url || '' }, caption: c.caption || '' } });
                    break;
                case 'quote':
                    out.push({ type: 'quote', data: { text: c.html || '', caption: c.caption || '', style: c.style || 'none', textAlign: c.textAlign || 'left', captionAlign: c.captionAlign || 'right' } });
                    break;
                case 'divider':
                    out.push({ type: 'delimiter', data: { style: c.style || 'line', thickness: c.thickness || '1', color: c.color || 'default' } });
                    break;
                case 'audio':
                    out.push({ type: 'audio', data: { url: c.url || '', caption: c.caption || '', label: c.label || '' } });
                    break;
                case 'callout':
                    out.push({ type: 'callout', data: { variant: c.variant || 'info', emoji: c.emoji || '💡', html: c.html || '' } });
                    break;
                case 'toggle': {
                    const hRaw = c.heading;
                    const heading = (hRaw && typeof hRaw === 'object')
                        ? { html: hRaw.html || '', level: hRaw.level || 2, color: hRaw.color || '', align: hRaw.align || '', bold: !!hRaw.bold, divider: hRaw.divider || 'none' }
                        : { html: (typeof hRaw === 'string' ? hRaw : ''), level: 2, color: '', align: '', bold: false, divider: 'none' };
                    let tBlocks = Array.isArray(c.blocks) ? c.blocks : [];
                    if (!tBlocks.length && c.body) tBlocks = [{ type: 'paragraph', content: { html: c.body } }];
                    out.push({ type: 'toggle', data: { heading, blocks: tBlocks, open: c.open || false, border: c.border || false, separator: c.separator || false } });
                    break;
                }
                case 'table':
                    out.push({ type: 'table', data: { withHeadings: c.withHeadings || false, content: c.content || [['', '']] } });
                    break;
                case 'embed':
                    out.push({ type: 'embed', data: { ...c } });
                    break;
                case 'bookmark':
                    out.push({ type: 'bookmark', data: { url: c.url || '', caption: c.caption || '', label: c.label || '' } });
                    break;
                case 'columns': {
                    const colItems = (c.items || []).map(ColumnsTool._normaliseItem);
                    out.push({ type: 'columns', data: { items: colItems, label: c.label || '' } });
                    break;
                }
                case 'props_block':
                    out.push({ type: 'props_block', data: { mode: c.mode || 'horizontal', align: c.align || 'left', rows: c.rows || [], label: c.label || '' } });
                    break;
                case 'spacer':
                    out.push({ type: 'spacer', data: { height: c.height || 60 } });
                    break;
                case 'entry_link':
                    out.push({ type: 'entry_link', data: { entryId: c.entryId || '', entryName: c.entryName || '', categoryName: c.categoryName || '', profileImage: c.profileImage || '' } });
                    break;
                default:
                    if (c.html) out.push({ type: 'paragraph', data: { text: c.html } });
            }
        }
        flushList();
        return { blocks: out };
    }

    // Editor.js output → internal block format
    function editorDataToBlocks(editorData) {
        const out = [];
        for (const blk of (editorData.blocks || [])) {
            switch (blk.type) {
                case 'paragraph':
                    out.push({ type: 'paragraph', content: { html: blk.data.text || '' } });
                    break;
                case 'header': {
                    const _lvl = blk.data.level || 2;
                    out.push({
                        type:    `heading_${_lvl}`,
                        content: {
                            html:    blk.data.text    || '',
                            color:   blk.data.color   || '',
                            align:   blk.data.align   || '',
                            bold:    blk.data.bold    || false,
                            divider: blk.data.divider || 'none',
                        },
                    });
                    break;
                }
                case 'list':
                    if (blk.data.items && blk.data.items.length) {
                        out.push({
                            type:    blk.data.style === 'ordered' ? 'numbered_list' : 'bulleted_list',
                            content: { items: blk.data.items },
                        });
                    }
                    break;
                case 'image':
                    out.push({ type: 'image', content: { url: blk.data.file?.url || '', caption: blk.data.caption || '' } });
                    break;
                case 'quote':
                    out.push({ type: 'quote', content: { html: blk.data.text || '', caption: blk.data.caption || '', style: blk.data.style || 'none', textAlign: blk.data.textAlign || 'left', captionAlign: blk.data.captionAlign || 'right' } });
                    break;
                case 'delimiter':
                    out.push({ type: 'divider', content: { style: blk.data.style || 'line', thickness: blk.data.thickness || '1', color: blk.data.color || 'default' } });
                    break;
                case 'audio':
                    out.push({ type: 'audio', content: { url: blk.data.url || '', caption: blk.data.caption || '', label: blk.data.label || '' } });
                    break;
                case 'callout':
                    out.push({ type: 'callout', content: { variant: blk.data.variant || 'info', emoji: blk.data.emoji || '💡', html: blk.data.html || '' } });
                    break;
                case 'toggle':
                    out.push({ type: 'toggle', content: { heading: blk.data.heading || {}, blocks: blk.data.blocks || [], open: blk.data.open || false, border: blk.data.border || false, separator: blk.data.separator || false } });
                    break;
                case 'table':
                    out.push({ type: 'table', content: { withHeadings: blk.data.withHeadings || false, content: blk.data.content || [] } });
                    break;
                case 'embed':
                    out.push({ type: 'embed', content: { ...blk.data } });
                    break;
                case 'bookmark':
                    out.push({ type: 'bookmark', content: { url: blk.data.url || '', caption: blk.data.caption || '', label: blk.data.label || '' } });
                    break;
                case 'columns':
                    out.push({ type: 'columns', content: { items: (blk.data.items || []).map(ColumnsTool._normaliseItem), label: blk.data.label || '' } });
                    break;
                case 'props_block':
                    out.push({ type: 'props_block', content: { mode: blk.data.mode || 'horizontal', align: blk.data.align || 'left', rows: blk.data.rows || [], label: blk.data.label || '' } });
                    break;
                case 'spacer':
                    out.push({ type: 'spacer', content: { height: blk.data.height || 60 } });
                    break;
                case 'entry_link':
                    out.push({ type: 'entry_link', content: { entryId: blk.data.entryId || '', entryName: blk.data.entryName || '', categoryName: blk.data.categoryName || '', profileImage: blk.data.profileImage || '' } });
                    break;
                default:
                    if (blk.data?.text) out.push({ type: 'paragraph', content: { html: blk.data.text } });
            }
        }
        return out;
    }

    // ── Entry edit mode ───────────────────────────────────────────────────────

    let _ejInstance   = null;
    let _editingEntry = null;
    let _isDirty      = false;  // true once the user makes any change in edit mode
    let _origNavFns   = null;   // stashed nav functions restored on exit
    let _navGuardFn   = null;   // document click guard — installed while in edit mode
    let _ctrlSHandler = null;   // keydown Ctrl+S listener
    let _draftTimer   = null;   // debounced auto-save draft timer
    let _countTimer   = null;   // debounced word/block count timer

    // ── Draft auto-save helpers ───────────────────────────────────────────────

    const _DRAFT_NS = 'ppastel-draft-v1';

    function _saveDraft(entryId, blocks, settings) {
        try { localStorage.setItem(`${_DRAFT_NS}:${entryId}`, JSON.stringify({ blocks, settings, savedAt: Date.now() })); } catch { /* storage full */ }
    }
    function _loadDraft(entryId) {
        try { const raw = localStorage.getItem(`${_DRAFT_NS}:${entryId}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
    }
    function _clearDraft(entryId) {
        try { localStorage.removeItem(`${_DRAFT_NS}:${entryId}`); } catch { /* ignore */ }
    }

    function _beforeUnloadHandler(e) {
        if (_isDirty) { e.preventDefault(); e.returnValue = ''; }
    }

    // Returns false (and blocks the action) if dirty and the user cancels.
    // ── Inline markdown auto-formatting ──────────────────────────────────────
    // Listens for input events on an EditorJS holder and converts inline
    // markdown syntax to rich text as the user types.
    // Covers all nested sub-editors (ColumnsTool, ToggleTool) via event bubbling.

    function _installMarkdownShortcuts(holder) {
        if (!holder) return;

        // Patterns checked longest-first so ** is tested before *
        const PATTERNS = [
            { open: '**', wrap: s => `<b>${s}</b>` },
            { open: '__', wrap: s => `<b>${s}</b>` },
            { open: '*',  wrap: s => `<em>${s}</em>` },
            { open: '_',  wrap: s => `<em>${s}</em>` },
            { open: '~~', wrap: s => `<s>${s}</s>` },
            { open: '`',  wrap: s => `<code>${s}</code>` },
        ];

        holder.addEventListener('input', (e) => {
            if (e.isComposing) return;

            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;

            const range = sel.getRangeAt(0);
            if (!range.collapsed) return;

            const node = range.startContainer;
            if (node.nodeType !== Node.TEXT_NODE) return;
            if (!node.parentElement?.isContentEditable) return;

            const text   = node.textContent;
            const pos    = range.startOffset;
            const before = text.slice(0, pos);

            for (const pat of PATTERNS) {
                if (!before.endsWith(pat.open)) continue;

                const innerEnd = before.length - pat.open.length;
                const search   = before.slice(0, innerEnd);
                const openIdx  = search.lastIndexOf(pat.open);
                if (openIdx < 0) continue;

                // Prevent single-char marker matching inside a double-char one
                // (e.g. stop * matching the second * in **)
                if (pat.open.length === 1 && openIdx > 0 &&
                    search[openIdx - 1] === pat.open[0]) continue;

                const inner = search.slice(openIdx + pat.open.length);
                if (!inner) continue;

                // Select the whole marker+content+marker span
                const r = document.createRange();
                r.setStart(node, openIdx);
                r.setEnd(node, pos);
                sel.removeAllRanges();
                sel.addRange(r);

                // Build safe HTML and insert it with a temporary cursor anchor
                const safeInner = inner
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                const anchorId = '_md_' + Date.now();
                // eslint-disable-next-line no-undef
                document.execCommand('insertHTML', false,
                    pat.wrap(safeInner) + `<span id="${anchorId}"></span>`);

                // Move cursor to just after the inserted element, then remove the anchor
                const anchor = document.getElementById(anchorId);
                if (anchor) {
                    const after = document.createRange();
                    after.setStartAfter(anchor);
                    after.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(after);
                    anchor.remove();
                }
                return;
            }
        });
    }

    // Exits edit mode automatically when the user confirms discard.
    function _confirmDiscard() {
        if (!_isDirty) return true;
        if (!confirm('You have unsaved changes. Discard them and leave?')) return false;
        _isDirty = false;
        exitEditMode();
        return true;
    }

    async function enterEditMode(entry) {
        _editingEntry = entry;
        etEdit.style.display   = 'none';
        etSave.style.display   = '';
        etCancel.style.display = '';

        try {
            setStatus('Loading editor…');
            await ensureEditorJS();

            // Replace blocks area with Editor.js holder
            const blocksArea = document.getElementById('sb-blocks-area');
            if (!blocksArea) throw new Error('Blocks area not found.');
            blocksArea.innerHTML = '<div id="ej-holder" class="wiki-editor-holder"></div>';

            _ejInstance = new EditorJS({
                holder:      'ej-holder',
                data:        blocksToEditorData(entry.blocks || []),
                placeholder: 'Write something… (use the + button to add blocks)',
                tools: {
                    header: { class: HeadingTool, inlineToolbar: true },
                    list: {
                        class:         List,
                        inlineToolbar: true,
                    },
                    image: { class: ImageTool },
                    quote:     { class: QuoteTool, inlineToolbar: true },
                    delimiter: { class: DelimiterTool },
                    table:     { class: Table, inlineToolbar: true },
                    embed:     { class: Embed },
                    audio:       { class: AudioTool },
                    callout:     { class: CalloutTool },
                    toggle:      { class: ToggleTool, inlineToolbar: true },
                    bookmark:    { class: BookmarkTool },
                    spacer:      { class: SpacerTool },
                    columns:     { class: ColumnsTool },
                    props_block: { class: PropsBlockTool },
                    entry_link:  { class: EntryLinkTool },
                    duplicate:   { class: DuplicateTune },
                },
                tunes: ['duplicate'],
            });

            // Wait for the editor to finish initialising before it is usable
            await _ejInstance.isReady;
            setStatus('Ctrl+S to save');
            _isDirty = false;

            // Mark the entry being edited in the entry list
            document.querySelector(`#sb-entry-list li[data-id="${entry.id}"]`)
                ?.classList.add('wiki-editing');

            // Ctrl+S / Cmd+S to save
            _ctrlSHandler = e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    if (!etSave.disabled) etSave.click();
                }
            };
            document.addEventListener('keydown', _ctrlSHandler);

            // Combined input handler: dirty flag + auto-save draft + word/block count
            const _ejHolder = document.getElementById('ej-holder');
            _ejHolder?.addEventListener('input', () => {
                _isDirty = true;

                // Auto-save draft (2-second debounce)
                clearTimeout(_draftTimer);
                _draftTimer = setTimeout(async () => {
                    if (!_ejInstance || !_editingEntry) return;
                    try {
                        const data = await _ejInstance.save();
                        _saveDraft(_editingEntry.id, editorDataToBlocks(data), _readEntrySettings());
                    } catch { /* ignore */ }
                }, 2000);

                // Update block + word count (0.8-second debounce)
                clearTimeout(_countTimer);
                _countTimer = setTimeout(async () => {
                    if (!_ejInstance) return;
                    try {
                        const data = await _ejInstance.save();
                        const bc = data.blocks.length;
                        const wc = data.blocks.reduce((sum, b) => {
                            const txt = (b.data?.text || b.data?.html || '').replace(/<[^>]+>/g, '');
                            return sum + (txt.match(/\S+/g) || []).length;
                        }, 0);
                        setStatus(`Ctrl+S to save  ·  ${bc} block${bc !== 1 ? 's' : ''}  ·  ~${wc} word${wc !== 1 ? 's' : ''}`);
                    } catch { /* ignore */ }
                }, 800);
            }, { capture: true });

            // Inline markdown shortcuts (**bold**, *italic*, `code`, ~~strike~~, etc.)
            _installMarkdownShortcuts(_ejHolder);

            // ── Entry Settings panel ──────────────────────────────────────────
            const mainArea   = document.getElementById('sb-entry-main');
            const layout     = entry.layout || {};

            const settingsEl = document.createElement('div');
            settingsEl.id        = 'sb-entry-settings';
            settingsEl.className = 'wiki-entry-settings';
            settingsEl.innerHTML = `
                <div class="wes-header"><span>Entry Settings</span></div>
                <div class="wes-grid">
                    <label>Name</label>
                    <input id="sb-entry-name" class="ej-input" type="text"
                           placeholder="Entry name"
                           value="${(entry.name || '').replace(/"/g,'&quot;')}">

                    <label>Subtitle</label>
                    <input id="sb-subtitle" class="ej-input" type="text"
                           placeholder="Optional subtitle / tagline"
                           value="${(entry.subtitle || '').replace(/"/g,'&quot;')}">

                    <label>Profile image URL</label>
                    <div>
                        <input id="sb-img-url" class="ej-input" type="url"
                               placeholder="https://…"
                               value="${(entry.profile_image || '').replace(/"/g,'&quot;')}">
                        <img id="sb-img-preview" class="ej-img-preview"
                             src="${(entry.profile_image || '').replace(/"/g,'&quot;')}"
                             style="${entry.profile_image ? '' : 'display:none'}">
                    </div>

                    <label>Banner image URL</label>
                    <div>
                        <input id="sb-banner-url" class="ej-input" type="url"
                               placeholder="https://… (wide header image)"
                               value="${(entry.banner_image || '').replace(/"/g,'&quot;')}">
                        <img id="sb-banner-preview" class="ej-img-preview ej-img-preview--banner"
                             src="${(entry.banner_image || '').replace(/"/g,'&quot;')}"
                             style="${entry.banner_image ? '' : 'display:none'}">
                    </div>

                    <label>Banner display</label>
                    <div id="sb-banner-controls"></div>

                    <label>Accent colour</label>
                    <input id="sb-accent-color" class="ej-input ej-color-input" type="color"
                           value="${layout.accentColor || '#98e6d6'}">

                    <label>Page style</label>
                    <select id="sb-page-style" class="ej-input ej-select">
                        <option value="full"    ${(layout.pageStyle||'full')==='full'    ? 'selected':''}>Full page (default)</option>
                        <option value="section" ${layout.pageStyle==='section'           ? 'selected':''}>Section</option>
                    </select>

                    <label>Title divider</label>
                    <select id="sb-title-divider" class="ej-input ej-select">
                        <option value="none"      ${(!layout.titleDivider || layout.titleDivider==='none')            ? 'selected':''}>None</option>
                        <option value="line"      ${layout.titleDivider==='line'                                      ? 'selected':''}>Line only</option>
                        <option value="moon-split"${layout.titleDivider==='moon-split'                                ? 'selected':''}>Moon (split)</option>
                        <option value="moon-full" ${(layout.titleDivider==='moon-full'||layout.titleDivider==='moon') ? 'selected':''}>Moon (full)</option>
                    </select>

                    <label>Divider color</label>
                    <select id="sb-divider-color" class="ej-input ej-select">
                        <option value="default"  ${(layout.titleDividerColor||'default')==='default'  ? 'selected':''}>Default</option>
                        <option value="lavender" ${layout.titleDividerColor==='lavender'              ? 'selected':''}>Lavender</option>
                        <option value="mint"     ${layout.titleDividerColor==='mint'                  ? 'selected':''}>Mint</option>
                        <option value="pink"     ${layout.titleDividerColor==='pink'                  ? 'selected':''}>Pink</option>
                    </select>

                    <label>Divider thickness</label>
                    <select id="sb-divider-thickness" class="ej-input ej-select">
                        <option value="0.5" ${layout.titleDividerThickness==='0.5'              ? 'selected':''}>Very Thin</option>
                        <option value="1"   ${(layout.titleDividerThickness||'1')==='1'         ? 'selected':''}>Thin</option>
                        <option value="2"   ${layout.titleDividerThickness==='2'                ? 'selected':''}>Medium</option>
                        <option value="3"   ${layout.titleDividerThickness==='3'                ? 'selected':''}>Thick</option>
                    </select>

                    <label>Sidebar</label>
                    <select id="sb-sidebar-pos" class="ej-input ej-select">
                        <option value="right"        ${(layout.sidebar||'right')==='right'        ? 'selected':''}>Right (default)</option>
                        <option value="left"         ${layout.sidebar==='left'                    ? 'selected':''}>Left</option>
                        <option value="float-right"  ${layout.sidebar==='float-right'             ? 'selected':''}>Float right (content wraps under)</option>
                        <option value="float-left"   ${layout.sidebar==='float-left'              ? 'selected':''}>Float left (content wraps under)</option>
                        <option value="none"         ${layout.sidebar==='none'                    ? 'selected':''}>Hidden (full-width)</option>
                    </select>
                </div>`;
            // Attach upload/browse buttons to image URL fields
            _attachUploadBtn(settingsEl.querySelector('#sb-img-url'),    'image');
            _attachUploadBtn(settingsEl.querySelector('#sb-banner-url'), 'image');
            _buildBannerControls(
                settingsEl.querySelector('#sb-banner-controls'),
                settingsEl.querySelector('#sb-banner-url'),
                'sb-banner',
                layout
            );

            mainArea.insertBefore(settingsEl, mainArea.firstChild);

            // Image URL → live preview
            const _wirePreview = (inputId, previewId) => {
                const inp = document.getElementById(inputId);
                const img = document.getElementById(previewId);
                if (!inp || !img) return;
                inp.addEventListener('input', () => {
                    const url = inp.value.trim();
                    img.style.display = url ? '' : 'none';
                    if (url) img.src = url;
                });
            };
            _wirePreview('sb-img-url',    'sb-img-preview');
            _wirePreview('sb-banner-url', 'sb-banner-preview');

            // Any change in the settings panel also marks dirty
            settingsEl.querySelectorAll('input, select').forEach(el => {
                el.addEventListener('change', () => { _isDirty = true; });
            });

            // ── Draft recovery ────────────────────────────────────────────────
            const _draft = _loadDraft(entry.id);
            if (_draft && _draft.savedAt > Date.now() - 7 * 24 * 3600 * 1000) {
                const t = new Date(_draft.savedAt);
                const timeStr = t.toLocaleDateString() + ' ' + t.toLocaleTimeString();
                const restore = await _dlgConfirm(
                    'Unsaved Draft Found',
                    `A draft from ${timeStr} was found. Restore it?`,
                    { okLabel: 'Restore Draft' }
                );
                if (restore) {
                    await _ejInstance.render(blocksToEditorData(_draft.blocks || []));
                    if (_draft.settings) _applyEntrySettings(_draft.settings);
                    _isDirty = true;
                }
            }

            // ── Guard in-app navigation while dirty ───────────────────────────

            // 1. Wrap WikiSB.nav functions for programmatic callers (e.g. logout).
            //    supabase-fetch.js buttons call internal functions directly, so
            //    these wrappers alone aren't enough — see click guard below.
            const _navOrigList = WikiSB.nav.showCampaignList;
            const _navOrigCamp = WikiSB.nav.showCampaign;
            _origNavFns = { showCampaignList: _navOrigList, showCampaign: _navOrigCamp };

            WikiSB.nav.showCampaignList = async (...a) => {
                if (!_confirmDiscard()) return;
                return _navOrigList(...a);
            };
            WikiSB.nav.showCampaign = async (...a) => {
                if (!_confirmDiscard()) return;
                return _navOrigCamp(...a);
            };

            // 2. Document-level capture-phase click guard.
            //    Intercepts ALL navigation-causing clicks on the page:
            //    — back/campaign/entry buttons (.wiki-back-btn, .wiki-cat-pill,
            //      .wiki-campaign-card, .wiki-entry-link)
            //    — navbar anchor links (a[href] that aren't plain "#")
            //    This fires before the element's own listener, so we can block
            //    the click or let it through after clearing edit state.
            _navGuardFn = (e) => {
                if (!_isDirty) return;
                const navEl = e.target.closest(
                    '.wiki-back-btn, .wiki-cat-pill, .wiki-campaign-card,' +
                    '.wiki-entry-link, a[href]'
                );
                if (!navEl) return;
                // Skip pure hash links (no real navigation)
                if (navEl.tagName === 'A' &&
                    (!navEl.getAttribute('href') || navEl.getAttribute('href') === '#')) return;

                if (!confirm('You have unsaved changes. Discard them and leave?')) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }

                // User confirmed discard — clean up edit mode, then let the
                // click proceed.  For in-app nav buttons the original handler
                // will fire normally; for external <a> links the browser
                // navigates away (beforeunload is already detached).
                _isDirty = false;
                exitEditMode();
                // Don't stop propagation — let the original handler run.
            };
            document.addEventListener('click', _navGuardFn, true);

            window.addEventListener('beforeunload', _beforeUnloadHandler);

        } catch (e) {
            setStatus('Editor failed to load: ' + e.message, true);
            _ejInstance   = null;
            _editingEntry = null;
            etEdit.style.display   = '';
            etSave.style.display   = 'none';
            etCancel.style.display = 'none';
        }
    }

    function _readEntrySettings() {
        const bh = document.getElementById('sb-banner-height')?.value || '';
        return {
            sidebar:               (document.getElementById('sb-sidebar-pos')?.value        || 'right'),
            accentColor:           (document.getElementById('sb-accent-color')?.value       || ''),
            pageStyle:             (document.getElementById('sb-page-style')?.value         || 'full'),
            titleDivider:          (document.getElementById('sb-title-divider')?.value      || 'none'),
            titleDividerColor:     (document.getElementById('sb-divider-color')?.value      || 'default'),
            titleDividerThickness: (document.getElementById('sb-divider-thickness')?.value  || '1'),
            bannerFit:             (document.getElementById('sb-banner-fit')?.value         || 'cover'),
            bannerFocalX:          +(document.getElementById('sb-banner-focal-x')?.value    ?? 50),
            bannerFocalY:          +(document.getElementById('sb-banner-focal-y')?.value    ?? 50),
            ...(bh ? { bannerHeight: +bh } : {}),
        };
    }

    function _applyEntrySettings(layout) {
        const sidebarSel    = document.getElementById('sb-sidebar-pos');
        const accentInp     = document.getElementById('sb-accent-color');
        const pageStyleSel  = document.getElementById('sb-page-style');
        const titleDivSel   = document.getElementById('sb-title-divider');
        const divColorSel   = document.getElementById('sb-divider-color');
        const divThickSel   = document.getElementById('sb-divider-thickness');
        if (sidebarSel)  sidebarSel.value   = layout.sidebar      || 'right';
        if (accentInp && layout.accentColor) accentInp.value = layout.accentColor;
        if (pageStyleSel) pageStyleSel.value = layout.pageStyle    || 'full';
        // normalise legacy 'moon' → 'moon-full'
        const _td = layout.titleDivider === 'moon' ? 'moon-full' : (layout.titleDivider || 'none');
        if (titleDivSel) titleDivSel.value = _td;
        if (divColorSel) divColorSel.value = layout.titleDividerColor     || 'default';
        if (divThickSel) divThickSel.value = layout.titleDividerThickness || '1';
        _applyBannerControls('sb-banner', layout);
    }

    etSave.addEventListener('click', async () => {
        if (!_editingEntry || !_ejInstance) {
            setStatus('Editor not ready — click ✏ Edit again.', true);
            return;
        }
        etSave.disabled = true;
        setStatus('Saving…');

        try {
            const editorData    = await _ejInstance.save();
            const blocks        = editorDataToBlocks(editorData);
            const name          = document.getElementById('sb-entry-name')?.value.trim() || _editingEntry.name;
            const profile_image = document.getElementById('sb-img-url')?.value.trim()    ?? _editingEntry.profile_image;
            const subtitle      = document.getElementById('sb-subtitle')?.value.trim()   ?? _editingEntry.subtitle;
            const banner_image  = document.getElementById('sb-banner-url')?.value.trim() ?? _editingEntry.banner_image;
            const layout        = _readEntrySettings();

            // Always save blocks first (no migration dependency)
            await API.saveBlocks(_editingEntry.id, blocks);

            // Try full update; if schema cache error, fall back to core fields only
            try {
                await API.updateEntry(_editingEntry.id, { name, profile_image, subtitle, banner_image, layout });
                setStatus('Saved!');
            } catch (e2) {
                const isMigration = e2.message.includes('schema cache') || e2.message.includes('column');
                if (isMigration) {
                    await API.updateEntry(_editingEntry.id, { name, profile_image });
                    setStatus('Content saved. Run supabase-migration-v2.sql to enable subtitle/banner/layout.', true);
                } else {
                    throw e2;
                }
            }

            const savedId   = _editingEntry.id;
            _clearDraft(savedId);
            exitEditMode();
            await WikiSB.nav.showEntry(savedId, name);
        } catch (e) {
            setStatus('Save failed: ' + e.message, true);
        } finally {
            etSave.disabled = false;
        }
    });

    etCancel.addEventListener('click', async () => {
        if (_isDirty && !await _dlgConfirm('Unsaved Changes', 'You have unsaved changes. Discard them?', { okLabel: 'Discard', danger: true })) return;
        const entry = _editingEntry; // capture before exitEditMode nulls it
        if (entry) _clearDraft(entry.id);
        _isDirty = false;
        exitEditMode();
        if (WikiSB.nav.showEntry && entry) {
            await WikiSB.nav.showEntry(entry.id, entry.name);
        }
    });

    function exitEditMode() {
        _isDirty = false;
        clearTimeout(_draftTimer); _draftTimer = null;
        clearTimeout(_countTimer); _countTimer = null;
        if (_ctrlSHandler) {
            document.removeEventListener('keydown', _ctrlSHandler);
            _ctrlSHandler = null;
        }
        document.querySelector('#sb-entry-list li.wiki-editing')?.classList.remove('wiki-editing');
        if (_origNavFns) {
            WikiSB.nav.showCampaignList = _origNavFns.showCampaignList;
            WikiSB.nav.showCampaign     = _origNavFns.showCampaign;
            _origNavFns = null;
        }
        if (_navGuardFn) {
            document.removeEventListener('click', _navGuardFn, true);
            _navGuardFn = null;
        }
        window.removeEventListener('beforeunload', _beforeUnloadHandler);
        if (_ejInstance) {
            try { _ejInstance.destroy(); } catch {}
        }
        _ejInstance   = null;
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('overflow-y');
        document.body.style.removeProperty('position');
        document.body.style.removeProperty('top');
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('overflow-y');
        _editingEntry = null;
        etEdit.style.display   = '';
        etSave.style.display   = 'none';
        etCancel.style.display = 'none';
        document.getElementById('sb-entry-settings')?.remove();
        setStatus('');
    }

    // ── Lightweight overlay panel ─────────────────────────────────────────────

    function _showPanel(title, bodyHTML, { onOk, okLabel = 'Save' } = {}) {
        document.getElementById('wiki-settings-panel')?.remove();
        const panel = document.createElement('div');
        panel.id = 'wiki-settings-panel';
        panel.className = 'wsp-overlay';
        panel.innerHTML = `
            <div class="wsp-backdrop"></div>
            <div class="wsp-box">
                <div class="wsp-header">
                    <span>${title}</span>
                    <button class="et-btn wsp-close">✕</button>
                </div>
                <div class="wsp-body">${bodyHTML}</div>
                ${onOk ? `<div class="wsp-footer"><button class="et-btn et-primary wsp-ok">${okLabel}</button></div>` : ''}
            </div>`;
        document.body.appendChild(panel);
        const close = () => panel.remove();
        panel.querySelector('.wsp-backdrop').addEventListener('click', close);
        panel.querySelector('.wsp-close').addEventListener('click', close);
        if (onOk) panel.querySelector('.wsp-ok').addEventListener('click', () => { onOk(panel); close(); });
        return panel;
    }

    // ── Themed dialog helpers ─────────────────────────────────────────────────

    function _dlgPrompt(title, { placeholder = '', value = '', okLabel = 'Confirm' } = {}) {
        return new Promise(resolve => {
            const panel = document.createElement('div');
            panel.className = 'wsp-overlay';
            panel.innerHTML = `
                <div class="wsp-backdrop"></div>
                <div class="wsp-box wsp-dialog">
                    <div class="wsp-header"><span>${title}</span></div>
                    <div class="wsp-body">
                        <input class="ej-input wsp-dlg-inp" type="text"
                               placeholder="${placeholder.replace(/"/g,'&quot;')}"
                               value="${(value||'').replace(/"/g,'&quot;')}">
                    </div>
                    <div class="wsp-footer wsp-footer--gap">
                        <button class="et-btn wsp-dlg-cancel">Cancel</button>
                        <button class="et-btn et-primary wsp-dlg-ok">${okLabel}</button>
                    </div>
                </div>`;
            document.body.appendChild(panel);
            const inp = panel.querySelector('.wsp-dlg-inp');
            const ok     = () => { const v = inp.value.trim(); panel.remove(); resolve(v || null); };
            const cancel = () => { panel.remove(); resolve(null); };
            panel.querySelector('.wsp-backdrop').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-cancel').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-ok').addEventListener('click', ok);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
            requestAnimationFrame(() => { inp.focus(); inp.select(); });
        });
    }

    function _dlgConfirm(title, message, { okLabel = 'Confirm', danger = false } = {}) {
        return new Promise(resolve => {
            const panel = document.createElement('div');
            panel.className = 'wsp-overlay';
            panel.innerHTML = `
                <div class="wsp-backdrop"></div>
                <div class="wsp-box wsp-dialog">
                    <div class="wsp-header"><span>${title}</span></div>
                    ${message ? `<div class="wsp-body"><p class="wsp-dlg-msg">${message}</p></div>` : ''}
                    <div class="wsp-footer wsp-footer--gap">
                        <button class="et-btn wsp-dlg-cancel">Cancel</button>
                        <button class="et-btn ${danger ? 'et-danger' : 'et-primary'} wsp-dlg-ok">${okLabel}</button>
                    </div>
                </div>`;
            document.body.appendChild(panel);
            const ok     = () => { panel.remove(); resolve(true); };
            const cancel = () => { panel.remove(); resolve(false); };
            panel.querySelector('.wsp-backdrop').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-cancel').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-ok').addEventListener('click', ok);
            panel.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
            requestAnimationFrame(() => panel.querySelector('.wsp-dlg-ok').focus());
        });
    }

    function _dlgTypeConfirm(name, kind = 'item') {
        return new Promise(resolve => {
            const safe = name.replace(/</g,'&lt;');
            const panel = document.createElement('div');
            panel.className = 'wsp-overlay';
            panel.innerHTML = `
                <div class="wsp-backdrop"></div>
                <div class="wsp-box wsp-dialog">
                    <div class="wsp-header"><span>Confirm Deletion</span></div>
                    <div class="wsp-body">
                        <p class="wsp-dlg-msg">This will permanently delete <strong>${safe}</strong> and all its contents.</p>
                        <p class="wsp-dlg-hint">Type the name of the ${kind} to confirm:</p>
                        <input class="ej-input wsp-dlg-inp" type="text"
                               placeholder="${name.replace(/"/g,'&quot;')}">
                    </div>
                    <div class="wsp-footer wsp-footer--gap">
                        <button class="et-btn wsp-dlg-cancel">Cancel</button>
                        <button class="et-btn et-danger wsp-dlg-ok" disabled>Delete</button>
                    </div>
                </div>`;
            document.body.appendChild(panel);
            const inp   = panel.querySelector('.wsp-dlg-inp');
            const okBtn = panel.querySelector('.wsp-dlg-ok');
            inp.addEventListener('input', () => { okBtn.disabled = inp.value.trim() !== name.trim(); });
            const ok     = () => { if (inp.value.trim() !== name.trim()) return; panel.remove(); resolve(true); };
            const cancel = () => { panel.remove(); resolve(false); };
            panel.querySelector('.wsp-backdrop').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-cancel').addEventListener('click', cancel);
            okBtn.addEventListener('click', ok);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
            requestAnimationFrame(() => inp.focus());
        });
    }

    function _dlgSelect(title, message, options) {
        return new Promise(resolve => {
            const opts = options.map(o => `<option value="${o.id.replace(/"/g,'&quot;')}">${(_parseIcon(o.name).displayName || o.name).replace(/</g,'&lt;')}</option>`).join('');
            const panel = document.createElement('div');
            panel.className = 'wsp-overlay';
            panel.innerHTML = `
                <div class="wsp-backdrop"></div>
                <div class="wsp-box wsp-dialog">
                    <div class="wsp-header"><span>${title}</span></div>
                    <div class="wsp-body">
                        <p class="wsp-dlg-msg">${message}</p>
                        <select class="ej-input ej-select wsp-dlg-sel" style="width:100%">${opts}</select>
                    </div>
                    <div class="wsp-footer wsp-footer--gap">
                        <button class="et-btn wsp-dlg-cancel">Cancel</button>
                        <button class="et-btn et-primary wsp-dlg-ok">Move</button>
                    </div>
                </div>`;
            document.body.appendChild(panel);
            const ok     = () => { const v = panel.querySelector('.wsp-dlg-sel')?.value || null; panel.remove(); resolve(v); };
            const cancel = () => { panel.remove(); resolve(null); };
            panel.querySelector('.wsp-backdrop').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-cancel').addEventListener('click', cancel);
            panel.querySelector('.wsp-dlg-ok').addEventListener('click', ok);
            panel.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
            requestAnimationFrame(() => panel.querySelector('.wsp-dlg-ok').focus());
        });
    }

    // ── Media picker (compact modal) ─────────────────────────────────────────

    async function _showMediaPicker(onSelect, { accept = 'all' } = {}) {
        let allAssets = [];
        try { allAssets = await API.getMediaAssets(); } catch { /* empty */ }

        let activeFilter = accept === 'all' ? 'all' : accept;
        let searchTerm   = '';

        function getFiltered() {
            return allAssets.filter(a => {
                const matchesType   = activeFilter === 'all' || a.resource_type === activeFilter;
                const matchesSearch = !searchTerm || (a.filename || '').toLowerCase().includes(searchTerm.toLowerCase());
                return matchesType && matchesSearch;
            });
        }

        function renderGrid(assets) {
            const grid = panel.querySelector('.ml-picker-grid');
            if (!grid) return;
            grid.innerHTML = '';
            if (!assets.length) {
                grid.innerHTML = '<p style="color:#a08ab0;padding:12px;grid-column:1/-1;margin:0">No media found.</p>';
                return;
            }
            assets.forEach(asset => {
                const card = document.createElement('div');
                card.className = 'ml-picker-card';
                const isAudio = asset.resource_type === 'audio';
                card.innerHTML = `
                    ${isAudio
                        ? '<div class="ml-picker-thumb-audio">🎵</div>'
                        : `<img src="${asset.url.replace(/"/g,'&quot;')}" alt="" style="width:90px;height:68px;object-fit:cover;border-radius:4px;border:1px solid rgba(211,179,231,0.2)" loading="lazy">`
                    }
                    <div class="ml-picker-name" title="${(asset.filename||'').replace(/"/g,'&quot;')}">${(asset.filename||'untitled').replace(/</g,'&lt;')}</div>
                    <button class="et-btn" style="font-size:0.72rem;padding:2px 8px">Use</button>`;
                card.querySelector('button').addEventListener('click', () => {
                    onSelect(asset.url);
                    close();
                });
                grid.appendChild(card);
            });
        }

        const panel = document.createElement('div');
        panel.className = 'wsp-overlay';
        const fileAccept = accept === 'audio' ? 'audio/*' : accept === 'image' ? 'image/*' : '*/*';
        panel.innerHTML = `
            <div class="wsp-backdrop"></div>
            <div class="wsp-box" style="max-width:640px">
                <div class="wsp-header">
                    <span>Media Library</span>
                    <button class="et-btn wsp-close">✕</button>
                </div>
                <div class="wsp-body">
                    <div class="ml-picker-filter-row">
                        <input class="ej-input ml-picker-search" type="text" placeholder="Search…" style="flex:1;min-width:100px">
                        <button class="ml-picker-tab ${activeFilter==='all'  ?'active':''}" data-filter="all">All</button>
                        <button class="ml-picker-tab ${activeFilter==='image'?'active':''}" data-filter="image">Images</button>
                        <button class="ml-picker-tab ${activeFilter==='audio'?'active':''}" data-filter="audio">Audio</button>
                        <button class="et-btn ml-picker-upload-btn" style="margin-left:auto;white-space:nowrap">⬆ Upload New</button>
                        <input type="file" class="ml-picker-file-inp" style="display:none" accept="${fileAccept}">
                    </div>
                    <div class="ml-picker-grid"></div>
                </div>
                <div class="wsp-footer">
                    <button class="et-btn wsp-close">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(panel);

        renderGrid(getFiltered());

        const close = () => panel.remove();

        panel.querySelectorAll('.wsp-close').forEach(b => b.addEventListener('click', close));
        panel.querySelector('.wsp-backdrop').addEventListener('click', close);

        panel.querySelectorAll('.ml-picker-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activeFilter = tab.dataset.filter;
                panel.querySelectorAll('.ml-picker-tab').forEach(t =>
                    t.classList.toggle('active', t.dataset.filter === activeFilter));
                renderGrid(getFiltered());
            });
        });

        panel.querySelector('.ml-picker-search').addEventListener('input', e => {
            searchTerm = e.target.value.trim();
            renderGrid(getFiltered());
        });

        const fileInp   = panel.querySelector('.ml-picker-file-inp');
        const uploadBtn = panel.querySelector('.ml-picker-upload-btn');
        uploadBtn.addEventListener('click', () => fileInp.click());
        fileInp.addEventListener('change', async () => {
            const file = fileInp.files[0];
            if (!file) return;
            uploadBtn.disabled = true;
            uploadBtn.textContent = 'Uploading…';
            try {
                const url = await _cloudinaryUpload(file, activeFilter !== 'all' ? activeFilter : 'Uncategorized');
                allAssets = await API.getMediaAssets();
                renderGrid(getFiltered());
                onSelect(url);
                close();
            } catch (err) {
                uploadBtn.textContent = '✕ Failed';
                setTimeout(() => { uploadBtn.textContent = '⬆ Upload New'; uploadBtn.disabled = false; }, 2000);
            }
        });
    }

    // ── Banner display controls (fit mode + focal point picker + height) ──────

    function _buildBannerControls(containerEl, bannerUrlInputEl, idPrefix, layout) {
        if (!containerEl) return;
        const fit    = layout?.bannerFit    || 'cover';
        const focalX = layout?.bannerFocalX ?? 50;
        const focalY = layout?.bannerFocalY ?? 50;
        const height = layout?.bannerHeight || '';

        const heights = [
            { val: '120', label: 'Short' },
            { val: '180', label: 'Medium' },
            { val: '240', label: 'Tall' },
            { val: '320', label: 'X-Tall' },
        ];
        const hBtns = heights.map(h =>
            `<button type="button" class="bsc-fit-btn${String(height) === h.val ? ' active' : ''}" data-bsc-height="${h.val}">${h.label}</button>`
        ).join('');

        containerEl.innerHTML = `
            <div class="bsc-section">
                <span class="bsc-section-label">Fit</span>
                <div class="bsc-fit-row">
                    <button type="button" class="bsc-fit-btn${fit === 'cover'   ? ' active' : ''}" data-bsc-fit="cover"  >Fill (cover)</button>
                    <button type="button" class="bsc-fit-btn${fit === 'contain' ? ' active' : ''}" data-bsc-fit="contain">Fit inside</button>
                    <button type="button" class="bsc-fit-btn${fit === 'actual'  ? ' active' : ''}" data-bsc-fit="actual" >Actual size</button>
                </div>
            </div>
            <div class="bsc-section">
                <span class="bsc-section-label">Height</span>
                <div class="bsc-fit-row">${hBtns}</div>
            </div>
            <div class="bsc-section bsc-focal-section">
                <span class="bsc-section-label">Focal point <span class="bsc-section-hint">(drag to set)</span></span>
                <div class="bsc-focal-picker" id="${idPrefix}-focal-picker">
                    <div class="bsc-focal-dot" style="left:${focalX}%;top:${focalY}%"></div>
                    <div class="bsc-focal-hint">drag</div>
                </div>
            </div>
            <input type="hidden" id="${idPrefix}-fit"      value="${fit}">
            <input type="hidden" id="${idPrefix}-focal-x"  value="${focalX}">
            <input type="hidden" id="${idPrefix}-focal-y"  value="${focalY}">
            <input type="hidden" id="${idPrefix}-height"   value="${height}">
        `;

        const fitInp    = containerEl.querySelector(`#${idPrefix}-fit`);
        const fxInp     = containerEl.querySelector(`#${idPrefix}-focal-x`);
        const fyInp     = containerEl.querySelector(`#${idPrefix}-focal-y`);
        const heightInp = containerEl.querySelector(`#${idPrefix}-height`);
        const picker    = containerEl.querySelector(`#${idPrefix}-focal-picker`);
        const dot       = picker.querySelector('.bsc-focal-dot');

        // Keep picker preview in sync with URL input
        const _updateBg = () => {
            const url = bannerUrlInputEl?.value?.trim();
            picker.style.backgroundImage = url ? `url('${url}')` : '';
        };
        _updateBg();
        bannerUrlInputEl?.addEventListener('input', _updateBg);
        bannerUrlInputEl?.addEventListener('change', _updateBg);

        // Fit buttons
        containerEl.querySelectorAll('[data-bsc-fit]').forEach(btn => {
            btn.addEventListener('click', () => {
                containerEl.querySelectorAll('[data-bsc-fit]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                fitInp.value = btn.dataset.bscFit;
            });
        });

        // Height buttons (toggle — click active to clear)
        containerEl.querySelectorAll('[data-bsc-height]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    heightInp.value = '';
                } else {
                    containerEl.querySelectorAll('[data-bsc-height]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    heightInp.value = btn.dataset.bscHeight;
                }
            });
        });

        // Focal point drag
        let _dragging = false;
        const _setFocal = (clientX, clientY) => {
            const rect = picker.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, Math.round((clientX - rect.left)  / rect.width  * 100)));
            const y = Math.max(0, Math.min(100, Math.round((clientY - rect.top)   / rect.height * 100)));
            dot.style.left = x + '%';
            dot.style.top  = y + '%';
            fxInp.value = x;
            fyInp.value = y;
        };
        picker.addEventListener('mousedown',  e => { _dragging = true;  _setFocal(e.clientX, e.clientY); });
        picker.addEventListener('touchstart', e => { _dragging = true;  _setFocal(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });

        // Attach document-level listeners and auto-remove when picker leaves DOM
        const _ac = new AbortController();
        document.addEventListener('mousemove', e => { if (_dragging) _setFocal(e.clientX, e.clientY); }, { signal: _ac.signal });
        document.addEventListener('mouseup',   () => { _dragging = false; },                             { signal: _ac.signal });
        document.addEventListener('touchmove', e => { if (_dragging) _setFocal(e.touches[0].clientX, e.touches[0].clientY); }, { signal: _ac.signal, passive: true });
        document.addEventListener('touchend',  () => { _dragging = false; },                             { signal: _ac.signal });
        const _obs = new MutationObserver(() => { if (!document.contains(picker)) { _ac.abort(); _obs.disconnect(); } });
        _obs.observe(document.body, { childList: true, subtree: true });
    }

    function _applyBannerControls(idPrefix, layout) {
        const fitInp    = document.getElementById(`${idPrefix}-fit`);
        const fxInp     = document.getElementById(`${idPrefix}-focal-x`);
        const fyInp     = document.getElementById(`${idPrefix}-focal-y`);
        const heightInp = document.getElementById(`${idPrefix}-height`);
        if (!fitInp) return;
        const wrap = fitInp.closest('[id$="-controls"], .wes-grid > div') || fitInp.parentElement;

        const fit    = layout?.bannerFit    || 'cover';
        const focalX = layout?.bannerFocalX ?? 50;
        const focalY = layout?.bannerFocalY ?? 50;
        const height = layout?.bannerHeight || '';

        fitInp.value    = fit;
        fxInp.value     = focalX;
        fyInp.value     = focalY;
        if (heightInp) heightInp.value = height;

        // Sync fit buttons
        document.querySelectorAll(`[data-bsc-fit]`).forEach(b => {
            b.classList.toggle('active', b.dataset.bscFit === fit);
        });
        // Sync height buttons
        document.querySelectorAll(`[data-bsc-height]`).forEach(b => {
            b.classList.toggle('active', b.dataset.bscHeight === String(height));
        });
        // Sync focal dot
        const dot = document.querySelector(`#${idPrefix}-focal-picker .bsc-focal-dot`);
        if (dot) { dot.style.left = focalX + '%'; dot.style.top = focalY + '%'; }
    }

    // ── Upload browse button injector ─────────────────────────────────────────

    function _attachUploadBtn(inputEl, accept) {
        if (!inputEl) return;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;gap:6px;align-items:center';
        inputEl.parentNode.insertBefore(wrapper, inputEl);
        wrapper.appendChild(inputEl);
        const btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = 'et-btn ml-browse-btn';
        btn.textContent = '⬆ Browse / Upload';
        btn.addEventListener('click', () => {
            _showMediaPicker(url => {
                inputEl.value = url;
                inputEl.dispatchEvent(new Event('input'));
            }, { accept });
        });
        wrapper.appendChild(btn);
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    function _fmtBytes(n) {
        if (!n) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
        return (n / 1073741824).toFixed(2) + ' GB';
    }

    async function _fetchCloudinaryUsage() {
        const session = await API.getSession();
        if (!session?.access_token) return null;
        try {
            const res = await fetch(`https://${_SIGN_WORKER_URL}/usage`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${session.access_token}` },
            });
            if (!res.ok) {
                console.error('[media] /usage returned', res.status, res.statusText);
                return null;
            }
            const data = await res.json();
            if (!data?.storage) {
                console.warn('[media] /usage response has no storage field — worker may need redeploying:', data);
            }
            return data;
        } catch (err) {
            console.error('[media] _fetchCloudinaryUsage error:', err);
            return null;
        }
    }

    // ── Media Manager (full file manager panel) ───────────────────────────────

    async function _openMediaManager() {
        let allAssets = [];
        try { allAssets = await API.getMediaAssets(); } catch { /* empty */ }

        let activeFolder = 'All Files';
        let searchTerm   = '';

        function getFolders() {
            const seen = new Set();
            allAssets.forEach(a => seen.add(a.folder || 'Uncategorized'));
            return ['All Files', ...Array.from(seen).sort()];
        }

        function getFiltered() {
            return allAssets.filter(a => {
                const matchesFolder = activeFolder === 'All Files' || (a.folder || 'Uncategorized') === activeFolder;
                const matchesSearch = !searchTerm || (a.filename || '').toLowerCase().includes(searchTerm.toLowerCase());
                return matchesFolder && matchesSearch;
            });
        }

        function getFolderBytes(folderName) {
            const assets = folderName === 'All Files'
                ? allAssets
                : allAssets.filter(a => (a.folder || 'Uncategorized') === folderName);
            return assets.reduce((s, a) => s + (a.bytes || 0), 0);
        }

        const panel = _showPanel('📁 Media Library', `
            <div class="ml-storage-bar" id="ml-storage-bar">
                <span class="ml-storage-label">Cloudinary Storage</span>
                <div class="ml-storage-track"><div id="ml-storage-fill" class="ml-storage-fill" style="width:0%"></div></div>
                <span id="ml-storage-text" class="ml-storage-text">Loading…</span>
            </div>
            <div class="ml-layout">
                <div class="ml-sidebar" id="ml-sidebar"></div>
                <div class="ml-main">
                    <div class="ml-main-toolbar">
                        <button class="et-btn" id="ml-upload-btn">⬆ Upload</button>
                        <input type="file" id="ml-upload-inp" style="display:none">
                        <input type="text" id="ml-search" class="ej-input" placeholder="Search…" style="flex:1">
                    </div>
                    <div class="ml-grid" id="ml-grid"></div>
                </div>
            </div>`);

        const box  = panel.querySelector('.wsp-box');
        const body = panel.querySelector('.wsp-body');
        if (box)  { box.style.maxWidth = '860px'; box.style.height = '70vh'; box.style.display = 'flex'; box.style.flexDirection = 'column'; }
        if (body) { body.style.flex = '1'; body.style.minHeight = '0'; body.style.padding = '0'; body.style.overflow = 'hidden'; body.style.display = 'flex'; body.style.flexDirection = 'column'; }
        const layout = panel.querySelector('.ml-layout');
        if (layout) { layout.style.flex = '1'; layout.style.minHeight = '0'; }

        // ── Storage bar (async) ───────────────────────────────────────────────
        _fetchCloudinaryUsage().then(usage => {
            const fill = panel.querySelector('#ml-storage-fill');
            const text = panel.querySelector('#ml-storage-text');
            if (!fill || !text) return;
            if (!usage?.storage) { text.textContent = 'Storage info unavailable'; return; }
            const used = usage.storage.usage ?? 0;
            const limit = usage.storage.limit ?? null;
            const pct = usage.storage.used_percent ?? (limit ? (used / limit * 100) : 0);
            fill.style.width = Math.min(100, pct).toFixed(1) + '%';
            fill.className = 'ml-storage-fill' +
                (pct >= 90 ? ' ml-storage-fill--danger' : pct >= 70 ? ' ml-storage-fill--warn' : '');
            const limitStr = limit ? ` / ${_fmtBytes(limit)}` : '';
            text.textContent = `${_fmtBytes(used)}${limitStr} used  (${pct.toFixed(1)}%)`;
        }).catch(() => {
            const text = panel.querySelector('#ml-storage-text');
            if (text) text.textContent = 'Storage info unavailable';
        });

        // ── Sidebar ───────────────────────────────────────────────────────────
        function renderSidebar() {
            const sidebar = panel.querySelector('#ml-sidebar');
            if (!sidebar) return;
            sidebar.innerHTML = '';
            getFolders().forEach(f => {
                const assets = f === 'All Files' ? allAssets : allAssets.filter(a => (a.folder || 'Uncategorized') === f);
                const count  = assets.length;
                const bytes  = getFolderBytes(f);
                const sizeStr = bytes ? _fmtBytes(bytes) : '';

                const item = document.createElement('div');
                item.className = 'ml-folder-item' + (f === activeFolder ? ' active' : '');
                item.title = sizeStr ? `${f} — ${count} file${count !== 1 ? 's' : ''}, ${sizeStr}` : f;

                const nameSpan = document.createElement('span');
                nameSpan.className = 'ml-folder-name';
                nameSpan.textContent = `${f} (${count})`;
                item.appendChild(nameSpan);

                if (sizeStr) {
                    const sizeSpan = document.createElement('span');
                    sizeSpan.className = 'ml-folder-size';
                    sizeSpan.textContent = sizeStr;
                    item.appendChild(sizeSpan);
                }

                item.addEventListener('click', () => { activeFolder = f; renderSidebar(); renderGrid(); });
                sidebar.appendChild(item);
            });

            const newFolderBtn = document.createElement('button');
            newFolderBtn.className = 'et-btn';
            newFolderBtn.style.cssText = 'font-size:0.75rem;margin-top:8px;width:100%';
            newFolderBtn.textContent = '+ New Folder';
            newFolderBtn.addEventListener('click', async () => {
                const name = await _dlgPrompt('New Folder', { placeholder: 'Folder name…', okLabel: 'Create' });
                if (!name) return;
                activeFolder = name.trim();
                renderSidebar();
                renderGrid();
            });
            sidebar.appendChild(newFolderBtn);
        }

        // ── Grid ──────────────────────────────────────────────────────────────
        function renderGrid() {
            const grid = panel.querySelector('#ml-grid');
            if (!grid) return;
            const filtered = getFiltered();
            grid.innerHTML = '';
            if (!filtered.length) {
                grid.innerHTML = '<p style="color:#a08ab0;padding:12px;grid-column:1/-1;margin:0">No media found.</p>';
                return;
            }

            const knownFolders = Array.from(new Set(['Uncategorized', ...allAssets.map(a => a.folder || 'Uncategorized')])).sort();

            filtered.forEach(asset => {
                const card    = document.createElement('div');
                card.className = 'ml-card';
                const isAudio  = asset.resource_type === 'audio';
                const sizeStr  = asset.bytes ? _fmtBytes(asset.bytes) : '';
                const folderOptsHTML = knownFolders.map(f =>
                    `<option value="${f.replace(/"/g,'&quot;')}" ${(asset.folder||'Uncategorized')===f?'selected':''}>${f.replace(/</g,'&lt;')}</option>`
                ).join('');

                card.innerHTML = `
                    ${isAudio
                        ? '<div class="ml-thumb-audio">🎵</div>'
                        : `<img class="ml-thumb" src="${asset.url.replace(/"/g,'&quot;')}" alt="" loading="lazy">`
                    }
                    <div class="ml-card-body">
                        <div class="ml-card-name" title="${(asset.filename||'').replace(/"/g,'&quot;')}">${(asset.filename||'untitled').replace(/</g,'&lt;')}</div>
                        ${sizeStr ? `<div class="ml-card-size">${sizeStr}</div>` : ''}
                        <div class="ml-card-actions">
                            <button class="et-btn ml-copy-btn" style="font-size:0.7rem;padding:2px 6px">📋 Copy URL</button>
                            <button class="et-btn et-danger ml-del-btn" style="font-size:0.7rem;padding:2px 6px">✕ Delete</button>
                        </div>
                        <select class="ej-input ej-select ml-folder-sel" style="font-size:0.72rem;padding:2px 4px;margin-top:4px;width:100%">${folderOptsHTML}</select>
                    </div>`;

                card.querySelector('.ml-copy-btn').addEventListener('click', async () => {
                    const btn = card.querySelector('.ml-copy-btn');
                    try {
                        await navigator.clipboard.writeText(asset.url);
                        btn.textContent = '✓ Copied';
                    } catch {
                        btn.textContent = '✕ Failed';
                    }
                    setTimeout(() => { btn.textContent = '📋 Copy URL'; }, 1500);
                });

                card.querySelector('.ml-del-btn').addEventListener('click', async () => {
                    if (!await _dlgConfirm('Delete Asset',
                        `Delete <strong>${(asset.filename||'').replace(/</g,'&lt;')}</strong>? This cannot be undone.`,
                        { okLabel: 'Delete', danger: true })) return;
                    try {
                        const session = await API.getSession();
                        if (session?.access_token && asset.public_id) {
                            await fetch(`https://${_SIGN_WORKER_URL}/delete`, {
                                method:  'POST',
                                headers: {
                                    'Authorization': `Bearer ${session.access_token}`,
                                    'Content-Type':  'application/json',
                                },
                                body: JSON.stringify({ public_id: asset.public_id, resource_type: asset.resource_type || 'image' }),
                            });
                        }
                        await API.deleteMediaAsset(asset.id);
                        allAssets = allAssets.filter(a => a.id !== asset.id);
                        card.remove();
                        renderSidebar();
                    } catch (err) { setStatus('Delete failed: ' + err.message, true); }
                });

                card.querySelector('.ml-folder-sel').addEventListener('change', async e => {
                    const newFolder = e.target.value;
                    try {
                        await API.updateMediaAsset(asset.id, { folder: newFolder });
                        asset.folder = newFolder;
                        renderSidebar();
                        if (activeFolder !== 'All Files' && activeFolder !== newFolder) card.remove();
                    } catch (err) { setStatus('Folder move failed: ' + err.message, true); }
                });

                grid.appendChild(card);
            });
        }

        renderSidebar();
        renderGrid();

        const uploadInp = panel.querySelector('#ml-upload-inp');
        panel.querySelector('#ml-upload-btn').addEventListener('click', () => uploadInp.click());
        uploadInp.addEventListener('change', async () => {
            const file = uploadInp.files[0];
            if (!file) return;
            const btn = panel.querySelector('#ml-upload-btn');
            btn.disabled = true;
            btn.textContent = 'Uploading…';
            try {
                await _cloudinaryUpload(file, activeFolder === 'All Files' ? 'Uncategorized' : activeFolder);
                allAssets = await API.getMediaAssets();
                renderSidebar();
                renderGrid();
            } catch (err) { setStatus('Upload failed: ' + err.message, true); }
            finally {
                btn.textContent = '⬆ Upload';
                btn.disabled = false;
                uploadInp.value = '';
            }
        });

        panel.querySelector('#ml-search').addEventListener('input', e => {
            searchTerm = e.target.value.trim();
            renderGrid();
        });
    }

    // ── Template system ───────────────────────────────────────────────────────

    function _stripBlockContent(blocks) {
        return (blocks || []).map(blk => {
            const c = blk.content || {};
            switch (blk.type) {
                case 'heading_2':
                case 'heading_3':
                case 'heading_4':
                    return blk; // headings ARE structure
                case 'paragraph':
                case 'rawHtml':
                    return { ...blk, content: { ...c, html: '' } };
                case 'quote':
                    return { ...blk, content: { ...c, html: '', caption: '' } };
                case 'image':
                case 'audio':
                case 'bookmark':
                case 'embed':
                    return { ...blk, content: { ...c, url: '' } };
                case 'callout':
                    return { ...blk, content: { variant: c.variant, emoji: c.emoji, html: '' } };
                case 'props_block':
                    return { ...blk, content: { ...c, rows: (c.rows || []).map(r => ({ key: r.key, value: '' })) } };
                case 'divider':
                    return blk;
                case 'bulleted_list':
                case 'numbered_list':
                    return { ...blk, content: { ...c, items: [] } };
                case 'columns':
                    return { ...blk, content: { ...c, items: (c.items || []).map(col => ({ ...col, blocks: _stripBlockContent(col.blocks || []) })) } };
                case 'toggle':
                    return { ...blk, content: { ...c, blocks: _stripBlockContent(c.blocks || []) } };
                case 'entry_link':
                    return { ...blk, content: { ...c, entryId: '', entryName: '' } };
                default:
                    return blk;
            }
        });
    }

    function _smartMerge(currentBlocks, templateBlocks) {
        const working = currentBlocks.slice();
        for (const tblk of (templateBlocks || [])) {
            if (tblk.type === 'props_block') {
                const idx = working.findIndex(b => b.type === 'props_block');
                if (idx !== -1) {
                    const curRows = (working[idx].content?.rows || []).map(r => ({ ...r }));
                    const tplRows = tblk.content?.rows || [];
                    for (const tr of tplRows) {
                        const ci = curRows.findIndex(r => r.key === tr.key);
                        if (ci !== -1) { if (tr.value) curRows[ci].value = tr.value; }
                        else curRows.push({ ...tr });
                    }
                    working[idx] = { ...working[idx], content: { ...working[idx].content, rows: curRows } };
                } else {
                    working.push(tblk);
                }
            } else if (tblk.type === 'heading_2' || tblk.type === 'heading_3' || tblk.type === 'heading_4') {
                const tText = (tblk.content?.html || '').replace(/<[^>]+>/g, '').trim();
                const found = tText && working.some(b =>
                    (b.type === tblk.type) &&
                    (b.content?.html || '').replace(/<[^>]+>/g, '').trim() === tText
                );
                if (!found) working.push(tblk);
            } else {
                working.push(tblk);
            }
        }
        return working;
    }

    async function _openTemplatePanel() {
        let templates = [];
        try { templates = await API.getTemplates(); } catch { /* empty */ }

        const inEditMode = !!_ejInstance && !!_editingEntry;

        const _BLOCK_LABELS = { heading_2:'Heading', heading_3:'Heading', heading_4:'Heading', paragraph:'Text', image:'Image', quote:'Quote', divider:'Divider', callout:'Callout', props_block:'Properties', toggle:'Toggle', columns:'Columns', table:'Table', embed:'Embed', bookmark:'Link', audio:'Audio', spacer:'Spacer', bulleted_list:'List', numbered_list:'List', entry_link:'Entry Link' };

        const listHTML = templates.length
            ? templates.map(t => `
                <div class="wsp-template-row" data-id="${t.id}">
                    <div class="wsp-template-info">
                        <strong>${t.name.replace(/</g,'&lt;')}</strong>
                        ${t.description ? `<span>${t.description.replace(/</g,'&lt;')}</span>` : ''}
                    </div>
                    <div class="wsp-template-btns">
                        <button class="et-btn wsp-tpl-preview-btn" data-id="${t.id}">▾ Preview</button>
                        ${inEditMode ? `
                        <button class="et-btn wsp-tpl-overwrite" data-id="${t.id}">Overwrite</button>
                        <button class="et-btn wsp-tpl-append"    data-id="${t.id}">Append</button>
                        <button class="et-btn wsp-tpl-smart"     data-id="${t.id}">Smart</button>
                        ` : ''}
                        <button class="et-btn et-danger wsp-tpl-del" data-id="${t.id}">✕</button>
                    </div>
                </div>`).join('')
            : '<p style="color:#a08ab0;margin:0">No templates saved yet.</p>';

        const saveRow = inEditMode
            ? `<div class="wsp-save-row">
                <input id="wsp-tpl-name" class="ej-input" type="text" placeholder="Template name…">
                <input id="wsp-tpl-desc" class="ej-input" type="text" placeholder="Description (optional)…">
                <div class="wsp-tpl-mode-row">
                    <label><input type="radio" name="wsp-tpl-mode" value="structure" checked> Structure only</label>
                    <label><input type="radio" name="wsp-tpl-mode" value="content"> With content</label>
                </div>
                <button class="et-btn et-primary" id="wsp-tpl-save">💾 Save current as template</button>
               </div>`
            : '';

        const panel = _showPanel('📋 Templates', `${saveRow}<div id="wsp-tpl-list">${listHTML}</div>`);

        // Save as template
        const saveBtn = panel.querySelector('#wsp-tpl-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const nameInp = panel.querySelector('#wsp-tpl-name');
                const name = nameInp.value.trim();
                if (!name) { nameInp.style.borderColor = '#f3b0c3'; nameInp.focus(); return; }
                try {
                    const editorData  = await _ejInstance.save();
                    let blocks        = editorDataToBlocks(editorData);
                    const description = panel.querySelector('#wsp-tpl-desc').value.trim();
                    const mode        = panel.querySelector('input[name="wsp-tpl-mode"]:checked')?.value || 'structure';
                    if (mode === 'structure') blocks = _stripBlockContent(blocks);
                    const layout = _readEntrySettings();
                    await API.createTemplate({ name, description, blocks, layout });
                    setStatus('Template saved!');
                    panel.remove();
                } catch (e) { setStatus('Template save failed: ' + e.message, true); }
            });
        }

        // Overwrite
        panel.querySelectorAll('.wsp-tpl-overwrite').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tpl = templates.find(t => t.id === btn.dataset.id);
                if (!tpl || !_ejInstance) return;
                if (!await _dlgConfirm('Apply Template', `Apply <strong>${tpl.name.replace(/</g,'&lt;')}</strong>? This replaces the current editor content.`, { okLabel: 'Overwrite' })) return;
                await _ejInstance.render(blocksToEditorData(tpl.blocks || []));
                if (tpl.layout) _applyEntrySettings(tpl.layout);
                panel.remove();
                setStatus('Template applied — edit and save when ready');
            });
        });

        // Append
        panel.querySelectorAll('.wsp-tpl-append').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tpl = templates.find(t => t.id === btn.dataset.id);
                if (!tpl || !_ejInstance) return;
                const currentData   = await _ejInstance.save();
                const currentBlocks = editorDataToBlocks(currentData);
                const merged        = [...currentBlocks, ...(tpl.blocks || [])];
                await _ejInstance.render(blocksToEditorData(merged));
                panel.remove();
                setStatus('Template appended — edit and save when ready');
            });
        });

        // Smart Match
        panel.querySelectorAll('.wsp-tpl-smart').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tpl = templates.find(t => t.id === btn.dataset.id);
                if (!tpl || !_ejInstance) return;
                const currentData   = await _ejInstance.save();
                const currentBlocks = editorDataToBlocks(currentData);
                const merged        = _smartMerge(currentBlocks, tpl.blocks || []);
                await _ejInstance.render(blocksToEditorData(merged));
                panel.remove();
                setStatus('Template smart-merged — edit and save when ready');
            });
        });

        panel.querySelectorAll('.wsp-tpl-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tpl = templates.find(t => t.id === btn.dataset.id);
                if (!tpl) return;
                if (!await _dlgConfirm('Delete Template', `Delete <strong>${tpl.name.replace(/</g,'&lt;')}</strong>? This cannot be undone.`, { okLabel: 'Delete', danger: true })) return;
                try {
                    await API.deleteTemplate(tpl.id);
                    btn.closest('.wsp-template-row').remove();
                } catch (e) { setStatus('Delete failed: ' + e.message, true); }
            });
        });

        // Template preview (expandable block list)
        panel.querySelectorAll('.wsp-tpl-preview-btn').forEach(btn => {
            const tpl = templates.find(t => t.id === btn.dataset.id);
            if (!tpl) return;
            btn.addEventListener('click', () => {
                const row = btn.closest('.wsp-template-row');
                const existing = row.querySelector('.wsp-tpl-preview');
                if (existing) { existing.remove(); btn.textContent = '▾ Preview'; return; }
                const blocks = tpl.blocks || [];
                // Summarise block types, collapsing consecutive identical ones
                const summary = blocks.map(b => _BLOCK_LABELS[b.type] || b.type);
                const grouped = summary.reduce((acc, t) => {
                    if (acc.length && acc[acc.length - 1].type === t) acc[acc.length - 1].count++;
                    else acc.push({ type: t, count: 1 });
                    return acc;
                }, []);
                const text = grouped.map(g => g.count > 1 ? `${g.type} ×${g.count}` : g.type).join(' → ');
                const preview = document.createElement('div');
                preview.className = 'wsp-tpl-preview';
                preview.textContent = blocks.length ? `${blocks.length} block${blocks.length !== 1 ? 's' : ''}: ${text}` : '(empty)';
                row.appendChild(preview);
                btn.textContent = '▴ Preview';
            });
        });
    }

    etTemplates.addEventListener('click', _openTemplatePanel);
    etMedia.addEventListener('click', _openMediaManager);

    // ── CRUD helpers ──────────────────────────────────────────────────────────

    const _ICON_RE = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;
    function _parseIcon(name) {
        const m = (name || '').match(_ICON_RE);
        if (m) return { icon: m[1], displayName: name.slice(m[0].length).trim() || name };
        return { icon: '', displayName: name || '' };
    }

    function _addDeleteBtn(parentEl, label, onConfirm, strong = false, kind = 'item') {
        const btn = document.createElement('button');
        btn.className   = 'wiki-crud-del';
        btn.textContent = '✕';
        btn.title       = 'Delete ' + label;
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            e.preventDefault();
            const ok = strong
                ? await _dlgTypeConfirm(label, kind)
                : await _dlgConfirm('Confirm Delete', `Delete <strong>${label.replace(/</g,'&lt;')}</strong>? This cannot be undone.`, { okLabel: 'Delete', danger: true });
            if (!ok) return;
            try { await onConfirm(); }
            catch (err) { setStatus('Delete failed: ' + err.message, true); }
        });
        parentEl.appendChild(btn);
        return btn;
    }

    function _addRenameBtn(parentEl, currentName, onRename, inline = false) {
        const btn = document.createElement('button');
        btn.className   = inline ? 'wiki-crud-rename-inline' : 'wiki-crud-rename';
        btn.textContent = '✎';
        btn.title       = 'Rename';
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            e.preventDefault();
            const newName = await _dlgPrompt('Rename', { value: currentName, okLabel: 'Rename' });
            if (!newName || newName === currentName) return;
            try { await onRename(newName.trim()); }
            catch (err) { setStatus('Rename failed: ' + err.message, true); }
        });
        parentEl.appendChild(btn);
        return btn;
    }

    // ── Drag-and-drop sort helper ─────────────────────────────────────────────

    function _setupDragSort(containerEl, itemSelector, onReorder, { horizontal = false } = {}) {
        if (!containerEl) return;
        let dragSrc = null;
        let ghost   = null;

        const items       = () => [...containerEl.querySelectorAll(itemSelector)];
        const removeGhost = () => { ghost?.remove(); ghost = null; };

        // Container handles the actual drop — fires wherever the user releases
        containerEl.addEventListener('dragover', e => e.preventDefault());
        containerEl.addEventListener('drop', e => {
            e.preventDefault();
            if (!dragSrc) { removeGhost(); return; }
            if (ghost?.parentNode) ghost.replaceWith(dragSrc);
            removeGhost();
            onReorder(items().map(n => n.dataset.id));
        });

        items().forEach(el => {
            el.draggable = true;
            el.addEventListener('dragstart', e => {
                dragSrc = el;
                el.classList.add('wiki-dnd-dragging');
                e.dataTransfer.effectAllowed = 'move';
                const tag = containerEl.tagName === 'UL' || containerEl.tagName === 'OL' ? 'li' : 'div';
                ghost = document.createElement(tag);
                ghost.className = horizontal ? 'wiki-dnd-ghost wiki-dnd-ghost--h' : 'wiki-dnd-ghost';
                if (horizontal) ghost.style.height = el.offsetHeight + 'px';
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('wiki-dnd-dragging');
                removeGhost();
            });
            el.addEventListener('dragover', e => {
                e.preventDefault();
                if (!ghost || !dragSrc || dragSrc === el) return;
                const rect = el.getBoundingClientRect();
                if (horizontal) {
                    if (e.clientX < rect.left + rect.width / 2) el.before(ghost);
                    else el.after(ghost);
                } else {
                    if (e.clientY < rect.top + rect.height / 2) el.before(ghost);
                    else el.after(ghost);
                }
            });
            el.addEventListener('dragenter', e => e.preventDefault());
        });
    }

    // ── WikiSB lifecycle hooks ────────────────────────────────────────────────

    // Campaign list: inject "+ New Campaign" button and delete buttons per card
    WikiSB.onCampaignList = function (campaigns) {
        if (!editorGuard()) return;
        resetToolbar();

        const ctrl = document.createElement('div');
        ctrl.className = 'wiki-editor-ctrl';
        ctrl.innerHTML = `<button class="et-btn" id="sb-add-camp">+ New Campaign</button>`;
        document.getElementById('wiki-container').insertAdjacentElement('afterbegin', ctrl);

        document.getElementById('sb-add-camp').addEventListener('click', async () => {
            const name = await _dlgPrompt('New Campaign', { placeholder: 'Campaign name…', okLabel: 'Create' });
            if (!name) return;
            const slug = name.trim().toLowerCase()
                .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            try {
                await API.createCampaign({ name: name.trim(), slug });
                await WikiSB.nav.showCampaignList();
            } catch (e) { setStatus('Create failed: ' + e.message, true); }
        });

        // Settings + delete buttons on each campaign card (rename merged into settings)
        const list = document.getElementById('sb-camp-list');
        if (!list) return;
        list.querySelectorAll('li').forEach((li, i) => {
            const camp = campaigns[i];
            if (!camp) return;
            const cp = _parseIcon(camp.name);
            const currentIcon = camp.icon || cp.icon || '';
            const currentDisplayName = camp.icon != null ? camp.name : cp.displayName;

            // Single ⚙ button — name, icon, description, accent, banner
            const settBtn = document.createElement('button');
            settBtn.className = 'wiki-crud-rename';
            settBtn.textContent = '⚙';
            settBtn.title = 'Campaign settings';
            settBtn.addEventListener('click', async e => {
                e.stopPropagation(); e.preventDefault();
                const campPanel = _showPanel(`⚙ ${currentDisplayName || camp.name} — Settings`, `
                    <div class="wes-grid">
                        <label>Name</label>
                        <input id="cst-name" class="ej-input" type="text"
                               placeholder="Campaign name"
                               value="${currentDisplayName.replace(/"/g,'&quot;')}">
                        <label>Icon</label>
                        <div>
                            <input id="cst-icon" class="ej-input" type="text"
                                   placeholder="🐉 or https://…/icon.png"
                                   value="${currentIcon.replace(/"/g,'&quot;')}">
                            <span class="wes-hint">Emoji or image URL. Recommended: 36 × 36 px</span>
                        </div>
                        <label>Description</label>
                        <input id="cst-desc" class="ej-input" type="text"
                               placeholder="Short campaign description"
                               value="${(camp.description || '').replace(/"/g,'&quot;')}">
                        <label>Accent colour</label>
                        <input id="cst-accent" class="ej-input ej-color-input" type="color"
                               value="${camp.accent_color || '#98e6d6'}">
                        <label>Banner image URL</label>
                        <div>
                            <input id="cst-banner" class="ej-input" type="url"
                                   placeholder="https://… (wide header image)"
                                   value="${(camp.banner_image || '').replace(/"/g,'&quot;')}">
                            <span class="wes-hint">Recommended: 1200 × 300 px</span>
                        </div>
                        <label>Banner display</label>
                        <div id="cst-banner-controls"></div>
                    </div>`, {
                    onOk: async panel => {
                        try {
                            const displayName = panel.querySelector('#cst-name').value.trim();
                            const icon = panel.querySelector('#cst-icon').value.trim();
                            const slug = displayName.toLowerCase()
                                .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                            const cbh = panel.querySelector('#cst-banner-height')?.value || '';
                            const campLayout = {
                                bannerFit:    panel.querySelector('#cst-banner-fit')?.value    || 'cover',
                                bannerFocalX: +(panel.querySelector('#cst-banner-focal-x')?.value ?? 50),
                                bannerFocalY: +(panel.querySelector('#cst-banner-focal-y')?.value ?? 50),
                                ...(cbh ? { bannerHeight: +cbh } : {}),
                            };
                            const allFields = {
                                name:         displayName,
                                slug,
                                icon:         icon || null,
                                description:  panel.querySelector('#cst-desc').value.trim(),
                                accent_color: panel.querySelector('#cst-accent').value,
                                banner_image: panel.querySelector('#cst-banner').value.trim(),
                                layout:       campLayout,
                            };
                            try {
                                await API.updateCampaign(camp.id, allFields);
                            } catch (e2) {
                                if (e2.message.includes('schema cache') || e2.message.includes('column')) {
                                    const { icon: _i, layout: _l, ...coreFields } = allFields;
                                    await API.updateCampaign(camp.id, coreFields);
                                    setStatus('Saved (icon/layout skipped — run supabase-migration-v3/v5.sql to enable)', true);
                                } else { throw e2; }
                            }
                            await WikiSB.nav.showCampaignList();
                        } catch (err) { setStatus('Save failed: ' + err.message, true); }
                    },
                });
                _attachUploadBtn(campPanel.querySelector('#cst-icon'),   'image');
                _attachUploadBtn(campPanel.querySelector('#cst-banner'), 'image');
                _buildBannerControls(
                    campPanel.querySelector('#cst-banner-controls'),
                    campPanel.querySelector('#cst-banner'),
                    'cst-banner',
                    camp.layout || {}
                );
            });
            li.appendChild(settBtn);

            _addDeleteBtn(li, camp.name, async () => {
                await API.deleteCampaign(camp.id);
                await WikiSB.nav.showCampaignList();
            }, true, 'campaign');
        });

        _setupDragSort(
            list,
            'li[data-id]',
            ids => Promise.all(ids.map((id, i) => API.updateCampaign(id, { sort_order: i })))
                .catch(e => setStatus('Reorder failed: ' + e.message, true))
        );
    };

    // Campaign view: inject "+ New Category" and delete per pill
    WikiSB.onCampaign = function (campaignId, categories) {
        if (!editorGuard()) return;
        resetToolbar();

        const pillsEl = document.getElementById('sb-cat-pills');
        if (!pillsEl) return;

        // Settings + delete buttons on existing pills (rename merged into settings)
        pillsEl.querySelectorAll('.wiki-cat-pill').forEach((pill, i) => {
            const cat = categories[i];
            if (!cat) return;
            const cp = _parseIcon(cat.name);
            const currentCatIcon = cat.icon || cp.icon || '';
            const currentCatName = cat.icon != null ? cat.name : cp.displayName;

            const settBtn = document.createElement('button');
            settBtn.className   = 'wiki-crud-rename-inline';
            settBtn.textContent = '⚙';
            settBtn.title       = 'Category settings';
            settBtn.addEventListener('click', async e => {
                e.stopPropagation();
                const catPanel = _showPanel(`⚙ Category — ${currentCatName || cat.name}`, `
                    <div class="wes-grid">
                        <label>Name</label>
                        <input id="ccat-name" class="ej-input" type="text"
                               value="${currentCatName.replace(/"/g,'&quot;')}">
                        <label>Icon</label>
                        <div>
                            <input id="ccat-icon" class="ej-input" type="text"
                                   placeholder="🎲 or https://…/icon.png"
                                   value="${currentCatIcon.replace(/"/g,'&quot;')}">
                            <span class="wes-hint">Emoji or image URL. Recommended: 24 × 24 px</span>
                        </div>
                    </div>`, {
                    onOk: async panel => {
                        try {
                            const displayName = panel.querySelector('#ccat-name').value.trim();
                            const icon = panel.querySelector('#ccat-icon').value.trim();
                            try {
                                await API.updateCategory(cat.id, { name: displayName, icon: icon || null });
                            } catch (e2) {
                                if (e2.message.includes('schema cache') || e2.message.includes('column')) {
                                    await API.updateCategory(cat.id, { name: displayName });
                                    setStatus('Saved (icon skipped — run supabase-migration-v3.sql to enable icons)', true);
                                } else { throw e2; }
                            }
                            await WikiSB.nav.showCampaign(campaignId, WikiSB.state.campaign.name);
                        } catch (err) { setStatus('Save failed: ' + err.message, true); }
                    },
                });
                _attachUploadBtn(catPanel.querySelector('#ccat-icon'), 'image');
            });
            pill.appendChild(settBtn);

            const del = document.createElement('button');
            del.className   = 'wiki-crud-del-inline';
            del.textContent = '✕';
            del.title       = 'Delete category';
            del.addEventListener('click', async e => {
                e.stopPropagation();
                if (!await _dlgTypeConfirm(cat.name, 'category')) return;
                try {
                    await API.deleteCategory(cat.id);
                    await WikiSB.nav.showCampaign(campaignId, WikiSB.state.campaign.name);
                } catch (err) { setStatus('Delete failed: ' + err.message, true); }
            });
            pill.appendChild(del);
        });

        // "+ Category" pill
        const addPill = document.createElement('button');
        addPill.className   = 'wiki-cat-pill wiki-add-pill';
        addPill.textContent = '+ Category';
        addPill.addEventListener('click', async () => {
            const name = await _dlgPrompt('New Category', { placeholder: 'Category name…', okLabel: 'Create' });
            if (!name) return;
            try {
                await API.createCategory(campaignId, { name: name.trim() });
                await WikiSB.nav.showCampaign(campaignId, WikiSB.state.campaign.name);
            } catch (e) { setStatus('Create failed: ' + e.message, true); }
        });
        pillsEl.appendChild(addPill);

        _setupDragSort(
            pillsEl,
            '.wiki-cat-pill[data-id]',
            ids => Promise.all(ids.map((id, i) => API.updateCategory(id, { sort_order: i })))
                .catch(e => setStatus('Reorder failed: ' + e.message, true)),
            { horizontal: true }
        );
    };

    // Entry list: inject "+ New Entry", delete, move, and duplicate per entry
    WikiSB.onEntries = function (categoryId, entries, area) {
        if (!editorGuard()) return;

        const _refreshList = () => {
            const activePill = document.querySelector('#sb-cat-pills .wiki-cat-pill.active');
            if (activePill) activePill.click();
        };

        const list = area.querySelector('#sb-entry-list');
        if (list) {
            // Operate on all li elements — entries array and li elements are in the same order
            const allLis = [...list.querySelectorAll('li[data-id]')];
            allLis.forEach((li, i) => {
                const entry = entries[i];
                if (!entry) return;

                // Move to category
                const moveBtn = document.createElement('button');
                moveBtn.className   = 'wiki-crud-move';
                moveBtn.textContent = '↕';
                moveBtn.title       = 'Move to another category';
                moveBtn.addEventListener('click', async e => {
                    e.stopPropagation(); e.preventDefault();
                    const campId = WikiSB.state.campaign?.id;
                    if (!campId) return;
                    try {
                        const allCats  = await API.getCategories(campId);
                        const otherCats = allCats.filter(c => c.id !== categoryId);
                        if (!otherCats.length) {
                            await _dlgConfirm('Move Entry', 'No other categories to move to.', { okLabel: 'OK' });
                            return;
                        }
                        const name = entry.name.replace(/</g, '&lt;');
                        const targetId = await _dlgSelect('Move Entry', `Move <strong>${name}</strong> to:`, otherCats);
                        if (!targetId) return;
                        await API.updateEntry(entry.id, { category_id: targetId });
                        _refreshList();
                    } catch (err) { setStatus('Move failed: ' + err.message, true); }
                });
                li.appendChild(moveBtn);

                // Duplicate entry
                const dupBtn = document.createElement('button');
                dupBtn.className   = 'wiki-crud-dup';
                dupBtn.textContent = '⎘';
                dupBtn.title       = 'Duplicate entry';
                dupBtn.addEventListener('click', async e => {
                    e.stopPropagation(); e.preventDefault();
                    try {
                        const full    = await API.getEntry(entry.id);
                        const newName = entry.name + ' (copy)';
                        const newRow  = await API.createEntry(categoryId, {
                            name: newName,
                            profile_image: full.profile_image || null,
                            subtitle:      full.subtitle      || null,
                            banner_image:  full.banner_image  || null,
                            layout:        full.layout        || null,
                            extra_props:   full.extra_props   || {},
                        });
                        if (full.blocks?.length) await API.saveBlocks(newRow.id, full.blocks);
                        await WikiSB.nav.showEntry(newRow.id, newName);
                    } catch (err) { setStatus('Duplicate failed: ' + err.message, true); }
                });
                li.appendChild(dupBtn);

                // Delete
                _addDeleteBtn(li, entry.name, async () => {
                    await API.deleteEntry(entry.id);
                    _refreshList();
                });
            });
        }

        // "+ New Entry" button
        const addBtn = document.createElement('button');
        addBtn.className   = 'et-btn';
        addBtn.style.marginTop = '12px';
        addBtn.textContent = '+ New Entry';
        addBtn.addEventListener('click', async () => {
            const name = await _dlgPrompt('New Entry', { placeholder: 'Entry name…', okLabel: 'Create' });
            if (!name) return;
            try {
                const row = await API.createEntry(categoryId, { name: name.trim(), extra_props: {} });
                await WikiSB.nav.showEntry(row.id, row.name);
            } catch (e) { setStatus('Create failed: ' + e.message, true); }
        });
        area.appendChild(addBtn);

        if (list) {
            _setupDragSort(
                list,
                'li[data-id]',
                ids => Promise.all(ids.map((id, i) => API.updateEntry(id, { sort_order: i })))
                    .catch(e => setStatus('Reorder failed: ' + e.message, true))
            );
        }
    };

    // ── Toolbar scroll positioning ────────────────────────────────────────────
    // When at the top of the page the toolbar drops below the navbar.
    // Once the navbar scrolls out of view it rises to near the top edge.

    function _updateToolbarTop() {
        const nav = document.querySelector('nav');
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
        toolbar.style.top = Math.max(20, navBottom + 8) + 'px';
    }

    window.addEventListener('scroll', _updateToolbarTop, { passive: true });

    // navbar.js injects <nav> on DOMContentLoaded — wait for that before
    // measuring, then re-check on window load for any late layout shifts.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _updateToolbarTop);
    } else {
        // DOM already parsed; navbar.js may not have run yet — defer one frame
        requestAnimationFrame(_updateToolbarTop);
    }
    window.addEventListener('load', _updateToolbarTop);

    // ── Entry detail: show the Edit button wired to the current entry ─────────
    WikiSB.onEntryDetail = function (entry) {
        if (!editorGuard()) return;
        etEdit.style.display = '';
        // enterEditMode is async — attach a .catch so any unhandled rejection
        // surfaces as a status message rather than a silent console error.
        etEdit.onclick = () => {
            enterEditMode(entry).catch(e => setStatus('Edit failed: ' + e.message, true));
        };
    };

}());
