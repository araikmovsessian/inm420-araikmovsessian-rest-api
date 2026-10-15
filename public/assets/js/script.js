/*
    sky archive: script.js
    ----------------------
    Loads NASA's Astronomy Picture of the Day (APOD) from NASA's REST API and lets the
    visitor move through the archive by changing the date parameters of the request.

    API endpoint: https://science.nasa.gov/wp-json/wp/v2/apod-basic
    This replaced the legacy api.nasa.gov/planetary/apod endpoint, which NASA is
    archiving on December 1, 2026. The new endpoint is public, so it needs no api key.

    Parameters this page sends:
        date_from   first day to return, written yymmdd (june 16, 1995 is 950616)
        date_to     last day to return, written yymmdd
        per_page    how many days to return (the api allows up to 25)

    Fields this page displays:
        date, title, explanation, credit, alt, media_type, permalink, hdurl and
        basic_html (an html copy of each apod page, holding the image or video link)

    The animations (the word-by-word titles, the counting numbers, the eyepiece lens and
    the terminal that types out each request) come from effects.js, which loads first.
*/

// ==========================================================================
// settings
// ==========================================================================

const apiUrl = "https://science.nasa.gov/wp-json/wp/v2/apod-basic";

// the very first astronomy picture of the day
const firstDate = "1995-06-16";

// days shown on each side of the chosen date in the "around this date" strip
const daysAround = 3;
const daysPerRequest = daysAround * 2 + 1;

// widths (in pixels) requested from nasa's image server
const pictureWidth = 1600;
const thumbnailWidth = 400;
const viewerWidth = 2400;

const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
];

// svg elements (the slider's year ticks) have to be created in the svg namespace
const svgNamespace = "http://www.w3.org/2000/svg";

// ==========================================================================
// page elements
// ==========================================================================

const dateForm = document.querySelector("#date-form");
const dateInput = document.querySelector("#date-input");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const latestButton = document.querySelector("#latest-button");
const randomButton = document.querySelector("#random-button");
const scaleInput = document.querySelector("#scale-input");
const scaleOutput = document.querySelector("#scale-output");
const scaleTicks = document.querySelector("#scale-ticks");
const statusText = document.querySelector("#status");
const archiveCount = document.querySelector("#archive-count");
const archiveCountNumber = document.querySelector("#archive-count-number");

const entry = document.querySelector("#entry");
const entryMedia = document.querySelector("#entry-media");
const entryStage = document.querySelector("#entry-stage");
const entryDate = document.querySelector("#entry-date");
const entryTitle = document.querySelector("#entry-title");
const entryColumns = document.querySelector("#entry-columns");
const entryExplanation = document.querySelector("#entry-explanation");
const entryHint = document.querySelector("#entry-hint");
const entryCredit = document.querySelector("#entry-credit");
const entryType = document.querySelector("#entry-type");
const entryDay = document.querySelector("#entry-day");
const viewerButton = document.querySelector("#viewer-button");
const permalink = document.querySelector("#permalink");

// the archive day counts up from one picture's number to the next, so it keeps one element
const entryDayNumber = document.createElement("span");

const stripHeading = document.querySelector("#strip-heading");
const stripNote = document.querySelector("#strip-note");
const stripList = document.querySelector("#strip-list");

const viewer = document.querySelector("#viewer");
const viewerTitle = document.querySelector("#viewer-title");
const viewerFrame = document.querySelector("#viewer-frame");
const viewerOriginal = document.querySelector("#viewer-original");

// ==========================================================================
// state
// ==========================================================================

// newest day in the archive (apod runs on us eastern time); replaced by the
// newest date the api returns once the latest pictures have loaded
let latestDate = getTodayInNewYork();

let selectedDate = latestDate;
let displayedDate = "";   // the day whose picture is on show, so it isn't rebuilt for nothing
let loadedEntries = [];   // days returned by the last api call, oldest first
let loadedRange = null;   // { from, to, isLatest } for the last api call
let lastRequest = null;   // remembered so "try again" can repeat it
let requestNumber = 0;    // lets the page ignore answers that arrive out of order
let inputTimer = null;    // short pause so dragging or typing sends one request, not dozens

// ==========================================================================
// events
// ==========================================================================

