const API_BASE = window.location.port === '3000' ? 'http://localhost:8000/api' : '/api';

// DOM Elements
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

// State
let currentJobId = localStorage.getItem('recall_job_id');
let transcriptData = [];
let flagData = [];

// WebSocket for real-time alerts
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = window.location.port === '3000' 
    ? 'ws://localhost:8000/ws' 
    : `${wsProtocol}//${window.location.host}/ws`;
let ws;
let wsRetryCount = 0;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        console.log('[WS] Connected to real-time alert server');
        wsRetryCount = 0;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[WS] Received:', data);
        if (data.type === 'alert') {
            showBadWordAlert(data.word, data.speaker, data.text, data.timestamp);
            // Also add to live flags list
            addLiveFlag(data.word, data.speaker, data.text);
        } else if (data.type === 'live_transcript') {
            addLiveTranscript(data.text, data.speaker, data.is_partial, data.meeting_time);
        }
    };


    ws.onclose = () => {
        console.log('[WS] Disconnected. Reconnecting in 3s...');
        if (wsRetryCount < 10) {
            wsRetryCount++;
            setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = (err) => {
        console.error('[WS] Error:', err);
    };
}

connectWebSocket();

function showBadWordAlert(word, speaker, text, timestamp) {
    const alertEl = document.createElement('div');
    alertEl.className = 'live-alert';
    
    // Format timestamp if it's ISO
    const displayTime = timestamp.includes('T') ? new Date(timestamp).toLocaleTimeString() : timestamp;

    alertEl.innerHTML = `
        <span class="alert-icon">⚠️</span>
        <div class="alert-content">
            <h4>🚨 Flagged Word!</h4>
            <p><strong>${speaker}</strong> said <span class="alert-word">"${word}"</span></p>
            <p class="alert-sentence">"${text}"</p>
            <small style="opacity: 0.7;">Detected at: ${displayTime}</small>
        </div>
    `;
    document.body.appendChild(alertEl);

    // Auto-remove after 6 seconds
    setTimeout(() => {
        alertEl.classList.add('fade-out');
        setTimeout(() => alertEl.remove(), 500);
    }, 6000);
}


let liveFlagCount = 0;

function addLiveFlag(word, speaker, text) {
    liveFlagCount++;
    document.getElementById('statFlags').textContent = liveFlagCount;
    
    // Add to the flags panel in real-time
    const emptyState = flagsContent.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const flagEl = document.createElement('div');
    flagEl.className = 'flag-item';
    flagEl.innerHTML = `
        <div class="flag-meta">
            <span class="flag-time">${new Date().toLocaleTimeString()}</span>
            <span class="flag-label">Flagged:</span>
            <span class="flag-word-only">${word}</span>
            <span class="flag-speaker">(${speaker})</span>
        </div>
        <p class="flag-context">${text}</p>
    `;
    flagsContent.prepend(flagEl);
}


const liveSpeakers = new Set();
let maxLiveDuration = 0;
let lastTranscriptEl = null;
let lastSpeaker = null;

function addLiveTranscript(text, speaker, isPartial, meetingTime) {
    // Clear empty state
    const emptyState = transcriptContent.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    // Update live insights
    if (speaker) {
        liveSpeakers.add(speaker);
        document.getElementById('statSpeakers').textContent = liveSpeakers.size;
    }

    if (meetingTime && meetingTime > maxLiveDuration) {
        maxLiveDuration = meetingTime;
        document.getElementById('statDuration').textContent = formatTime(maxLiveDuration);
    }

    // If it's a partial update and from the same speaker, update the last element
    if (isPartial && lastTranscriptEl && lastSpeaker === speaker) {
        lastTranscriptEl.querySelector('.text').textContent = text + '...';
        return;
    }

    // Create new element
    const lineEl = document.createElement('div');
    lineEl.className = 'transcript-line' + (isPartial ? ' partial' : '');
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    lineEl.innerHTML = `
        <div class="line-meta">
            <span class="speaker">${speaker}</span>
            <span class="timestamp">${timeStr}</span>
        </div>
        <p class="text">${text}${isPartial ? '...' : ''}</p>
    `;
    
    // If the previous one was partial and we now have a final or a different speaker, 
    // remove the "partial" look from the previous one
    if (!isPartial) {
        if (lastTranscriptEl && lastSpeaker === speaker && lastTranscriptEl.classList.contains('partial')) {
            lastTranscriptEl.remove();
        }
        lastTranscriptEl = lineEl;
        lastSpeaker = speaker;
    } else {
        lastTranscriptEl = lineEl;
        lastSpeaker = speaker;
    }

    transcriptContent.appendChild(lineEl);
    lineEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
}


// Initial check for existing job
if (currentJobId && currentJobId !== 'undefined') {
    pollStatus();
} else if (currentJobId === 'undefined') {
    localStorage.removeItem('recall_job_id');
    currentJobId = null;
}

// Event Listeners
recordBtn.addEventListener('click', startRecording);
uploadBtn.addEventListener('click', () => videoUpload.click());
videoUpload.addEventListener('change', handleFileUpload);

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}Tab`).classList.add('active');
    });
});

// Functions
async function startRecording() {
    const url = meetingUrlInput.value.trim();
    if (!url) return showToast('Please enter a meeting URL', 'error');

    showToast('Deploying Speaksafe bot...');
    try {
        const res = await fetch(`${API_BASE}/record?meeting_url=${encodeURIComponent(url)}`, { method: 'POST' });
        const data = await res.json();
        
        if (data.job_id && data.job_id !== 'undefined') {
            currentJobId = data.job_id;
            localStorage.setItem('recall_job_id', currentJobId);
            pollStatus();
        } else {
            console.error('Invalid job ID received:', data);
            showToast('Error: Could not get a valid meeting ID', 'error');
        }
    } catch (err) {
        showToast('Failed to start recording', 'error');
    }
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Load video locally for immediate preview
    const url = URL.createObjectURL(file);
    mainVideo.src = url;
    mainVideo.style.display = 'block';
    videoPlaceholder.style.display = 'none';

    showToast('Uploading and transcribing video...', 'info');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        currentJobId = data.job_id;
        localStorage.setItem('recall_job_id', currentJobId);
        
        pollStatus();
    } catch (err) {
        showToast('Failed to process upload', 'error');
    }
}

async function pollStatus() {
    if (!currentJobId) return;

    const interval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/status/${currentJobId}`);
            const data = await res.json();

            if (data.status === 'completed' || data.status === 'done') {
                clearInterval(interval);
                showToast('Recording ready!', 'success');
                
                if (data.video_url) {
                    mainVideo.src = data.video_url;
                    mainVideo.style.display = 'block';
                    videoPlaceholder.style.display = 'none';
                }
                
                localStorage.removeItem('recall_job_id');
                fetchTranscript();
            } else if (data.status === 'error') {
                clearInterval(interval);
                showToast('Meeting recording failed or was rejected', 'error');
                localStorage.removeItem('recall_job_id');
            } else {
                showToast(`Status: ${data.status}...`);
            }
        } catch (err) {
            clearInterval(interval);
            showToast('Error polling status', 'error');
        }
    }, 5000);
}

