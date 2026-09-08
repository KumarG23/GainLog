GainLog read-only MCP deployment handoff

Status

These are prepared templates, not an installed deployment. The separate GainLog tunnel already exists; use only the out-of-band tunnel ID recorded for this project and do not create, replace, or alter a tunnel from this runbook. Runtime-key enrollment, production installation, service restarts, and the ChatGPT developer app remain parent/user operations. Homelab Observer is untouched.

Boundary

Three operating identities are intentional:

- gainlog: the existing application identity and short-lived projection exporter. It can read the canonical database and write only /var/lib/gainlog-mcp while the exporter unit runs.
- gainlog-mcp-reader: reads only the allowlisted projection through a PrivateNetwork systemd socket service. /etc, /run, /var, /home, /root, and /opt/gainlog are hidden except for the read-only projection bind.
- gainlog-mcp-tunnel: holds the OpenAI runtime credential, has public outbound network access, cannot read the source database or projection, sees an empty private /run plus the reader socket directory, and is denied loopback, link-local, multicast, RFC1918, unique-local IPv6, and 100.64.0.0/10 destinations.

The projection contains personal health data but no OAuth state, encrypted refresh token, connection error text, nutrition sync payloads, raw provider payloads, environment, or arbitrary database objects. It is replaced atomically every five minutes. The MCP process opens it immutable/read-only and exposes no TCP listener.

Prerequisites and rollback capture

The commands below are a parent runbook, not an automatic installer. Stage reviewed files in a root-private randomized directory. Set GAINLOG_HEALTH_URL to the exact existing /health URL and set GAINLOG_API_HOST and GAINLOG_API_PORT to the existing service listener. Confirm the API is healthy before changing anything; do not print its response body.

    test -n "$GAINLOG_HEALTH_URL" && test -n "$GAINLOG_API_HOST" && test -n "$GAINLOG_API_PORT"
    curl --fail --silent --show-error --output /dev/null "$GAINLOG_HEALTH_URL"
    git -C /opt/gainlog/backend-git rev-parse HEAD
    systemctl show gainlog -p User -p Group -p UMask -p FragmentPath --no-pager
    systemctl is-active --quiet gainlog
    test ! -e /opt/gainlog-mcp && test ! -e /etc/gainlog-mcp
    test ! -e /usr/local/bin/uv && ! dpkg-query -W socat >/dev/null 2>&1
    ! getent passwd gainlog-mcp-reader >/dev/null && ! getent passwd gainlog-mcp-tunnel >/dev/null

Capture prior bytes and metadata before any install. This rollback-state directory must stay root-only and off shared logs because it may contain prior local configuration. The path record distinguishes existing files from absent files; rollback must restore only paths recorded as present and remove only paths recorded as absent.

    rollback="/root/gainlog-mcp-rollback-state-$(date +%Y%m%dT%H%M%S)"
    install -d -o root -g root -m 0700 "$rollback/files"
    : >"$rollback/paths"
    record_path() { path="$1"; if test -e "$path"; then printf 'present\t%s\n' "$path" >>"$rollback/paths"; install -d -o root -g root -m 0700 "$rollback/files$(dirname "$path")"; cp -a -- "$path" "$rollback/files$path"; else printf 'absent\t%s\n' "$path" >>"$rollback/paths"; fi; }
    for path in /etc/systemd/system/gainlog.service.d/20-private-data.conf /etc/systemd/system/gainlog-mcp-export.service /etc/systemd/system/gainlog-mcp-export.timer /etc/systemd/system/gainlog-mcp-reader.socket /etc/systemd/system/gainlog-mcp-reader@.service /etc/systemd/system/gainlog-mcp-tunnel.service; do record_path "$path"; done
    stat -c '%n %u %g %a' /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db >"$rollback/source-permissions"
    for path in /opt/gainlog/backend-git/data/gainlog.db-wal /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$path" || stat -c '%n %u %g %a' "$path" >>"$rollback/source-permissions"; done
    chmod 0600 "$rollback/paths" "$rollback/source-permissions"

