# Taskman Backend Only

Backend-only MVP for Taskman: a multi-tenant Jira-like task manager API with Postgres, JWT auth, sprint planning, issue boards, comments, reports, heuristic AI endpoints, and Server-Sent Events realtime updates.

## Run

```bash
docker rm -f taskman-backend taskman-postgres 2>/dev/null || true
docker compose down -v --remove-orphans
docker compose up --build
```

Backend URL:

```text
http://localhost:8080
```

Health check:

```text
http://localhost:8080/api/health
```

Swagger docs:

```text
http://localhost:8080/docs
```

## Main flow

1. List or create tenant.
2. Signup under tenant or create tenant during signup.
3. Login with tenant ID, email, password.
4. Use the returned Bearer token for all protected APIs.
5. Create projects.
6. Create backlog issues.
7. Create sprints.
8. Add issues to sprints.
9. Start/complete sprints.
10. Listen to realtime events over SSE.

## Example curl

Create tenant during signup:

```bash
curl -X POST http://localhost:8080/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Subham Kumar",
    "email":"subham@example.com",
    "password":"password123",
    "tenant_name":"Grabbit"
  }'
```

Login:

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id":"TENANT_ID",
    "email":"subham@example.com",
    "password":"password123"
  }'
```

Create project:

```bash
curl -X POST http://localhost:8080/api/projects \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{"name":"Customer App","key":"CAPP","description":"Customer-facing app work"}'
```

Create issue:

```bash
curl -X POST http://localhost:8080/api/issues \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "project_id":"PROJECT_ID",
    "title":"Build login screen",
    "issue_type":"TASK",
    "priority":"HIGH",
    "story_points":3
  }'
```

SSE stream:

```text
GET /api/events/stream?token=TOKEN
```

## Key endpoints

### Auth

```text
POST /api/auth/signup
POST /api/auth/login
GET  /api/auth/me
```

### Tenants

```text
GET  /api/tenants
POST /api/tenants
GET  /api/tenants/current
GET  /api/tenants/{tenant_id}/members
POST /api/tenants/{tenant_id}/members
```

### Projects

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
DELETE /api/projects/{project_id}
```

### Issues

```text
GET    /api/issues
POST   /api/issues
GET    /api/issues/{issue_id}
PATCH  /api/issues/{issue_id}
DELETE /api/issues/{issue_id}
PATCH  /api/issues/{issue_id}/status
PATCH  /api/issues/{issue_id}/sprint
PATCH  /api/issues/reorder
```

### Sprints

```text
GET  /api/sprints
POST /api/sprints
GET  /api/sprints/{sprint_id}
PATCH /api/sprints/{sprint_id}
POST /api/sprints/{sprint_id}/start
POST /api/sprints/{sprint_id}/complete
POST /api/sprints/{sprint_id}/issues
```

### Comments

```text
GET  /api/issues/{issue_id}/comments
POST /api/issues/{issue_id}/comments
```

### Reports

```text
GET /api/reports/dashboard
GET /api/reports/sprint/{sprint_id}
```

### AI helper endpoints

```text
POST /api/ai/breakdown
POST /api/ai/acceptance-criteria
POST /api/ai/sprint-plan
POST /api/ai/sprint-insights
```

### Realtime

```text
GET /api/events/stream?token=TOKEN
```

## Notes

- Data is isolated by tenant.
- JWT contains user ID, tenant ID, and role.
- First user in a new tenant becomes OWNER.
- Existing tenant signup creates MEMBER role.
- SSE events are in-memory and tenant-scoped. For multi-instance production, replace the in-memory event bus with Redis Pub/Sub or Postgres LISTEN/NOTIFY.
