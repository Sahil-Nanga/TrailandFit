"""Logging setup.

Never log photos, signed URLs, tokens, or measurement values (AGENT.md section 9).
Log identifiers and outcomes only.
"""

import logging


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # Uvicorn's access log includes full query strings, which may later carry signed URLs.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
