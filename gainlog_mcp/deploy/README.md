GainLog read-only MCP split deployment handoff

Status

Prepared only. Nothing in this runbook has been installed or activated. No production
identity, key, permission, package, unit, service, SSH policy, network policy, tunnel,
Observer component, or health row was changed by the placement repair.

Placement and trust boundary

LXC 106 / gainlog-api (`100.80.191.75`) runs only:

- the existing GainLog service as `gainlog`;
- a short-lived credential-free exporter as `gainlog`, writing only the fixed
  allowlisted SQLite projection at `/var/lib/gainlog-mcp-source/projection.db`;
- a locked `gainlog-mcp-source` SSH identity whose two independent fixed-command
  controls can only stream that projection.

Hermes VM runs:

- a credential-free `systemd-socket-proxyd` with the immutable destination
  `100.80.191.75:22`;
- `gainlog-mcp-acquire`, which receives its dedicated SSH key only through
  `LoadCredential`, has `PrivateNetwork=yes`/`AF_UNIX` only, and can reach only the
  proxy Unix socket;
- `gainlog-mcp-reader`, which has `PrivateNetwork=yes`, reads only the received
  projection, and owns no credential;
- `gainlog-mcp-tunnel`, which receives only the OpenAI runtime key, cannot read the
  acquisition key or either database, sees only the reader Unix socket under its
  private `/run`, and uses the already-proven Hermes BPF/private-run boundary.

The source API remains bound only to `100.80.191.75:8000`. Acquisition cannot open IP
sockets and the fixed proxy targets port 22, so the API is not a transport path. No
listener is added for MCP. Use only tunnel
`tunnel_6a9e1d950c9081919663761188782096`; do not create or replace a tunnel.

Transfer contract

The exporter copies only fixed tables and columns. It never copies the credential-bearing
source database, `encrypted_refresh_token`, OAuth state/verifiers, provider error text,
nutrition sync payloads, raw provider payloads, arbitrary tables, or arbitrary SQL/path/
URL input. The SSH sender accepts no arguments and rejects any nonempty
`SSH_ORIGINAL_COMMAND`.

Before atomic replacement on Hermes, the receiver requires all of the following from the
same bounded stream: successful SSH exit, nonempty size at most 100 MiB, SQLite quick and
foreign-key checks, exact application ID and schema version, exact table and ordered-column
allowlist, exactly three metadata keys, valid UTC timestamps, no timestamp over five
minutes in the future, and age no greater than 15 minutes. Partial, malformed, oversized,
future, stale, or nonzero-exit transfers fail without replacing the prior snapshot. The
reader reports a retained snapshot as stale after 15 minutes rather than pretending the
last pull succeeded.

Observed read-only prerequisites

Live preflight found, without printing health values or secrets:

- LXC 106 is Ubuntu 24.04 with OpenSSH 9.6, Python 3.12/venv, GainLog active, and
  effective UMask already 0077. `/opt/gainlog/backend-git/data` is currently 0755 and
  `gainlog.db` is 0644. No MCP source identity/path/unit/SSH include exists.
- LXC SSH listens on all addresses; the API listens only on `100.80.191.75:8000`.
  Current global SSH defaults allow passwords and forwarding, so the dedicated Match
  block plus key restriction below are mandatory.
- Hermes is Ubuntu 24.04/systemd 255 at `100.118.80.5`, with `/usr/bin/socat` 1.8.0.0,
  `/usr/lib/systemd/systemd-socket-proxyd`, and no GainLog MCP identities or paths.
  `/usr/local/bin/uv` is absent. Existing Observer files/services remain unrelated and
  must not be copied, modified, stopped, restarted, or used for credentials.
- Direct Hermes access to LXC's LAN address `192.168.4.37` is unavailable; the fixed
  proxy therefore uses the reachable tailnet SSH address while preventing acquisition
  from opening the API address itself.

Pre-downtime enforceability gates

