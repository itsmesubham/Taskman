# Taskman - A jira like taskmanager for enterprise

Responsive React/Vite UI for Taskman.

## Run

Start the backend first on `http://localhost:8080`.

Then run:

```bash
docker rm -f taskman-react-ui 2>/dev/null || true
docker compose up --build
```

Open `http://localhost:3000`.

## Important

This package intentionally does not include `package-lock.json` because a stale lock file caused Docker to build without Vite.
The Dockerfile installs from `package.json`, verifies `node_modules/vite/bin/vite.js`, and runs Vite directly.
