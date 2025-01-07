const PROXY_URL = 'https://minip-xc9e.onrender.com/api/get-sheet-data';
let campaigns = {}; // Store data globally for filtering

// Fetch data from the proxy
async function fetchData() {
    try {
        const response = await fetch(PROXY_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        processWikiData(data);
        renderWikiData(); // Initial render
    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('wiki-container').innerHTML = `<p style="color: red;">Error loading data. Please try again later.</p>`;
    }
}

// Process fetched data
function processWikiData(data) {
    campaigns = {};
    console.log("Raw data being processed:", data.values); // Log raw values

    data.values.forEach((row, index) => {
        if (index === 0) return; // Skip header
        const [campaignName, npcName, npcRole, locationName, description, category] = row;

        if (!campaignName) return; // Skip rows without campaign names

        if (!campaigns[campaignName]) {
            campaigns[campaignName] = { NPCs: [], Locations: [] };
        }

        if (category === 'NPC' && npcName) {
            campaigns[campaignName].NPCs.push({ name: npcName, role: npcRole, description });
        } else if (category === 'Location' && locationName) {
            campaigns[campaignName].Locations.push({ name: locationName, description });
        }
    });

    console.log("Processed campaigns object:", campaigns); // Log processed campaigns
}


// Render the filtered data dynamically
function renderWikiData(filterText = '', filterCategory = 'all') {
    const container = document.getElementById('wiki-container');
    container.innerHTML = ''; // Clear existing content

    console.log("Rendering with filters:", { filterText, filterCategory }); // Debug filters

    Object.keys(campaigns).forEach(campaignName => {
        const campaign = campaigns[campaignName];
        let filteredNPCs = campaign.NPCs;
        let filteredLocations = campaign.Locations;

        // Apply filters
        if (filterCategory === 'NPC') filteredLocations = [];
        if (filterCategory === 'Location') filteredNPCs = [];
        if (filterText) {
            const lowerCaseText = filterText.toLowerCase();
            filteredNPCs = filteredNPCs.filter(npc =>
                npc.name.toLowerCase().includes(lowerCaseText) || npc.role.toLowerCase().includes(lowerCaseText)
            );
            filteredLocations = filteredLocations.filter(location =>
                location.name.toLowerCase().includes(lowerCaseText) || location.description.toLowerCase().includes(lowerCaseText)
            );
        }

        // Debug filtered results
        console.log(`Rendering campaign: ${campaignName}`, { filteredNPCs, filteredLocations });

        // Render campaign if it has any filtered results
        if (filteredNPCs.length > 0 || filteredLocations.length > 0) {
            const section = document.createElement('section');
            section.innerHTML = `
                <h2>${campaignName}</h2>
                ${filteredNPCs.length > 0 ? `
                    <h3>NPCs</h3>
                    <ul>${filteredNPCs.map(npc => `
                        <li><strong>${npc.name}</strong>: ${npc.role}<br>${npc.description}</li>
                    `).join('')}</ul>
                ` : ''}
                ${filteredLocations.length > 0 ? `
                    <h3>Locations</h3>
                    <ul>${filteredLocations.map(location => `
                        <li><strong>${location.name}</strong>: ${location.description}</li>
                    `).join('')}</ul>
                ` : ''}
            `;
            container.appendChild(section);
        }
    });
}


// Event listeners for search and filter
document.addEventListener('DOMContentLoaded', () => {
    fetchData();

    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');

    searchInput.addEventListener('input', () => {
        renderWikiData(searchInput.value, categoryFilter.value);
    });

    categoryFilter.addEventListener('change', () => {
        renderWikiData(searchInput.value, categoryFilter.value);
    });
});