Dependency and package installation

LXC 106 is x86_64 Ubuntu 24.04. Refuse other platforms rather than applying these pinned hashes to the wrong artifact. Install uv 0.12.10 from its official release archive and verify its published SHA-256 before extraction.

    test "$(uname -m)" = x86_64
    cd ROOT_PRIVATE_STAGING_DIRECTORY
    curl --proto '=https' --tlsv1.2 --fail --location --output uv-x86_64-unknown-linux-gnu.tar.gz https://github.com/astral-sh/uv/releases/download/0.12.10/uv-x86_64-unknown-linux-gnu.tar.gz
    printf '%s  %s\n' 173d95a0c32d18c896c46ba6fafbf3cf9c14ab74b033f81b76c883ef492a976b uv-x86_64-unknown-linux-gnu.tar.gz | sha256sum --check --strict
    tar -xzf uv-x86_64-unknown-linux-gnu.tar.gz
    install -o root -g root -m 0755 uv-x86_64-unknown-linux-gnu/uv /usr/local/bin/uv
    test "$(/usr/local/bin/uv --version | cut -d' ' -f1-2)" = "uv 0.12.10"

Install pinned socat from Ubuntu's signed package metadata after checking the exact downloaded package hash. Dependencies fetched by apt remain authenticated by Ubuntu repository signatures and hashes.

    apt-get update
    apt-get download socat=1.8.0.0-4ubuntu0.1
    printf '%s  %s\n' 46e854289b6b1c97e28be5d9293bea61e8633d00d6a65d9513f019c7232696fe socat_1.8.0.0-4ubuntu0.1_amd64.deb | sha256sum --check --strict
    apt-get install --yes --no-install-recommends ./socat_1.8.0.0-4ubuntu0.1_amd64.deb
    test "$(dpkg-query -W -f='${Version}' socat)" = 1.8.0.0-4ubuntu0.1
    test -x /usr/bin/socat

Install the reviewed gainlog_mcp tree at /opt/gainlog-mcp and create its locked production environment. The separately obtained official tunnel client is also a pinned artifact: set its expected SHA-256 out of band, verify before installation, and record its actual version. Do not use the Observer binary, key, profile, config, or tunnel.

    install -d -o root -g root -m 0755 /opt/gainlog-mcp
    # Copy only the reviewed gainlog_mcp tree from the verified commit into /opt/gainlog-mcp.
    cd /opt/gainlog-mcp
    /usr/local/bin/uv sync --frozen --no-dev
    test -n "$TUNNEL_CLIENT_SHA256"
    printf '%s  %s\n' "$TUNNEL_CLIENT_SHA256" VERIFIED_TUNNEL_CLIENT | sha256sum --check --strict
    install -o root -g root -m 0755 VERIFIED_TUNNEL_CLIENT /opt/gainlog-mcp/tunnel-client
    /opt/gainlog-mcp/tunnel-client --version

GainLog UMask and source permissions

Apply and load the UMask before the controlled restart. Verify API recovery before changing source modes, then close the source boundary before creating either new identity.

    install -d -o root -g root -m 0755 /etc/systemd/system/gainlog.service.d
    install -o root -g root -m 0644 deploy/gainlog.service.d/20-private-data.conf /etc/systemd/system/gainlog.service.d/20-private-data.conf
    systemctl daemon-reload
    systemctl restart gainlog
    test "$(systemctl show gainlog -p UMask --value)" = 0077
    systemctl is-active --quiet gainlog
    curl --fail --silent --show-error --output /dev/null "$GAINLOG_HEALTH_URL"
    chown gainlog:gainlog /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db
    chmod 0750 /opt/gainlog/backend-git/data
    chmod 0640 /opt/gainlog/backend-git/data/gainlog.db
    for file in /opt/gainlog/backend-git/data/gainlog.db-wal /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$file" || { chown gainlog:gainlog "$file" && chmod 0640 "$file"; }; done
    stat -c '%n %U:%G %a' /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db
    for file in /opt/gainlog/backend-git/data/gainlog.db-wal /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$file" || stat -c '%n %U:%G %a' "$file"; done