// connects every control on the page to what it does
function addEventListeners() {
    // picking a date from the calendar, or typing one
    dateInput.addEventListener("change", function () {
        if (!dateInput.value) {
            return;
        }

        if (dateInput.validity.valid) {
            goToDateSoon(dateInput.value);
        } else {
            statusText.textContent = `Choose a date between ${formatLongDate(firstDate)} and ${formatLongDate(latestDate)}.`;
        }
    });

    // pressing enter inside the date field
    dateForm.addEventListener("submit", function (event) {
        event.preventDefault();

        if (dateInput.validity.valid) {
            goToDate(dateInput.value);
        }
    });

    previousButton.addEventListener("click", function () {
        goToDate(addDays(selectedDate, -1));
    });

    nextButton.addEventListener("click", function () {
        goToDate(addDays(selectedDate, 1));
    });

    latestButton.addEventListener("click", loadLatest);

    randomButton.addEventListener("click", function () {
        const totalDays = daysBetween(firstDate, latestDate);
        const randomDay = Math.floor(Math.random() * (totalDays + 1));

        goToDate(addDays(firstDate, randomDay));
    });

    // while the archive slider moves, preview the date it points at
    scaleInput.addEventListener("input", function () {
        const date = getScaleDate();

        scaleOutput.textContent = formatLongDate(date);
        scaleInput.setAttribute("aria-valuetext", formatLongDate(date));
        dateInput.value = date;
        fillScale();
    });

    // once the slider is let go (or moved with the arrow keys), load that date
    scaleInput.addEventListener("change", function () {
        goToDateSoon(getScaleDate());
    });

    // links in the explanation that point to another apod open on this page
    entryExplanation.addEventListener("click", function (event) {
        const archiveLink = event.target.closest("a[data-date]");

        if (archiveLink) {
            event.preventDefault();
            goToDate(archiveLink.dataset.date);
            entry.scrollIntoView({ behavior: getScrollBehavior() });

            // the clicked link is replaced, so move keyboard focus to the new title
            entryTitle.focus({ preventScroll: true });
        }
    });

    viewerButton.addEventListener("click", openViewer);

    // clicking the full size picture closes the viewer
    viewerFrame.addEventListener("click", function () {
        viewer.close();
    });
}

// ==========================================================================
// choosing what to load
// ==========================================================================

// loads the newest pictures: with no date parameters the api returns the latest days first
function loadLatest() {
    clearTimeout(inputTimer);
    requestEntries({ per_page: daysPerRequest }, null, "");
}

// shows one date, asking the api for it only when it isn't already loaded
function goToDate(date) {
    clearTimeout(inputTimer);
    selectedDate = clampDate(date);

    if (loadedRange && selectedDate >= loadedRange.from && selectedDate <= loadedRange.to) {
        showSelectedEntry();
        return;
    }

    // ask for a week of pictures with the chosen date in the middle
    let from = addDays(selectedDate, -daysAround);
    let to = addDays(selectedDate, daysAround);

    // near either end of the archive, slide the week so it still holds seven days
    if (to > latestDate) {
        to = latestDate;
        from = addDays(latestDate, -(daysPerRequest - 1));
    }

    if (from < firstDate) {
        from = firstDate;
        to = addDays(firstDate, daysPerRequest - 1);
    }

    const params = {
        date_from: toApiDate(from),
        date_to: toApiDate(to),
        per_page: daysPerRequest
    };

    requestEntries(params, { from: from, to: to, isLatest: false }, selectedDate);
}

// waits a moment before loading, so a fast slider drag or a typed year sends one request
function goToDateSoon(date) {
    clearTimeout(inputTimer);

    inputTimer = setTimeout(function () {
        goToDate(date);
    }, 350);
}

// ==========================================================================
// talking to the api
// ==========================================================================

// sends one request and shows what comes back
async function requestEntries(params, range, dateToShow) {
    requestNumber += 1;

    const thisRequest = requestNumber;

    lastRequest = { params: params, range: range, dateToShow: dateToShow };
    updateControls();

    if (dateToShow) {
        setLoading(true, `Loading ${formatLongDate(dateToShow)}…`);
    } else {
        setLoading(true, "Loading the latest pictures…");
    }

    try {
        const results = await fetchEntries(params);

        // a newer request started while this one was loading, so drop these results
        if (thisRequest !== requestNumber) {
            return;
        }

        loadedEntries = results.map(prepareEntry).sort(compareByDate);

        if (range) {
            loadedRange = range;
        } else {
            if (loadedEntries.length === 0) {
                throw new Error("NASA’s API didn’t return any pictures. Try again in a minute.");
            }

            // the newest picture marks the end of the archive
            const newest = loadedEntries[loadedEntries.length - 1];

            latestDate = newest.date;
            selectedDate = newest.date;
            loadedRange = { from: loadedEntries[0].date, to: newest.date, isLatest: true };
            setDateLimits();
        }

        renderStrip();
        showSelectedEntry();
    } catch (error) {
        if (thisRequest === requestNumber) {
            showError(error.message);
        }
    } finally {
        if (thisRequest === requestNumber) {
            setLoading(false);
        }
    }
}

