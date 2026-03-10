function loadNavbar() {
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
            <span></span><span></span><span></span>
        </button>
        <ul class="nav-links">
            <li><a href="index.html">Home</a></li>
            <li><a href="about.html">About Me</a></li>
            <li><a href="livestreams.html">Livestreams &amp; Playlists</a></li>
            <li><a href="wiki.html">Wiki</a></li>
            <li><a href="wiki-notion.html">Wiki (Notion)</a></li>
            <li><a href="forms.html">Forms</a></li>
            <li><a href="editor-guide.html">Editor Guide</a></li>
        </ul>
    `;
    document.getElementById('navbar-placeholder').appendChild(nav);

    const toggle = nav.querySelector('.nav-toggle');
    const links  = nav.querySelector('.nav-links');

    toggle.addEventListener('click', () => {
        const open = links.classList.toggle('nav-open');
        toggle.setAttribute('aria-expanded', open);
    });

    // Close menu when any link is clicked
    links.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            links.classList.remove('nav-open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}
document.addEventListener('DOMContentLoaded', () => {
    loadNavbar();
    const s = document.createElement('script');
    s.src = 'scripts/music-player.js';
    document.body.appendChild(s);
    const fx = document.createElement('script');
    fx.src = 'scripts/ttrpg-fx.js';
    document.body.appendChild(fx);
    const dec = document.createElement('script');
    dec.src = 'scripts/decorations.js';
    document.body.appendChild(dec);
});
