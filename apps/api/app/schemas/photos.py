from pydantic import BaseModel, Field

from app.schemas.measurements import ConfidenceMap, Measurements


class PhotoEstimate(BaseModel):
    """Estimated measurements. Show them in the editable form; they are not saved yet."""

    measurements: Measurements
    confidence: ConfidenceMap
    notes: list[str] = Field(
        default_factory=list, description="Tips for a better result, safe to show the user."
    )
