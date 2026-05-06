import json
import re
import google.generativeai as genai

from .base import AIProvider
from config import get_settings


class GeminiProvider(AIProvider):
    def __init__(self):
        settings = get_settings()
        genai.configure(api_key=settings.google_api_key)
        self.model_name = settings.gemini_model
        self.system_prompt: str = ""

    async def extract(self, image_bytes: bytes, mime_type: str, system_prompt: str) -> dict:
        model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=system_prompt,
        )
        image_part = {"mime_type": mime_type, "data": image_bytes}
        response = model.generate_content(
            [image_part, "Extract the data from this bank deposit screenshot."],
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                max_output_tokens=4096,
            ),
        )
        raw = response.text.strip()
        return _parse_json(raw)


def _parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned.strip())
