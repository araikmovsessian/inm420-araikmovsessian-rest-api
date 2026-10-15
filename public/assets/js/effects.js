/*
    sky archive: effects.js
    -----------------------
    The animated effects on the page. Each one is adapted from a component in Magic UI
    (https://magicui.design, MIT licence). Magic UI is written for React and Tailwind, so
    these are rewritten in plain JavaScript, with all of their styles kept in style.css.
    Where an effect needs a number only known while the page runs (a mouse position, a
    random delay), this file passes it to style.css as a css custom property, such as
    --spot-x, and the stylesheet decides what to do with it.

        particles       the starfield behind the page, which drifts towards the mouse
        meteors         shooting stars that cross the header now and then
        sparkles text   four-point stars that twinkle around the site title
        cool mode       a burst of stars from the "random date" button
        magic card      a spotlight that follows the mouse across the day cards
        text animate    titles that arrive word by word, out of a blur
        hyper text      dates that scramble, then settle, like an instrument readout
        number ticker   numbers that count up to their new value
        lens            an eyepiece that magnifies the picture under the mouse
        terminal        the api request typed out, with the api's answer below it

    Four more effects need no javascript, so they live in style.css alone: the border
    beam around the picture while it loads, the shimmer on the "random date" button, the
    blur fade on the day cards and the noise texture (film grain) over the sky. The
    backlight glow behind each picture is a blurred copy that script.js adds in createMedia.

    script.js calls animateWords, scrambleText, tickNumber, attachLens, logRequest,
    logResponse and replayAnimation. Everything else starts itself at the end of this file.
*/

// ==========================================================================
// settings
// ==========================================================================

// visitors can ask their system for less motion; the effects check this every time they run
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// the lens follows a mouse, so it only appears where there is one
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

// the hubble palette from style.css, written as rgb for the canvas (mostly white stars)
const starColors = ["237, 241, 250", "237, 241, 250", "237, 241, 250", "242, 184, 75", "111, 214, 202"];

// the four-point star used by the title sparkles and the button burst (from magic ui)
const starPath = "M9.82531 0.843845C10.0553 0.215178 10.9446 0.215178 11.1746 0.843845L11.8618 2.72026C12.4006 4.19229 12.3916 6.39157 13.5 7.5C14.6084 8.60843 16.8077 8.59935 18.2797 9.13822L20.1561 9.82534C20.7858 10.0553 20.7858 10.9447 20.1561 11.1747L18.2797 11.8618C16.8077 12.4007 14.6084 12.3916 13.5 13.5C12.3916 14.6084 12.4006 16.8077 11.8618 18.2798L11.1746 20.1562C10.9446 20.7858 10.0553 20.7858 9.82531 20.1562L9.13819 18.2798C8.59932 16.8077 8.60843 14.6084 7.5 13.5C6.39157 12.3916 4.19225 12.4007 2.72023 11.8618L0.843814 11.1747C0.215148 10.9447 0.215148 10.0553 0.843814 9.82534L2.72023 9.13822C4.19225 8.59935 6.39157 8.60843 7.5 7.5C8.60843 6.39157 8.59932 4.19229 9.13819 2.72026L9.82531 0.843845Z";

// script.js has its own svgNamespace for the slider ticks; both files share top-level
// names, so this one needs a different name
const effectsSvgNamespace = "http://www.w3.org/2000/svg";

// ==========================================================================
// page elements
// ==========================================================================

const starfield = document.querySelector("#starfield");
const starContext = starfield.getContext("2d");
const meteorLayer = document.querySelector("#meteors");
const sparkleTitle = document.querySelector("#sparkles");
const burstButton = document.querySelector("#random-button");
const spotlightList = document.querySelector("#strip-list");
const requestDetails = document.querySelector("#request");
const requestLog = document.querySelector("#request-log");

// ==========================================================================
// particles: a starfield that drifts slowly and leans towards the mouse
// ==========================================================================

