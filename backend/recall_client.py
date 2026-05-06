import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

RECALL_API_KEY = os.getenv("RECALL_API_KEY")
RECALL_BASE_URL = os.getenv("RECALL_BASE_URL", "https://us-west-2.recall.ai/api/v1")


class RecallClient:
    def __init__(self):
        self.headers = {
            "Authorization": f"Token {RECALL_API_KEY}",
            "Content-Type": "application/json"
        }

    async def create_bot(self, meeting_url, bot_name="Speaksafe bot"):
        """Deploy a bot to a meeting URL."""
        url = f"{RECALL_BASE_URL}/bot/"
        payload = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
            "recording_config": {
                "video_mixed_mp4": {},
                "transcript": {
                    "provider": {
                        "recallai_streaming": {
                            "mode": "prioritize_low_latency",
                            "language_code": "en"
                        }
                    }
                },
                "realtime_endpoints": [
                    {
                        "type": "webhook",
                        "url": f"{os.getenv('BASE_URL')}/api/webhook/transcript",
                        "events": ["transcript.data", "transcript.partial_data"]
                    }
                ]
            }
        }
        print(f"[DEBUG] Webhook URL set to: {os.getenv('BASE_URL')}/api/webhook/transcript")
        print(f"[DEBUG] Recall Create Payload: {json.dumps(payload, indent=2)}")
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            if response.status_code != 201:
                print(f"[Recall Error] {response.status_code}: {response.text}")
            response.raise_for_status()
            return response.json()

    async def get_status(self, job_id):
        """
        Poll the bot status. Recall.ai bot status_changes list contains entries like:
        'joining', 'in_waiting_room', 'in_call_not_recording', 'in_call_recording',
        'recording_permission_denied', 'done', 'fatal'
        We look at the latest status_change to determine the current state.
        """
        async with httpx.AsyncClient() as client:
            bot_url = f"{RECALL_BASE_URL}/bot/{job_id}/"
            resp = await client.get(bot_url, headers=self.headers)
            if resp.status_code != 200:
                print(f"[Recall get_status error] {resp.status_code}: {resp.text}")
                resp.raise_for_status()
            
            data = resp.json()
            print(f"[DEBUG] Full bot data keys: {list(data.keys())}")
            
            # Extract current status from status_changes list
            status_changes = data.get("status_changes", [])
            if status_changes:
                latest = status_changes[-1]
                current_status = latest.get("code", "unknown")
                print(f"[DEBUG] Latest status_change: {current_status}")
            else:
                current_status = data.get("status", "unknown")
                print(f"[DEBUG] No status_changes, using status field: {current_status}")

            # Extract video URL if bot is done
            video_url = None
            if current_status == "done":
                recordings = data.get("recordings", [])
                print(f"[DEBUG] Recordings count: {len(recordings)}")
                for rec in recordings:
                    media = rec.get("media_shortcuts", {})
                    # Try video_mixed_mp4 first, then video_mixed
                    for key in ["video_mixed_mp4", "video_mixed", "video_mp4"]:
                        url_data = media.get(key, {})
                        if isinstance(url_data, dict) and url_data.get("data", {}).get("download_url"):
                            video_url = url_data["data"]["download_url"]
                            break
                    if video_url:
                        break
                print(f"[DEBUG] Video URL found: {bool(video_url)}")

            # Extract transcript ID if bot is done
            transcript_id = None
            if current_status == "done":
                recordings = data.get("recordings", [])
                for i, rec in enumerate(recordings):
                    print(f"[DEBUG] Recording {i} keys: {list(rec.keys())}")
                    print(f"[DEBUG] Recording {i} media_shortcuts keys: {list(rec.get('media_shortcuts', {}).keys())}")
                    
                    # Check media_shortcuts for transcript
                    media = rec.get("media_shortcuts", {})
                    print(f"[DEBUG] media_shortcuts content: {media}")
                    transcript_data = media.get("transcript", {})
                    if isinstance(transcript_data, dict) and transcript_data.get("data", {}).get("id"):
                        transcript_id = transcript_data["data"]["id"]
                        print(f"[DEBUG] Found transcript ID in media_shortcuts: {transcript_id}")
                        break
                    
                    # Fallback: look in artifacts list
                    artifacts = rec.get("artifacts", [])
                    print(f"[DEBUG] Artifacts: {artifacts}")
                    for artifact in artifacts:
                        if artifact.get("type") == "transcript":
                            transcript_id = artifact.get("id")
                            print(f"[DEBUG] Found transcript ID in artifacts: {transcript_id}")
                            break
                    if transcript_id:
                        break
                    
                    # Fallback 2: direct transcript field on recording
                    if rec.get("transcript", {}).get("id"):
                        transcript_id = rec["transcript"]["id"]
                        print(f"[DEBUG] Found transcript ID directly on recording: {transcript_id}")
                        break

            return {
                "raw_status": current_status,
                "video_url": video_url,
                "transcript_id": transcript_id,
                "recordings": data.get("recordings", [])
            }

    async def get_transcript(self, job_id):
        """
        Fetch transcript using the artifact-based endpoint.
        First gets the bot status to find the transcript artifact ID.
        """
        status_data = await self.get_status(job_id)
        transcript_id = status_data.get("transcript_id")
        
        if not transcript_id:
            print(f"[Recall Error] No transcript ID found for job {job_id}")
            return []

        async with httpx.AsyncClient() as client:
            url = f"{RECALL_BASE_URL}/transcript/{transcript_id}/"
            resp = await client.get(url, headers=self.headers)
            if resp.status_code != 200:
                print(f"[Recall transcript error] {resp.status_code}: {resp.text}")
                resp.raise_for_status()
            data = resp.json()
            # The transcript artifact usually has a 'transcript' field which is the list
            return data.get("transcript", []) if isinstance(data, dict) else data
