# Taskman React UI Refactor

This is the componentized enterprise React UI for Taskman.

## Structure

```text
src/
  App.js
  api/client.js
  context/WorkspaceContext.jsx
  layout/
  components/
  screens/
  styles.css
```

## Run locally

```bash
npm install
npm run dev
```

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Default backend API: `http://localhost:8080/api`.