let stars = [];
let starfieldWidth = 0;
let starfieldHeight = 0;
let starMouseX = 0;
let starMouseY = 0;
let starResizeTimer = null;

function startStarfield() {
    sizeStarfield();

    // wait until resizing stops before rebuilding the canvas
    window.addEventListener("resize", function () {
        clearTimeout(starResizeTimer);
        starResizeTimer = setTimeout(sizeStarfield, 200);
    });

    // the mouse position, measured from the middle of the screen
    window.addEventListener("mousemove", function (event) {
        starMouseX = event.clientX - starfieldWidth / 2;
        starMouseY = event.clientY - starfieldHeight / 2;
    });

    if (!reducedMotion.matches) {
        window.requestAnimationFrame(moveStars);
    }
}

// matches the canvas to the screen, keeping the stars that are already there
function sizeStarfield() {
    const pixelRatio = window.devicePixelRatio || 1;

    starfieldWidth = starfield.clientWidth;
    starfieldHeight = starfield.clientHeight;
    starfield.width = Math.round(starfieldWidth * pixelRatio);
    starfield.height = Math.round(starfieldHeight * pixelRatio);
    starContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    // about one star for every 6,500 square pixels, so phones get fewer
    const starCount = Math.min(280, Math.round(starfieldWidth * starfieldHeight / 6500));

    stars = stars.slice(0, starCount);

    while (stars.length < starCount) {
        stars.push(createStar());
    }

    // stars outside the new edges move back inside
    stars.forEach(function (star) {
        star.x = star.x % starfieldWidth;
        star.y = star.y % starfieldHeight;
    });

    // with reduced motion the sky is drawn once, standing still
    if (reducedMotion.matches) {
        drawStillStars();
    }
}

function createStar() {
    return {
        x: Math.random() * starfieldWidth,
        y: Math.random() * starfieldHeight,
        offsetX: 0,
        offsetY: 0,
        size: Math.random() * 1.3 + 0.3,
        alpha: 0,
        targetAlpha: Math.random() * 0.6 + 0.15,
        speedX: (Math.random() - 0.5) * 0.1,
        speedY: (Math.random() - 0.5) * 0.1,
        // how strongly the star leans towards the mouse; nearer stars lean further
        magnetism: 0.1 + Math.random() * 4,
        twinkle: Math.random() * Math.PI * 2,
        color: starColors[Math.floor(Math.random() * starColors.length)]
    };
}

function drawStar(star, alpha) {
    starContext.beginPath();
    starContext.arc(star.x + star.offsetX, star.y + star.offsetY, star.size, 0, Math.PI * 2);
    starContext.fillStyle = `rgba(${star.color}, ${alpha})`;
    starContext.fill();
}

function drawStillStars() {
    starContext.clearRect(0, 0, starfieldWidth, starfieldHeight);

    stars.forEach(function (star) {
        drawStar(star, star.targetAlpha);
    });
}

// one frame of the animation: fade in, drift, lean towards the mouse, twinkle
function moveStars(time) {
    starContext.clearRect(0, 0, starfieldWidth, starfieldHeight);

    stars.forEach(function (star, index) {
        // stars fade out as they reach an edge (closest edge, from 0 to 20 pixels away)
        const edgeDistance = Math.min(
            star.x + star.offsetX,
            starfieldWidth - star.x - star.offsetX,
            star.y + star.offsetY,
            starfieldHeight - star.y - star.offsetY
        );
        const edgeFade = Math.max(0, Math.min(edgeDistance / 20, 1));

        if (edgeFade >= 1) {
            star.alpha = Math.min(star.alpha + 0.02, star.targetAlpha);
        } else {
            star.alpha = star.targetAlpha * edgeFade;
        }

        star.x += star.speedX;
        star.y += star.speedY;

        // eases a little of the way towards the mouse each frame (staticity 50, ease 50)
        star.offsetX += (starMouseX / (50 / star.magnetism) - star.offsetX) / 50;
        star.offsetY += (starMouseY / (50 / star.magnetism) - star.offsetY) / 50;

        drawStar(star, star.alpha * (0.8 + 0.2 * Math.sin(time / 900 + star.twinkle)));

        // a star that drifts off the screen is replaced by a new one
        if (star.x < -star.size || star.x > starfieldWidth + star.size ||
            star.y < -star.size || star.y > starfieldHeight + star.size) {
            stars[index] = createStar();
        }
    });

    window.requestAnimationFrame(moveStars);
}

