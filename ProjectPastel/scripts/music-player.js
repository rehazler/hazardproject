// ── Configuration — fill these in when ready ──────────────────────────────
// TWITCH_WORKER_URL: URL of your Cloudflare Worker (used for Twitch live check)
// TWITCH_CHANNEL:    your Twitch username — leave empty to skip the live check
// MUSIC_SRC:         direct URL to your audio file (.mp3, .ogg, etc.)
// MUSIC_TITLE:       song name shown in the player
// CHAR_IMAGE:        direct URL to your 300×300 character image
const TWITCH_WORKER_URL = 'https://old-bush-385d.hazardousmadness.workers.dev';
const TWITCH_CHANNEL = 'voiddoll';
const MUSIC_SRC      = 'audio/song.m4a';
const MUSIC_TITLE    = 'Site Theme';
const CHAR_IMAGE     = 'https://media.discordapp.net/stickers/1090496358840029254.webp?size=300&quality=lossless';

// ── Session storage keys ───────────────────────────────────────────────────
const STATE_KEY  = 'voidverse-music-state';
const PROMPT_KEY = 'voidverse-music-prompted';
const PIP_KEY    = 'voidverse-pip-open';

// ── Persistence helpers ────────────────────────────────────────────────────

function getAudioState() {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY)); } catch { return null; }
}

function saveAudioState(audio) {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({
        time:    audio.currentTime,
        playing: !audio.paused,
        volume:  audio.volume,
    }));
}

function isPromptDone()   { return sessionStorage.getItem(PROMPT_KEY) === '1'; }
function markPromptDone() { sessionStorage.setItem(PROMPT_KEY, '1'); }

function isPipOpen()      { return sessionStorage.getItem(PIP_KEY) === '1'; }
function setPipOpen(open) {
    if (open) sessionStorage.setItem(PIP_KEY, '1');
    else      sessionStorage.removeItem(PIP_KEY);
}

// ── Twitch live check ──────────────────────────────────────────────────────

async function checkTwitchLive() {
    if (!TWITCH_CHANNEL || !TWITCH_WORKER_URL) return false;
    try {
        const resp = await fetch(`${TWITCH_WORKER_URL}/twitch-live`);
        if (!resp.ok) return false;
        const data = await resp.json();
        return data.live === true;
    } catch {
        return false;
    }
}

// ── Draggable (pointer events — works for mouse and touch) ─────────────────

function makeDraggable(el, handle) {
    let startX, startY, origLeft, origTop;

    handle.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return; // let header buttons fire normally
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const rect = el.getBoundingClientRect();
        startX   = e.clientX;
        startY   = e.clientY;
        origLeft = rect.left;
        origTop  = rect.top;
        // Switch from bottom/right to top/left so translation math is simple
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        el.style.left   = origLeft + 'px';
        el.style.top    = origTop  + 'px';
    });

    handle.addEventListener('pointermove', e => {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  origLeft + dx)) + 'px';
        el.style.top  = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, origTop  + dy)) + 'px';
    });
}

// ── Twitch PiP player ──────────────────────────────────────────────────────

function buildPip() {
    const pip = document.createElement('div');
    pip.id = 'twitch-pip';
    pip.innerHTML = `
        <div class="pip-header">
            <span class="pip-title">▶ ${TWITCH_CHANNEL}</span>
            <div class="pip-actions">
                <button class="pip-popout" aria-label="Open in new tab" title="Open in new tab">⧉</button>
                <button class="pip-close"  aria-label="Close" title="Close">✕</button>
            </div>
        </div>
        <iframe
            src="https://player.twitch.tv/?channel=${encodeURIComponent(TWITCH_CHANNEL)}&parent=${encodeURIComponent(location.hostname || 'localhost')}"
            allowfullscreen
        ></iframe>
    `;
    document.body.appendChild(pip);
    makeDraggable(pip, pip.querySelector('.pip-header'));

    const iframe = pip.querySelector('iframe');

    pip.querySelector('.pip-popout').addEventListener('click', () => {
        iframe.src = ''; // pause the embedded stream
        window.open(`https://www.twitch.tv/${TWITCH_CHANNEL}`, '_blank');
    });

    pip.querySelector('.pip-close').addEventListener('click', () => {
        pip.style.animation = 'pipOut 0.25s ease forwards';
        setTimeout(() => {
            pip.remove();
            setPipOpen(false);
            // If no music player is visible yet, offer music now
            if (MUSIC_SRC && !document.getElementById('music-player')) {
                buildPrompt(false);
            }
        }, 260);
    });
    setPipOpen(true);
}

// ── Music player ───────────────────────────────────────────────────────────

