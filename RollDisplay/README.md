# RollDisplay

A 3D dice roller built for streaming. Based on [Bee's Dice Roller](https://andylawton.com/home/bee-dice-roller), extended with URL parameter control so a bot or browser source can open the page with a specific dice set, forced result values, and custom appearance — no user interaction needed.

Physics and 3D rendering are handled by [Cannon.js](https://schteppe.github.io/cannon.js/) and [Three.js](https://threejs.org/). Multiplayer room support is included via a WebSocket server.

---

## Running

**Static (single-player):** Copy `rolldisplay.html`, `dice.js`, `main.js`, `teal.js`, `main.css`, `dice.css`, and the `libs/` folder to any web server. No build step required.

**With multiplayer server:**
```bash
npm install
npm start
```
Server runs on `http://localhost:3000` (or `$PORT`). The Express server serves the static files and manages WebSocket rooms for multiplayer sessions.

---

## Dice Notation

RollDisplay uses standard dice notation in the `d` parameter or the input field:

| Notation | Meaning |
|----------|---------|
| `d20` | Roll one d20 |
| `2d6` | Roll two d6s |
| `d8+d4` | Roll one d8 and one d4 |
| `2d6+3` | Roll two d6s and add 3 to the total |
| `2d20+d6+d4` | Mix any combination of dice types |

Supported dice: **d4, d6, d8, d10, d12, d20, d100**

---

## URL Parameters

All parameters are passed as a query string. Combine any of them freely.

### Dice

| Parameter | Value | Description |
|-----------|-------|-------------|
| `d` | dice notation | Set the dice to roll. Example: `d=2d20` or `d=d8+d4` |
| `roll` | *(no value)* | Automatically throw the dice on page load |
| `dicevalue` | number or comma-separated numbers | Force the dice to land on specific values. Values map to dice left-to-right in the notation. See details below. |
| `timeout` | seconds | Automatically clear the dice N seconds after they settle. Useful for streaming overlays. Example: `timeout=5` |

### Appearance

| Parameter | Value | Description |
|-----------|-------|-------------|
| `dicehex` | hex color (no `#`) | Dice body color. Example: `dicehex=44475a` |
| `labelhex` | hex color (no `#`) | Number/pip color. Example: `labelhex=ffb86c` |
| `chromahex` | hex color (no `#`) | Background color. Example: `chromahex=00ff00` |
| `transparency` | `0.0` – `1.0` | Dice opacity. `1.0` is fully opaque. |
| `scale` | number | Dice size multiplier. The baked-in default is `scale=2`. To double the default visible size use `scale=4`; to halve it use `scale=1`. |
| `shadows` | `0` or `1` | Toggle shadows under the dice. |
| `noresult` | *(no value)* | Hide the roll result text overlay. |
| `chromakey` | *(no value)* | Green screen mode: forces green background and hides the UI controls and result text. |

---

## Forcing Dice Results with `dicevalue`

`dicevalue` accepts a single number or a comma-separated list of numbers. Each value corresponds to one die, in the same left-to-right order as the dice notation.

The dice will physically roll and settle, but the faces are rotated after the physics simulation so they land on the specified values. The animation looks natural.

**Examples:**

```
# Single die — land on 15
?d=d20&dicevalue=15&roll

# Two d6s — first lands on 4, second on 3
?d=2d6&dicevalue=4,3&roll

# Mixed dice — d20 lands on 17, d8 on 6, d4 on 2
?d=d20+d8+d4&dicevalue=17,6,2&roll

# Partial — only the first die is forced; the rest roll freely
?d=3d6&dicevalue=5&roll
```

Valid ranges per die type:

| Die | Valid values |
|-----|-------------|
| d4 | 1 – 4 |
| d6 | 1 – 6 |
| d8 | 1 – 8 |
| d10 | 1 – 10 |
| d12 | 1 – 12 |
| d20 | 1 – 20 |
| d100 | 0, 10, 20 ... 90 (multiples of 10; pass `0` for `00`) |

Values outside the valid range for a die are ignored and that die rolls freely.

---

## Baked-in Defaults

URL parameters must be passed on every page load. To avoid repeating the same parameters, you can hardcode defaults by editing `main.js` starting at **line 31**. The current defaults set the background to green, apply custom dice and label colors, and disable shadows.

---

## Full Example URLs

```
# Streaming overlay — green background, custom colors, roll 2d20 immediately
http://yoursite/?dicehex=4E1E78&labelhex=CC9EEC&chromahex=00FF00&d=2d20&roll

# Bot-controlled roll — d20 forced to 18, clears after 4 seconds
http://yoursite/?d=d20&dicevalue=18&roll&chromakey&timeout=4

# Mixed dice with forced values, no result text
http://yoursite/?d=d20+d6+d4&dicevalue=20,6,3&roll&noresult
```
