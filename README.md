# D'Decor Workboard

A Monday.com-style project management board built with React + Express + PostgreSQL.

## Features
- 20 column types: text, long text, number, status, date, person, checkbox, dropdown, link, email, phone, rating, progress, timeline, tags, color, file, time tracking, formula, location
- Status columns with fully customizable colorful options
- Automations that fire on trigger and open Outlook mailto for email actions
- Toast notifications for all actions
- Full PostgreSQL CRUD for all entities
- Seed data loads automatically on first run

---

## Setup

### 1. Create PostgreSQL Database
```bash
createdb workboard_db
```

### 2. Run Schema
```bash
psql -U postgres -d workboard_db -f db/schema.sql
```

### 3. Configure Environment
Edit `backend/.env` and set your DB credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=workboard_db
DB_USER=postgres
DB_PASSWORD=your_password
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 4. Start Backend
```bash
cd backend
npm install
npm run dev
```
Seed data is inserted automatically on first run.

### 5. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

### 6. Open App
http://localhost:5173

---

## Column Types (20 total)
| Type | Description |
|------|-------------|
| text | Single-line text |
| long_text | Multi-line textarea |
| number | Numeric input |
| status | Colored label picker with custom options |
| date | Date picker |
| person | Name/owner text |
| checkbox | True/false toggle |
| dropdown | Select from predefined list |
| link | Clickable URL |
| email | Email address input |
| phone | Phone number input |
| rating | 1–5 star rating |
| progress | 0–100% with color bar |
| timeline | Start → End date range |
| tags | Comma-separated tag pills |
| color_picker | Color swatch picker |
| file | File name / path |
| time_tracking | Hours:minutes input |
| formula | Read-only computed field |
| location | City/country text |

## Automations
- **Trigger:** Status changes to a value / Item created / Date arrives
- **Action:** Send email (opens Outlook mailto) / Show notification

To configure: click **⚡ Automations** in the toolbar.
