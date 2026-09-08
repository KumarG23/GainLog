#!/usr/bin/python3
from __future__ import annotations

import argparse
import ipaddress
from pathlib import Path
import socket
import ssl


CONTROL_SOCKETS = (
    Path("/run/dbus/system_bus_socket"),
    Path("/run/tailscale/tailscaled.sock"),
)
READER_SOCKET = Path("/run/gainlog-mcp/mcp.sock")
PUBLIC_HOST = "api.openai.com"
PUBLIC_PORT = 443
DENIED_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "127.0.0.0/8", "::1/128", "169.254.0.0/16", "fe80::/10",
    "224.0.0.0/4", "ff00::/8", "10.0.0.0/8", "172.16.0.0/12",
    "192.168.0.0/16", "fc00::/7", "100.64.0.0/10",
))


def _connect_unix(path: Path, *, should_connect: bool) -> None:
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(3)
    try:
        result = connection.connect_ex(str(path))
    finally:
        connection.close()
    if (result == 0) != should_connect:
        expectation = "reachable" if should_connect else "inaccessible"
        raise RuntimeError(f"Unix boundary failed: expected path to be {expectation}")


def _connect_tcp(host: str, port: int, *, should_connect: bool) -> None:
    connected = False
    try:
        connection = socket.create_connection((host, port), timeout=3)
    except OSError:
        pass
    else:
        connected = True
        connection.close()
    if connected != should_connect:
        expectation = "reachable" if should_connect else "denied"
        raise RuntimeError(f"IP boundary failed: expected destination to be {expectation}")


def _connect_public_tls() -> None:
    addresses = socket.getaddrinfo(PUBLIC_HOST, PUBLIC_PORT, type=socket.SOCK_STREAM)
    if not addresses:
        raise RuntimeError("public DNS returned no control-plane addresses")
    if any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise RuntimeError("public DNS returned a non-global control-plane address")

    context = ssl.create_default_context()
    failures = []
    for family, socktype, protocol, _, address in addresses:
        connection = socket.socket(family, socktype, protocol)
        connection.settimeout(5)
        try:
            connection.connect(address)
            with context.wrap_socket(connection, server_hostname=PUBLIC_HOST):
                return
        except OSError as exc:
            failures.append(type(exc).__name__)
            connection.close()
    raise RuntimeError(f"public TLS boundary failed ({','.join(failures)})")


def verify_tunnel(denied_host: str, denied_port: int) -> None:
    address = ipaddress.ip_address(denied_host)
    if not any(address in network for network in DENIED_NETWORKS):
        raise RuntimeError("denied test host is not covered by the tunnel IP policy")
    _connect_tcp(denied_host, denied_port, should_connect=False)
    for path in CONTROL_SOCKETS:
        _connect_unix(path, should_connect=False)
    _connect_unix(READER_SOCKET, should_connect=True)
    _connect_public_tls()
    print("tunnel-boundary-ok")


def verify_isolated() -> None:
    for path in CONTROL_SOCKETS:
        _connect_unix(path, should_connect=False)
    _connect_tcp("1.1.1.1", 443, should_connect=False)
    print("isolated-boundary-ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("tunnel", "isolated"))
    parser.add_argument("--denied-host")
    parser.add_argument("--denied-port", type=int)
    args = parser.parse_args()
    if args.mode == "tunnel":
        if not args.denied_host or args.denied_port is None:
            parser.error("tunnel mode requires --denied-host and --denied-port")
        verify_tunnel(args.denied_host, args.denied_port)
    else:
        verify_isolated()


if __name__ == "__main__":
    main()