def test_browser_origin_cannot_write_apple_health_imports(client):
    for path in (
        "/body-weight/import",
        "/apple-health/daily/import",
        "/apple-health/auto-export",
    ):
        response = client.post(
            path,
            headers={"Origin": "https://evil.example"},
            json={},
        )

        assert response.status_code == 403, path


def test_cors_allows_gainlog_frontend_but_not_arbitrary_sites(client):
    allowed = client.options(
        "/dashboard/summary?date=2026-07-31",
        headers={
            "Origin": "https://gainlog-frontend.tailc88c35.ts.net",
            "Access-Control-Request-Method": "GET",
        },
    )
    denied = client.options(
        "/dashboard/summary?date=2026-07-31",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == (
        "https://gainlog-frontend.tailc88c35.ts.net"
    )
    assert "access-control-allow-origin" not in denied.headers