// builds the request url, calls the api and returns the list of days
async function fetchEntries(params) {
    const url = new URL(apiUrl);
    let response;

    url.search = new URLSearchParams(params).toString();

    // type the exact request into the terminal in the "show the api request" panel
    const logId = logRequest(url.toString());
    const startTime = performance.now();

    try {
        response = await fetch(url);
    } catch (error) {
        logResponse(logId, "No response. The request didn’t reach NASA.", "error");
        throw new Error("Couldn’t reach NASA’s API. Check your internet connection, then try again.");
    }

    // errors can come back as an html page instead of json, so don't assume json
    const data = await response.json().catch(function () {
        return null;
    });
    const time = Math.round(performance.now() - startTime);

    if (!response.ok) {
        logResponse(logId, `${response.status} error after ${time} ms`, "error");
        throw new Error(getErrorMessage(response.status));
    }

    if (!Array.isArray(data)) {
        logResponse(logId, `${response.status}, but the answer wasn’t a list of days`, "error");
        throw new Error("NASA’s API sent back something this page can’t read. Try again in a minute.");
    }

    logResponse(logId, `${response.status} OK · ${data.length} days · ${time} ms`, "success");

    // a peek at the json: the first day in the answer and the fields this page reads first
    if (data.length > 0) {
        const preview = {
            date: data[0].date,
            title: getPlainText(data[0].title),
            media_type: data[0].media_type
        };

        logResponse(logId, `${JSON.stringify(preview)}${data.length > 1 ? `, …${data.length - 1} more` : ""}`, "data");
    }

    return data;
}

// turns an http status code into a message a visitor can act on
function getErrorMessage(status) {
    if (status === 400) {
        return `NASA’s API couldn’t read that date. Choose a date between ${formatLongDate(firstDate)} and today.`;
    }

    if (status === 429) {
        return "NASA’s API is getting too many requests right now. Wait a minute, then try again.";
    }

    if (status >= 500) {
        return `NASA’s API isn’t responding right now (error ${status}). Try again in a minute.`;
    }

    return `NASA’s API sent an unexpected answer (error ${status}). Try again in a minute.`;
}

// repeats the last request, used by the "try again" button
function retryLastRequest() {
    if (lastRequest) {
        requestEntries(lastRequest.params, lastRequest.range, lastRequest.dateToShow);
    }
}

// ==========================================================================
// preparing api data
// ==========================================================================

// turns one raw api entry into the pieces this page needs
function prepareEntry(data) {
    // a few titles start with "APOD: 1997 March 04 – ", which repeats the date shown above them
    const title = getPlainText(data.title).replace(/^APOD:\s*\d{4}\s+[a-z]+\s+\d{1,2}\s*[-–—]\s*/i, "") || "Untitled";
    const alt = getPlainText(data.alt);

    return {
        date: data.date,
        title: title,
        // older days use a generic "see explanation" alt text, so fall back to the title
        alt: alt && !alt.startsWith("See Explanation") ? alt : title,
        explanation: cleanExplanation(data.explanation || ""),
        credit: cleanCredit(data.credit || data.copyright || ""),
        media: getMedia(data),
        permalink: data.permalink || data.url || "https://science.nasa.gov/apod/archive/"
    };
}