There is no planned GainLog restart. Run these gates before changing source modes or
enrolling the dedicated key. Failure blocks installation; do not weaken LXC AppArmor,
host-global firewall policy, or the prepared units.

On LXC 106, prove the exporter's network namespace—not the disproven IPAddressDeny
mechanism—cannot reach the live API. The normal curl is only a reachability prerequisite
and discards the response body:

    curl --fail --silent --show-error --output /dev/null http://100.80.191.75:8000/health
    systemd-run --quiet --wait --pipe --collect --unit=gainlog-mcp-export-net-probe \
      --property=User=nobody --property=NoNewPrivileges=yes \
      --property=PrivateNetwork=yes --property='RestrictAddressFamilies=AF_UNIX' \
      /usr/bin/python3 -c 'import socket
try: socket.socket(socket.AF_INET,socket.SOCK_STREAM)
except OSError: print("export-network-isolated")
else: raise SystemExit(1)'

The transient command must print only `export-network-isolated`; a zero exit without that
exact line is not evidence. Do not rerun an `IPAddressDeny` probe in LXC; that architecture
is known ineffective.

On Hermes, after staging the prepared units but before source permission changes, verify:

    systemd-analyze verify /etc/systemd/system/gainlog-mcp-*.service \
      /etc/systemd/system/gainlog-mcp-*.socket /etc/systemd/system/gainlog-mcp-*.timer
    /usr/bin/python3 -c 'from pathlib import Path
p=Path("/etc/systemd/system/gainlog-mcp-source-proxy.service")
assert "ExecStart=/usr/lib/systemd/systemd-socket-proxyd 100.80.191.75:22\n" in p.read_text()'
    test "$(stat -c '%U:%G %a' /usr/lib/systemd/systemd-socket-proxyd)" = 'root:root 755'

Then start only `gainlog-mcp-source-proxy.socket` and run an acquisition-equivalent
transient sandbox. It must be unable to create an IP socket and able to receive an SSH
banner through the one rebound Unix socket; print no banner bytes:

    systemctl start gainlog-mcp-source-proxy.socket
    systemd-run --quiet --wait --pipe --collect --unit=gainlog-mcp-acquire-boundary-probe \
      --property=User=gainlog-mcp-acquire --property=Group=gainlog-mcp-acquire \
      --property=NoNewPrivileges=yes --property=PrivateNetwork=yes \
      --property='RestrictAddressFamilies=AF_UNIX' --property=TemporaryFileSystem=/run \
      --property=BindReadOnlyPaths=/run/gainlog-mcp-source-proxy \
      /usr/bin/python3 -c 'import socket; denied=False
try: socket.socket(socket.AF_INET,socket.SOCK_STREAM)
except OSError: denied=True
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(5); s.connect("/run/gainlog-mcp-source-proxy/source.sock"); banner=s.recv(16); s.close()
raise SystemExit(0 if denied and banner.startswith(b"SSH-") else 1)'

Stop the socket if proceeding is not authorized. This gate creates no identity or key and
does not call the GainLog API.

Artifact preparation

Work from the reviewed commit and a root-private randomized stage on each host. Build one
wheel and record its SHA-256; transfer it and `deploy/` only through the existing trusted
parent maintenance path. Do not use a shared fixed `/tmp` path.

    test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
    uv build --wheel
    sha256sum dist/gainlog_readonly_mcp-0.1.0-py3-none-any.whl

On every target, verify the recorded wheel checksum and every staged unit/config checksum
before privileged installation. The source venv installs this wheel with `--no-deps`; only
the stdlib exporter/sender entry points run there. Hermes installs the locked full runtime.

LXC 106 installation

