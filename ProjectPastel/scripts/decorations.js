(function () {
    'use strict';

    // ── 0. Performance guards ─────────────────────────────────────────────────
    // Respect OS-level "reduce motion" preference (accessibility + battery saver)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Treat devices with ≤2 CPU cores or ≤2 GB RAM as low-end
    const lowEnd = (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2)
                || (navigator.deviceMemory      !== undefined && navigator.deviceMemory      <= 2);

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

        // Light strings at the top.
        // Two tiers remembered per session:
        //   (none)     → full video
        //   'frozen'   → static snapshot, no video element
        const CHAIN_FROZEN_KEY = 'voidverse-chain-frozen';

        if (sessionStorage.getItem(CHAIN_FROZEN_KEY) !== '1') {
            const topChain = makeVideo(
                ANIM + '2HorizontalLightStringsWithCoffonMoonAndDiamonds.webm',
                'position:absolute;top:0;left:0;width:100%;z-index:0;opacity:0.5;'
            );
            header.appendChild(topChain);

            // Pause the chain while the header is scrolled out of view
            const chainObserver = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) e.target.play().catch(() => {});
                    else                  e.target.pause();
                });
            }, { threshold: 0 });
            chainObserver.observe(topChain);

            // Run up to CHAIN_CHECKS quality checks, 1 s apart.
            // If any check exceeds 5 % dropped frames the video is removed and
            // no further checks run. Change CHAIN_CHECKS to adjust the count.
            const CHAIN_CHECKS = 3;
            topChain.addEventListener('play', () => {
                let remaining = CHAIN_CHECKS;
                function check() {
                    if (typeof topChain.getVideoPlaybackQuality !== 'function') return;
                    const q = topChain.getVideoPlaybackQuality();
                    if (q.totalVideoFrames > 0 &&
                        q.droppedVideoFrames / q.totalVideoFrames > 0.18) {
                        sessionStorage.setItem(CHAIN_FROZEN_KEY, '1');
                        chainObserver.disconnect();
                        topChain.src = '';
                        topChain.remove();
                        return;
                    }
                    if (--remaining > 0) setTimeout(check, 1000);
                }
                setTimeout(check, 1000);
            }, { once: true });
        }

        // Star chains at the bottom — capped height so they stay at the edge
        // ── Commented out - May return or change later ───────────────
        //header.appendChild(makeVideo(
        //    ANIM + 'ThreeHorizontalStarChains.webm',
        //    'position:absolute;bottom:0;left:0;width:100%;max-height:110px;object-fit:cover;object-position:bottom;z-index:1;opacity:0.85;mix-blend-mode:screen;'
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

    // ── 3. Bats — periodic flyby (skipped on low-end devices) ───────────────
    // Quality tiers (remembered per session via sessionStorage):
    //   (none)   → full video
    //   'small'  → half-res / half-fps video
    //   'off'    → bats disabled for this session
    const BATS_QUALITY_KEY = 'voidverse-bats-quality';
    const BATS_CHECKS = 3; // number of 1-second performance checks per flyby

    const BATS_SRCS = {
        full:  ANIM + 'BatsFlyingLeftToRight.webm',
        small: ANIM + 'BatsFlyingLeftToRight_small.webm',
    };
    const BATS_CSS = {
        full:  'position:fixed;top:15%;left:0;width:100%;z-index:5;display:none;opacity:0.75;',
        small: 'position:fixed;top:15%;left:0;width:100%;z-index:5;display:none;mix-blend-mode:screen;',
    };

    function initBats() {
        const quality = sessionStorage.getItem(BATS_QUALITY_KEY);
        if (quality === 'off') return;

        const tier = quality === 'small' ? 'small' : 'full';
        const bats = makeVideo(BATS_SRCS[tier], BATS_CSS[tier]);
        bats.loop = false;
        document.body.appendChild(bats);

        function scheduleBats() {
            setTimeout(() => {
                bats.style.display = 'block';
                bats.currentTime   = 0;
                bats.play().catch(() => {});

                let stopped = false;
                let remaining = BATS_CHECKS;

                function check() {
                    if (stopped) return;
                    if (typeof bats.getVideoPlaybackQuality !== 'function') return;
                    const q = bats.getVideoPlaybackQuality();
                    if (q.totalVideoFrames > 0 &&
                        q.droppedVideoFrames / q.totalVideoFrames > 0.20) {
                        stopped = true;
                        bats.pause();
                        bats.style.display = 'none';
                        bats.src = '';
                        bats.remove();
                        sessionStorage.setItem(BATS_QUALITY_KEY, tier === 'full' ? 'small' : 'off');
                        if (tier === 'full') initBats(); // restart with small quality
                        return;
                    }
                    if (--remaining > 0) setTimeout(check, 1000);
                }

                setTimeout(check, 1000);

                setTimeout(() => {
                    if (!stopped) {
                        bats.pause();
                        bats.style.display = 'none';
                        scheduleBats();
                    }
                }, 10000); // stop after 10 s
            }, 45000 + Math.random() * 90000); // every 45–135 s
        }

        scheduleBats();
    }

    if (!lowEnd) initBats();

    // ── 4. Pause all decoration videos when the tab is hidden 4────────────────
    document.addEventListener('visibilitychange', () => {
        document.querySelectorAll('video').forEach(v => {
            if (document.hidden) v.pause();
            else if (v.style.display !== 'none') v.play().catch(() => {});
        });
    });
})();
