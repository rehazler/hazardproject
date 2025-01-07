const SHEET_NAMES_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-names';
const SHEET_DATA_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-data';
let campaigns = {}; // Store data globally for filtering

// Utility function to parse URL parameters
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Fetch and display sheet names
async function fetchSheetNames() {
    console.log('fetchSheetNames called'); // Debugging log
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

                    // Update the URL
                    history.pushState(null, '', `?campaign=${encodeURIComponent(sheetName)}`);

                    // Fetch and display campaign data
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

// Fetch and display data for a specific sheet
async function fetchSheetData(sheetName) {
    console.log(`Fetching data for campaign: ${sheetName}`); // Debugging log
    try {
        const response = await fetch(`${SHEET_DATA_URL}?sheetName=${encodeURIComponent(sheetName)}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();

        processWikiData(sheetName, data);

        // Handle non-existent campaigns
        if (!campaigns[sheetName]) {
            document.getElementById('wiki-container').innerHTML = `
                <p style="color: red;">Campaign not found: ${sheetName}</p>
            `;
            setTimeout(fetchSheetNames, 3000); // Redirect back to list after 3 seconds
            return;
        }

        const container = document.getElementById('wiki-container');

        // Clear existing content
        container.innerHTML = ''; // Clear the container

        // Add Back Button
        const backButton = document.createElement('button');
        backButton.id = 'back-button';
        backButton.textContent = 'Back to Campaign List';
        console.log('Back button created and appended'); // Debugging log

        // Ensure event listener is attached after the button is added to the DOM
        backButton.addEventListener('click', () => {
            console.log('Back button clicked'); // Debugging log

            // Clear URL parameters
            history.pushState(null, '', window.location.pathname);

            // Fetch and display the campaign list
            fetchSheetNames();
        });

        // Append the button to the container
        container.appendChild(backButton);

        // Render the selected campaign details
        renderWikiData(sheetName);
    } catch (error) {
        console.error(`Error fetching data for sheet ${sheetName}:`, error);
        document.getElementById('wiki-container').innerHTML = `<p style="color: red;">Error loading data for ${sheetName}. Please try again later.</p>`;
    }
}


// Process fetched data
function processWikiData(sheetName, data) {
    campaigns[sheetName] = { NPCs: [], Locations: [] }; // Initialize campaign object
    data.values.forEach((row, index) => {
        if (index === 0) return; // Skip header row
        const [npcName, npcRole, locationName, description, category] = row;

        if (category === 'NPC' && npcName) {
            campaigns[sheetName].NPCs.push({ name: npcName, role: npcRole, description });
        } else if (category === 'Location' && locationName) {
            campaigns[sheetName].Locations.push({ name: locationName, description });
        }
    });
}

// Render campaign details
function renderWikiData(sheetName) {
    const container = document.getElementById('wiki-container');

    // Preserve back button
    const backButton = document.getElementById('back-button');
    container.innerHTML = backButton ? backButton.outerHTML : '';

    const campaign = campaigns[sheetName];
    if (!campaign) {
        console.error(`No data found for campaign: ${sheetName}`);
        return;
    }

    const section = document.createElement('section');
    section.innerHTML = `
        <h2>${sheetName}</h2>
        ${campaign.NPCs.length > 0 ? `
            <details open>
                <summary><h3>NPCs</h3></summary>
                <ul>${campaign.NPCs.map(npc => `
                    <li><strong>${npc.name}</strong>: ${npc.role}<br>${npc.description}</li>
                `).join('')}</ul>
            </details>
        ` : ''}
        ${campaign.Locations.length > 0 ? `
            <details open>
                <summary><h3>Locations</h3></summary>
                <ul>${campaign.Locations.map(location => `
                    <li><strong>${location.name}</strong>: ${location.description}</li>
                `).join('')}</ul>
            </details>
        ` : ''}
    `;
    container.appendChild(section);
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    const campaignName = getURLParameter('campaign');
    console.log('Detected campaign parameter:', campaignName); // Debugging log
    if (campaignName) {
        fetchSheetData(campaignName); // Load specific campaign if parameter exists
    } else {
        fetchSheetNames(); // Otherwise, load the campaign list
    }
});
