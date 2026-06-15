"""Pydantic models matching the Luminascent import schema."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from utils import slugify


WAX_TYPES = frozenset({
    "soy", "paraffin", "beeswax", "coconut", "rapeseed", "palm",
    "vegetable wax", "gel", "mineral wax", "stearin", "bayberry",
    "carnauba", "tallow", "apricot", "ceresin", "coconut-soy",
    "coconut-rapeseed", "soy blend", "blend", "other",
})


class PyramidStage(str, Enum):
    top = "top"
    middle = "middle"
    base = "base"
    general = "general"
    unknown = "unknown"


class ProductSize(BaseModel):
    size_value: float | None = None
    size_unit: str | None = None
    size_grams: int | None = None
    price_amount: int | None = None
    price_currency: str | None = None
    burn_time_hours: int | None = None
    sku: str | None = None
    availability: str | None = None
    source_url: str | None = None
    is_primary: bool = False


class ProductImage(BaseModel):
    source_url: str
    position: int = 0
    is_primary: bool = False


class ProductNote(BaseModel):
    note_slug: str | None = None
    name: str
    pyramid_stage: PyramidStage = PyramidStage.unknown
    color: str | None = None
    color_gradient: str | None = None

    @model_validator(mode="after")
    def fill_slug(self) -> ProductNote:
        if not self.note_slug and self.name:
            self.note_slug = slugify(self.name)
        return self


class ProductAccord(BaseModel):
    accord_slug: str | None = None
    name: str
    color: str | None = None
    color_gradient: str | None = None

    @model_validator(mode="after")
    def fill_slug(self) -> ProductAccord:
        if not self.accord_slug and self.name:
            self.accord_slug = slugify(self.name)
        return self


class CandleProduct(BaseModel):
    source_url: str
    category_slug: str = "candle"
    brand_name: str | None = None
    brand_slug: str | None = None
    name: str
    slug: str | None = None
    description: str | None = None
    scent_summary: str | None = None
    release_year: int | None = None
    wax_type: str | None = None
    vessel_material: str | None = None
    is_discontinued: bool = False
    sizes: list[ProductSize] = Field(default_factory=list)
    images: list[ProductImage] = Field(default_factory=list)
    notes: list[ProductNote] = Field(default_factory=list)
    accords: list[ProductAccord] = Field(default_factory=list)

    @field_validator("wax_type")
    @classmethod
    def normalize_wax(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value in WAX_TYPES:
            return value
        return "other"

    @model_validator(mode="after")
    def fill_slugs_and_defaults(self) -> CandleProduct:
        if self.brand_name and not self.brand_slug:
            self.brand_slug = slugify(self.brand_name)
        if self.name and not self.slug:
            self.slug = slugify(self.name)
        if self.sizes and not any(s.is_primary for s in self.sizes):
            self.sizes[0].is_primary = True
        if self.images and not any(i.is_primary for i in self.images):
            self.images[0].is_primary = True
        return self

    def to_import_record(self, *, provenance: dict[str, bool] | None = None) -> dict[str, Any]:
        data = self.model_dump(mode="json")
        data["_provenance"] = provenance or {"llm": True}
        return data


def parse_extracted_product(
    raw: dict[str, Any] | list[Any],
    *,
    source_url: str,
    brand_name: str | None = None,
    brand_slug: str | None = None,
) -> CandleProduct | None:
    if isinstance(raw, list):
        if not raw:
            return None
        raw = raw[0]
    if not isinstance(raw, dict):
        return None

    payload = dict(raw)
    payload.setdefault("source_url", source_url)
    if brand_name and not payload.get("brand_name"):
        payload["brand_name"] = brand_name
    if brand_slug and not payload.get("brand_slug"):
        payload["brand_slug"] = brand_slug
    if not payload.get("name"):
        return None

    return CandleProduct.model_validate(payload)