// ==========================================================================
// meteors: now and then a shooting star crosses the header
// ==========================================================================

function startMeteors() {
    if (reducedMotion.matches) {
        return;
    }

    for (let count = 0; count < 7; count += 1) {
        const meteor = document.createElement("span");

        // style.css runs the animation; each meteor gets its own start, timing and path
        meteor.className = "meteor";
        meteor.style.setProperty("--meteor-left", `${Math.round(Math.random() * 100 + 15)}%`);
        meteor.style.setProperty("--meteor-delay", `${(Math.random() * 9).toFixed(2)}s`);
        meteor.style.setProperty("--meteor-duration", `${(Math.random() * 6 + 7).toFixed(2)}s`);
        meteorLayer.append(meteor);
    }
}

// ==========================================================================
// sparkles text: stars twinkle around the site title, moving between twinkles
// ==========================================================================

// builds one four-point star as an inline svg
function createStarShape(className) {
    const shape = document.createElementNS(effectsSvgNamespace, "svg");
    const path = document.createElementNS(effectsSvgNamespace, "path");

    shape.setAttribute("class", className);
    shape.setAttribute("viewBox", "0 0 21 21");
    shape.setAttribute("aria-hidden", "true");
    path.setAttribute("d", starPath);
    shape.append(path);

    return shape;
}

function startSparkles() {
    if (reducedMotion.matches) {
        return;
    }

    for (let count = 0; count < 6; count += 1) {
        const sparkle = createStarShape(count % 2 === 0 ? "sparkle" : "sparkle is-teal");

        placeSparkle(sparkle);
        sparkle.style.setProperty("--sparkle-delay", `${(Math.random() * 2).toFixed(2)}s`);

        // between twinkles the star is invisible, so it can jump to a new spot unseen
        sparkle.addEventListener("animationiteration", function () {
            if (Math.random() < 0.6) {
                placeSparkle(sparkle);
            }
        });

        sparkleTitle.append(sparkle);
    }
}

function placeSparkle(sparkle) {
    sparkle.style.setProperty("--sparkle-x", `${Math.round(Math.random() * 100)}%`);
    sparkle.style.setProperty("--sparkle-y", `${Math.round(Math.random() * 100)}%`);
    sparkle.style.setProperty("--sparkle-scale", (Math.random() + 0.3).toFixed(2));
}

// ==========================================================================
// cool mode: pressing "random date" throws a handful of stars into the air
// ==========================================================================

let burstLayer = null;
let burstStars = [];
let burstRunning = false;

function throwStars(event) {
    if (reducedMotion.matches) {
        return;
    }

    // one layer over the whole page holds every flying star
    if (!burstLayer) {
        burstLayer = document.createElement("div");
        burstLayer.className = "burst";
        burstLayer.setAttribute("aria-hidden", "true");
        document.body.append(burstLayer);
    }

    const buttonBox = burstButton.getBoundingClientRect();

    // a keyboard press has no pointer position, so the stars start from the middle of the button
    const startX = event.detail === 0 ? buttonBox.left + buttonBox.width / 2 : event.clientX;
    const startY = event.detail === 0 ? buttonBox.top + buttonBox.height / 2 : event.clientY;
    const colors = ["", "is-teal", "is-white"];

    for (let count = 0; count < 14; count += 1) {
        const size = Math.round(Math.random() * 12 + 8);
        const shape = createStarShape(`burst-star ${colors[count % colors.length]}`);

        shape.setAttribute("width", size);
        shape.setAttribute("height", size);
        burstLayer.append(shape);

        burstStars.push({
            shape: shape,
            x: startX - size / 2,
            y: startY - size / 2,
            size: size,
            speedX: (Math.random() * 5 + 1) * (Math.random() < 0.5 ? -1 : 1),
            speedY: Math.random() * 10 + 6,
            spin: Math.random() * 360,
            spinSpeed: (Math.random() * 16 + 4) * (Math.random() < 0.5 ? -1 : 1)
        });
    }

    if (!burstRunning) {
        burstRunning = true;
        window.requestAnimationFrame(moveBurst);
    }
}

