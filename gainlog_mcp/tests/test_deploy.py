from __future__ import annotations

from pathlib import Path
import subprocess


DEPLOY = Path(__file__).parents[1] / "deploy"


def read(name: str) -> str:
    return (DEPLOY / name).read_text()


def test_units_encode_three_identity_boundary_and_no_public_listener():
    exporter = read("gainlog-mcp-export.service")
    reader = read("gainlog-mcp-reader@.service")
    socket = read("gainlog-mcp-reader.socket")
    tunnel = read("gainlog-mcp-tunnel.service")
    config = read("tunnel.yaml.example")

    assert "User=gainlog\n" in exporter
    assert "PrivateNetwork=yes" in exporter
    assert "TemporaryFileSystem=/run:ro" in exporter
    assert "ReadOnlyPaths=/opt/gainlog/backend-git/data" in exporter
    assert "ReadWritePaths=/var/lib/gainlog-mcp" in exporter

    assert "User=gainlog-mcp-reader" in reader
    assert "PrivateNetwork=yes" in reader
    assert "IPAddressDeny=any" in reader
    assert "TemporaryFileSystem=/run:ro /var:ro /etc:ro" in reader
    assert "BindReadOnlyPaths=/var/lib/gainlog-mcp" in reader
    assert "StandardInput=socket" in reader

    assert "Accept=yes" in socket
    assert "SocketGroup=gainlog-mcp-tunnel" in socket
    assert "SocketMode=0660" in socket
    assert "ListenStream=/run/gainlog-mcp/mcp.sock" in socket

    assert "User=gainlog-mcp-tunnel" in tunnel
    assert "LoadCredential=openai-key:/etc/gainlog-mcp/openai-runtime-key" in tunnel
    assert "Restart=always" in tunnel
    assert "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" in tunnel
    assert "TemporaryFileSystem=/run" in tunnel
    assert "BindReadOnlyPaths=/run/gainlog-mcp" in tunnel
    assert "BindReadOnlyPaths=/etc/gainlog-mcp/resolv.conf:/etc/resolv.conf" in tunnel
    for denied_range in (
        "127.0.0.0/8", "::1/128", "169.254.0.0/16", "fe80::/10",
        "224.0.0.0/4", "ff00::/8", "10.0.0.0/8", "172.16.0.0/12",
        "192.168.0.0/16", "fc00::/7", "100.64.0.0/10",
    ):
        assert f"IPAddressDeny={denied_range}" in tunnel

    assert "unix_socket:" in config
    assert "listen_addr:" not in config
    assert "stdio_send_initialized_notification: true" in config
    assert "capture_payloads" not in config
    assert "harpoon" not in config.lower()
    assert "REPLACE_WITH_SEPARATE_GAINLOG_TUNNEL_ID" in config
    assert "sk-" not in config


def test_runbook_installs_dependencies_permissions_and_orders_recoverable_hardening():
    runbook = read("README.md")

    assert "uv 0.12.10" in runbook
    assert "173d95a0c32d18c896c46ba6fafbf3cf9c14ab74b033f81b76c883ef492a976b" in runbook
    assert "socat=1.8.0.0-4ubuntu0.1" in runbook
    assert "46e854289b6b1c97e28be5d9293bea61e8633d00d6a65d9513f019c7232696fe" in runbook
    assert "root -g gainlog-mcp-tunnel -m 0750 /etc/gainlog-mcp" in runbook
    assert "root -g gainlog-mcp-tunnel -m 0640" in runbook
    assert "runuser -u gainlog-mcp-tunnel -- test -r /etc/gainlog-mcp/tunnel.yaml" in runbook

    install_drop_in = runbook.index("20-private-data.conf /etc/systemd/system/gainlog.service.d/20-private-data.conf")
    daemon_reload = runbook.index("systemctl daemon-reload", install_drop_in)
    restart = runbook.index("systemctl restart gainlog", daemon_reload)
    verify_umask = runbook.index("test \"$(systemctl show gainlog -p UMask --value)\" = 0077", restart)
    harden_database = runbook.index("chmod 0640 /opt/gainlog/backend-git/data/gainlog.db", verify_umask)
    assert install_drop_in < daemon_reload < restart < verify_umask < harden_database
    assert "rollback-state" in runbook
    assert "restore only paths recorded as present" in runbook


def test_systemd_units_parse_cleanly():
    units = [
        DEPLOY / "gainlog-mcp-export.service",
        DEPLOY / "gainlog-mcp-export.timer",
        DEPLOY / "gainlog-mcp-reader.socket",
        DEPLOY / "gainlog-mcp-reader@.service",
        DEPLOY / "gainlog-mcp-tunnel.service",
    ]
    result = subprocess.run(
        ["systemd-analyze", "verify", *map(str, units)],
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