/*
    Works out what to display for one day. The image, video or youtube link lives in
    basic_html, an html copy of the original apod page. hdurl is used as a back-up and as
    the preview frame for videos, unless it is nasa's generic placeholder image.
*/
function getMedia(data) {
    const page = parseHtml(data.basic_html || "");
    const preview = isPlaceholder(data.hdurl) ? "" : data.hdurl;
    const frame = page.querySelector("iframe[src]");
    const video = page.querySelector("video source[src], video[src]");
    const image = page.querySelector("img[src]");

    if (frame) {
        const src = fixUrl(frame.getAttribute("src"));

        return { type: "embed", src: src, thumbnail: preview || getYouTubeThumbnail(src) };
    }

    if (video) {
        return { type: "video", src: fixUrl(video.getAttribute("src")), thumbnail: preview };
    }

    if (image || preview) {
        const src = image ? fixUrl(image.getAttribute("src")) : preview;
        const link = image ? image.closest("a[href]") : null;
        const linkUrl = link ? fixUrl(link.getAttribute("href")) : "";

        return {
            type: "image",
            src: src,
            // on apod the picture links to its largest version
            fullSrc: isImageFile(linkUrl) ? linkUrl : preview || src,
            thumbnail: src
        };
    }

    return { type: "none", thumbnail: "" };
}

// removes the "explanation:" label and the notes that follow the explanation
function cleanExplanation(html) {
    return html
        .replace(/^\s*<(strong|b)>\s*explanation:?\s*<\/(strong|b)>\s*/i, "")
        .replace(/(<br\s*\/?>\s*)+(<(strong|b)>\s*)?(tomorrow['’]s picture|teachers)\s*:[\s\S]*$/i, "")
        .trim();
}

// removes labels like "image credit & copyright:" so only the names remain
function cleanCredit(html) {
    return html
        .replace(/^\s*<(b|strong)>[\s\S]*?(credit|copyright)[\s\S]*?<\/\1>\s*/i, "")
        .replace(/^\s*(image |video |illustration )?(credit|copyright)[^:]{0,30}:\s*/i, "")
        .trim();
}

// nasa uses a generic image when a day has no proper preview
function isPlaceholder(url) {
    return !url || url.includes("news-thumbnail") || url.includes("nasa-logo");
}

// checks whether a link points straight at a picture file
function isImageFile(url) {
    return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(url.split("?")[0]);
}

// some links start with "//" and need a protocol to work everywhere
function fixUrl(url) {
    return url.startsWith("//") ? `https:${url}` : url;
}

// nasa's image server resizes pictures with a ?w= parameter, which keeps huge
// originals (a few are over 30 mb) from slowing the page down
function getSizedUrl(url, width) {
    if (!url.includes("/dynamicimage/")) {
        return url;
    }

    const sizedUrl = new URL(url);

    sizedUrl.search = "";
    sizedUrl.searchParams.set("w", width);

    return sizedUrl.toString();
}

// youtube serves a preview frame for every video at a predictable address
function getYouTubeThumbnail(url) {
    const match = url.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/);

    return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : "";
}

/*
    Finds the date in a link to another apod page, in either address style:
        https://apod.nasa.gov/apod/ap950808.html
        https://science.nasa.gov/image-article/apod-2026-april-30-waves-on-titan/
*/
function getArchiveDate(url) {
    const oldStyle = url.match(/apod\.nasa\.gov\/apod\/ap(\d{2})(\d{2})(\d{2})\.html/i);
    const newStyle = url.match(/science\.nasa\.gov\/image-article\/(?:apod\/)?apod-(\d{4})-([a-z]+)-(\d{1,2})-/i);
    let date = "";

    if (oldStyle) {
        const century = Number(oldStyle[1]) >= 95 ? "19" : "20";

        date = `${century}${oldStyle[1]}-${oldStyle[2]}-${oldStyle[3]}`;
    } else if (newStyle) {
        const month = monthNames.indexOf(newStyle[2].toLowerCase()) + 1;

        if (month > 0) {
            date = `${newStyle[1]}-${padNumber(month)}-${padNumber(newStyle[3])}`;
        }
    }

    // only dates inside the archive count
    return date >= firstDate && date <= latestDate ? date : "";
}

// ==========================================================================
// safe html: the api sends explanations and credits as html with links
// ==========================================================================

// reads an html string without running it (no scripts run, no images download)
function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
}

// returns only the words in an html string, with codes like &#039; turned back into characters
function getPlainText(html) {
    return parseHtml(html || "").body.textContent.replace(/\s+/g, " ").trim();
}

// rebuilds the api's html keeping only text and links, so nothing unexpected reaches the page
function createSafeContent(html) {
    const fragment = document.createDocumentFragment();

    copySafeNodes(parseHtml(html).body, fragment);

    return fragment;
}

// walks through the parsed html and copies across only the safe parts
function copySafeNodes(source, target) {
    source.childNodes.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            target.append(tidyText(node.textContent));
        } else if (node.nodeName === "A") {
            target.append(createSafeLink(node));
        } else if (node.nodeName === "BR") {
            target.append(" ");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // any other tag is dropped, but the words inside it are kept
            copySafeNodes(node, target);
        }
    });
}

