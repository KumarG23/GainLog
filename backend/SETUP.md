# GainLog Backend — Ubuntu 24.04 Setup

## 1. System prerequisites

```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip rsync
```

## 2. Create a dedicated user and directory

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gainlog
sudo mkdir -p /opt/gainlog/backend-git/data
sudo chown -R gainlog:gainlog /opt/gainlog
```

## 3. Synchronize the backend files

```bash
sudo rsync -a --delete --exclude='data/' --exclude='__pycache__/' \
  backend/ /opt/gainlog/backend-git/
sudo chown -R gainlog:gainlog /opt/gainlog/backend-git
```

The `data/` exclusion is mandatory: deployment must never overwrite or delete
the production SQLite database.

## 4. Create a virtual environment and install dependencies

```bash
sudo -u gainlog python3 -m venv /opt/gainlog/venv-new
sudo -u gainlog /opt/gainlog/venv-new/bin/pip install --upgrade pip
sudo -u gainlog /opt/gainlog/venv-new/bin/pip install -r /opt/gainlog/backend-git/requirements.txt
```

## 5. Local AI Coach with Ollama

GainLog defaults to a local Ollama-compatible coach provider.

Environment variables are loaded by systemd from `/etc/gainlog.env`:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/gainlog.env
sudo tee /etc/gainlog.env >/dev/null <<'EOF'
GAINLOG_COACH_PROVIDER=ollama
GAINLOG_DATABASE_URL=sqlite:////opt/gainlog/backend-git/data/gainlog.db
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT_SECONDS=60
EOF
```

If Ollama runs on another machine, set `OLLAMA_BASE_URL` to that host, for example:

```bash
OLLAMA_BASE_URL=http://100.66.106.122:11434
```

Pull a model:

```bash
ollama pull qwen2.5:7b
```

Test Ollama:

```bash
curl http://localhost:11434/api/generate \
  -d '{"model":"qwen2.5:7b","prompt":"Write one sentence of workout coaching.","stream":false}'
```

Optional Anthropic fallback:

```bash
GAINLOG_COACH_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## 6. Install and enable the systemd service

```bash
sudo cp /opt/gainlog/backend-git/gainlog.service /etc/systemd/system/gainlog.service
sudo cp /opt/gainlog/backend-git/gainlog-google-health-sync.service /etc/systemd/system/
sudo cp /opt/gainlog/backend-git/gainlog-google-health-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gainlog.service gainlog-google-health-sync.timer
```

## 7. Verify it's running

```bash
sudo systemctl status gainlog
curl http://localhost:8000/health
curl http://localhost:8000/workouts/
```

Uvicorn listens only on localhost. Reach the API through the private Tailscale
Serve endpoint; Swagger UI is available at
`https://gainlog-api.tailc88c35.ts.net/docs` from the tailnet.

## Local verification

```bash
npm run lint
npx tsc --noEmit
python -m pytest backend/tests -v
```

## Useful commands

```bash
# View logs
sudo journalctl -u gainlog -f

# Restart after updating files
sudo systemctl restart gainlog

# Database location
/opt/gainlog/backend-git/data/gainlog.db
```

## Firewall (ufw)

If ufw is active and you need external access:

```bash
sudo ufw allow 8000/tcp
```
