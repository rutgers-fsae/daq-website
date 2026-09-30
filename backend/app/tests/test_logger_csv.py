import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    "content,time_column,channel,unit,text_column",
    [
        (
            "received_utc,elapsed_s,airspeed_m_s,pressure_pa,reading_state,source_line\n"
            '2026-09-30T03:20:50+00:00,0,2,20,valid,"D,1,2,3,0,100,0"\n'
            '2026-09-30T03:20:51+00:00,1,,20,sensor_error,"F,2,3,0,100,0"\n',
            "received_utc",
            "airspeed_m_s",
            "m/s",
            "reading_state",
        ),
        (
            "timestamp,startup_ns,yaw,pressure_pa,event_timestamp,event_type,event_note\n"
            "2026-07-31T21:56:45-04:00,375002507000,2,101.5,,,\n"
            '2026-07-31T21:56:46-04:00,375102507000,,101.5,2026-08-01T01:56:46Z,Cone,"Turn, left"\n',
            "timestamp",
            "yaw",
            "deg",
            "event_type",
        ),
    ],
)
def test_logger_upload_schema_preview_chart_filter_and_download(
    content, time_column, channel, unit, text_column
):
    uploaded = client.post(
        "/api/upload",
        headers={"Authorization": f"Bearer {settings.upload_password}"},
        files={"file": ("logger.csv", content, "text/csv")},
    )
    assert uploaded.status_code == 200
    base = f"/api/datasets/{uploaded.json()['slug']}"
    schema = client.get(f"{base}/schema").json()
    columns = {column["name"]: column for column in schema["columns"]}
    assert schema["row_count"] == 2
    assert columns[time_column]["type"] == "datetime"
    assert columns[channel]["unit"] == unit
    assert columns[text_column]["type"] == "categorical"
    assert columns["pressure_pa"]["unit"] == (
        "Pa" if channel == "airspeed_m_s" else "kPa"
    )
    preview = client.post(f"{base}/preview", json={"filters": [], "limit": 2})
    assert preview.status_code == 200
    assert preview.json()["rows"][1][channel] is None
    chart = {
        "chart_type": "line",
        "x_column": time_column,
        "y_columns": [channel],
        "filters": [],
    }
    response = client.post(f"{base}/chart-data", json=chart)
    assert response.status_code == 200
    assert response.json()["data"][0]["y"] == [2, None]
    first = preview.json()["rows"][0][time_column]
    filters = [{"column": time_column, "op": "lte", "value": first}]
    response = client.post(f"{base}/chart-data", json={**chart, "filters": filters})
    assert response.status_code == 200
    assert response.json()["source_row_count"] == 1
    response = client.post(f"{base}/preview", json={"filters": filters})
    assert response.status_code == 200
    assert response.json()["row_count"] == 1
    response = client.post(f"{base}/download", json={"filters": filters})
    assert response.status_code == 200
    assert len(response.text.splitlines()) == 2

    response = client.post(
        f"{base}/chart-data",
        json={
            **chart,
            "filters": [{"column": time_column, "op": "gte", "value": "invalid"}],
        },
    )
    assert response.status_code == 400
