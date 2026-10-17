from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AccountSettings(BaseModel):
    active_profile_id: UUID | None


class AccountSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_profile_id: UUID | None
