(function () {
    'use strict';

    const ANIM = 'Assets/TransparentAnimatedDecorations/';

    function makeVideo(src, css) {
        const v = document.createElement('video');
        v.src = src;
        v.autoplay = true;
        v.loop     = true;
        v.muted    = true;
        v.setAttribute('playsinline', '');
        v.style.cssText = css + ';pointer-events:none;';
        return v;
    }

    const isWiki = document.body.classList.contains('wiki-page');

    // ── 1. Header decorations ────────────────────────────────────────────────
    const header = document.querySelector('header');
    if (header) {
        header.style.position = 'relative';

        // Raise all header text above the decorative videos
        header.querySelectorAll('h1, h2, h3, p').forEach(el => {
            el.style.position = 'relative';
            el.style.zIndex   = '2';
        });

        // Light strings at the top
        header.appendChild(makeVideo(
            ANIM + '2HorizontalLightStringsWithCoffonMoonAndDiamonds.webm',
            'position:absolute;top:0;left:0;width:100%;z-index:0;opacity:0.5;'
        ));

        // Star chains at the bottom — capped height so they stay at the edge
        // ── Commented out - May return or change later ───────────────
        //header.appendChild(makeVideo(
        //    ANIM + 'ThreeHorizontalStarChains.webm',
        //    'position:absolute;bottom:0;left:0;width:100%;max-height:110px;object-fit:cover;object-position:bottom;z-index:1;opacity:0.5;'
        //));
    }

    // ── 2. Right side moon chain (non-wiki, wide screens only) ───────────────
    // ── Commented out - May return or change later ───────────────
    //if (!isWiki && window.innerWidth >= 1200) {
    //    document.body.appendChild(makeVideo(
    //        ANIM + '1VerticalLongMoonChain.webm',
    //        'position:fixed;top:0;right:0;height:100vh;width:auto;max-width:180px;z-index:0;opacity:0.55;'
    //    ));
    //}

    // ── 3. Bats — periodic flyby ─────────────────────────────────────────────
    const bats = makeVideo(
        ANIM + 'BatsFlyingLeftToRight.webm',
        'position:fixed;top:15%;left:0;width:100%;z-index:5;opacity:0.75;display:none;'
    );
    bats.loop = false;
    document.body.appendChild(bats);

    function scheduleBats() {
        setTimeout(() => {
            bats.style.display = 'block';
            bats.currentTime   = 0;
            bats.play();
            setTimeout(() => {
                bats.pause();
                bats.style.display = 'none';
                scheduleBats();
            }, 30000); // stop after 30 s
        }, 45000 + Math.random() * 90000); // every 45–135 s
    }
    scheduleBats();
})();