Capture rollback first. Record existing bytes/metadata for every destination and numeric
source modes. Never save or copy the credential-bearing database itself.

    rollback=/root/gainlog-mcp-source-rollback-$(date +%Y%m%dT%H%M%S)
    install -d -o root -g root -m 0700 "$rollback/files"
    : >"$rollback/paths"
    record_path() { p="$1"; if test -e "$p"; then printf 'present\t%s\n' "$p" >>"$rollback/paths"; install -d -m 0700 "$rollback/files$(dirname "$p")"; cp -a -- "$p" "$rollback/files$p"; else printf 'absent\t%s\n' "$p" >>"$rollback/paths"; fi; }
    for p in /etc/systemd/system/gainlog-mcp-export.service \
      /etc/systemd/system/gainlog-mcp-export.timer \
      /etc/ssh/sshd_config.d/60-gainlog-mcp-source.conf \
      /etc/ssh/authorized_keys/gainlog-mcp-source; do record_path "$p"; done
    stat -c '%n %u %g %a' /opt/gainlog/backend-git/data \
      /opt/gainlog/backend-git/data/gainlog.db >"$rollback/source-permissions"
    for p in /opt/gainlog/backend-git/data/gainlog.db-wal \
      /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$p" || stat -c '%n %u %g %a' "$p" >>"$rollback/source-permissions"; done
    chmod 0600 "$rollback/paths" "$rollback/source-permissions"

The effective UMask is already 0077; no drop-in is required. Do not restart GainLog.
Health-check before and after chmod while discarding the body, then create the new identity
only after world-read access is gone:

    test "$(systemctl show gainlog -p UMask --value)" = 0077
    systemctl is-active --quiet gainlog
    curl --fail --silent --show-error --output /dev/null http://100.80.191.75:8000/health
    chown gainlog:gainlog /opt/gainlog/backend-git/data /opt/gainlog/backend-git/data/gainlog.db
    chmod 0750 /opt/gainlog/backend-git/data
    chmod 0640 /opt/gainlog/backend-git/data/gainlog.db
    for p in /opt/gainlog/backend-git/data/gainlog.db-wal \
      /opt/gainlog/backend-git/data/gainlog.db-shm; do test ! -e "$p" || { chown gainlog:gainlog "$p"; chmod 0640 "$p"; }; done
    curl --fail --silent --show-error --output /dev/null http://100.80.191.75:8000/health
    groupadd --system gainlog-mcp-source
    useradd --system --gid gainlog-mcp-source --home-dir /nonexistent --shell /bin/sh gainlog-mcp-source
    passwd --lock gainlog-mcp-source
    install -d -o gainlog -g gainlog-mcp-source -m 2750 /var/lib/gainlog-mcp-source

Install only the verified wheel into a source-only venv and the two source units:

    install -d -o root -g root -m 0755 /opt/gainlog-mcp-source
    python3 -m venv /opt/gainlog-mcp-source/.venv
    /opt/gainlog-mcp-source/.venv/bin/pip install --no-index --no-deps VERIFIED_WHEEL
    /opt/gainlog-mcp-source/.venv/bin/python -c 'import gainlog_mcp.exporter, gainlog_mcp.transfer'
    /opt/gainlog-mcp-source/.venv/bin/python -c 'import mcp' && exit 1 || true
    test -x /opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-export
    test -x /opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-send
    install -o root -g root -m 0644 deploy/gainlog-mcp-export.service /etc/systemd/system/
    install -o root -g root -m 0644 deploy/gainlog-mcp-export.timer /etc/systemd/system/
    systemctl daemon-reload
    systemctl start gainlog-mcp-export.service
    test "$(stat -c '%U:%G %a' /var/lib/gainlog-mcp-source/projection.db)" = 'gainlog:gainlog-mcp-source 640'
    runuser -u gainlog-mcp-source -- env -i PATH=/usr/bin:/bin \
      /opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-send >/dev/null