function buildPlayer(autoplay) {
    const state  = getAudioState();
    const player = document.createElement('div');
    player.id    = 'music-player';
    player.innerHTML = `
        <span class="music-title">♪ ${MUSIC_TITLE}</span>
        <div class="music-controls">
            <button class="music-btn" id="music-play-pause" aria-label="Play">▶</button>
            <button class="music-btn" id="music-stop" aria-label="Stop">■</button>
            <input type="range" id="music-volume" min="0" max="1" step="0.05"
                value="${state?.volume ?? 0.5}" aria-label="Volume" title="Volume">
        </div>
    `;
    document.body.appendChild(player);

    const audio        = new Audio(MUSIC_SRC);
    audio.loop         = true;
    audio.volume       = state?.volume ?? 0.5;
    const btnPlayPause = player.querySelector('#music-play-pause');
    const btnStop      = player.querySelector('#music-stop');
    const volSlider    = player.querySelector('#music-volume');

    function setUI(playing) {
        btnPlayPause.textContent = playing ? '⏸' : '▶';
        btnPlayPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        player.classList.toggle('music-playing', playing);
    }

    audio.addEventListener('canplay', () => {
        if (state?.time) audio.currentTime = state.time;
        if (autoplay || state?.playing) {
            audio.play().then(() => setUI(true)).catch(() => setUI(false));
        }
    }, { once: true });

    btnPlayPause.addEventListener('click', () => {
        if (audio.paused) {
            audio.play().then(() => setUI(true)).catch(() => setUI(false));
        } else {
            audio.pause();
            setUI(false);
            saveAudioState(audio);
        }
    });

    btnStop.addEventListener('click', () => {
        audio.pause();
        audio.currentTime = 0;
        setUI(false);
        sessionStorage.removeItem(STATE_KEY);
    });

    volSlider.addEventListener('input', () => {
        audio.volume = parseFloat(volSlider.value);
    });

    setInterval(() => { if (!audio.paused) saveAudioState(audio); }, 2000);
    window.addEventListener('pagehide', () => saveAudioState(audio));
}

// ── Character prompt ───────────────────────────────────────────────────────

function buildPrompt(isLive) {
    const prompt = document.createElement('div');
    prompt.id    = 'music-prompt';
    prompt.innerHTML = `
        <div class="music-bubble"></div>
        <div class="music-bubble-tail"></div>
        ${CHAR_IMAGE
            ? `<img src="${CHAR_IMAGE}" alt="VoidDoll mascot" class="music-char">`
            : '<div class="music-char-placeholder"></div>'}
    `;
    document.body.appendChild(prompt);

    const bubble = prompt.querySelector('.music-bubble');

    function dismiss(callback) {
        markPromptDone();
        prompt.classList.add('music-hide');
        setTimeout(() => { prompt.remove(); callback?.(); }, 400);
    }

    function showMusicQuestion() {
        const transition = bubble.innerHTML.trim() !== '';
        const doShow = () => {
            bubble.innerHTML = `
                <p>Hey! Would you like to listen to some music while you explore? 🎵</p>
                <div class="music-bubble-btns">
                    <button id="music-yes">Yes please!</button>
                    <button id="music-no">No thanks</button>
                </div>
            `;
            bubble.style.opacity = '1';
            bubble.querySelector('#music-yes').addEventListener('click', () => {
                dismiss(() => buildPlayer(true));
            });
            bubble.querySelector('#music-no').addEventListener('click', () => {
                dismiss(() => buildPlayer(false));
            });
        };
        if (transition) {
            bubble.style.opacity = '0';
            setTimeout(doShow, 250);
        } else {
            doShow();
        }
    }

    function showTwitchQuestion() {
        bubble.innerHTML = `
            <p>I'm live on Twitch! Would you like to watch? 🎮</p>
            <div class="music-bubble-btns">
                <button id="music-yes">Watch now!</button>
                <button id="music-no">No thanks</button>
            </div>
        `;
        bubble.querySelector('#music-yes').addEventListener('click', () => {
            dismiss(() => buildPip());
        });
        bubble.querySelector('#music-no').addEventListener('click', () => {
            if (MUSIC_SRC) {
                showMusicQuestion();
            } else {
                dismiss();
            }
        });
    }

    if (isLive) {
        showTwitchQuestion();
    } else {
        showMusicQuestion();
    }
}

// ── Navbar live indicator ──────────────────────────────────────────────────

function updateNavLiveIndicator(isLive) {
    const link = document.querySelector('nav a[href="livestreams.html"]');
    if (!link) return;
    const existing = link.querySelector('.nav-live');
    if (isLive && !existing) {
        const badge = document.createElement('span');
        badge.className = 'nav-live';
        badge.textContent = 'LIVE';
        link.appendChild(badge);
    } else if (!isLive && existing) {
        existing.remove();
    }
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
    if (!TWITCH_CHANNEL && !MUSIC_SRC) return;

    // Always check live status so the navbar indicator is accurate on every page load
    const isLive = await checkTwitchLive();
    updateNavLiveIndicator(isLive);

    if (isPromptDone()) {
        // Restore last known state without re-prompting
        if (MUSIC_SRC)                     buildPlayer(false);
        if (TWITCH_CHANNEL && isPipOpen()) buildPip();
        return;
    }

    // Nothing to show if not live and no music configured
    if (!isLive && !MUSIC_SRC) return;

    buildPrompt(isLive);
}

// Works whether loaded directly via <script> tag or injected dynamically
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
