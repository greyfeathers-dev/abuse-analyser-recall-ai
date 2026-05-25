import os
import httpx
from dotenv import load_dotenv

load_dotenv()

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"


class AssemblyAIClient:
    def __init__(self):
        self.auth_headers = {
            "authorization": ASSEMBLYAI_API_KEY,
        }

    async def upload_file(self, file_path: str) -> str:
        """Upload a local video/audio file to AssemblyAI and return the upload URL."""
        upload_url = f"{ASSEMBLYAI_BASE_URL}/upload"
        with open(file_path, "rb") as f:
            file_data = f.read()
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                upload_url,
                content=file_data,
                headers=self.auth_headers
            )
            if resp.status_code != 200:
                print(f"[AssemblyAI Upload Error] {resp.status_code}: {resp.text}")
            resp.raise_for_status()
            return resp.json()["upload_url"]

    async def request_transcript(self, audio_url: str) -> str:
        """Submit a transcription job and return the transcript ID."""
        url = f"{ASSEMBLYAI_BASE_URL}/transcript"
        payload = {
            "audio_url": audio_url,
            "speaker_labels": True,
            "speech_models": ["universal-2"] # Using plural as required by newer API
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                json=payload,
                headers=self.auth_headers
            )
            if resp.status_code != 200:
                print(f"[AssemblyAI Transcript Error] {resp.status_code}: {resp.text}")
            resp.raise_for_status()
            return resp.json()["id"]

    async def get_transcript_status(self, transcript_id: str) -> dict:
        """Poll the status of a transcription job."""
        url = f"{ASSEMBLYAI_BASE_URL}/transcript/{transcript_id}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=self.auth_headers)
            resp.raise_for_status()
            return resp.json()

    def parse_transcript(self, transcript_data: dict) -> list:
        """
        Parse AssemblyAI transcript into a standard segment format.
        """
        segments = []
        utterances = transcript_data.get("utterances", [])

        if utterances:
            for utt in utterances:
                segments.append({
                    "speaker": f"Speaker {utt.get('speaker', '?')}",
                    "text": utt.get("text", ""),
                    "start_time": utt.get("start", 0) / 1000.0,
                    "end_time": utt.get("end", 0) / 1000.0,
                    "words": [
                        {
                            "text": w["text"],
                            "start_time": w["start"] / 1000.0,
                            "end_time": w["end"] / 1000.0,
                        }
                        for w in utt.get("words", [])
                    ]
                })
        else:
            words = transcript_data.get("words", [])
            if words:
                segments.append({
                    "speaker": "Speaker A",
                    "text": transcript_data.get("text", ""),
                    "start_time": words[0]["start"] / 1000.0 if words else 0,
                    "end_time": words[-1]["end"] / 1000.0 if words else 0,
                    "words": [
                        {
                            "text": w["text"],
                            "start_time": w["start"] / 1000.0,
                            "end_time": w["end"] / 1000.0,
                        }
                        for w in words
                    ]
                })

        return segments