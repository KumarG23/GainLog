# GainLog Backend — Ubuntu 24.04 Setup

## 1. System prerequisites

```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip
```

## 2. Create a dedicated user and directory

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gainlog
sudo mkdir -p /opt/gainlog/backend/data
sudo chown -R gainlog:gainlog /opt/gainlog
```

## 3. Copy the backend files

```bash
sudo cp -r backend/* /opt/gainlog/backend/
```

## 4. Create a virtual environment and install dependencies

```bash
sudo -u gainlog python3 -m venv /opt/gainlog/venv
sudo -u gainlog /opt/gainlog/venv/bin/pip install --upgrade pip
sudo -u gainlog /opt/gainlog/venv/bin/pip install -r /opt/gainlog/backend/requirements.txt
```

## 5. Local AI Coach with Ollama

GainLog defaults to a local Ollama-compatible coach provider.

Environment variables:

```bash
GAINLOG_COACH_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT_SECONDS=60
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
sudo cp /opt/gainlog/backend/gainlog.service /etc/systemd/system/gainlog.service
sudo systemctl daemon-reload
sudo systemctl enable gainlog
sudo systemctl start gainlog
```

## 7. Verify it's running

```bash
sudo systemctl status gainlog
curl http://localhost:8000/health
curl http://localhost:8000/workouts/
```

The API docs (Swagger UI) are available at http://<server-ip>:8000/docs

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
/opt/gainlog/backend/data/gainlog.db
```

## Firewall (ufw)

If ufw is active and you need external access:

```bash
sudo ufw allow 8000/tcp
```
