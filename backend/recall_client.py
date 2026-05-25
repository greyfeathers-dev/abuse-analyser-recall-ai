import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

RECALL_API_KEY = os.getenv("RECALL_API_KEY")

RECALL_BASE_URL = os.getenv(
    "RECALL_BASE_URL",
    "https://ap-northeast-1.recall.ai/api/v1"
)


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
                        "events": [
                            "transcript.data",
                            "transcript.partial_data"
                        ]
                    }
                ]
            }
        }

        print("====================================")
        print("[DEBUG] CREATE BOT CALLED")
        print("[DEBUG] Meeting URL:", meeting_url)
        print("[DEBUG] Recall URL:", url)
        print(
            "[DEBUG] Webhook URL:",
            f"{os.getenv('BASE_URL')}/api/webhook/transcript"
        )
        print("[DEBUG] Payload:")
        print(json.dumps(payload, indent=2))

        async with httpx.AsyncClient(timeout=60.0) as client:

            response = await client.post(
                url,
                json=payload,
                headers=self.headers
            )

            print("[DEBUG] Recall status:", response.status_code)
            print("[DEBUG] Recall raw response:", response.text)

            if response.status_code not in [200, 201]:

                print("====================================")
                print("[RECALL ERROR]")
                print("Status Code:", response.status_code)
                print("Response:", response.text)
                print("====================================")

                raise Exception(
                    f"Recall API Error {response.status_code}: {response.text}"
                )

            data = response.json()

            print("[DEBUG] Parsed response:", data)

            return data

    async def get_status(self, job_id):

        async with httpx.AsyncClient(timeout=60.0) as client:

            bot_url = f"{RECALL_BASE_URL}/bot/{job_id}/"

            resp = await client.get(
                bot_url,
                headers=self.headers
            )

            if resp.status_code != 200:
                print(
                    f"[Recall get_status error] "
                    f"{resp.status_code}: {resp.text}"
                )
                resp.raise_for_status()

            data = resp.json()

            status_changes = data.get("status_changes", [])

            if status_changes:
                latest = status_changes[-1]
                current_status = latest.get("code", "unknown")
            else:
                current_status = data.get("status", "unknown")

            video_url = None

            if current_status == "done":

                recordings = data.get("recordings", [])

                for rec in recordings:

                    media = rec.get("media_shortcuts", {})

                    for key in [
                        "video_mixed_mp4",
                        "video_mixed",
                        "video_mp4"
                    ]:

                        url_data = media.get(key, {})

                        if (
                            isinstance(url_data, dict)
                            and url_data.get("data", {}).get("download_url")
                        ):
                            video_url = (
                                url_data["data"]["download_url"]
                            )
                            break

                    if video_url:
                        break

            transcript_id = None

            if current_status == "done":

                recordings = data.get("recordings", [])

                for rec in recordings:

                    media = rec.get("media_shortcuts", {})

                    transcript_data = media.get("transcript", {})

                    if (
                        isinstance(transcript_data, dict)
                        and transcript_data.get("data", {}).get("id")
                    ):
                        transcript_id = (
                            transcript_data["data"]["id"]
                        )
                        break

            return {
                "raw_status": current_status,
                "video_url": video_url,
                "transcript_id": transcript_id,
                "recordings": data.get("recordings", [])
            }

    async def get_transcript(self, job_id):

        status_data = await self.get_status(job_id)

        transcript_id = status_data.get("transcript_id")

        if not transcript_id:
            print(
                f"[Recall Error] "
                f"No transcript ID found for job {job_id}"
            )
            return []

        async with httpx.AsyncClient(timeout=60.0) as client:

            url = f"{RECALL_BASE_URL}/transcript/{transcript_id}/"

            resp = await client.get(
                url,
                headers=self.headers
            )

            if resp.status_code != 200:
                print(
                    f"[Recall transcript error] "
                    f"{resp.status_code}: {resp.text}"
                )
                resp.raise_for_status()

            data = resp.json()

            return (
                data.get("transcript", [])
                if isinstance(data, dict)
                else data
            )