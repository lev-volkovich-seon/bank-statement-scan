import base64
import json
import re
import anthropic

from .base import AIProvider
from config import get_settings


class ClaudeProvider(AIProvider):
    def __init__(self):
        settings = get_settings()
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.claude_model

    async def extract(self, image_bytes: bytes, mime_type: str, system_prompt: str) -> dict:
        image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
        message = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Extract the data from this bank deposit screenshot.",
                        },
                    ],
                }
            ],
        )
        raw = message.content[0].text.strip()
        return _parse_json(raw)


def _parse_json(text: str) -> dict:
    # Strip markdown code fences if model adds them despite instructions
    cleaned = re.sub(r"^```(?:json)?\s*", "", text)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned.strip())