Enroll only the dedicated acquisition public key supplied from Hermes. Validate its exact
two-field Ed25519 shape before building the line; never copy a parent/Observer maintenance
key. Install both key-level `restrict,command=` and the account-level Match `ForceCommand`:

    install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
    test "$(wc -w <DEDICATED_PUBLIC_KEY_FILE)" -eq 2
    test "$(cut -d' ' -f1 <DEDICATED_PUBLIC_KEY_FILE)" = ssh-ed25519
    { printf 'restrict,command="/opt/gainlog-mcp-source/.venv/bin/gainlog-mcp-send" '; cat DEDICATED_PUBLIC_KEY_FILE; } \
      | install -o root -g root -m 0644 /dev/stdin /etc/ssh/authorized_keys/gainlog-mcp-source
    # OpenSSH drops to the Match user before reading AuthorizedKeysFile, so
    # root:root 0600 is unreadable and auth fails with "Permission denied".
    install -o root -g root -m 0644 deploy/gainlog-mcp-source-sshd.conf \
      /etc/ssh/sshd_config.d/60-gainlog-mcp-source.conf
    /usr/sbin/sshd -t
    /usr/sbin/sshd -T -C user=gainlog-mcp-source,host=gainlog-api,addr=100.118.80.5 \
      | sed -n -e '/^forcecommand /p' -e '/^authorizedkeysfile /p' \
        -e '/^disableforwarding /p' -e '/^permittty /p' -e '/^permituserrc /p'
    systemctl reload ssh
    systemctl enable --now gainlog-mcp-export.timer

Expected effective values are the fixed sender path, dedicated authorized-keys path,
`disableforwarding yes`, `permittty no`, and `permituserrc no`.

Hermes installation

The live preflight found all GainLog MCP paths absent. Reconfirm that fact and record it in a
separate root-only rollback directory before writes; refuse unexpected existing state rather
than merging it:

    rollback=/root/gainlog-mcp-hermes-rollback-$(date +%Y%m%dT%H%M%S)
    install -d -o root -g root -m 0700 "$rollback"
    : >"$rollback/created-paths"
    for p in /opt/gainlog-mcp /etc/gainlog-mcp /etc/gainlog-mcp-acquire \
      /var/lib/gainlog-mcp /etc/systemd/system/gainlog-mcp-source-proxy.service \
      /etc/systemd/system/gainlog-mcp-source-proxy.socket \
      /etc/systemd/system/gainlog-mcp-acquire.service \
      /etc/systemd/system/gainlog-mcp-acquire.timer \
      /etc/systemd/system/gainlog-mcp-reader.socket \
      /etc/systemd/system/gainlog-mcp-reader@.service \
      /etc/systemd/system/gainlog-mcp-tunnel.service; do \
      test ! -e "$p" || { printf 'unexpected existing path: %s\n' "$p" >&2; exit 1; }; \
      printf '%s\n' "$p" >>"$rollback/created-paths"; \
    done
    chmod 0600 "$rollback/created-paths"

Create mutually exclusive identities and data/config directories:

    groupadd --system gainlog-mcp-acquire
    groupadd --system gainlog-mcp-reader
    groupadd --system gainlog-mcp-tunnel
    useradd --system --gid gainlog-mcp-acquire --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-acquire
    useradd --system --gid gainlog-mcp-reader --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-reader
    useradd --system --gid gainlog-mcp-tunnel --home-dir /nonexistent --shell /usr/sbin/nologin gainlog-mcp-tunnel
    install -d -o gainlog-mcp-acquire -g gainlog-mcp-reader -m 2750 /var/lib/gainlog-mcp
    install -d -o root -g gainlog-mcp-acquire -m 0750 /etc/gainlog-mcp-acquire
    install -d -o root -g gainlog-mcp-tunnel -m 0750 /etc/gainlog-mcp

