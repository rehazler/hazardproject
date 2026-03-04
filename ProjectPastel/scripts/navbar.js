function loadNavbar() {
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <ul>
            <li><a href="index.html">Home</a></li>
            <li><a href="about.html">About Me</a></li>
            <li><a href="livestreams.html">Livestreams &amp; Playlists</a></li>
            <li><a href="wiki.html">Wiki</a></li>
            <li><a href="forms.html">Forms</a></li>
        </ul>
    `;
    document.getElementById('navbar-placeholder').appendChild(nav);
}
document.addEventListener('DOMContentLoaded', loadNavbar);