// older apod pages leave a space before punctuation ("the shuttle fleet ."), so remove it
function tidyText(text) {
    return text
        .replace(/\s+([.,;:!?)])/g, "$1")
        .replace(/\(\s+/g, "(");
}

// copies one link, opening outside sites in a new tab
function createSafeLink(source) {
    const url = source.getAttribute("href") || "";
    const archiveDate = getArchiveDate(url);

    // not a web address (an email link, for example), so keep just the words
    if (!archiveDate && !/^https?:\/\//i.test(url)) {
        const words = document.createDocumentFragment();

        copySafeNodes(source, words);

        return words;
    }

    const link = document.createElement("a");

    copySafeNodes(source, link);

    if (archiveDate) {
        // a link to another astronomy picture of the day opens that date here
        link.href = `?date=${archiveDate}`;
        link.dataset.date = archiveDate;
        link.className = "archive-link";
    } else {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
    }

    return link;
}

// ==========================================================================
// showing results on the page
// ==========================================================================

// shows the chosen date using the days already loaded
function showSelectedEntry() {
    const current = getSelectedEntry();

    updateControls();
    updateAddress();
    markCurrentInStrip();

    if (current) {
        // only rebuild the picture when the day has changed
        if (current.date !== displayedDate) {
            renderEntry(current);
        }

        statusText.textContent = `Showing ${formatLongDate(current.date)}.`;
    } else {
        renderMissingEntry();
        statusText.textContent = `There’s no picture for ${formatLongDate(selectedDate)}.`;
    }
}

// fills the main article with one day's picture and text
function renderEntry(current) {
    displayedDate = current.date;
    entry.classList.remove("is-empty");

    // images keep the loading beam until they arrive; videos and messages appear straight away
    entryMedia.classList.toggle("is-waiting", current.media.type === "image");
    entryStage.replaceChildren(createMedia(current));

    showEntryDate(current.date);
    showEntryTitle(current.title);

    // the text below the picture fades in again for each new day (effects.js)
    replayAnimation(entryColumns, "is-arriving");

    if (current.explanation) {
        entryExplanation.replaceChildren(createSafeContent(current.explanation));
    } else {
        // a few days arrive from the api without their explanation
        entryExplanation.replaceChildren(
            "NASA’s API didn’t include the explanation for this day. ",
            createLink("Read it on NASA Science", current.permalink)
        );
    }

    entryHint.hidden = entryExplanation.querySelector(".archive-link") === null;

    entryCredit.replaceChildren(current.credit ? createSafeContent(current.credit) : "Not listed");
    entryType.textContent = getMediaLabel(current.media.type);

    // "11,438 of 11,438", with the first number counting to its new value
    entryDay.replaceChildren(entryDayNumber, ` of ${formatNumber(daysBetween(firstDate, latestDate) + 1)}`);
    tickNumber(entryDayNumber, daysBetween(firstDate, current.date) + 1);

    viewerButton.hidden = current.media.type !== "image";
    permalink.href = current.permalink;
    document.title = `${current.title} | Sky Archive`;
}

