from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.dataset_registry import registry
from app.services import csv_reader
from app.services.csv_reader import _read_motec_csv, read_dataset


client = TestClient(app)


def test_datasets_list_works():
    response = client.get("/api/datasets")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_motec_reader_supports_selected_columns(tmp_path):
    csv_path = tmp_path / "motec.csv"
    csv_path.write_text(
        '\n'.join(
            [
                '"Format","MoTeC CSV File"',
                '"Sample Rate","500.000","Hz"',
                '',
                '"Time","Battery Temp","Motor Speed"',
                '"s","C","rpm"',
                '',
                '"0.000","18.0","0"',
                '"0.002","18.1","10"',
            ]
        ),
        encoding="utf-8",
    )

    frame, units = _read_motec_csv(csv_path, {"Time", "Motor Speed"})

    assert frame.columns.tolist() == ["Time", "Motor Speed"]
    assert frame.to_dict(orient="records") == [
        {"Time": 0.0, "Motor Speed": 0},
        {"Time": 0.002, "Motor Speed": 10},
    ]
    assert units == {"Time": "s", "Motor Speed": "rpm"}


def test_chart_data_rejects_missing_columns():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/chart-data",
        json={"chart_type": "line", "x_column": "Time", "y_columns": ["Missing"], "filters": []},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown dataset columns: Missing"


def test_schema_uses_limited_sample_read(monkeypatch):
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n2,30\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)
    original_read_regular_csv = csv_reader._read_regular_csv
    sample_reads = []

    def spy_read_regular_csv(path, columns=None, nrows=None):
        sample_reads.append(nrows)
        return original_read_regular_csv(path, columns, nrows)

    monkeypatch.setattr(csv_reader, "_read_regular_csv", spy_read_regular_csv)

    response = client.get(f"/api/datasets/{record.slug}/schema")

    assert response.status_code == 200
    assert response.json()["row_count"] == 3
    assert sample_reads[0] == 100


def test_unfiltered_preview_avoids_full_dataset_read(monkeypatch):
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n2,30\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    def fail_full_read(*args, **kwargs):
        raise AssertionError("preview should not use full dataset read without filters")

    monkeypatch.setattr("app.api.routes.datasets.read_dataset", fail_full_read)

    response = client.post(f"/api/datasets/{record.slug}/preview", json={"filters": [], "limit": 2})

    assert response.status_code == 200
    assert response.json() == {
        "rows": [{"Time": 0, "Speed": 10}, {"Time": 1, "Speed": 20}],
        "row_count": 3,
    }


def test_selected_column_read_uses_parquet_sidecar(monkeypatch):
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    full = read_dataset(record.slug)

    assert full.columns.tolist() == ["Time", "Speed"]
    assert csv_path.with_suffix(".csv.parquet").exists()

    def fail_csv_read(*args, **kwargs):
        raise AssertionError("selected-column read should use parquet sidecar")

    monkeypatch.setattr(csv_reader, "_read_regular_csv", fail_csv_read)

    selected = read_dataset(record.slug, {"Speed"})

    assert selected.columns.tolist() == ["Speed"]
    assert selected.to_dict(orient="records") == [{"Speed": 10}, {"Speed": 20}]


def test_preview_rejects_limit_above_configured_max():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/preview",
        json={"filters": [], "limit": settings.max_preview_rows + 1},
    )

    assert response.status_code == 422


def test_download_returns_parsed_csv_without_auth():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size, original_name="Track Day.csv")

    response = client.get(f"/api/datasets/{record.slug}/download")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="Track-Day-parsed.csv"'
    assert response.text == "Time,Speed\n0,10\n1,20\n"


def test_download_motec_csv_returns_parsed_table():
    csv_path = settings.data_dir / "motec.csv"
    csv_path.write_text(
        '\n'.join(
            [
                '"Format","MoTeC CSV File"',
                '"Sample Rate","500.000","Hz"',
                '',
                '"Time","Battery Temp","Motor Speed"',
                '"s","C","rpm"',
                '',
                '"0.000","18.0","0"',
                '"0.002","18.1","10"',
            ]
        ),
        encoding="utf-8",
    )
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.get(f"/api/datasets/{record.slug}/download")

    assert response.status_code == 200
    assert response.text == "Time,Battery Temp,Motor Speed\n0.0,18.0,0\n0.002,18.1,10\n"


def test_filtered_download_applies_export_filters():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed,Driver\n0,10,Ada\n1,20,Bea\n2,30,Ada\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/download",
        json={"filters": [{"column": "Driver", "op": "eq", "value": "Ada"}, {"column": "Speed", "op": "gte", "value": 30}]},
    )

    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="sample-filtered-parsed.csv"'
    assert response.text == "Time,Speed,Driver\n2,30,Ada\n"


def test_filtered_download_limits_selected_columns_in_dataset_order():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed,Driver\n0,10,Ada\n1,20,Bea\n2,30,Ada\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/download",
        json={"columns": ["Driver", "Time"], "filters": [{"column": "Speed", "op": "gte", "value": 20}]},
    )

    assert response.status_code == 200
    assert response.text == "Time,Driver\n1,Bea\n2,Ada\n"


def test_filtered_download_rejects_unknown_filter_columns():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/download",
        json={"filters": [{"column": "Missing", "op": "eq", "value": "x"}]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown dataset columns: Missing"


def test_filtered_download_rejects_unknown_selected_columns():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/download",
        json={"columns": ["Time", "Missing"], "filters": []},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown dataset columns: Missing"


def test_filtered_download_rejects_empty_selected_columns():
    csv_path = settings.data_dir / "sample.csv"
    csv_path.write_text("Time,Speed\n0,10\n1,20\n", encoding="utf-8")
    record = registry.register(csv_path.name, csv_path.stat().st_size)

    response = client.post(
        f"/api/datasets/{record.slug}/download",
        json={"columns": [], "filters": []},
    )

    assert response.status_code == 422
