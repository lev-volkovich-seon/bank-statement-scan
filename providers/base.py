from abc import ABC, abstractmethod


class AIProvider(ABC):
    @abstractmethod
    async def extract(self, image_bytes: bytes, mime_type: str, system_prompt: str) -> dict:
        """Call the vision model and return parsed JSON dict."""
        ...
