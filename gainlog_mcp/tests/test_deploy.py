from __future__ import annotations

from pathlib import Path
import subprocess


DEPLOY = Path(__file__).parents[1] / "deploy"


def read(name: str) -> str:
    return (DEPLOY / name).read_text()


def test_split_units_keep_source_acquisition_reader_and_tunnel_separate():
    exporter = read("gainlog-mcp-export.service")
    source_proxy = read("gainlog-mcp-source-proxy.service")
    acquisition = read("gainlog-mcp-acquire.service")
    reader = read("gainlog-mcp-reader@.service")
    socket = read("gainlog-mcp-reader.socket")
    tunnel = read("gainlog-mcp-tunnel.service")

    assert "User=gainlog\n" in exporter
    assert "PrivateNetwork=yes" in exporter
    assert "--destination /var/lib/gainlog-mcp-source/projection.db" in exporter
    assert "ReadOnlyPaths=/opt/gainlog/backend-git/data" in exporter
    assert "ReadWritePaths=/var/lib/gainlog-mcp-source" in exporter

    assert "systemd-socket-proxyd 100.80.191.75:22" in source_proxy
    assert "IPAddressDeny=any" in source_proxy
    assert "IPAddressAllow=100.80.191.75/32" in source_proxy
    assert "SocketBindDeny=any" in source_proxy
    assert "SystemCallFilter=~bind" in source_proxy

    assert "User=gainlog-mcp-acquire" in acquisition
    assert "LoadCredential=source-key:/etc/gainlog-mcp-acquire/id_ed25519" in acquisition
    assert "PrivateNetwork=yes" in acquisition
    assert "RestrictAddressFamilies=AF_UNIX" in acquisition
    assert "BindReadOnlyPaths=/run/gainlog-mcp-source-proxy" in acquisition
    assert "ReadOnlyPaths=/etc/gainlog-mcp-acquire" in acquisition
    assert "ReadWritePaths=/var/lib/gainlog-mcp" in acquisition
    assert "InaccessiblePaths=-/etc/gainlog-mcp -/run/gainlog-mcp" in acquisition

    assert "User=gainlog-mcp-reader" in reader
    assert "PrivateNetwork=yes" in reader
    assert "IPAddressDeny=any" in reader
    assert "TemporaryFileSystem=/run:ro /var:ro /etc:ro" in reader
    assert "BindReadOnlyPaths=/var/lib/gainlog-mcp" in reader
    assert "/etc/gainlog-mcp-acquire" in reader
    assert "StandardInput=socket" in reader

    assert "Accept=yes" in socket
    assert "SocketGroup=gainlog-mcp-tunnel" in socket
    assert "SocketMode=0660" in socket
    assert "ListenStream=/run/gainlog-mcp/mcp.sock" in socket

    assert "User=gainlog-mcp-tunnel" in tunnel
    assert "LoadCredential=openai-key:/etc/gainlog-mcp/openai-runtime-key" in tunnel
    assert "Restart=always" in tunnel
    assert "TemporaryFileSystem=/run" in tunnel
    assert "BindReadOnlyPaths=/run/gainlog-mcp" in tunnel
    assert "/var/lib/gainlog-mcp" in tunnel
    assert "/etc/gainlog-mcp-acquire" in tunnel
    for denied_range in (
        "127.0.0.0/8", "::1/128", "169.254.0.0/16", "fe80::/10",
        "224.0.0.0/4", "ff00::/8", "10.0.0.0/8", "172.16.0.0/12",
        "192.168.0.0/16", "fc00::/7", "100.64.0.0/10",
    ):
        assert f"IPAddressDeny={denied_range}" in tunnel


def test_ssh_transport_is_fixed_command_with_no_direct_network_from_acquisition():
    ssh = read("ssh_config")
    sshd = read("gainlog-mcp-source-sshd.conf")
    authorized = read("authorized_keys.example")

    assert "HostName 100.80.191.75" in ssh
    assert "Port 22" in ssh
    assert "User gainlog-mcp-source" in ssh
    assert "IdentityFile /run/credentials/gainlog-mcp-acquire.service/source-key" in ssh
    assert "StrictHostKeyChecking yes" in ssh
    assert "ClearAllForwardings yes" in ssh
    assert "RequestTTY no" in ssh
    assert "ProxyCommand /usr/bin/socat STDIO UNIX-CONNECT:/run/gainlog-mcp-source-proxy/source.sock" in ssh

    assert "ForceCommand /opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-send" in sshd
    assert "AuthorizedKeysFile /etc/ssh/authorized_keys/gainlog-mcp-source" in sshd
    assert "DisableForwarding yes" in sshd
    assert "PermitTTY no" in sshd
    assert "PermitUserRC no" in sshd
    assert "PasswordAuthentication no" in sshd
    assert authorized.startswith(
        'restrict,command="/opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-send" ssh-ed25519 '
    )


def test_tunnel_config_reuses_exact_tunnel_and_has_no_public_listener():
    config = read("tunnel.yaml.example")

    assert "tunnel_id: tunnel_6a9e1d950c9081919663761188782096" in config
    assert "unix_socket:" in config
    assert "listen_addr:" not in config
    assert "stdio_send_initialized_notification: true" in config
    assert "capture_payloads" not in config
    assert "harpoon" not in config.lower()
    assert "REPLACE_WITH_SEPARATE_GAINLOG_TUNNEL_ID" not in config
    assert "sk-" not in config


def test_runbook_places_only_export_and_sender_on_lxc_and_skips_redundant_restart():
    runbook = read("README.md")

    assert "LXC 106 / gainlog-api" in runbook
    assert "Hermes VM" in runbook
    assert "192.168.4.37" in runbook
    assert "100.80.191.75:8000" in runbook
    assert "effective UMask is already 0077" in runbook
    assert "Do not restart GainLog" in runbook
    assert "projection.db" in runbook
    assert "encrypted_refresh_token" in runbook
    assert "rollback" in runbook.lower()


def test_systemd_units_parse_cleanly():
    units = [
        DEPLOY / "gainlog-mcp-export.service",
        DEPLOY / "gainlog-mcp-export.timer",
        DEPLOY / "gainlog-mcp-source-proxy.socket",
        DEPLOY / "gainlog-mcp-source-proxy.service",
        DEPLOY / "gainlog-mcp-acquire.service",
        DEPLOY / "gainlog-mcp-acquire.timer",
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