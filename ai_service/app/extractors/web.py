from __future__ import annotations

import asyncio
import logging

import httpx

from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)


class WebExtractor(BaseExtractor):
    """Extract content from generic web pages and blog posts."""

    def can_handle(self, url: str) -> bool:
        # Catch-all for any URL not handled by specific extractors
        return True

    async def extract(self, url: str) -> ExtractedContent:
        html = await self._fetch_html(url)
        if not html:
            return ExtractedContent(platform="web", url=url)

        extracted = await asyncio.to_thread(self._parse_html, html, url)
        return extracted

    async def _fetch_html(self, url: str) -> str | None:
        try:
            async with httpx.AsyncClient(
                timeout=15.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.text
        except Exception as e:
            logger.warning("Failed to fetch %s: %s", url, e)
            return None

    def _parse_html(self, html: str, url: str) -> ExtractedContent:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # Extract title
        title = None
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True)

        # Extract meta description
        description = None
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc:
            description = meta_desc.get("content", "")

        # Try og:description as fallback
        if not description:
            og_desc = soup.find("meta", attrs={"property": "og:description"})
            if og_desc:
                description = og_desc.get("content", "")

        # Extract main article text using readability
        article_text = self._extract_article_text(html)

        # Extract structured data (JSON-LD)
        structured = self._extract_json_ld(soup)

        return ExtractedContent(
            platform="web",
            url=url,
            title=title,
            description=description,
            raw_text=article_text,
            has_video=False,
            metadata={
                "structured_data": structured,
            },
        )

    def _extract_article_text(self, html: str) -> str | None:
        try:
            from readability import Document

            doc = Document(html)
            from bs4 import BeautifulSoup

            clean_soup = BeautifulSoup(doc.summary(), "html.parser")
            return clean_soup.get_text(separator="\n", strip=True)[:5000]
        except Exception:
            return None

    def _extract_json_ld(self, soup) -> list[dict]:
        """Extract JSON-LD structured data."""
        import json

        results = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                results.append(data)
            except (json.JSONDecodeError, TypeError):
                pass
        return results