Identities, config, units, and reader

    groupadd --system gainlog-mcp-reader
    useradd --system --gid gainlog-mcp-reader --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-reader
    groupadd --system gainlog-mcp-tunnel
    useradd --system --gid gainlog-mcp-tunnel --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-tunnel
    install -d -o gainlog -g gainlog-mcp-reader -m 2750 /var/lib/gainlog-mcp
    install -d -o root -g gainlog-mcp-tunnel -m 0750 /etc/gainlog-mcp
    install -o root -g gainlog-mcp-tunnel -m 0640 deploy/resolv.conf /etc/gainlog-mcp/resolv.conf
    install -o root -g gainlog-mcp-tunnel -m 0640 CONFIGURED_TUNNEL_YAML /etc/gainlog-mcp/tunnel.yaml
    install -o root -g root -m 0644 deploy/gainlog-mcp-export.service /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-export.timer /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-reader.socket /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-reader@.service /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-tunnel.service /etc/systemd/system/
    runuser -u gainlog-mcp-tunnel -- test -r /etc/gainlog-mcp/tunnel.yaml
    runuser -u gainlog-mcp-tunnel -- test -r /etc/gainlog-mcp/resolv.conf
    runuser -u gainlog-mcp-tunnel -- test -x /usr/bin/socat
    runuser -u gainlog-mcp-tunnel -- test -x /opt/gainlog-mcp/tunnel-client
    systemd-analyze verify /etc/systemd/system/gainlog-mcp-export.service /etc/systemd/system/gainlog-mcp-export.timer /etc/systemd/system/gainlog-mcp-reader.socket /etc/systemd/system/gainlog-mcp-reader@.service /etc/systemd/system/gainlog-mcp-tunnel.service
    systemctl daemon-reload
    systemctl start gainlog-mcp-export.service
    stat -c '%n %U:%G %a %s' /var/lib/gainlog-mcp/projection.db
    systemctl enable --now gainlog-mcp-export.timer gainlog-mcp-reader.socket

Expected projection ownership is gainlog:gainlog-mcp-reader and mode 0640. Verify the reader UID cannot read the source database, the tunnel UID cannot read either database, and all eight tools work through the real reader socket without printing health rows.

Target runtime boundary gate

IPAddressDeny uses systemd cgroup BPF and may be ignored inside an unprivileged LXC. systemd-analyze output and unit text are not proof. Do not start or enable the tunnel until a disposable transient service inside LXC 106 runs deploy/verify-boundary.py with the same TemporaryFileSystem, bind, address-family, and IP-deny directives and prints tunnel-boundary-ok. First confirm the supplied local API endpoint is reachable outside the sandbox; otherwise its denial proves nothing.

The tunnel probe must prove the active local API is denied, host D-Bus and Tailscale sockets are hidden, the reader socket is reachable, DNS returns only global OpenAI addresses, and a TLS handshake to api.openai.com:443 succeeds. The isolated probe must print isolated-boundary-ok under PrivateNetwork=yes for both reader/exporter assumptions. If either probe fails or systemd reports unsupported BPF policy, stop: the deployment is blocked, not degraded to a wider network boundary. Do not change host AppArmor or the global firewall to make it pass.