async function fetchTranscript() {
    showToast('Fetching transcript...');
    try {
        const res = await fetch(`${API_BASE}/transcript/${currentJobId}`);
        const data = await res.json();
        renderTranscript(data.transcript);
        renderFlags(data.flags);
        updateStats(data);
        showToast('Analysis complete!', 'success');
    } catch (err) {
        showToast('Failed to fetch transcript', 'error');
    }
}

function renderTranscript(segments) {
    transcriptData = segments;
    transcriptContent.innerHTML = segments.map(seg => `
        <div class="transcript-line" onclick="seekTo(${seg.start_time})">
            <div class="line-meta">
                <span class="speaker">${seg.speaker || 'Speaker'}</span>
                <span class="timestamp">${formatTime(seg.start_time)}</span>
            </div>
            <p class="text">${seg.text || seg.words.map(w => w.text).join(' ')}</p>
        </div>
    `).join('');
}

function renderFlags(flags) {
    flagData = flags;
    if (flags.length === 0) {
        flagsContent.innerHTML = '<div class="empty-state"><p>No bad words detected. Great meeting!</p></div>';
        return;
    }

    flagsContent.innerHTML = flags.map(flag => `
        <div class="flag-item" onclick="seekTo(${flag.timestamp})">
            <span class="flag-time">${formatTime(flag.timestamp)}</span>
            <span class="flag-label">Flagged:</span>
            <span class="flag-word-only">${flag.word}</span>
        </div>
    `).join('');
}

function updateStats(data) {
    document.getElementById('statFlags').textContent = data.flags.length;
    document.getElementById('statSpeakers').textContent = new Set(data.transcript.map(s => s.speaker)).size;
    
    const lastSeg = data.transcript[data.transcript.length - 1];
    if (lastSeg) {
        const duration = lastSeg.end_time || lastSeg.start_time;
        document.getElementById('statDuration').textContent = formatTime(duration);
    }
}

function seekTo(time) {
    mainVideo.currentTime = time;
    mainVideo.play();
}

// Sync video with transcript highlighting
mainVideo.ontimeupdate = () => {
    const currentTime = mainVideo.currentTime;
    const lines = document.querySelectorAll('.transcript-line');
    
    transcriptData.forEach((seg, index) => {
        if (currentTime >= seg.start_time && (index === transcriptData.length - 1 || currentTime < transcriptData[index+1].start_time)) {
            lines.forEach(l => l.classList.remove('active'));
            lines[index].classList.add('active');
            lines[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
};

// Helpers
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).filter((v, i) => v !== '00' || i > 0).join(':');
}

function showToast(msg, type = 'info') {
    statusMessage.textContent = msg;
    toast.className = `toast show ${type}`;
    if (type !== 'info') {
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

// Simulation for demo without Recall API Key
function simulateAnalysis() {
    setTimeout(() => {
        const mockData = {
            transcript: [
                { start_time: 0, speaker: "John Doe", text: "Hello everyone, welcome to the quarterly review." },
                { start_time: 5, speaker: "Jane Smith", text: "Thanks John. I'm really excited to share the damn results." },
                { start_time: 10, speaker: "John Doe", text: "Wait, Jane, did you just say that? That's quite a strong word." },
                { start_time: 15, speaker: "Jane Smith", text: "Sorry, I meant the amazing results. This project doesn't suck at all." },
                { start_time: 20, speaker: "John Doe", text: "Agreed. Let's look at the charts." }
            ],
            flags: [
                { word: "damn", timestamp: 8.5, speaker: "Jane Smith" },
                { word: "suck", timestamp: 18.2, speaker: "Jane Smith" }
            ]
        };
        renderTranscript(mockData.transcript);
        renderFlags(mockData.flags);
        updateStats(mockData);
        showToast('Demo Analysis Complete!', 'success');
    }, 3000);
}
