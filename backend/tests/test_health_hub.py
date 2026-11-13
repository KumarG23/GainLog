from datetime import datetime, timezone

import pytest
from sqlmodel import Session

from backend.health_hub import HEADERS, local_date, project, sync


class FakeSheets:
    def __init__(self):
        self.tabs = {name: [] for name in HEADERS}
        self.writes = []

    def metadata(self, sheet_id):
        assert sheet_id == "private-sheet"
        return {"sheets": [{"properties": {"title": name}} for name in self.tabs]}

    def read(self, sheet_id, tab):
        return [list(row) for row in self.tabs[tab]]

    def write(self, sheet_id, tab, start, values):
        self.writes.append((tab, start))
        while len(self.tabs[tab]) < start + len(values) - 1:
            self.tabs[tab].append([])
        for i, row in enumerate(values, start):
            self.tabs[tab][i - 1] = list(row)


def test_personal_oauth_credential_is_rejected(tmp_path):
    from backend.health_hub import SheetsClient
    path = tmp_path / "personal.json"
    path.write_text('{"type":"authorized_user","refresh_token":"synthetic"}')
    with pytest.raises(ValueError, match="service-account"):
        SheetsClient(str(path))


def test_systemd_job_is_opt_in_and_scoped():
    from pathlib import Path
    directory = Path(__file__).resolve().parents[1]
    unit = (directory / "gainlog-health-hub.service").read_text()
    timer = (directory / "gainlog-health-hub.timer").read_text()
    assert "User=gainlog" in unit and "EnvironmentFile=/etc/gainlog-health-hub.env" in unit
    assert "ExecStart=/opt/gainlog/venv-new/bin/python -m health_hub" in unit
    assert "ProtectHome=true" in unit and "NoNewPrivileges=true" in unit
    assert "03:30:00 America/New_York" in timer and "Persistent=true" in timer


def test_eastern_boundary_and_dst():
    assert local_date("2026-11-16T03:30:00Z") == "2026-11-15"
    assert local_date("2026-03-08T04:30:00Z") == "2026-03-07"
    assert local_date("2026-03-08T08:30:00Z") == "2026-03-08"
    with pytest.raises(ValueError, match="offset"):
        local_date("2026-11-16T03:30:00")


def test_source_projection_real_models_and_missing_is_blank(client):
    from backend.main import engine, AppleHealthDailyDB, BodyWeightEntryDB, NutritionEntryDB, WorkoutSessionDB, ExerciseDB, WorkoutSetDB
    with Session(engine) as db:
        db.add(AppleHealthDailyDB(date="2026-11-15", sleep_minutes=0, steps=8000, updated_at="2026-11-16T00:00:00Z"))
        db.add(BodyWeightEntryDB(id="weight", date="2026-11-15", weight_lbs=180.2))
        db.add(NutritionEntryDB(id="meal1", date="2026-11-15", meal="dinner", name="test", calories=420, protein_g=35))
        db.add(NutritionEntryDB(id="meal2", date="2026-11-15", meal="breakfast", name="test", calories=200, protein_g=20))
        db.add(WorkoutSessionDB(id="workout", date="2026-11-16T03:30:00Z", duration_minutes=50, cardio_duration_minutes=20, cardio_analysis_json='{"windowSource":"recorded","zone2Minutes":12.5,"protocolCompliant":true,"benchmarkCoverage":1,"benchmarkAverageHr":117}'))
        db.add(ExerciseDB(id="exercise", session_id="workout", name="Hang"))
        db.add(WorkoutSetDB(id="set", exercise_id="exercise", reps=0, weight=0, measure="seconds", seconds=40))
        db.commit()
        rows = project(db)
    daily = rows["Daily"][0]
    assert daily[0] == "2026-11-15"
    assert daily[1] == 180.2 and daily[5] == 0 and daily[8] == 8000
    assert daily[6] == "" and daily[14] == "" and daily[23] == "" and daily[24] == ""
    assert daily[13] == 12.5 and daily[16] == 620 and daily[17] == 55
    assert rows["Exercise Sets"][0][-1] == "seconds"
    assert rows["Exercise Sets"][0][7] == "" and rows["Exercise Sets"][0][9] == 40
    assert rows["Benchmarks"][0][2] == 117
    assert rows["Weekly"][0][0] == "2026-11-09"


def test_idempotent_upsert_preserves_history_and_manual_labs(client):
    from backend.main import engine, AppleHealthDailyDB
    sheets = FakeSheets()
    sheets.tabs["Labs"] = [HEADERS["Labs"], ["2026-01-01", "Private marker", "value"]]
    with Session(engine) as db:
        db.add(AppleHealthDailyDB(date="2026-11-15", steps=100, updated_at="2026-11-15T00:00:00Z"))
        db.commit()
        first = sync(db, sheets, "private-sheet", datetime(2026, 11, 16, tzinfo=timezone.utc))
        assert first["Daily"] == 1
        baseline = len(sheets.writes)
        sync(db, sheets, "private-sheet", datetime(2026, 11, 16, tzinfo=timezone.utc))
        assert len(sheets.writes) == baseline + 1  # README freshness only
        record = db.get(AppleHealthDailyDB, "2026-11-15")
        record.steps = 200
        db.add(record)
        db.commit()
        sync(db, sheets, "private-sheet")
    assert len(sheets.tabs["Daily"]) == 2
    assert sheets.tabs["Daily"][1][8] == 200
    assert sheets.tabs["Labs"][1] == ["2026-01-01", "Private marker", "value"]
    assert sheets.tabs["README"][1][0] == "Last successful sync (Eastern)"


def test_readback_failure_does_not_advance_freshness(client):
    from backend.main import engine, AppleHealthDailyDB
    class DroppingSheets(FakeSheets):
        def read(self, sheet_id, tab):
            values = super().read(sheet_id, tab)
            return values[:1] if tab == "Daily" and len(values) > 1 else values
    sheets = DroppingSheets()
    with Session(engine) as db:
        db.add(AppleHealthDailyDB(date="2026-11-15", steps=100, updated_at="2026-11-15T00:00:00Z"))
        db.commit()
        with pytest.raises(RuntimeError, match="readback missing"):
            sync(db, sheets, "private-sheet")
    assert sheets.tabs["README"] == []


def test_schema_drift_duplicate_keys_and_missing_tab_fail_closed(client):
    from backend.main import engine
    sheets = FakeSheets()
    with Session(engine) as db:
        sheets.tabs["Daily"] = [["bad header"]]
        with pytest.raises(ValueError, match="header mismatch"):
            sync(db, sheets, "private-sheet")
        sheets.tabs["Daily"] = [HEADERS["Daily"], ["2026-11-15"], ["2026-11-15"]]
        with pytest.raises(ValueError, match="duplicate"):
            sync(db, sheets, "private-sheet")
        del sheets.tabs["BP"]
        with pytest.raises(ValueError, match="missing Health Hub tabs"):
            sync(db, sheets, "private-sheet")
