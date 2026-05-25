// ========================
// CONFIG (PRODUCTION READY)
// ========================
const API_BASE =
    window.location.hostname === "localhost"
        ? "http://localhost:8000/api"
        : "https://abuse-analyser-recall-ai-production.up.railway.app/api";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL =
    window.location.hostname === "localhost"
        ? "ws://localhost:8000/ws"
        : "wss://abuse-analyser-recall-ai-production.up.railway.app/ws";

// ========================
// DOM ELEMENTS
// ========================
const meetingUrlInput = document.getElementById('meetingUrl');
const recordBtn = document.getElementById('recordBtn');
const uploadBtn = document.getElementById('uploadBtn');
const videoUpload = document.getElementById('videoUpload');
const mainVideo = document.getElementById('mainVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const transcriptContent = document.getElementById('transcriptContent');
const flagsContent = document.getElementById('flagsContent');
const toast = document.getElementById('statusToast');
const statusMessage = document.getElementById('statusMessage');

const badWordsListEl = document.getElementById('badWordsList');
const newBadWordInput = document.getElementById('newBadWordInput');
const addBadWordBtn = document.getElementById('addBadWordBtn');

// ========================
// STATE
// ========================
let currentJobId = localStorage.getItem('recall_job_id');
let transcriptData = [];
let flagData = [];
let customBadWords = [];

// ========================
// LIVE TRANSCRIPT STATE
// ========================
let currentPartialEl = null;
let speakersSeen = new Set();
let meetingStartTime = null;
let durationInterval = null;
let liveFlagCount = 0;

// ========================
// TAB SWITCHING
// ========================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(tabId + 'Tab').classList.add('active');
    });
});

// ========================
// WEBSOCKET
// ========================
let ws;
let wsRetryCount = 0;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('[WS] Connected');
        wsRetryCount = 0;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'alert') {
            showBadWordAlert(data.word, data.speaker, data.text, data.timestamp);
            addLiveFlag(data.word, data.speaker, data.text, data.timestamp);
        }

        if (data.type === 'live_transcript') {
            addLiveTranscript(
                data.text,
                data.speaker,
                data.is_partial,
                data.meeting_time
            );
        }
    };

    ws.onclose = () => {
        console.log('[WS] Reconnecting...');
        if (wsRetryCount < 10) {
            wsRetryCount++;
            setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = (err) => {
        console.error('[WS Error]', err);
    };
}

connectWebSocket();

// ========================
// CUSTOM BAD WORDS
// ========================
async function fetchBadWords() {
    try {
        const res = await fetch(`${API_BASE}/bad_words`);
        const data = await res.json();
        customBadWords = data.bad_words || [];
        renderBadWords();
    } catch (err) {
        console.error("Failed to fetch bad words", err);
    }
}

function renderBadWords() {
    if (!badWordsListEl) return;
    badWordsListEl.innerHTML = "";
    customBadWords.forEach(word => {
        const tag = document.createElement("div");
        tag.className = "bad-word-tag";
        tag.innerHTML = `
            ${word}
            <span class="delete-btn" data-word="${word}">&times;</span>
        `;
        badWordsListEl.appendChild(tag);
    });

    // Add delete listeners
    document.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const word = e.target.getAttribute("data-word");
            try {
                const res = await fetch(`${API_BASE}/bad_words/${encodeURIComponent(word)}`, { method: "DELETE" });
                if (res.ok) {
                    const data = await res.json();
                    customBadWords = data.bad_words;
                    renderBadWords();
                }
            } catch (err) {
                console.error("Failed to delete bad word", err);
            }
        });
    });
}

if (addBadWordBtn) {
    addBadWordBtn.addEventListener("click", addBadWord);
}
if (newBadWordInput) {
    newBadWordInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addBadWord();
    });
}

