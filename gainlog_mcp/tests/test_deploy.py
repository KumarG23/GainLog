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

    assert "unix_socket:" in config
    assert "listen_addr:" not in config
    assert "stdio_send_initialized_notification: true" in config
    assert "capture_payloads" not in config
    assert "harpoon" not in config.lower()
    assert "REPLACE_WITH_SEPARATE_GAINLOG_TUNNEL_ID" in config
    assert "sk-" not in config


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