// each star flies up, slows, then falls off the bottom of the screen and is removed
function moveBurst() {
    burstStars = burstStars.filter(function (star) {
        star.x += star.speedX;
        star.y -= star.speedY;
        star.speedY -= 0.55;
        star.spin += star.spinSpeed;

        // style.css turns these into the star's transform
        star.shape.style.setProperty("--burst-x", `${star.x}px`);
        star.shape.style.setProperty("--burst-y", `${star.y}px`);
        star.shape.style.setProperty("--burst-spin", `${star.spin}deg`);

        if (star.y > window.innerHeight + star.size) {
            star.shape.remove();
            return false;
        }

        return true;
    });

    if (burstStars.length > 0) {
        window.requestAnimationFrame(moveBurst);
    } else {
        burstRunning = false;
    }
}

// ==========================================================================
// magic card: a spotlight follows the mouse across each day card
// ==========================================================================

// style.css draws the light at --spot-x and --spot-y, which start off the card
function addSpotlight(list) {
    list.addEventListener("pointermove", function (event) {
        const card = event.target.closest(".strip-item");

        if (card) {
            const box = card.getBoundingClientRect();

            card.style.setProperty("--spot-x", `${Math.round(event.clientX - box.left)}px`);
            card.style.setProperty("--spot-y", `${Math.round(event.clientY - box.top)}px`);
        }
    });

    // when the pointer leaves a card, its light goes back off the edge
    list.addEventListener("pointerout", function (event) {
        const card = event.target.closest(".strip-item");

        if (card && !card.contains(event.relatedTarget)) {
            card.style.removeProperty("--spot-x");
            card.style.removeProperty("--spot-y");
        }
    });
}

// ==========================================================================
// text animate: a title arrives word by word, rising out of a blur
// ==========================================================================

/*
    Screen readers get the whole title from a visually hidden copy, while the animated
    words are hidden from them, so the title is never read one word at a time.
*/
function animateWords(element, text) {
    const label = document.createElement("span");
    const words = document.createElement("span");

    label.className = "visually-hidden";
    label.textContent = text;
    words.setAttribute("aria-hidden", "true");

    text.split(" ").forEach(function (word, index) {
        const span = document.createElement("span");

        if (index > 0) {
            words.append(" ");
        }

        // style.css staggers each word's start using its place in the title
        span.className = "title-word";
        span.style.setProperty("--word-index", index);
        span.textContent = word;
        words.append(span);
    });

    element.replaceChildren(label, words);
}

// ==========================================================================
// hyper text: letters scramble, then settle from left to right
// ==========================================================================

const scrambleLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const scrambleDigits = "0123456789";
let scrambleFrame = null;