// builds the image, video or message that fills the picture area
function createMedia(current) {
    const media = current.media;

    if (media.type === "image") {
        const picture = document.createElement("div");
        const image = document.createElement("img");
        const glow = document.createElement("img");

        picture.className = "media-picture";
        image.className = "media-image";
        image.alt = current.alt;

        // the picture starts out of focus and sharpens once it has loaded
        image.addEventListener("load", function () {
            image.classList.add("is-sharp");

            if (entryMedia.contains(image)) {
                entryMedia.classList.remove("is-waiting");
            }
        });

        image.addEventListener("error", function () {
            // only replace it if this picture is still the one on show
            if (entryMedia.contains(image)) {
                viewerButton.hidden = true;
                entryMedia.classList.remove("is-waiting");
                entryStage.replaceChildren(createNotice(
                    "This picture didn’t load.",
                    "NASA’s image server didn’t send the file. You can still see it on NASA Science.",
                    createLink("Open on NASA Science", current.permalink)
                ));
            }
        });

        image.addEventListener("click", openViewer);
        image.src = getSizedUrl(media.src, pictureWidth);

        // backlight: a blurred, saturated copy behind the picture lights the plate in its
        // colours; it uses the same file, so the browser downloads it only once
        glow.className = "media-glow";
        glow.alt = "";
        glow.src = image.src;

        picture.append(image, glow);

        // the eyepiece lens looks at a sharper copy when nasa's image server can make one
        attachLens(picture, image, getSizedUrl(media.src, viewerWidth));

        return picture;
    }

    if (media.type === "embed") {
        const frame = document.createElement("iframe");

        frame.className = "media-frame";
        frame.src = media.src;
        frame.title = current.title;
        frame.allow = "fullscreen; picture-in-picture";
        frame.referrerPolicy = "strict-origin-when-cross-origin";

        return frame;
    }

    if (media.type === "video") {
        const video = document.createElement("video");

        video.className = "media-video";
        video.src = media.src;
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";

        if (media.thumbnail) {
            video.poster = getSizedUrl(media.thumbnail, pictureWidth);
        }

        return video;
    }

    return createNotice(
        "This day can’t be shown here.",
        "It uses a format this page can’t display, such as an interactive page.",
        createLink("Open on NASA Science", current.permalink)
    );
}

// shown when the archive has no picture for the chosen date
function renderMissingEntry() {
    displayedDate = "";
    entry.classList.add("is-empty");
    entryMedia.classList.remove("is-waiting");
    entryStage.replaceChildren(createNotice(
        "",
        "NASA’s archive has no Astronomy Picture of the Day for this date. Choose a nearby day below, or pick another date.",
        null
    ));

    showEntryDate(selectedDate);
    showEntryTitle("Nothing was published on this date");
    entryExplanation.replaceChildren();
    document.title = "Sky Archive | NASA Astronomy Picture of the Day";
}

// shown when the api can't be reached or sends an error
function showError(message) {
    displayedDate = "";
    entry.classList.add("is-empty");
    entryMedia.classList.remove("is-waiting");
    entryStage.replaceChildren(createNotice(
        "",
        message,
        createButton("Try again", retryLastRequest)
    ));

    showEntryDate(selectedDate);
    showEntryTitle("This date couldn’t be loaded");
    entryExplanation.replaceChildren();
    statusText.textContent = message;
}

// writes the date above the title as a <time> element, so browsers can read it as a date
function showEntryDate(date) {
    const time = document.createElement("time");

    time.dateTime = date;
    entryDate.replaceChildren(time);

    // the letters scramble, then settle, like a readout on an instrument (effects.js)
    scrambleText(time, formatLongDate(date));
}

// the title arrives word by word, rising out of a blur (effects.js)
function showEntryTitle(text) {
    animateWords(entryTitle, text);
}

// fills the strip with every day the last api call returned
function renderStrip() {
    stripList.replaceChildren();

    loadedEntries.forEach(function (item) {
        const listItem = document.createElement("li");
        const button = document.createElement("button");
        const date = document.createElement("time");
        const title = document.createElement("span");

        button.className = "strip-item";
        button.type = "button";
        button.dataset.date = item.date;
        button.addEventListener("click", function () {
            goToDate(item.date);
        });

        date.className = "strip-date";
        date.dateTime = item.date;
        date.textContent = formatMediumDate(item.date);

        title.className = "strip-title";
        title.textContent = item.title;

        button.append(createThumbnail(item), date, title);
        listItem.append(button);
        stripList.append(listItem);
    });

    if (loadedEntries.length === 0) {
        const empty = document.createElement("li");

        empty.className = "strip-empty";
        empty.textContent = "No pictures were published in these days.";
        stripList.append(empty);
    }

    stripHeading.textContent = loadedRange.isLatest ? "Latest pictures" : "Around this date";
    stripNote.textContent = `${formatMediumDate(loadedRange.from)} to ${formatMediumDate(loadedRange.to)}`;
}

