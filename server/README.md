## Server Setup

The backend now uses MongoDB for users, rooms, collaborators, and OAuth-linked accounts.

### Environment

Add these values to `server/.env`:

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=codechatter
```

For local mock validation only, you can use:

```env
MONGODB_URI=mongomock://localhost
MONGODB_DB_NAME=codechatter_test
```

### Install

```powershell
cd server
.\venv\Scripts\pip install -r requirements.txt
```

### Run

```powershell
cd server
.\venv\Scripts\uvicorn main:app --reload
```

On first startup, the server will:

1. Create MongoDB indexes for users and rooms.
2. Import legacy data from `server/data/storage.json` if the Mongo database is empty.
3. Seed featured public rooms if no rooms exist yet.
