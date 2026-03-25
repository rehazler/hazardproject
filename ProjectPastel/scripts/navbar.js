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
            <li><a href="wiki-supabase.html">Wiki</a></li>
            <li><a href="forms.html">Forms</a></li>
            <li id="nav-editor-guide" style="display:none"><a href="editor-guide.html">Editor Guide</a></li>
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
(function () {
    const _SECRET = 'intothevoid';
    let _buf = '', _timer = null;

    function _voidTransition(href) {
        const portal = document.createElement('div');
        portal.id = 'void-portal';
        [80, 140, 210].forEach(function (size, i) {
            const ring = document.createElement('div');
            ring.className = 'void-ring';
            ring.style.cssText = 'width:' + size + 'px;height:' + size + 'px;animation-delay:' + (i * 0.12) + 's';
            portal.appendChild(ring);
        });
        document.body.appendChild(portal);
        ['header', 'main', 'footer', 'nav'].forEach(function (sel) {
            const el = document.querySelector(sel);
            if (el) el.classList.add('void-suck');
        });
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { portal.classList.add('active'); });
        });
        setTimeout(function () { window.location.href = href; }, 950);
    }

    document.addEventListener('keydown', function (e) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.activeElement && document.activeElement.isContentEditable) return;
        if (e.key.length !== 1) return;
        _buf += e.key.toLowerCase();
        if (_buf.length > _SECRET.length) _buf = _buf.slice(-_SECRET.length);
        clearTimeout(_timer);
        _timer = setTimeout(function () { _buf = ''; }, 1500);
        if (_buf === _SECRET) {
            _buf = ''; clearTimeout(_timer);
            _voidTransition('login.html');
        }
    });
})();

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