Install pinned uv 0.12.10, the full locked package, and a separately obtained official
tunnel-client. Do not reuse the Observer binary. Verify the tunnel-client's official digest
provided out of band:

    curl --proto '=https' --tlsv1.2 --fail --location --output uv.tar.gz \
      https://github.com/astral-sh/uv/releases/download/0.12.10/uv-x86_64-unknown-linux-gnu.tar.gz
    printf '%s  %s\n' 173d95a0c32d18c896c46ba6fafbf3cf9c14ab74b033f81b76c883ef492a976b uv.tar.gz | sha256sum --check --strict
    tar -xzf uv.tar.gz
    install -o root -g root -m 0755 uv-x86_64-unknown-linux-gnu/uv /usr/local/bin/uv
    install -d -o root -g root -m 0755 /opt/gainlog-mcp
    # Copy only the verified gainlog_mcp tree from the approved commit here.
    cd /opt/gainlog-mcp
    /usr/local/bin/uv sync --frozen --no-dev
    test -n "$TUNNEL_CLIENT_SHA256"
    printf '%s  %s\n' "$TUNNEL_CLIENT_SHA256" VERIFIED_TUNNEL_CLIENT | sha256sum --check --strict
    install -o root -g root -m 0755 VERIFIED_TUNNEL_CLIENT /opt/gainlog-mcp/tunnel-client
    /opt/gainlog-mcp/tunnel-client --version

Generate one dedicated acquisition key as root. The service UID must not read it directly;
`LoadCredential` is the only path. Build `known_hosts` from LXC 106's existing public
Ed25519 host key through the trusted parent console path, not TOFU or `ssh-keyscan`:

    ssh-keygen -q -t ed25519 -N '' -C '' \
      -f /etc/gainlog-mcp-acquire/id_ed25519
    chown root:root /etc/gainlog-mcp-acquire/id_ed25519 /etc/gainlog-mcp-acquire/id_ed25519.pub
    chmod 0600 /etc/gainlog-mcp-acquire/id_ed25519
    chmod 0644 /etc/gainlog-mcp-acquire/id_ed25519.pub
    install -o root -g gainlog-mcp-acquire -m 0640 deploy/ssh_config /etc/gainlog-mcp-acquire/ssh_config
    install -o root -g gainlog-mcp-acquire -m 0640 VERIFIED_KNOWN_HOSTS /etc/gainlog-mcp-acquire/known_hosts
    runuser -u gainlog-mcp-acquire -- test ! -r /etc/gainlog-mcp-acquire/id_ed25519

Produce `VERIFIED_KNOWN_HOSTS` through the trusted LXC console path, then transfer this
public-only file through the parent maintenance channel and compare its fingerprint before
installing it:

    awk '{print "100.80.191.75 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub \
      >ROOT_PRIVATE_STAGING_DIRECTORY/known_hosts
    ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
    ssh-keygen -lf ROOT_PRIVATE_STAGING_DIRECTORY/known_hosts

After the public key is enrolled on LXC 106, install units/config and acquire once before
starting the reader. The tunnel config already names the required existing tunnel:

    install -o root -g gainlog-mcp-tunnel -m 0640 deploy/tunnel.yaml.example /etc/gainlog-mcp/tunnel.yaml
    install -o root -g gainlog-mcp-tunnel -m 0640 deploy/resolv.conf /etc/gainlog-mcp/resolv.conf
    for p in deploy/gainlog-mcp-source-proxy.service deploy/gainlog-mcp-source-proxy.socket \
      deploy/gainlog-mcp-acquire.service deploy/gainlog-mcp-acquire.timer \
      deploy/gainlog-mcp-reader.socket deploy/gainlog-mcp-reader@.service \
      deploy/gainlog-mcp-tunnel.service; do install -o root -g root -m 0644 "$p" /etc/systemd/system/; done
    systemctl daemon-reload
    systemctl enable --now gainlog-mcp-source-proxy.socket
    systemctl start gainlog-mcp-acquire.service
    test "$(stat -c '%U:%G %a' /var/lib/gainlog-mcp/projection.db)" = 'gainlog-mcp-acquire:gainlog-mcp-reader 640'
    runuser -u gainlog-mcp-reader -- /opt/gainlog-mcp/.venv/bin/gainlog-mcp-validate
    systemctl enable --now gainlog-mcp-acquire.timer gainlog-mcp-reader.socket

Runtime acceptance before tunnel activation

1. Run the alternate-command probe through a transient unit carrying the source key; it
   must fail and emit no projection. Require PTY allocation, direct forwarding, and remote
   forwarding to be administratively prohibited; discard any forced-command stdout from
   the PTY probe. Save only exit/status digests, never projection bytes.
