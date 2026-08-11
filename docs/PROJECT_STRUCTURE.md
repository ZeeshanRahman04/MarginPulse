# Project Structure

The project is split into separate frontend and backend packages.

```text
.
├── frontend/                    # React + Vite UI
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── App.jsx          # App shell, auth state, navigation, routes
│   │   │   └── App.css
│   │   ├── components/
│   │   ├── data/
│   │   ├── features/
│   │   ├── services/
│   │   ├── styles/
│   │   ├── utils/
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/                     # Express API + SQLite
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── jobs/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   └── index.js
│   ├── tests/
│   ├── backup.js
│   ├── restore.js
│   └── package.json
├── docs/
├── scripts/
└── package.json                 # npm workspaces root
```
