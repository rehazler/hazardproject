const SHEET_NAMES_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-names';
const SHEET_DATA_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-data';
let campaigns = {}; // Store data globally for filtering

function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

async function fetchSheetNames() {
    try {
        const response = await fetch(SHEET_NAMES_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const sheetNames = await response.json();

        const container = document.getElementById('wiki-container');
        container.innerHTML = `
            <h2>Select a Campaign:</h2>
            <input type="text" id="search-campaigns" placeholder="Search campaigns..." />
            <ul id="sheet-list"></ul>
        `;

        const sheetList = document.getElementById('sheet-list');

        function renderCampaignList(filter = '') {
            sheetList.innerHTML = '';
            sheetNames
                .filter(sheetName => sheetName.toLowerCase().includes(filter.toLowerCase()))
                .forEach(sheetName => {
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `<a href="?campaign=${encodeURIComponent(sheetName)}" data-sheet="${sheetName}">${sheetName}</a>`;
                    sheetList.appendChild(listItem);
                });

            document.querySelectorAll('[data-sheet]').forEach(link => {
                link.addEventListener('click', event => {
                    event.preventDefault();
                    const sheetName = event.target.getAttribute('data-sheet');
                    history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}`);
                    fetchSheetData(sheetName);
                });
            });
        }

        renderCampaignList();

        document.getElementById('search-campaigns').addEventListener('input', event => {
            renderCampaignList(event.target.value);
        });
    } catch (error) {
        console.error('Error fetching sheet names:', error);
        document.getElementById('wiki-container').innerHTML = `<p style="color: red;">Error loading campaigns. Please try again later.</p>`;
    }
}

async function fetchSheetData(sheetName) {
    try {
        const response = await fetch(`${SHEET_DATA_URL}?sheetName=${encodeURIComponent(sheetName)}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();

        processWikiData(sheetName, data);

        const container = document.getElementById('wiki-container');
        container.innerHTML = '';

        const backButton = document.createElement('button');
        backButton.id = 'back-button';
        backButton.textContent = 'Back to Campaign List';
        backButton.style.float = 'left';
        backButton.style.marginBottom = '20px';
        backButton.addEventListener('click', () => {
            history.pushState(null, '', window.location.pathname);
            fetchSheetNames();
        });
        container.appendChild(backButton);

        const campaignTitle = document.createElement('h1');
        campaignTitle.textContent = sheetName;
        campaignTitle.style.color = '#f4f4f4';
        campaignTitle.style.textAlign = 'center';
        campaignTitle.style.margin = '40px 0 20px';
        campaignTitle.style.clear = 'both';
        container.appendChild(campaignTitle);

        renderWikiData(sheetName);
    } catch (error) {
        console.error(`Error fetching data for sheet ${sheetName}:`, error);
        document.getElementById('wiki-container').innerHTML = `<p style="color: red;">Error loading data for ${sheetName}. Please try again later.</p>`;
    }
}

function processWikiData(sheetName, data) {
    campaigns[sheetName] = { items: [] };

    let currentItem = null;
    let currentProfileSection = null;

    data.values.forEach((row, index) => {
        if (index === 0) return;

        const [name, category, profilePicture, profileSection, profileDescriptor, profileDescription, pageSection, pageDescriptor, pageDescription, artworkSection, artworkDescriptor, artworkLink, artworkDescription] = row;

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
                if (!currentItem.profileTable[currentProfileSection]) {
                    currentItem.profileTable[currentProfileSection] = [];
                }
            }

            if (currentProfileSection && profileDescriptor && profileDescription) {
                currentItem.profileTable[currentProfileSection].push({
                    descriptor: profileDescriptor,
                    description: profileDescription
                });
            }

            if (pageSection) {
                const existingPage = currentItem.pageSections.find(ps => ps.sectionName === pageSection);
                if (!existingPage) {
                    currentItem.pageSections.push({
                        sectionName: pageSection,
                        details: [{ descriptor: pageDescriptor || '', description: pageDescription || '' }]
                    });
                } else {
                    existingPage.details.push({ descriptor: pageDescriptor || '', description: pageDescription || '' });
                }
            }

            if (artworkSection) {
                const existingArtwork = currentItem.artworkSections.find(as => as.sectionName === artworkSection);
                if (!existingArtwork) {
                    currentItem.artworkSections.push({
                        sectionName: artworkSection,
                        details: [{ descriptor: artworkDescriptor || '', link: artworkLink || '', description: artworkDescription || '' }]
                    });
                } else {
                    existingArtwork.details.push({ descriptor: artworkDescriptor || '', link: artworkLink || '', description: artworkDescription || '' });
                }
            }
        }
    });

    if (currentItem) campaigns[sheetName].items.push(currentItem);
}

function renderWikiData(sheetName) {
    const container = document.getElementById('wiki-container');

    const campaign = campaigns[sheetName]?.items;
    if (!campaign || campaign.length === 0) {
        container.innerHTML += `<p style="color: red;">No data found for campaign: ${sheetName}</p>`;
        return;
    }

    campaign.forEach(item => {
        const section = document.createElement('section');
        section.innerHTML = `
            <h2>${item.name}</h2>
            <p><strong>Category:</strong> ${item.category}</p>
            <div style="display: flex;">
                <div style="flex: 3;">
                    ${item.pageSections.map(pageSection => `
                        <h3>${pageSection.sectionName}</h3>
                        ${pageSection.details.map(detail => `
                            <h4>${detail.descriptor}</h4>
                            <p>${detail.description}</p>
                        `).join('')}
                    `).join('')}
                    ${item.artworkSections.map(artworkSection => `
                        <h3>${artworkSection.sectionName}</h3>
                        ${artworkSection.details.map(detail => `
                            <h4>${detail.descriptor}</h4>
                            <img src="${detail.link}" alt="${detail.descriptor}" style="max-width: 100%; margin-bottom: 0.5rem;">
                            <p style="font-style: italic;">${detail.description}</p>
                        `).join('')}
                    `).join('')}
                </div>
                <div style="flex: 1; text-align: center; padding-left: 20px;">
                    <h3>${item.name}</h3>
                    ${item.profilePicture ? `<img src="${item.profilePicture}" alt="${item.name} Image" style="max-width: 100%; margin-bottom: 1rem;">` : ''}
                    ${Object.entries(item.profileTable).map(([sectionName, descriptors]) => `
                        <h3>${sectionName}</h3>
                        <table style="width: 100%; border: 1px solid #ccc; text-align: left; margin-bottom: 1rem; table-layout: fixed;">
                            ${descriptors.map(row => `
                                <tr>
                                    <td style="width: 50%; font-weight: bold;">${row.descriptor}</td>
                                    <td>${row.description}</td>
                                </tr>
                            `).join('')}
                        </table>
                    `).join('')}
                </div>
            </div>
        `;
        container.appendChild(section);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const campaignName = getURLParameter('campaign');

    if (campaignName) {
        fetchSheetData(campaignName);
    } else {
        fetchSheetNames();
    }
});
