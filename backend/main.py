from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .recall_client import RecallClient
from .assemblyai_client import AssemblyAIClient
from .bad_words import detect_bad_words
import uvicorn
import shutil
import os
import json

app = FastAPI(title="Abuse Analyzer API")

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[DEBUG] Incoming request: {request.method} {request.url.path}")
    return await call_next(request)

recall_client = RecallClient()
assemblyai_client = AssemblyAIClient()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Recall final statuses that mean the bot is done
RECALL_DONE_STATUSES = {"done", "call_ended", "recording_stopped"}
RECALL_ACTIVE_STATUSES = {"joining", "in_waiting_room", "in_call_not_recording", "in_call_recording"}
RECALL_ERROR_STATUSES = {"fatal", "recording_permission_denied", "bot_rejected"}



@app.post("/api/record")
async def record_meeting(meeting_url: str):
    """Start a Recall bot for a meeting URL."""
    try:
        from .bad_words import reset_seen_flags
        reset_seen_flags()  # Reset flagging cache for new session
        
        print(f"[DEBUG] Creating bot for URL: {meeting_url}")
        result = await recall_client.create_bot(meeting_url)
        bot_id = result.get("id")
        print(f"[DEBUG] Bot created successfully. ID: {bot_id}")
        
        if not bot_id:
            raise Exception(f"Recall API did not return a bot ID. Response: {result}")
            
        return {"job_id": bot_id, "status": "started", "provider": "recall"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file and transcribe via AssemblyAI."""
    try:
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        audio_url = await assemblyai_client.upload_file(file_path)
        transcript_id = await assemblyai_client.request_transcript(audio_url)

        return {"job_id": transcript_id, "status": "processing", "provider": "assemblyai"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Get status - routes to the correct provider based on job_id format."""
    try:
        # Try AssemblyAI first (UUIDs from AssemblyAI look like 'abc123...' not a standard UUID)
        try:
            data = await assemblyai_client.get_transcript_status(job_id)
            aai_status = data.get("status")
            # If AssemblyAI returns a valid status, use it
            if aai_status in ("queued", "processing", "completed", "error"):
                return {"status": aai_status, "video_url": None, "provider": "assemblyai"}
        except Exception:
            pass  # Not an AssemblyAI job, fall through to Recall

        # Try Recall
        recall_data = await recall_client.get_status(job_id)
        raw_status = recall_data.get("raw_status", "unknown")
        video_url = recall_data.get("video_url")

        if raw_status in RECALL_DONE_STATUSES:
            status = "completed"
        elif raw_status in RECALL_ERROR_STATUSES:
            status = "error"
        elif raw_status in RECALL_ACTIVE_STATUSES:
            status = raw_status  # send the actual message: 'in_call_recording', etc.
        else:
            status = raw_status

        return {"status": status, "video_url": video_url, "provider": "recall"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/transcript/{job_id}")
async def get_transcript(job_id: str):
    """Get transcript - routes to the correct provider."""
    try:
        # Try AssemblyAI first
        try:
            raw = await assemblyai_client.get_transcript_status(job_id)
            if raw.get("status") == "completed":
                segments = assemblyai_client.parse_transcript(raw)
                flags = detect_bad_words(segments)
                return {"transcript": segments, "flags": flags}
        except Exception:
            pass

        # Try Recall transcript
        transcript_data = await recall_client.get_transcript(job_id)

        # Recall transcript is a list of objects like:
        # [{"speaker": 0, "words": [{"text": "hi", "start_time": 0.5, "end_time": 0.9}, ...]}]
        segments = []
        if isinstance(transcript_data, list):
            for entry in transcript_data:
                words = entry.get("words", [])
                text = " ".join(w.get("text", "") for w in words)
                start = words[0].get("start_time", 0) if words else 0
                end = words[-1].get("end_time", start) if words else start
                speaker_id = entry.get("speaker", 0)

                normalized_words = []
                for w in words:
                    normalized_words.append({
                        "text": w.get("text", ""),
                        "start_time": w.get("start_time", 0),
                        "end_time": w.get("end_time", 0),
                    })

                segments.append({
                    "speaker": f"Speaker {speaker_id}",
                    "text": text,
                    "start_time": start,
                    "end_time": end,
                    "words": normalized_words
                })

        flags = detect_bad_words(segments)
        return {"transcript": segments, "flags": flags}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@app.post("/api/webhook/transcript")
async def receive_transcript_webhook(request: Request):
    """Receive real-time transcript from Recall.ai"""
    try:
        payload = await request.json()
        print(f"[DEBUG] RAW WEBHOOK PAYLOAD: {json.dumps(payload)[:200]}...")
        event_type = payload.get("event", "unknown")
        
        # We only care about transcript data for live text
        if event_type not in ["transcript.data", "transcript.partial_data"]:
            return {"status": "ignored", "event": event_type}

        # Handle nested data structure from Recall.ai
        inner_data = payload.get("data", {})
        if "data" in inner_data:
            data = inner_data["data"]
        else:
            data = inner_data

        words = data.get("words", [])
        is_final = data.get("is_final", event_type == "transcript.data")
        bot_id = payload.get("bot_id", "unknown")
        
        # Extract text from words list
        text = " ".join(str(w.get("text", "")).strip() for w in words).strip()
        
        if not text:
            print(f"[WEBHOOK] Received event but text was empty. Words: {len(words)}")
            return {"status": "no_text"}

        # Get speaker info
        participant = data.get("participant", {})
        speaker_name = participant.get("name") or f"Speaker {data.get('speaker', '?')}"
        
        print(f"[WEBHOOK] TEXT: '{text}' | SPEAKER: {speaker_name} | Connections: {len(manager.active_connections)}")
        
        # Get current meeting time for the duration stat
        meeting_time = 0
        if words:
            last_word = words[-1]
            if isinstance(last_word.get('end_timestamp'), dict):
                meeting_time = last_word['end_timestamp'].get('relative', 0)
            else:
                meeting_time = last_word.get('end_time', 0)

        # ALWAYS broadcast the live transcript text to the UI
        await manager.broadcast({
            "type": "live_transcript",
            "text": text,
            "speaker": speaker_name,
            "is_partial": not is_final,
            "bot_id": bot_id,
            "meeting_time": meeting_time
        })

        # Only flag bad words on FINAL chunks to avoid duplicate partial alerts
        if is_final:
            segment = {"text": text, "speaker": speaker_name, "words": words}
            flags = detect_bad_words([segment])
            
            if flags:
                import datetime
                print(f"[WEBHOOK] ALERT: {len(flags)} bad words found")
                for flag in flags:
                    await manager.broadcast({
                        "type": "alert",
                        "word": flag["word"],
                        "text": flag["context"], # Full sentence context
                        "speaker": speaker_name,
                        "timestamp": datetime.datetime.now().isoformat(),
                        "meeting_time": flag.get("timestamp", 0),
                        "bot_id": bot_id
                    })
        
        return {"status": "ok"}
    except Exception as e:
        print(f"[WEBHOOK] Processing Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "detail": str(e)}




# Serve static files - MOVED TO END to avoid shadowing API routes
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