// the small preview at the top of each day in the strip
function createThumbnail(item) {
    const thumbnail = document.createElement("span");

    thumbnail.className = "strip-thumb";

    if (item.media.thumbnail) {
        const image = document.createElement("img");

        // the title under the thumbnail already describes it, so the image itself is decorative
        image.alt = "";
        image.loading = "lazy";
        image.src = getSizedUrl(item.media.thumbnail, thumbnailWidth);
        thumbnail.append(image);
    } else {
        thumbnail.textContent = "No preview";
    }

    if (item.media.type === "video" || item.media.type === "embed") {
        const badge = document.createElement("span");

        badge.className = "strip-badge";
        badge.textContent = "Video";
        thumbnail.append(badge);
    }

    return thumbnail;
}

// gives the day on show a gold ring in the strip
function markCurrentInStrip() {
    stripList.querySelectorAll(".strip-item").forEach(function (button) {
        if (button.dataset.date === selectedDate) {
            button.setAttribute("aria-current", "true");
        } else {
            button.removeAttribute("aria-current");
        }
    });
}

// opens the picture on show at full size
function openViewer() {
    const current = getSelectedEntry();

    if (!current || current.media.type !== "image") {
        return;
    }

    const image = document.createElement("img");

    image.className = "viewer-image";
    image.alt = current.alt;

    // the loading line runs until the large picture has arrived
    viewerFrame.classList.add("is-waiting");
    image.addEventListener("load", function () {
        viewerFrame.classList.remove("is-waiting");
    });
    image.addEventListener("error", function () {
        viewerFrame.classList.remove("is-waiting");
    });
    image.src = getSizedUrl(current.media.fullSrc, viewerWidth);

    viewerTitle.textContent = current.title;
    viewerOriginal.href = current.media.fullSrc;
    viewerFrame.replaceChildren(image);
    viewer.showModal();
}

// ==========================================================================
// small page helpers
// ==========================================================================

// a short message for the picture area, with an optional title and link or button
function createNotice(title, text, action) {
    const notice = document.createElement("div");
    const body = document.createElement("p");

    notice.className = "notice";

    if (title) {
        const heading = document.createElement("p");

        heading.className = "notice-title";
        heading.textContent = title;
        notice.append(heading);
    }

    body.className = "notice-text";
    body.textContent = text;
    notice.append(body);

    if (action) {
        notice.append(action);
    }

    return notice;
}

// a link that opens in a new tab
function createLink(text, url) {
    const link = document.createElement("a");

    link.className = "text-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = text;

    return link;
}

// a gold button, used for "try again"
function createButton(text, onClick) {
    const button = document.createElement("button");

    button.className = "button button-accent";
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", onClick);

    return button;
}

// finds the loaded day that matches the chosen date
function getSelectedEntry() {
    return loadedEntries.find(function (item) {
        return item.date === selectedDate;
    });
}

// a readable name for each media type the api uses
function getMediaLabel(type) {
    if (type === "image") {
        return "Image";
    }

    if (type === "video" || type === "embed") {
        return "Video";
    }

    return "Other";
}

// dims the article and updates the status line while a request is running
function setLoading(isLoading, message) {
    entry.classList.toggle("is-loading", isLoading);
    entry.setAttribute("aria-busy", String(isLoading));

    if (isLoading) {
        entryMedia.classList.add("is-waiting");
    } else if (entryMedia.querySelector(".media-image:not(.is-sharp)") === null) {
        // the request is done and no picture is still downloading
        entryMedia.classList.remove("is-waiting");
    }

    if (message) {
        statusText.textContent = message;
    }
}

// keeps the date field, slider and buttons in step with the chosen date
function updateControls() {
    dateInput.value = selectedDate;
    scaleInput.value = daysBetween(firstDate, selectedDate);
    scaleOutput.textContent = formatLongDate(selectedDate);

    // screen readers announce the date instead of the slider's raw number
    scaleInput.setAttribute("aria-valuetext", formatLongDate(selectedDate));
    previousButton.disabled = selectedDate <= firstDate;
    nextButton.disabled = selectedDate >= latestDate;
    fillScale();
}

// sets the earliest and latest dates the controls allow
function setDateLimits() {
    const totalDays = daysBetween(firstDate, latestDate) + 1;

    dateInput.min = firstDate;
    dateInput.max = latestDate;
    scaleInput.max = totalDays - 1;
    drawScaleTicks();
    fillScale();

    // the header's day count climbs to the archive's length (effects.js)
    archiveCount.hidden = false;
    tickNumber(archiveCountNumber, totalDays);
}

// lights the slider's track from 1995 up to the needle; style.css reads --scale-fraction
function fillScale() {
    scaleInput.style.setProperty("--scale-fraction", (scaleInput.value / scaleInput.max).toFixed(4));
}

