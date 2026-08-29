from concurrent.futures import ThreadPoolExecutor
import threading

from backend import main


def _payload(values=(72, 78, 75)):
    return {
        "category": "recovery",
        "metric": "deepSleep",
        "range": "30D",
        "asOfDate": "2026-08-29",
        "points": [
            {"date": f"2026-08-{index + 20:02d}", "value": value}
            for index, value in enumerate(values)
        ],
    }


def test_trend_summary_uses_sol_and_frames_deep_sleep_as_a_personal_wearable_trend(
    client,
    monkeypatch,
):
    calls = []
    provider_config = {}

    class FakeProvider:
        def generate(self, prompt: str) -> str:
            calls.append(prompt)
            return (
                "Your deep-sleep estimate is steady across the selected range. "
                "Prioritize total sleep and the multi-night pattern rather than chasing one stage target."
            )

    def fake_get_coach_provider(**kwargs):
        provider_config.update(kwargs)
        return FakeProvider()

    monkeypatch.setattr(main, "get_coach_provider", fake_get_coach_provider)

    response = client.post("/coach/trend-summary", json=_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["summary"].startswith("Your deep-sleep estimate")
    assert body["cached"] is False
    assert body["model"] == "gpt-5.6-sol"
    assert body["generatedAt"]
    assert provider_config == {
        "model_env_var": "GAINLOG_TREND_SUMMARY_MODEL",
        "default_model": "gpt-5.6-sol",
        "allow_fallback": False,
        "provider_override": "luna-proxy",
        "model_override": "gpt-5.6-sol",
    }

    prompt = calls[0]
    assert "Deep Sleep" in prompt
    assert "no rigid universal deep-sleep target" in prompt
    assert "consumer wearable" in prompt
    assert "7 or more hours" in prompt
    assert "one or two sentences" in prompt
    assert '"value": 72.0' in prompt
    assert "Do not diagnose" in prompt


def test_trend_summary_reuses_cache_until_the_underlying_data_changes(client, monkeypatch):
    prompts = []

    class FakeProvider:
        def generate(self, prompt: str) -> str:
            prompts.append(prompt)
            return f"Summary number {len(prompts)}. Keep watching the multi-day direction."

    monkeypatch.setattr(main, "get_coach_provider", lambda **_: FakeProvider())

    first = client.post("/coach/trend-summary", json=_payload())
    cached = client.post("/coach/trend-summary", json=_payload())
    changed = client.post("/coach/trend-summary", json=_payload((72, 78, 82)))

    assert first.status_code == cached.status_code == changed.status_code == 200
    assert first.json()["cached"] is False
    assert cached.json()["cached"] is True
    assert cached.json()["summary"] == first.json()["summary"]
    assert changed.json()["cached"] is False
    assert changed.json()["summary"].startswith("Summary number 2")
    assert len(prompts) == 2
    with main.Session(main.engine) as db:
        rows = db.exec(main.select(main.TrendSummaryDB)).all()
        assert len(rows) == 2
        assert len({row.data_hash for row in rows}) == 2


def test_trend_summary_rejects_unknown_metrics_and_insufficient_points(client):
    unknown = _payload()
    unknown["metric"] = "readinessScore"
    sparse = _payload((72,))

    assert client.post("/coach/trend-summary", json=unknown).status_code == 422
    response = client.post("/coach/trend-summary", json=sparse)
    assert response.status_code == 422
    assert "at least 2" in response.text


def test_trend_summary_limits_model_output_to_two_plain_sentences(client, monkeypatch):
    class FakeProvider:
        def generate(self, _: str) -> str:
            return "**First finding.** Second action. Third sentence should not survive."

    monkeypatch.setattr(main, "get_coach_provider", lambda **_: FakeProvider())

    response = client.post("/coach/trend-summary", json=_payload())

    assert response.status_code == 200
    assert response.json()["summary"] == "First finding. Second action."


def test_trend_summary_sentence_limit_preserves_decimal_measurements(client, monkeypatch):
    class FakeProvider:
        def generate(self, _: str) -> str:
            return (
                "Weight declined from 200.5 lb to 198.5 lb across the selected range. "
                "Keep watching the weekly average. Third sentence must be removed."
            )

    monkeypatch.setattr(main, "get_coach_provider", lambda **_: FakeProvider())

    response = client.post("/coach/trend-summary", json=_payload())

    assert response.status_code == 200
    assert response.json()["summary"] == (
        "Weight declined from 200.5 lb to 198.5 lb across the selected range. "
        "Keep watching the weekly average."
    )


def test_concurrent_identical_trend_requests_share_one_cache_row(client, monkeypatch):
    barrier = threading.Barrier(2)

    class FakeProvider:
        def generate(self, _: str) -> str:
            barrier.wait(timeout=5)
            return "The selected pattern is stable. Keep watching the multi-day direction."

    monkeypatch.setattr(main, "get_coach_provider", lambda **_: FakeProvider())

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post("/coach/trend-summary", json=_payload()), range(2)))

    assert [response.status_code for response in responses] == [200, 200]
    with main.Session(main.engine) as db:
        assert len(db.exec(main.select(main.TrendSummaryDB)).all()) == 1