function scrambleText(element, text) {
    const label = document.createElement("span");
    const readout = document.createElement("span");
    const startTime = performance.now();
    const duration = 750;

    // the same screen reader approach as animateWords
    label.className = "visually-hidden";
    label.textContent = text;
    readout.setAttribute("aria-hidden", "true");
    readout.textContent = text;
    element.replaceChildren(label, readout);

    window.cancelAnimationFrame(scrambleFrame);

    if (reducedMotion.matches) {
        return;
    }

    function step(time) {
        const progress = Math.min((time - startTime) / duration, 1);
        const settled = progress * text.length;

        // letters become random letters and digits random digits; spaces and commas stay
        readout.textContent = text.split("").map(function (character, index) {
            if (index < settled || !/[a-z0-9]/i.test(character)) {
                return character;
            }

            const pool = /\d/.test(character) ? scrambleDigits : scrambleLetters;

            return pool[Math.floor(Math.random() * pool.length)];
        }).join("");

        if (progress < 1) {
            scrambleFrame = window.requestAnimationFrame(step);
        }
    }

    scrambleFrame = window.requestAnimationFrame(step);
}

// ==========================================================================
// number ticker: a number counts from its old value to its new one
// ==========================================================================

// each counting number keeps its own animation, so two can run at once
const tickerFrames = new Map();

function tickNumber(element, value) {
    const startValue = Number(element.dataset.value || 0);
    const startTime = performance.now();
    const duration = 1400;

    element.dataset.value = value;
    window.cancelAnimationFrame(tickerFrames.get(element));

    if (reducedMotion.matches || startValue === value) {
        element.textContent = value.toLocaleString("en-US");
        return;
    }

    function step(time) {
        const progress = Math.min((time - startTime) / duration, 1);

        // fast at first, then slowing gently into place, like a spring settling
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        element.textContent = Math.round(startValue + (value - startValue) * eased).toLocaleString("en-US");

        if (progress < 1) {
            tickerFrames.set(element, window.requestAnimationFrame(step));
        }
    }

    tickerFrames.set(element, window.requestAnimationFrame(step));
}

// ==========================================================================
// lens: an eyepiece that magnifies the part of the picture under the mouse
// ==========================================================================

const lensZoom = 2.5;

/*
    The lens is a circle whose background is the same picture, made larger and moved so
    the spot under the mouse sits in its centre. It starts with the picture already on
    the page, then swaps to a sharper copy (largeSrc) once that has downloaded.
*/
function attachLens(picture, image, largeSrc) {
    if (!finePointer.matches) {
        return;
    }

    const lens = document.createElement("span");
    let largeRequested = false;

    lens.className = "lens";
    lens.setAttribute("aria-hidden", "true");
    lens.style.setProperty("--lens-image", getCssUrl(image.src));
    picture.append(lens);

    picture.addEventListener("mousemove", function (event) {
        // the picture hasn't finished loading, so there is nothing to magnify yet
        if (!image.classList.contains("is-sharp")) {
            return;
        }

        const imageBox = image.getBoundingClientRect();
        const pictureBox = picture.getBoundingClientRect();
        const x = event.clientX - imageBox.left;
        const y = event.clientY - imageBox.top;
        const isOverImage = x >= 0 && y >= 0 && x <= imageBox.width && y <= imageBox.height;
        const radius = lens.offsetWidth / 2;

        // the glow spreads past the picture's edges; the lens only shows over the picture
        lens.classList.toggle("is-active", isOverImage);

        if (!isOverImage) {
            return;
        }

        if (!largeRequested && largeSrc !== image.src) {
            const large = new Image();

            largeRequested = true;
            large.addEventListener("load", function () {
                lens.style.setProperty("--lens-image", getCssUrl(largeSrc));
            });
            large.src = largeSrc;
        }

        // style.css places the lens and its magnified picture using these
        lens.style.setProperty("--lens-x", `${event.clientX - pictureBox.left}px`);
        lens.style.setProperty("--lens-y", `${event.clientY - pictureBox.top}px`);
        lens.style.setProperty("--lens-size", `${imageBox.width * lensZoom}px ${imageBox.height * lensZoom}px`);
        lens.style.setProperty("--lens-position", `${radius - x * lensZoom}px ${radius - y * lensZoom}px`);
    });

    picture.addEventListener("mouseleave", function () {
        lens.classList.remove("is-active");
    });
}

