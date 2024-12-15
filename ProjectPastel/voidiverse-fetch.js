// Define the URL for your proxy
const PROXY_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-data';

// Fetch data from the proxy
async function fetchData() {
    try {
        const response = await fetch(PROXY_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        displayWikiData(data);
    } catch (error) {
        console.error('Error fetching data:', error);
        const container = document.getElementById('wiki-container');
        if (container) {
            container.innerHTML = `<p style="color: red;">Error loading data. Please try again later.</p>`;
        }
    }
}

// Utility function to sanitize HTML input
function sanitizeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
}

// Organize and display fetched data
function displayWikiData(data) {
    const container = document.getElementById('wiki-container');
    if (!container) {
        console.error('Wiki container not found in the DOM');
        return;
    }

    // Clear the "Loading wiki data..." message
    container.innerHTML = '';

    const campaigns = {};

    // Organize rows into campaigns
    data.values.forEach((row, index) => {
        if (index === 0) return; // Skip header row
        const [campaignName, npcName, npcRole, locationName, description, category] = row;

        if (!campaignName || (!npcName && !locationName)) {
            console.warn('Invalid row data:', row);
            return;
        }

        // Initialize campaign if not already added
        if (!campaigns[campaignName]) {
            campaigns[campaignName] = { NPCs: [], Locations: [] };
        }

        // Categorize data
        if (category === 'NPC') {
            campaigns[campaignName].NPCs.push({ name: npcName, role: npcRole, description });
        } else if (category === 'Location') {
            campaigns[campaignName].Locations.push({ name: locationName, description });
        }
    });

    console.log('Processed Campaigns:', campaigns);

    // Render campaigns dynamically
    Object.keys(campaigns).forEach(campaignName => {
        const campaignData = campaigns[campaignName];
        const campaignSection = document.createElement('section');

        // Safely render NPCs and locations
        const npcList = campaignData.NPCs.map(npc => `
            <li><strong>${sanitizeHTML(npc.name)}</strong>: ${sanitizeHTML(npc.role)}<br>${sanitizeHTML(npc.description)}</li>
        `).join('');

        const locationList = campaignData.Locations.map(location => `
            <li><strong>${sanitizeHTML(location.name)}</strong>: ${sanitizeHTML(location.description)}</li>
        `).join('');

        campaignSection.innerHTML = `
            <h2>${sanitizeHTML(campaignName)}</h2>
            <h3>NPCs</h3>
            <ul>${npcList}</ul>
            <h3>Locations</h3>
            <ul>${locationList}</ul>
        `;
        container.appendChild(campaignSection);
    });
}


// Wait for DOM to load before running fetchData
document.addEventListener('DOMContentLoaded', fetchData);
