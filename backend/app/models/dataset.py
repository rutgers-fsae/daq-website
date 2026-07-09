from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class DatasetMetadata(BaseModel):
    driver: str = ""
    ride_height: float | None = None
    aero_configuration: str = ""
    testing_notes: str = ""

    @field_validator("ride_height")
    @classmethod
    def round_ride_height(cls, value: float | None) -> float | None:
        if value is None:
            return None
        return round(value, 2)


class DatasetRecord(BaseModel):
    slug: str
    filename: str
    original_name: str
    title: str
    uploaded_at: datetime
    size_bytes: int
    metadata: DatasetMetadata = Field(default_factory=DatasetMetadata)


class DatasetListItem(BaseModel):
    slug: str
    title: str
    filename: str
    uploaded_at: datetime
    size_bytes: int
    metadata: DatasetMetadata = Field(default_factory=DatasetMetadata)