2. Prove `gainlog-mcp-acquire` cannot create AF_INET/AF_INET6 sockets, read
   `/etc/gainlog-mcp/openai-runtime-key`, or connect `/run/gainlog-mcp/mcp.sock`, while a
   normal acquisition advances the received projection's `exported_at` and passes
   `gainlog-mcp-validate`.
3. Prove reader initialization, exact eight-tool discovery, every tool call, freshness,
   bounded errors, and no listener through `/run/gainlog-mcp/mcp.sock`. Do not print health
   rows. Prove reader cannot read source/acquisition/tunnel credentials or write projection.
4. Run `verify-boundary.py tunnel --denied-host 100.80.191.75 --denied-port 8000` in a
   tunnel-equivalent Hermes transient sandbox with the exact private `/run`, reader bind,
   resolver bind, and IP denies from the unit. It must print `tunnel-boundary-ok`. Run its
   `isolated` mode for the reader/acquisition namespace and require
   `isolated-boundary-ok`.
5. Kill only disposable test processes and verify no test listener, temporary snapshot,
   credential copy, or transient unit remains.

Runtime key and existing tunnel

The remaining human secret is an OpenAI runtime API key whose principal has only Tunnels
Read + Use. Enter it directly on Hermes through a trusted terminal, never chat or shell
history:

    install -o root -g root -m 0600 /dev/stdin /etc/gainlog-mcp/openai-runtime-key
    runuser -u gainlog-mcp-tunnel -- test ! -r /etc/gainlog-mcp/openai-runtime-key

Run tunnel-client `doctor` under the same `LoadCredential` boundary, then enable only
`gainlog-mcp-tunnel.service`. Require running/healthy/ready, successful control-plane poll,
exact eight-tool discovery/calls, fresh data, and no public listener. ChatGPT developer-app
creation selecting the existing tunnel and one real hosted call remain separate human
acceptance gates. This prepared work does none of them.

Rollback

Hermes rollback:

    systemctl disable --now gainlog-mcp-tunnel.service gainlog-mcp-reader.socket \
      gainlog-mcp-acquire.timer gainlog-mcp-source-proxy.socket
    systemctl stop 'gainlog-mcp-reader@*.service' gainlog-mcp-acquire.service \
      gainlog-mcp-source-proxy.service
    while read -r path; do case "$path" in /etc/systemd/system/*) rm -f -- "$path";; esac; done <"$rollback/created-paths"
    systemctl daemon-reload

Preserve `/var/lib/gainlog-mcp/projection.db` until deletion of personal health data is
explicitly authorized. Remove only newly created GainLog MCP identities/directories after
proving no process or file ownership depends on them. Revoke only the dedicated acquisition
key and separately enrolled runtime key. Never delete or replace the existing tunnel and
never touch Observer.

LXC rollback:

    systemctl disable --now gainlog-mcp-export.timer
    systemctl stop gainlog-mcp-export.service
    while IFS="$(printf '\t')" read -r state path; do if test "$state" = present; then rm -f -- "$path"; cp -a -- "$rollback/files$path" "$path"; else rm -f -- "$path"; fi; done <"$rollback/paths"
    /usr/sbin/sshd -t
    systemctl daemon-reload
    systemctl reload ssh

Keep the safer source modes during ordinary MCP rollback. If those modes caused a verified
GainLog regression, restore only the numeric metadata captured in
`$rollback/source-permissions`:

    while read -r path uid gid mode; do chown "$uid:$gid" "$path"; chmod "$mode" "$path"; done <"$rollback/source-permissions"
    curl --fail --silent --show-error --output /dev/null http://100.80.191.75:8000/health

Do not restart GainLog unless a separate application failure actually requires it. Remove
the source user, group, venv, and projection directory only after the forced key is gone and
health-data deletion is authorized. Never guess prior modes or remove unrecorded paths.