// wraps an address for use as a css background, escaping any quotes inside it
function getCssUrl(url) {
    return `url("${url.replaceAll("\"", "%22")}")`;
}

// ==========================================================================
// terminal: types out each api request, then the answer under it
// ==========================================================================

let terminalLines = [];   // the last request and its answer, kept so they can be replayed
let terminalRequest = 0;  // counts requests, so a slow, older answer can't join a newer log
let terminalPlay = 0;     // counts replays, so starting a new one stops the typing of the last
let terminalTyping = Promise.resolve();

// starts a new log with the request; returns its number for logResponse
function logRequest(url) {
    terminalRequest += 1;
    terminalLines = [{ kind: "command", text: `GET ${url}` }];
    playTerminal();

    return terminalRequest;
}

// adds a line of the api's answer once the request has finished typing
function logResponse(requestId, text, kind) {
    if (requestId !== terminalRequest) {
        return;
    }

    const play = terminalPlay;

    terminalLines.push({ kind: kind, text: text });
    terminalTyping = terminalTyping.then(function () {
        if (play === terminalPlay) {
            requestLog.append(createTerminalLine(kind, text, isTerminalAnimated()));
        }
    });
}

// writes the whole log again, typing it out if the panel is open
function playTerminal() {
    const animate = isTerminalAnimated();

    terminalPlay += 1;

    const play = terminalPlay;

    requestLog.replaceChildren();
    terminalTyping = Promise.resolve();

    terminalLines.forEach(function (item) {
        if (item.kind === "command") {
            const line = createTerminalLine("command", "", false);

            requestLog.append(line);
            terminalTyping = typeLine(line, item.text, animate, play);
        } else {
            terminalTyping = terminalTyping.then(function () {
                if (play === terminalPlay) {
                    requestLog.append(createTerminalLine(item.kind, item.text, animate));
                }
            });
        }
    });
}

// typing only runs where someone can see it
function isTerminalAnimated() {
    return requestDetails.open && !reducedMotion.matches;
}

// one line of the log: a symbol for its kind, then the text
function createTerminalLine(kind, text, animate) {
    const line = document.createElement("span");
    const prompt = document.createElement("span");
    const body = document.createElement("span");
    const symbols = { command: "$", success: "✓", data: "→", error: "✕" };

    line.className = `terminal-line is-${kind}`;
    prompt.className = "terminal-prompt";
    prompt.setAttribute("aria-hidden", "true");
    prompt.textContent = symbols[kind];
    body.className = "terminal-text";
    body.textContent = text;

    if (animate) {
        line.classList.add("is-new");
    }

    line.append(prompt, " ", body);

    return line;
}

// types a line two characters at a time; the promise resolves when it's done
function typeLine(line, text, animate, play) {
    const body = line.querySelector(".terminal-text");

    if (!animate) {
        body.textContent = text;
        return Promise.resolve();
    }

    line.classList.add("is-typing");

    return new Promise(function (resolve) {
        let typed = 0;

        const timer = setInterval(function () {
            typed += 2;
            body.textContent = text.slice(0, typed);

            // finished, or a newer replay has taken over the log
            if (typed >= text.length || play !== terminalPlay) {
                clearInterval(timer);
                line.classList.remove("is-typing");
                resolve();
            }
        }, 16);
    });
}

// ==========================================================================
// small helpers
// ==========================================================================

// restarts a css animation by taking its class away and adding it back
function replayAnimation(element, className) {
    element.classList.remove(className);

    // reading the size makes the browser notice the class left before it returns
    void element.offsetWidth;

    element.classList.add(className);
}

// ==========================================================================
// start
// ==========================================================================

startStarfield();
startMeteors();
startSparkles();
addSpotlight(spotlightList);
burstButton.addEventListener("click", throwStars);

// opening the api request panel replays the last request
requestDetails.addEventListener("toggle", function () {
    if (requestDetails.open) {
        playTerminal();
    }
});