Run the target probes with the exact boundary properties. These transient units are collected after exit and do not start the tunnel client:

    curl --fail --silent --show-error --output /dev/null "$GAINLOG_HEALTH_URL"
    systemd-run --quiet --wait --pipe --collect --unit=gainlog-mcp-tunnel-boundary-probe \
      --property=User=gainlog-mcp-tunnel --property=Group=gainlog-mcp-tunnel \
      --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property=ProtectHome=yes \
      --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
      --property=TemporaryFileSystem=/run \
      --property=BindReadOnlyPaths=/run/gainlog-mcp \
      --property=BindReadOnlyPaths=/etc/gainlog-mcp/resolv.conf:/etc/resolv.conf \
      --property=IPAddressDeny=127.0.0.0/8 --property=IPAddressDeny=::1/128 \
      --property=IPAddressDeny=169.254.0.0/16 --property=IPAddressDeny=fe80::/10 \
      --property=IPAddressDeny=224.0.0.0/4 --property=IPAddressDeny=ff00::/8 \
      --property=IPAddressDeny=10.0.0.0/8 --property=IPAddressDeny=172.16.0.0/12 \
      --property=IPAddressDeny=192.168.0.0/16 --property=IPAddressDeny=fc00::/7 \
      --property=IPAddressDeny=100.64.0.0/10 \
      /usr/bin/python3 /opt/gainlog-mcp/deploy/verify-boundary.py tunnel \
      --denied-host "$GAINLOG_API_HOST" --denied-port "$GAINLOG_API_PORT"
    systemd-run --quiet --wait --pipe --collect --unit=gainlog-mcp-isolated-boundary-probe \
      --property=User=gainlog-mcp-reader --property=Group=gainlog-mcp-reader \
      --property=NoNewPrivileges=yes --property=PrivateNetwork=yes \
      --property='RestrictAddressFamilies=AF_UNIX' --property=IPAddressDeny=any \
      --property=TemporaryFileSystem=/run:ro \
      /usr/bin/python3 /opt/gainlog-mcp/deploy/verify-boundary.py isolated

Runtime key and activation

Use the existing separate tunnel ID supplied out of band in tunnel.yaml; never create a replacement. The runtime-key principal needs only Tunnels Read + Use. The user enters the key directly through a trusted terminal, never chat or shell history:

    install -o root -g root -m 0600 /dev/stdin /etc/gainlog-mcp/openai-runtime-key
    runuser -u gainlog-mcp-tunnel -- test ! -r /etc/gainlog-mcp/openai-runtime-key

The second check is intentional: the service UID reads the key only from systemd's LoadCredential mount. Run tunnel-client doctor under that credential boundary, then enable gainlog-mcp-tunnel.service. Verify its private Unix health endpoint reports running, healthy, ready, and a successful control-plane poll. Hosted discovery and a real hosted tool call remain separate acceptance gates. This runbook does not claim deployment.

Rollback

    systemctl disable --now gainlog-mcp-tunnel.service gainlog-mcp-reader.socket gainlog-mcp-export.timer
    systemctl stop 'gainlog-mcp-reader@*.service' gainlog-mcp-export.service
    while IFS="$(printf '\t')" read -r state path; do if test "$state" = present; then rm -f -- "$path"; cp -a -- "$rollback/files$path" "$path"; else rm -f -- "$path"; fi; done <"$rollback/paths"
    systemctl daemon-reload

That loop restores exact captured bytes and metadata for previously present unit/drop-in paths and removes only paths recorded absent. Preserve /var/lib/gainlog-mcp/projection.db until health-data deletion is explicitly authorized. Remove /opt/gainlog-mcp, configuration, package dependencies, and unused identities only after verifying no process or ownership depends on them. Revoke only the newly enrolled runtime key and remove any ChatGPT app as explicit control-plane actions; do not delete or replace the existing tunnel.

Retain private database permissions and UMask hardening during ordinary MCP rollback. If that hardening caused an application regression, restore the captured metadata and drop-in state, then restart and verify:

    while read -r path uid gid mode; do chown "$uid:$gid" "$path" && chmod "$mode" "$path"; done <"$rollback/source-permissions"
    while IFS="$(printf '\t')" read -r state path; do test "$path" != /etc/systemd/system/gainlog.service.d/20-private-data.conf || { if test "$state" = present; then rm -f -- "$path"; cp -a -- "$rollback/files$path" "$path"; else rm -f -- "$path"; fi; }; done <"$rollback/paths"
    systemctl daemon-reload
    systemctl restart gainlog
    curl --fail --silent --show-error --output /dev/null "$GAINLOG_HEALTH_URL"

Never guess prior modes or assume a unit/drop-in path was absent.