async function addBadWord() {
    const word = newBadWordInput.value.trim().toLowerCase();
    if (!word) return;
    if (customBadWords.includes(word)) {
        alert("Word already exists in the list!");
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/bad_words`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word })
        });
        if (res.ok) {
            const data = await res.json();
            customBadWords = data.bad_words;
            newBadWordInput.value = "";
            renderBadWords();
            rescanTranscriptForFlags();
        } else {
            alert("Failed to add word.");
        }
    } catch (err) {
        console.error("Failed to add bad word", err);
    }
}

function highlightBadWords(text) {
    if (!customBadWords || customBadWords.length === 0) return text;
    // Escape regex characters
    const escapedWords = customBadWords.map(w => w.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&'));
    const pattern = new RegExp(`\\\\b(${escapedWords.join('|')})\\\\b`, 'gi');
    return text.replace(pattern, '<span class="flagged-highlight">$&</span>');
}

function rescanTranscriptForFlags() {
    // Clear flags and rescan the current transcript in DOM
    flagsContent.innerHTML = "";
    liveFlagCount = 0;
    const statFlags = document.getElementById('statFlags');
    if (statFlags) statFlags.textContent = '0';
    
    const lines = document.querySelectorAll('.transcript-line');
    lines.forEach(line => {
        const textEl = line.querySelector('.text');
        const speakerEl = line.querySelector('.speaker');
        const timeEl = line.querySelector('.timestamp');
        
        if (textEl && speakerEl && timeEl) {
            // Re-highlight the text
            const originalText = textEl.textContent;
            textEl.innerHTML = highlightBadWords(originalText);
            
            // Check if any bad words are present
            if (!customBadWords || customBadWords.length === 0) return;
            const escapedWords = customBadWords.map(w => w.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&'));
            const pattern = new RegExp(`\\\\b(${escapedWords.join('|')})\\\\b`, 'gi');
            
            let match;
            while ((match = pattern.exec(originalText)) !== null) {
                // To convert display time back to timestamp for addLiveFlag (or just pass the display time)
                // We don't have the exact timestamp easily, so we just use the display time 
                addLiveFlag(match[0], speakerEl.textContent, originalText, null, timeEl.textContent);
            }
        }
    });
}

fetchBadWords();

// ========================
// LIVE ALERT UI
// ========================
function showBadWordAlert(word, speaker, text, timestamp) {
    const alertEl = document.createElement('div');
    alertEl.className = 'live-alert';

    alertEl.innerHTML = `
        <div class="alert-content">
            <h4>🚨 Flagged Word</h4>
            <p><b>${speaker}</b> said "<b>${word}</b>"</p>
            <p>${text}</p>
        </div>
    `;

    document.body.appendChild(alertEl);
    setTimeout(() => alertEl.remove(), 6000);
}

// ========================
// LIVE FLAGS
// ========================
function addLiveFlag(word, speaker, text, timestamp, displayTimeStr = null) {
    liveFlagCount++;

    const statFlags = document.getElementById('statFlags');
    if (statFlags) statFlags.textContent = liveFlagCount;

    const displayTime = displayTimeStr || (timestamp
        ? new Date(timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString());

    let offsetSeconds = 0;
    if (meetingStartTime) {
        offsetSeconds = Math.max(0, (Date.now() - meetingStartTime) / 1000);
    }

    // Remove empty state if present
    const empty = flagsContent.querySelector('.empty-state');
    if (empty) empty.remove();

    // Update or add count header
    let countEl = flagsContent.querySelector('.flag-count');
    if (countEl) {
        countEl.textContent = `${liveFlagCount} flagged word${liveFlagCount > 1 ? 's' : ''} detected`;
    } else {
        countEl = document.createElement('p');
        countEl.className = 'flag-count';
        countEl.style.cssText = 'color:#94a3b8; font-size:12px; margin-bottom:12px;';
        countEl.textContent = `${liveFlagCount} flagged word detected`;
        flagsContent.insertBefore(countEl, flagsContent.firstChild);
    }

    const el = document.createElement('div');
    el.className = 'flag-item clickable-time';
    el.setAttribute('data-time', offsetSeconds);
    el.innerHTML = `
        <div class="flag-meta">
            <i class="fas fa-triangle-exclamation" style="color:#ef4444;"></i>
            <span class="flag-word-only">${word}</span>
            <span class="flag-speaker">${speaker}</span>
            <span class="flag-time">${displayTime}</span>
        </div>
        <div class="flag-context">"...${highlightBadWords(text)}..."</div>
    `;

    // Insert after the count header
    if (countEl.nextSibling) {
        flagsContent.insertBefore(el, countEl.nextSibling);
    } else {
        flagsContent.appendChild(el);
    }
}

// ========================
// CLICK TO SEEK LOGIC
// ========================
document.addEventListener('click', (e) => {
    const clickable = e.target.closest('.clickable-time');
    if (clickable && mainVideo.src) {
        const time = parseFloat(clickable.getAttribute('data-time'));
        if (!isNaN(time)) {
            mainVideo.currentTime = time;
            mainVideo.play().catch(err => console.error("Auto-play prevented", err));
        }
    }
});

// ========================
// DURATION TIMER
// ========================
function startDurationTimer() {
    if (meetingStartTime) return;

    meetingStartTime = Date.now();

    durationInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');

        const statDuration = document.getElementById('statDuration');
        if (statDuration) statDuration.textContent = `${mins}:${secs}`;
    }, 1000);
}

// ========================
// LIVE TRANSCRIPT
// ========================
function addLiveTranscript(text, speaker, isPartial, meetingTime) {

    startDurationTimer();

    speakersSeen.add(speaker);
    const statSpeakers = document.getElementById('statSpeakers');
    if (statSpeakers) statSpeakers.textContent = speakersSeen.size;
    
    const highlightedText = highlightBadWords(text);

    let offsetSeconds = 0;
    if (meetingStartTime) {
        offsetSeconds = Math.max(0, (Date.now() - meetingStartTime) / 1000);
    }

    if (currentPartialEl) {
        currentPartialEl.querySelector('.text').innerHTML = highlightedText;
        if (!isPartial) {
            currentPartialEl.setAttribute('data-time', offsetSeconds);
            currentPartialEl = null;
        }
    } else {
        const el = document.createElement('div');
        el.className = 'transcript-line clickable-time';
        el.setAttribute('data-time', offsetSeconds);
        const now = new Date().toLocaleTimeString();
        el.innerHTML = `
            <div class="line-meta">
                <span class="speaker">${speaker}</span>
                <span class="timestamp">${now}</span>
            </div>
            <div class="text">${highlightedText}</div>
        `;
        transcriptContent.appendChild(el);
        if (isPartial) {
            currentPartialEl = el;
        }
    }

    transcriptContent.scrollTop = transcriptContent.scrollHeight;
}

// ========================
// RECORD MEETING
// ========================
recordBtn.addEventListener('click', async () => {
    try {
        const url = meetingUrlInput.value.trim();

        if (!url) {
            alert("Enter meeting URL");
            return;
        }

        // Reset stats for new session
        speakersSeen.clear();
        liveFlagCount = 0;
        meetingStartTime = null;
        currentPartialEl = null;
        clearInterval(durationInterval);

        const statDuration = document.getElementById('statDuration');
        const statSpeakers = document.getElementById('statSpeakers');
        const statFlags = document.getElementById('statFlags');
        if (statDuration) statDuration.textContent = '--:--';
        if (statSpeakers) statSpeakers.textContent = '0';
        if (statFlags) statFlags.textContent = '0';

        transcriptContent.innerHTML = '';
        flagsContent.innerHTML = '';

        console.log("Sending meeting URL:", url);

        const res = await fetch(
            `${API_BASE}/record?meeting_url=${encodeURIComponent(url)}`,
            { method: "POST" }
        );

        console.log("Response status:", res.status);

        const data = await res.json();

        console.log("Backend response:", data);

        if (!data.job_id) {
            console.error("Bot creation failed");
            alert(data.detail || "Bot creation failed. Check Railway logs.");
            return;
        }

        currentJobId = data.job_id;
        console.log("JOB ID:", currentJobId);
        localStorage.setItem("recall_job_id", currentJobId);

        pollStatus();

    } catch (err) {
        console.error("Frontend error:", err);
        alert("Frontend crashed. Check console.");
    }
});

// ========================
// UPLOAD VIDEO
// ========================
uploadBtn.addEventListener('click', () => videoUpload.click());

videoUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData
    });

    const data = await res.json();

    currentJobId = data.job_id;
    localStorage.setItem("recall_job_id", currentJobId);

    pollStatus();
});

// ========================
// POLL STATUS
// ========================
async function pollStatus() {
    const interval = setInterval(async () => {
        const res = await fetch(`${API_BASE}/status/${currentJobId}`);
        const data = await res.json();

        if (data.status === "completed") {
            clearInterval(interval);
            if (data.video_url) {
                mainVideo.src = data.video_url;
                mainVideo.style.display = 'block';
                videoPlaceholder.style.display = 'none';
            }
            fetchTranscript();
        }
    }, 4000);
}

// ========================
// GET TRANSCRIPT
// ========================
async function fetchTranscript() {
    const res = await fetch(`${API_BASE}/transcript/${currentJobId}`);
    const data = await res.json();

    renderTranscript(data.transcript);
    renderFlags(data.flags);
}

// ========================
// RENDER TRANSCRIPT
// ========================
function renderTranscript(data) {
    if (!data || data.length === 0) {
        return; // Don't wipe out existing live transcript if fetched data is empty
    }

    transcriptContent.innerHTML = "";

    data.forEach(seg => {
        const el = document.createElement('div');
        el.className = 'transcript-line clickable-time';
        el.setAttribute('data-time', seg.start_time || 0);
        const displayTime = seg.start_time
            ? new Date(seg.start_time * 1000).toLocaleTimeString()
            : '--';
        el.innerHTML = `
            <div class="line-meta">
                <span class="speaker">${seg.speaker}</span>
                <span class="timestamp">${displayTime}</span>
            </div>
            <div class="text">${highlightBadWords(seg.text)}</div>
        `;
        transcriptContent.appendChild(el);
    });
}

// ========================
// RENDER FLAGS (POST-UPLOAD)
// ========================
function renderFlags(data) {
    if (!data || data.length === 0) {
        if (liveFlagCount > 0) return; // Don't wipe out existing live flags
        flagsContent.innerHTML = `<div class="empty-state"><p>No flagged words detected.</p></div>`;
        return;
    }

    flagsContent.innerHTML = "";

    // Count header
    const countEl = document.createElement('p');
    countEl.className = 'flag-count';
    countEl.style.cssText = 'color:#94a3b8; font-size:12px; margin-bottom:12px;';
    countEl.textContent = `${data.length} flagged word${data.length > 1 ? 's' : ''} detected`;
    flagsContent.appendChild(countEl);

    data.forEach(flag => {
        const displayTime = flag.timestamp
            ? new Date(flag.timestamp * 1000).toLocaleTimeString()
            : '--';

        const el = document.createElement('div');
        el.className = 'flag-item clickable-time';
        el.setAttribute('data-time', flag.timestamp || 0);
        el.innerHTML = `
            <div class="flag-meta">
                <i class="fas fa-triangle-exclamation" style="color:#ef4444;"></i>
                <span class="flag-word-only">${flag.word}</span>
                <span class="flag-speaker">${flag.speaker}</span>
                <span class="flag-time">${displayTime}</span>
            </div>
            <div class="flag-context">"...${highlightBadWords(flag.context)}..."</div>
        `;
        flagsContent.appendChild(el);
    });
}

// ========================
// TOAST
// ========================
function showToast(msg) {
    statusMessage.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}