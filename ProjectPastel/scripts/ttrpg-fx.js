(function () {
    'use strict';

    // ── Floating Particles ────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.id = 'ttrpg-particles';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const COLOURS = ['#98e6d6', '#f3b0c3', '#d3b3e7'];

    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: 55 }, () => ({
        x:     Math.random() * window.innerWidth,
        y:     Math.random() * window.innerHeight,
        r:     0.5 + Math.random() * 1.5,
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
        base:  0.2 + Math.random() * 0.4,
        sx:    (Math.random() - 0.5) * 0.3,
        sy:    -(0.1 + Math.random() * 0.2),
        phase: Math.random() * Math.PI * 2,
    }));

    (function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const t = Date.now() / 1000;
        particles.forEach(p => {
            p.x += p.sx;
            p.y += p.sy;
            if (p.x < -5)                p.x = canvas.width + 5;
            if (p.x > canvas.width + 5)  p.x = -5;
            if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.colour;
            ctx.globalAlpha = p.base * (0.6 + 0.4 * Math.sin(t * 1.2 + p.phase));
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }());

    // ── Page Effect Styles ────────────────────────────────────────────────
    const fxStyle = document.createElement('style');
    fxStyle.textContent = `
        @keyframes ttrpg-shake {
            0%,100% { transform: translate(0,0) rotate(0); }
            15%     { transform: translate(-7px,2px) rotate(-0.4deg); }
            30%     { transform: translate(6px,-2px) rotate(0.4deg); }
            45%     { transform: translate(-5px,1px) rotate(-0.2deg); }
            60%     { transform: translate(4px,-1px) rotate(0.2deg); }
            75%     { transform: translate(-2px,0); }
            90%     { transform: translate(2px,0); }
        }
        .ttrpg-shaking { animation: ttrpg-shake 0.65s ease both; }
    `;
    document.head.appendChild(fxStyle);

    // Nat 20 — confetti burst from d20 position
    function critSuccessEffect() {
        const ov = document.createElement('canvas');
        ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
        document.body.appendChild(ov);
        ov.width  = window.innerWidth;
        ov.height = window.innerHeight;
        const oc = ov.getContext('2d');

        const ox = 48;
        const oy = window.innerHeight - 48;
        const CONF = ['#98e6d6','#f3b0c3','#d3b3e7','#ffe8a0','#ffffff'];
        const pieces = Array.from({ length: 90 }, () => ({
            x: ox, y: oy,
            vx: (Math.random() - 0.5) * 14,
            vy: -(5 + Math.random() * 11),
            r:  2.5 + Math.random() * 3.5,
            col: CONF[Math.floor(Math.random() * CONF.length)],
            rot: Math.random() * Math.PI * 2,
            rs:  (Math.random() - 0.5) * 0.18,
            rect: Math.random() > 0.45,
        }));

        let t0 = null;
        const DUR = 2400;
        (function loop(ts) {
            if (!t0) t0 = ts;
            const prog = (ts - t0) / DUR;
            oc.clearRect(0, 0, ov.width, ov.height);
            pieces.forEach(p => {
                p.x  += p.vx;  p.y  += p.vy;
                p.vy += 0.28;  p.vx *= 0.985;
                p.rot += p.rs;
                oc.save();
                oc.globalAlpha = Math.max(0, 1 - prog * 1.1);
                oc.fillStyle = p.col;
                oc.translate(p.x, p.y);
                oc.rotate(p.rot);
                if (p.rect) { oc.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9); }
                else        { oc.beginPath(); oc.arc(0, 0, p.r * 0.55, 0, Math.PI * 2); oc.fill(); }
                oc.restore();
            });
            if (prog < 1) { requestAnimationFrame(loop); } else { ov.remove(); }
        }(performance.now()));
    }

    // Nat 1 — screen shake + red flash
    function critFailEffect() {
        document.body.classList.remove('ttrpg-shaking');
        void document.body.offsetWidth; // force reflow so re-adding the class restarts the animation
        document.body.classList.add('ttrpg-shaking');
        setTimeout(() => document.body.classList.remove('ttrpg-shaking'), 700);

        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;inset:0;background:rgba(180,0,0,0.18);z-index:9998;pointer-events:none;transition:opacity 0.7s ease;';
        document.body.appendChild(flash);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 800);
        }));
    }

    // ── D20 Easter Egg ────────────────────────────────────────────────────
    function getMsg(n) {
        if (n === 20) return 'Natural 20! Fortune favours you!';
        if (n === 1)  return 'Critical fail! Your dice rolled off the table.';
        if (n >= 15)  return 'A solid roll! Success is within reach.';
        if (n >= 10)  return 'Middling - The fates are undecided.';
        return 'A rough roll... perhaps reconsider your life choices.';
    }

    const wrap = document.createElement('div');
    wrap.id = 'ttrpg-d20';
    wrap.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:300;cursor:pointer;user-select:none;';

    const bubble = document.createElement('div');
    bubble.style.cssText = [
        'display:none',
        'position:absolute',
        'bottom:68px',
        'left:0',
        'background:#2e1d32',
        'border:1px solid #503554',
        'border-radius:8px',
        'padding:10px',
        'font-size:0.78rem',
        'font-family:Spectral,serif',
        'color:#f4f4f4',
        'box-shadow:0 2px 12px rgba(0,0,0,0.5)',
        'transition:opacity 0.4s ease',
        'pointer-events:none',
        'width:125px',
        'white-space:normal',
        'line-height:1.4',
    ].join(';');

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-label', 'Roll d20');
    svg.style.cssText = 'width:56px;height:56px;display:block;transition:filter 0.2s,transform 0.2s;filter:drop-shadow(0 0 4px rgba(211,179,231,0.3));';

    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', '50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5');
    poly.setAttribute('fill', '#2e1d32');
    poly.setAttribute('stroke', '#d3b3e7');
    poly.setAttribute('stroke-width', '2');

    const numText = document.createElementNS(NS, 'text');
    numText.setAttribute('x', '50');
    numText.setAttribute('y', '60');
    numText.setAttribute('text-anchor', 'middle');
    numText.setAttribute('font-family', 'Spectral,serif');
    numText.setAttribute('font-size', '28');
    numText.setAttribute('fill', '#98e6d6');
    numText.textContent = 'd20';

    svg.appendChild(poly);
    svg.appendChild(numText);
    wrap.appendChild(bubble);
    wrap.appendChild(svg);
    document.body.appendChild(wrap);

    svg.addEventListener('mouseenter', () => {
        svg.style.filter = 'drop-shadow(0 0 10px rgba(211,179,231,0.7))';
        svg.style.transform = 'scale(1.1)';
    });
    svg.addEventListener('mouseleave', () => {
        svg.style.filter = 'drop-shadow(0 0 4px rgba(211,179,231,0.3))';
        svg.style.transform = 'scale(1)';
    });

    let spinning = false;
    let timer = null;

    wrap.addEventListener('click', () => {
        if (spinning) return;
        spinning = true;
        const result = Math.floor(Math.random() * 20) + 1;
        let angle = 0;
        const id = setInterval(() => {
            angle += 30;
            svg.style.transform = 'rotate(' + angle + 'deg) scale(1.05)';
            if (angle >= 360) {
                clearInterval(id);
                svg.style.transform = 'scale(1)';
                numText.textContent = result;
                numText.setAttribute('fill', result === 20 ? '#98e6d6' : result === 1 ? '#f3b0c3' : '#d3b3e7');
                showBubble(getMsg(result));
                if (result === 20) critSuccessEffect();
                else if (result === 1) critFailEffect();
                spinning = false;
            }
        }, 40);
    });

    function showBubble(msg) {
        if (timer) clearTimeout(timer);
        bubble.textContent = msg;
        bubble.style.display = 'block';
        bubble.style.opacity = '1';
        timer = setTimeout(() => {
            bubble.style.opacity = '0';
            setTimeout(() => { bubble.style.display = 'none'; }, 400);
        }, 3000);
    }
}());
