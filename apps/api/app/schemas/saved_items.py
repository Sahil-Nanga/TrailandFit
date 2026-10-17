from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, StringConstraints, UrlConstraints

# Web pages only: no javascript:, data:, file: or extension URLs.
PageUrl = Annotated[AnyUrl, UrlConstraints(max_length=2048, allowed_schemes=["http", "https"])]
PageTitle = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class SavedItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: PageUrl
    title: PageTitle | None = None


class SavedItem(BaseModel):
    id: UUID
    url: str
    title: str | None
    created_at: datetime


class SavedItemPage(BaseModel):
    items: list[SavedItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
