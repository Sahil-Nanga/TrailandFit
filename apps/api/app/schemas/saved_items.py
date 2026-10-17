from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, StringConstraints, UrlConstraints

# Web pages only: no javascript:, data:, file: or extension URLs.
PageUrl = Annotated[AnyUrl, UrlConstraints(max_length=2048, allowed_schemes=["http", "https"])]
PageTitle = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
ImageUrl = Annotated[AnyUrl, UrlConstraints(max_length=2048, allowed_schemes=["https", "http"])]
Category = Literal["top", "bottom", "other"]
SizeLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Body measurements a shop's size chart can give (same names as Measurements).
ChartField = Literal[
    "height_cm",
    "weight_kg",
    "chest_cm",
    "waist_cm",
    "hips_cm",
    "shoulder_width_cm",
    "inseam_cm",
    "sleeve_cm",
    "neck_cm",
    "thigh_cm",
]


class StoreSize(BaseModel):
    """One of the sizes the shop offers for the item, as read from its page."""

    model_config = ConfigDict(extra="forbid")

    label: SizeLabel
    # False when the shop shows it as sold out; None when the page doesn't say.
    available: bool | None = None


class ChartRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float = Field(ge=0, le=500)
    max: float = Field(ge=0, le=500)


class ChartSize(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: SizeLabel
    ranges: dict[ChartField, ChartRange]


class SizeChart(BaseModel):
    """The shop's body-measurement size chart for the item, in cm and kg."""

    model_config = ConfigDict(extra="forbid")

    basis: Literal["body", "unknown"]
    fields: list[ChartField] = Field(max_length=10)
    sizes: list[ChartSize] = Field(min_length=1, max_length=40)


class SavedItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: PageUrl
    title: PageTitle | None = None
    # Guessed from the title and URL when omitted.
    category: Category | None = None
    image_url: ImageUrl | None = None
    sizes: list[StoreSize] | None = Field(default=None, max_length=40)
    size_chart: SizeChart | None = None


class SavedItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category


class SavedItem(BaseModel):
    id: UUID
    url: str
    title: str | None
    category: Category
    image_url: str | None
    sizes: list[StoreSize] | None
    size_chart: SizeChart | None
    created_at: datetime


class SavedItemPage(BaseModel):
    items: list[SavedItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
