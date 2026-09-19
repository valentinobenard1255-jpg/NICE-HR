# PeoplePilot HR — Full-stack HR system

PeoplePilot HR is a responsive HR website for a 22-person company. The UI is in English and now includes authentication, a SQLite database, a backend API and role-based permissions.

## Included modules

- Secure login and logout using an HTTP-only session cookie
- Password hashing with `bcryptjs`
- SQLite database with automatic schema creation and seed data
- Employee directory and add-employee flow
- Attendance tracking and check-in actions
- Leave requests and approval workflow
- Payroll summary and monthly payroll items
- Reports and workspace settings
- Users & permissions screen
- Audit log table for important security and HR actions

## Roles and permissions

| Role | Access |
| --- | --- |
| **HR Administrator** | Employees, attendance, leave, payroll, reports, settings and user access management |
| **Manager** | View employees and attendance, create/approve leave, view reports |
| **Employee** | Self-service permissions for personal leave, attendance and payroll (endpoint-ready) |
| **Super Admin** | All permissions (`*`) |

The backend enforces these permissions on every protected endpoint. Hiding a button in the UI is not the security boundary; API middleware performs the actual authorization.

## Run locally

Requirements: Node.js 20+ and pnpm.

```bash
cd hr-system
pnpm install
cp .env.example .env
pnpm start
```

Open <http://localhost:8080>.

The database is created automatically at `data/peoplepilot.sqlite` on first start. Do not commit the `data/` directory or `.env` file.

## Seeded local accounts

These accounts are created only when the database is empty. Change them in `.env` before using the system outside local development.

| Role | Email | Password |
| --- | --- | --- |
| HR Administrator | `admin@northstar.studio` | `Admin@12345` |
| Manager | `manager@northstar.studio` | `Manager@12345` |
| Employee | `employee@northstar.studio` | `Employee@12345` |
| Super Admin | `owner@northstar.studio` | `Owner@12345` |

The **Super Admin** account has full access to every permission, including user roles, settings and payroll actions.

## Publish publicly on Render

The included `render.yaml` is a Render Blueprint. To publish the system:

1. Push the `hr-system` folder to a GitHub repository.
2. Open [Render Dashboard](https://dashboard.render.com/) and choose **New → Blueprint**.
3. Connect the repository and deploy `render.yaml`.
4. Enter new production passwords when Render asks for the `sync: false` variables. Do not use the demo passwords in production.
5. Render will provide a public `onrender.com` URL. Attach your own domain from the service settings if needed.

The Blueprint uses a persistent disk for SQLite. Render persistent disks require a paid web-service plan and support one service instance. For larger or multi-instance production use, move the database to managed PostgreSQL.

## API routes

All routes except `/api/health` and login require an authenticated session. Examples of protected endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET/POST /api/employees`
- `GET/POST /api/attendance`, `/api/attendance/mark`
- `GET/POST /api/leave`, `PATCH /api/leave/:id/approve`
- `GET /api/payroll/current`, `POST /api/payroll/run`
- `GET /api/reports/summary`
- `GET/PUT /api/settings`
- `GET /api/users`, `PATCH /api/users/:id/role`, `PATCH /api/users/:id/status`

## Production checklist

Before deploying for real HR or payroll data:

1. Set a long, random `JWT_SECRET` and use HTTPS.
2. Replace the seeded passwords and create an account provisioning flow.
3. Move SQLite to PostgreSQL or another managed database for multi-instance deployment.
4. Configure country-specific tax, pension, benefits and statutory deductions; the current 20% payroll deduction is illustrative only.
5. Add password reset, MFA, rate limiting, CSRF protection, backups, audit-log retention and monitoring.
6. Review privacy, retention and access policies for employee data.