// draws a tick on the archive slider for each new year, with a label every five years
function drawScaleTicks() {
    const totalDays = daysBetween(firstDate, latestDate);
    const firstYear = Number(firstDate.slice(0, 4));
    const lastYear = Number(latestDate.slice(0, 4));

    scaleTicks.replaceChildren();

    for (let year = firstYear; year <= lastYear; year += 1) {
        // the archive starts partway through 1995, so that tick sits at the very start
        const tickDate = year === firstYear ? firstDate : `${year}-01-01`;
        const isLabelled = year === firstYear || year % 5 === 0;

        // how far along the archive this year begins, as a percentage of the slider
        const position = `${(daysBetween(firstDate, tickDate) / totalDays * 100).toFixed(3)}%`;
        const tick = document.createElementNS(svgNamespace, "line");

        tick.setAttribute("class", isLabelled ? "scale-tick is-labelled" : "scale-tick");
        tick.setAttribute("x1", position);
        tick.setAttribute("x2", position);
        tick.setAttribute("y1", "3");
        tick.setAttribute("y2", isLabelled ? "15" : "9");
        scaleTicks.append(tick);

        if (isLabelled) {
            const label = document.createElementNS(svgNamespace, "text");

            // decade labels stay visible on the narrowest screens; the others hide there
            label.setAttribute("class", year === firstYear || year % 10 === 0 ? "scale-label is-decade" : "scale-label");
            label.setAttribute("x", position);
            label.setAttribute("y", "30");
            label.textContent = year;
            scaleTicks.append(label);
        }
    }
}

// the date the archive slider is pointing at
function getScaleDate() {
    return addDays(firstDate, Number(scaleInput.value));
}

// puts the date in the address bar so the page can be bookmarked or shared
function updateAddress() {
    try {
        window.history.replaceState(null, "", `?date=${selectedDate}`);
    } catch (error) {
        // some browsers block this when the page is opened straight from a file; nothing else is affected
    }
}

// reads a date from the address bar, such as index.html?date=2020-07-04
function getDateFromAddress() {
    const date = new URLSearchParams(window.location.search).get("date") || "";
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

    return isDate && date >= firstDate && date <= latestDate ? date : "";
}

// smooth scrolling, unless the visitor has asked for less motion
function getScrollBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// ==========================================================================
// date helpers: dates are kept as "yyyy-mm-dd" strings and worked out in utc,
// so the visitor's time zone never shifts a day
// ==========================================================================

// "2026-10-08" becomes a date object at midnight utc
function parseDate(date) {
    return new Date(`${date}T00:00:00Z`);
}

// moves a date forward (or back, with a negative number) by whole days
function addDays(date, days) {
    const result = parseDate(date);

    result.setUTCDate(result.getUTCDate() + days);

    return result.toISOString().slice(0, 10);
}

// how many days separate two dates
function daysBetween(start, end) {
    return Math.round((parseDate(end) - parseDate(start)) / 86400000);
}

// keeps a date inside the archive
function clampDate(date) {
    if (date < firstDate) {
        return firstDate;
    }

    if (date > latestDate) {
        return latestDate;
    }

    return date;
}

// sorts days from oldest to newest
function compareByDate(a, b) {
    return a.date.localeCompare(b.date);
}

// the api expects dates written yymmdd: "2026-10-08" becomes "261008"
function toApiDate(date) {
    return date.slice(2).replaceAll("-", "");
}

// apod publishes on us eastern time, so "today" is today in new york
function getTodayInNewYork() {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    return formatter.format(new Date());
}

// "Thursday, October 8, 2026"
function formatLongDate(date) {
    return parseDate(date).toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

// "Oct 8, 2026"
function formatMediumDate(date) {
    return parseDate(date).toLocaleDateString("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

// adds thousands separators: 11438 becomes "11,438"
function formatNumber(number) {
    return number.toLocaleString("en-US");
}

// adds a leading zero: 4 becomes "04"
function padNumber(number) {
    return String(number).padStart(2, "0");
}

// ==========================================================================
// start
// ==========================================================================

addEventListeners();
setDateLimits();
updateControls();

// open the date in the address bar if there is one, otherwise the latest picture
const dateFromAddress = getDateFromAddress();

if (dateFromAddress) {
    goToDate(dateFromAddress);
} else {
    loadLatest();
}
