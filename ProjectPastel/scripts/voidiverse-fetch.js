const SHEET_NAMES_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-names';
const SHEET_DATA_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-data';
let campaigns = {};

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

function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBackButton(label, onClick) {
    const btn = document.createElement('button');
    btn.id = 'back-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function makeBreadcrumb(crumbs) {
    const nav = document.createElement('nav');
    nav.id = 'wiki-breadcrumb';
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

// ── Data fetching ──────────────────────────────────────────────────────────

async function ensureSheetData(sheetName) {
    if (campaigns[sheetName]) return;
    document.getElementById('wiki-container').innerHTML = `
        <div class="wiki-loading">
            <div class="wiki-spinner"></div>
            <p>Loading ${escapeHTML(sheetName)}…</p>
        </div>`;
    const response = await fetch(`${SHEET_DATA_URL}?sheetName=${encodeURIComponent(sheetName)}`);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    processWikiData(sheetName, await response.json());
}

function processWikiData(sheetName, data) {
    campaigns[sheetName] = { items: [] };
    let currentItem = null;
    let currentProfileSection = null;

    data.values.forEach((row, index) => {
        if (index === 0) return;
        const [name, category, profilePicture, profileSection, profileDescriptor,
               profileDescription, pageSection, pageDescriptor, pageDescription,
               artworkSection, artworkDescriptor, artworkLink, artworkDescription] = row;

        if (!name && !category && !profileSection && !pageSection && !artworkSection) return;

        if (name) {
            if (currentItem) campaigns[sheetName].items.push(currentItem);
            currentItem = {
                name,
                category: category || '',
                profilePicture: profilePicture || '',
                profileTable: {},
                pageSections: [],
                artworkSections: []
            };
            currentProfileSection = null;
        }

        if (currentItem) {
            if (profileSection) {
                currentProfileSection = profileSection;
                if (!currentItem.profileTable[currentProfileSection])
                    currentItem.profileTable[currentProfileSection] = [];
            }
            if (currentProfileSection && profileDescriptor && profileDescription) {
                currentItem.profileTable[currentProfileSection].push({
                    descriptor: profileDescriptor, description: profileDescription
                });
            }
            if (pageSection) {
                const existing = currentItem.pageSections.find(p => p.sectionName === pageSection);
                if (!existing) {
                    currentItem.pageSections.push({
                        sectionName: pageSection,
                        details: [{ descriptor: pageDescriptor || '', description: pageDescription || '' }]
                    });
                } else {
                    existing.details.push({ descriptor: pageDescriptor || '', description: pageDescription || '' });
                }
            }
            if (artworkSection) {
                const existing = currentItem.artworkSections.find(a => a.sectionName === artworkSection);
                if (!existing) {
                    currentItem.artworkSections.push({
                        sectionName: artworkSection,
                        details: [{ descriptor: artworkDescriptor || '', link: artworkLink || '', description: artworkDescription || '' }]
                    });
                } else {
                    existing.details.push({ descriptor: artworkDescriptor || '', link: artworkLink || '', description: artworkDescription || '' });
                }
            }
        }
    });

    if (currentItem) campaigns[sheetName].items.push(currentItem);
}

// ── Views ──────────────────────────────────────────────────────────────────

async function showCampaignList() {
    const container = document.getElementById('wiki-container');
    try {
        const response = await fetch(SHEET_NAMES_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const sheetNames = await response.json();

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
            sheetNames
                .filter(n => n.toLowerCase().includes(filter.toLowerCase()))
                .forEach(sheetName => {
                    const li = document.createElement('li');
                    li.innerHTML = `<a href="?campaign=${encodeURIComponent(sheetName)}"
                        data-sheet="${escapeHTML(sheetName)}">${escapeHTML(sheetName)}</a>`;
                    list.appendChild(li);
                });
            list.querySelectorAll('[data-sheet]').forEach(link => {
                link.addEventListener('click', e => {
                    e.preventDefault();
                    const name = e.target.getAttribute('data-sheet');
                    history.pushState(null, '', `?campaign=${encodeURIComponent(name)}`);
                    showCategoryList(name);
                });
            });
        }

        render();
        document.getElementById('search-campaigns').addEventListener('input', e => render(e.target.value));
    } catch (err) {
        console.error('Error fetching sheet names:', err);
        container.innerHTML = `<p style="color:red;">Error loading campaigns. Please try again later.</p>`;
    }
}

async function showCategoryList(sheetName) {
    const container = document.getElementById('wiki-container');
    try {
        await ensureSheetData(sheetName);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red;">Error loading ${escapeHTML(sheetName)}.</p>`;
        return;
    }

    const goToCampaigns = () => {
        history.pushState(null, '', window.location.pathname);
        showCampaignList();
    };

    const categories = [...new Set(
        campaigns[sheetName].items.map(i => i.category).filter(Boolean)
    )];

    container.innerHTML = '';
    container.appendChild(makeBreadcrumb([
        { label: 'Campaigns', onClick: goToCampaigns },
        { label: sheetName }
    ]));
    container.appendChild(makeBackButton('← Back to Campaigns', goToCampaigns));

    const title = document.createElement('h1');
    title.textContent = sheetName;
    container.appendChild(title);

    if (categories.length === 0) {
        const msg = document.createElement('p');
        msg.textContent = 'No categories found.';
        container.appendChild(msg);
        return;
    }

    const list = document.createElement('ul');
    list.id = 'sheet-list';
    categories.forEach(category => {
        const count = campaigns[sheetName].items.filter(i => i.category === category).length;
        const li = document.createElement('li');
        li.innerHTML = `<a href="?campaign=${encodeURIComponent(sheetName)}&category=${encodeURIComponent(category)}"
            data-category="${escapeHTML(category)}">${escapeHTML(category)}
            <span class="wiki-count">(${count})</span></a>`;
        list.appendChild(li);
    });
    container.appendChild(list);

    list.querySelectorAll('[data-category]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const cat = e.target.closest('[data-category]').getAttribute('data-category');
            history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}&category=${encodeURIComponent(cat)}`);
            showNameList(sheetName, cat);
        });
    });
}

async function showNameList(sheetName, category) {
    const container = document.getElementById('wiki-container');
    try {
        await ensureSheetData(sheetName);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red;">Error loading ${escapeHTML(sheetName)}.</p>`;
        return;
    }

    const goToCampaigns = () => {
        history.pushState(null, '', window.location.pathname);
        showCampaignList();
    };
    const goToCategories = () => {
        history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}`);
        showCategoryList(sheetName);
    };

    const items = campaigns[sheetName].items.filter(i => i.category === category);

    container.innerHTML = '';
    container.appendChild(makeBreadcrumb([
        { label: 'Campaigns', onClick: goToCampaigns },
        { label: sheetName, onClick: goToCategories },
        { label: category }
    ]));
    container.appendChild(makeBackButton(`← Back to ${sheetName}`, goToCategories));

    const title = document.createElement('h1');
    title.textContent = category;
    container.appendChild(title);

    if (items.length === 0) {
        const msg = document.createElement('p');
        msg.textContent = `No entries found in ${category}.`;
        container.appendChild(msg);
        return;
    }

    const list = document.createElement('ul');
    list.id = 'sheet-list';
    items.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="?campaign=${encodeURIComponent(sheetName)}&category=${encodeURIComponent(category)}&entry=${encodeURIComponent(item.name)}"
            data-entry="${escapeHTML(item.name)}">${escapeHTML(item.name)}</a>`;
        list.appendChild(li);
    });
    container.appendChild(list);

    list.querySelectorAll('[data-entry]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const entry = e.target.getAttribute('data-entry');
            history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}&category=${encodeURIComponent(category)}&entry=${encodeURIComponent(entry)}`);
            showItemDetail(sheetName, category, entry);
        });
    });
}

async function showItemDetail(sheetName, category, itemName) {
    const container = document.getElementById('wiki-container');
    try {
        await ensureSheetData(sheetName);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red;">Error loading ${escapeHTML(sheetName)}.</p>`;
        return;
    }

    const goToCampaigns = () => {
        history.pushState(null, '', window.location.pathname);
        showCampaignList();
    };
    const goToCategories = () => {
        history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}`);
        showCategoryList(sheetName);
    };
    const goToNames = () => {
        history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}&category=${encodeURIComponent(category)}`);
        showNameList(sheetName, category);
    };

    const item = campaigns[sheetName].items.find(i => i.name === itemName);

    container.innerHTML = '';
    container.appendChild(makeBreadcrumb([
        { label: 'Campaigns', onClick: goToCampaigns },
        { label: sheetName, onClick: goToCategories },
        { label: category, onClick: goToNames },
        { label: itemName }
    ]));
    container.appendChild(makeBackButton(`← Back to ${category}`, goToNames));

    if (!item) {
        const msg = document.createElement('p');
        msg.style.color = 'red';
        msg.textContent = `Entry not found: ${itemName}`;
        container.appendChild(msg);
        return;
    }

    const section = document.createElement('section');
    section.innerHTML = `
        <h2>${escapeHTML(item.name)}</h2>
        <p><strong>Category:</strong> ${escapeHTML(item.category)}</p>
        <div class="wiki-entry-layout">
            <div class="wiki-entry-main">
                ${item.pageSections.map(ps => `
                    <h3>${escapeHTML(ps.sectionName)}</h3>
                    ${ps.details.map(d => `
                        <h4>${escapeHTML(d.descriptor)}</h4>
                        <p>${escapeHTML(d.description)}</p>
                    `).join('')}
                `).join('')}
                ${item.artworkSections.map(as => `
                    <h3>${escapeHTML(as.sectionName)}</h3>
                    ${as.details.map(d => `
                        <h4>${escapeHTML(d.descriptor)}</h4>
                        <img src="${safeURL(d.link)}" alt="${escapeHTML(d.descriptor)}" style="max-width:100%;margin-bottom:0.5rem;">
                        <p style="font-style:italic;">${escapeHTML(d.description)}</p>
                    `).join('')}
                `).join('')}
            </div>
            <div class="wiki-entry-sidebar">
                <h3>${escapeHTML(item.name)}</h3>
                ${item.profilePicture ? `<img src="${safeURL(item.profilePicture)}" alt="${escapeHTML(item.name)}" style="max-width:100%;margin-bottom:1rem;">` : ''}
                ${Object.entries(item.profileTable).map(([sectionName, rows]) => `
                    <h3>${escapeHTML(sectionName)}</h3>
                    <table style="width:100%;border:1px solid #ccc;text-align:left;margin-bottom:1rem;table-layout:fixed;">
                        ${rows.map(row => `
                            <tr>
                                <td style="width:50%;font-weight:bold;">${escapeHTML(row.descriptor)}</td>
                                <td>${escapeHTML(row.description)}</td>
                            </tr>
                        `).join('')}
                    </table>
                `).join('')}
            </div>
        </div>
    `;
    container.appendChild(section);
}

// ── Router ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const campaign = getURLParameter('campaign');
    const category = getURLParameter('category');
    const entry    = getURLParameter('entry');

    if (campaign && category && entry) {
        showItemDetail(campaign, category, entry);
    } else if (campaign && category) {
        showNameList(campaign, category);
    } else if (campaign) {
        showCategoryList(campaign);
    } else {
        showCampaignList();
    }
});
