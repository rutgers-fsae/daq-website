import re
from pathlib import Path

from fastapi import APIRouter, Depends, Response

from app.config import settings
from app.core.auth import require_upload_password
from app.core.errors import bad_request
from app.models.chart import ChartRequest, ExportRequest, PreviewRequest
from app.models.dataset import DatasetListItem, DatasetMetadata, DatasetRecord
from app.services.chart_builder import build_chart_payload
from app.services.csv_reader import (
    apply_filters,
    read_dataset,
    read_dataset_preview,
    read_dataset_sample_with_units,
)
from app.services.dataset_registry import registry
from app.services.schema_inference import infer_schema

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetListItem])
def list_datasets() -> list[DatasetListItem]:
    registry.ensure_initial_data_registered()
    return [
        DatasetListItem(
            slug=item.slug,
            title=item.title,
            filename=item.filename,
            uploaded_at=item.uploaded_at,
            size_bytes=item.size_bytes,
            metadata=item.metadata,
        )
        for item in registry.list()
    ]


@router.get("/{slug}", response_model=DatasetRecord)
def get_dataset(slug: str) -> DatasetRecord:
    return registry.get(slug)


@router.patch("/{slug}/metadata", response_model=DatasetRecord)
def update_dataset_metadata(
    slug: str,
    metadata: DatasetMetadata,
    _: None = Depends(require_upload_password),
) -> DatasetRecord:
    return registry.update_metadata(slug, metadata)


@router.get("/{slug}/schema")
def get_dataset_schema(slug: str) -> dict:
    df, units, row_count = read_dataset_sample_with_units(slug)
    return {"columns": infer_schema(df, units), "row_count": row_count}


@router.post("/{slug}/preview")
def preview_dataset(slug: str, payload: PreviewRequest) -> dict:
    limit = payload.limit or settings.max_preview_rows
    filters = [rule.model_dump() for rule in payload.filters]
    if not filters:
        records, row_count = read_dataset_preview(slug, limit)
        return {"rows": records.to_dict(orient="records"), "row_count": row_count}

    df = read_dataset(slug)
    filtered = apply_filters(df, filters)
    records = filtered.head(limit).to_dict(orient="records")
    return {"rows": records, "row_count": len(filtered)}


@router.post("/{slug}/chart-data")
def chart_data(slug: str, payload: ChartRequest) -> dict:
    filters = [rule.model_dump() for rule in payload.filters]
    requested_columns = _columns_for_chart(payload, filters)
    df = read_dataset(slug, requested_columns)
    _validate_requested_columns(df.columns, requested_columns)
    filtered = apply_filters(df, filters)
    return build_chart_payload(filtered, payload.chart_type, payload.x_column, payload.y_columns, payload.group_by)


@router.get("/{slug}/download")
def download_dataset(slug: str) -> Response:
    return _download_dataset(slug, [], None)


@router.post("/{slug}/download")
def download_filtered_dataset(slug: str, payload: ExportRequest) -> Response:
    return _download_dataset(slug, [rule.model_dump() for rule in payload.filters], payload.columns)


def _download_dataset(slug: str, filters: list[dict], columns: list[str] | None) -> Response:
    record = registry.get(slug)
    df = read_dataset(slug)
    _validate_filter_columns(df.columns, filters)
    _validate_requested_columns(df.columns, set(columns) if columns is not None else None)
    if filters:
        df = apply_filters(df, filters)
    if columns is not None:
        df = df.loc[:, [column for column in df.columns if column in set(columns)]]
    suffix = "filtered-parsed" if filters else "parsed"
    filename = _download_filename(record.original_name or record.filename, suffix)
    return Response(
        content=df.to_csv(index=False),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _download_filename(source_name: str, suffix: str) -> str:
    stem = Path(source_name).stem or "dataset"
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-") or "dataset"
    return f"{safe_stem}-{suffix}.csv"


def _columns_for_chart(payload: ChartRequest, filters: list[dict]) -> set[str] | None:
    columns = set(payload.y_columns)
    if payload.x_column:
        columns.add(payload.x_column)
    if payload.group_by:
        columns.add(payload.group_by)
    for rule in filters:
        column = rule.get("column")
        if isinstance(column, str):
            columns.add(column)
    return columns or None


def _validate_requested_columns(available_columns, requested_columns: set[str] | None) -> None:
    if not requested_columns:
        return
    missing = sorted(requested_columns - set(available_columns))
    if missing:
        raise bad_request(f"Unknown dataset columns: {', '.join(missing)}")


def _validate_filter_columns(available_columns, filters: list[dict]) -> None:
    available = set(available_columns)
    missing = sorted(
        {
            column
            for rule in filters
            if isinstance((column := rule.get("column")), str) and column not in available
        }
    )
    if missing:
        raise bad_request(f"Unknown dataset columns: {', '.join(missing)}")
