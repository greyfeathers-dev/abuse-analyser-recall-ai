# 🎙️ Abuse Analyzer

A modern web application to analyze meetings using Recall.ai. It provides timestamped transcripts, bad word detection, and a synchronized video-transcript player.

## Features
- **✔ Upload / Record**: Submit meeting URLs (Zoom/Meet/Teams) or upload video files.
- **✔ Timestamped Transcript**: Fully synchronized transcript with the video player.
- **✔ Bad Word Detection**: Automatically flags inappropriate language with precise timestamps.
- **✔ Split-View UI**: Premium dark-mode interface with video on the left and transcript on the right.

## Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js (for serving the frontend)
- Recall.ai API Key (Get one at [recall.ai](https://recall.ai))

### 2. Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Configure your environment:
   Edit `backend/.env` and add your `RECALL_API_KEY`.

### 3. Running the App
Start both the backend and frontend:

**Backend:**
```bash
python -m backend.main
```

**Frontend:**
```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Demo Mode
If you don't have an API key yet, you can still test the UI by uploading any video file. The app will enter a **Simulation Mode** that displays a sample transcript and flagged words to demonstrate the synchronized playback and UI features.

## Tech Stack
- **Backend**: FastAPI, Httpx, Pydantic
- **Frontend**: Vanilla JS, CSS3 (Glassmorphism), HTML5
- **API**: Recall.ai
