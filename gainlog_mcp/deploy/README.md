GainLog read-only MCP deployment handoff

Status

These are prepared templates, not an installed deployment. They create a separate GainLog tunnel and do not modify Homelab Observer. Tunnel enrollment, the runtime key, production installation, service restarts, and the ChatGPT developer app are parent/user operations after scoped boundary review.

Boundary

Three operating identities are intentional:

- gainlog: the existing application identity and short-lived projection exporter. It can read the canonical database and write only /var/lib/gainlog-mcp while the exporter unit runs.
- gainlog-mcp-reader: reads only the allowlisted projection through a PrivateNetwork systemd socket service. /etc, /run, /var, /home, /root, and /opt/gainlog are hidden except for the read-only projection bind.
- gainlog-mcp-tunnel: holds the OpenAI runtime credential, has outbound network access, cannot read the source database or projection, and can only reach the reader's group-gated Unix socket.

The projection contains personal health data but no OAuth state, encrypted refresh token, connection error text, nutrition sync payloads, raw provider payloads, environment, or arbitrary database objects. It is replaced atomically every five minutes. The MCP process opens it immutable/read-only and exposes no TCP listener.

Prerequisites to capture before installation

Record, without copying data values:

    git -C /opt/gainlog/backend-git rev-parse HEAD
    stat -c '%n %U:%G %a' /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db
    systemctl show gainlog -p User -p Group -p UMask -p FragmentPath --no-pager
    systemctl is-active gainlog

Verify the reviewed GainLog commit and the SHA-256 digest of the separately obtained official tunnel-client v0.0.14 or newer. Do not copy the Homelab Observer runtime key, tunnel ID, profile, or config. A separately selectable GainLog MCP requires one new tunnel plus one ChatGPT developer app selecting that tunnel.

Install after review

The commands below are a parent runbook, not an automatic installer. Stage files in a root-private randomized directory and verify checksums before root installation.

1. Create identities and projection storage:

    groupadd --system gainlog-mcp-reader
    useradd --system --gid gainlog-mcp-reader --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-reader
    groupadd --system gainlog-mcp-tunnel
    useradd --system --gid gainlog-mcp-tunnel --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-tunnel
    install -d -o gainlog -g gainlog-mcp-reader -m 2750 /var/lib/gainlog-mcp
    install -d -o root -g root -m 0755 /opt/gainlog-mcp
    install -d -o root -g root -m 0750 /etc/gainlog-mcp

2. Install this subproject at /opt/gainlog-mcp, then create the pinned runtime environment:

    cd /opt/gainlog-mcp
    uv sync --frozen --no-dev
    install -o root -g root -m 0755 VERIFIED_TUNNEL_CLIENT /opt/gainlog-mcp/tunnel-client

3. Close the existing world-readable source boundary before assigning either new UID. Include SQLite sidecars if present and install the supplied gainlog.service UMask override so future WAL/SHM files are private:

    install -d -o root -g root -m 0755 /etc/systemd/system/gainlog.service.d
    install -o root -g root -m 0644 deploy/gainlog.service.d/20-private-data.conf /etc/systemd/system/gainlog.service.d/20-private-data.conf
    chown gainlog:gainlog /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db
    chmod 0750 /opt/gainlog/backend-git/data
    chmod 0640 /opt/gainlog/backend-git/data/gainlog.db
    for file in /opt/gainlog/backend-git/data/gainlog.db-wal /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$file" || { chown gainlog:gainlog "$file" && chmod 0640 "$file"; }; done

A controlled gainlog restart is required for the new UMask to govern future sidecars. Parent owns that restart and the ordinary API health check. Do not continue if GainLog fails to recover.

4. Install units, daemon-reload, run one export, and inspect metadata only:

    install -o root -g root -m 0644 deploy/gainlog-mcp-export.service /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-export.timer /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-reader.socket /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-reader@.service /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-tunnel.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl start gainlog-mcp-export.service
    stat -c '%n %U:%G %a %s' /var/lib/gainlog-mcp/projection.db
    systemctl enable --now gainlog-mcp-export.timer gainlog-mcp-reader.socket

Expected projection ownership is gainlog:gainlog-mcp-reader and mode 0640. Verify the reader UID cannot read /opt/gainlog/backend-git/data/gainlog.db, the tunnel UID cannot read either database, and the reader has no IP network. Exercise all tools through the real Unix socket before tunnel enrollment.

5. In OpenAI Platform, create a separate GainLog tunnel associated with the intended Platform organization and ChatGPT workspace. The runtime-key principal needs Tunnels Read + Use. The user enters the key directly into /etc/gainlog-mcp/openai-runtime-key through a trusted terminal; never paste it into chat or shell history. Install it root:root 0600.

6. Copy tunnel.yaml.example to /etc/gainlog-mcp/tunnel.yaml, replace only the placeholder tunnel ID, retain the credential-file reference, and set root:root 0644. Run tunnel-client doctor with a private diagnostic config or under the service credential boundary. Then enable gainlog-mcp-tunnel.service and verify its Unix health endpoint reports process running, healthy, ready, and a successful control-plane poll.

7. Only while the tunnel service is ready, create one ChatGPT developer-mode app with Connection: Tunnel and select the new GainLog tunnel. Hosted discovery and a real hosted tool call are separate acceptance gates; local tests do not prove them.

Rollback

    systemctl disable --now gainlog-mcp-tunnel.service gainlog-mcp-reader.socket gainlog-mcp-export.timer
    systemctl stop 'gainlog-mcp-reader@*.service' gainlog-mcp-export.service
    rm -f /etc/systemd/system/gainlog-mcp-tunnel.service \
          /etc/systemd/system/gainlog-mcp-reader.socket \
          /etc/systemd/system/gainlog-mcp-reader@.service \
          /etc/systemd/system/gainlog-mcp-export.service \
          /etc/systemd/system/gainlog-mcp-export.timer
    systemctl daemon-reload

Revoke/delete the separate GainLog tunnel runtime key and remove the ChatGPT app/tunnel as explicit OpenAI control-plane actions. Preserve /var/lib/gainlog-mcp/projection.db until the user explicitly authorizes health-data deletion; then securely remove it according to storage semantics and backup policy. Remove /opt/gainlog-mcp and the two unused system users/groups only after verifying no process or file ownership depends on them.

Retain the private GainLog database permissions and UMask hardening during ordinary MCP rollback. If the override itself caused an application regression, restore the captured prior unit/drop-in and permission metadata, daemon-reload, restart GainLog, and verify its API; do not guess prior modes.
