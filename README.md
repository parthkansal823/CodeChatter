## Deployment

This project is set up to deploy as a single service:

- the Vite client builds to static assets
- FastAPI serves the built frontend
- the whole app can run from one container

### Required Environment

Use [server/.env.example](/D:/Project_With_Niyati/New%20folder/CodeChatterNK/server/.env.example) as the backend template.

Important values:

- `FRONTEND_URL` should be your public app URL, for example `https://your-domain.example`
- `ALLOWED_ORIGINS` should include that same frontend origin
- `MONGODB_URI` should point to your deployed MongoDB instance
- `SECRET_KEY` and `SESSION_SECRET_KEY` should be long random secrets

If you deploy the frontend separately, use [client/.env.example](/D:/Project_With_Niyati/New%20folder/CodeChatterNK/client/.env.example) and set `VITE_API_URL`.

### Docker

Build the image:

```bash
docker build -t codechatter .
```

Run it:

```bash
docker run --env-file server/.env -p 8000:8000 codechatter
```

Health check:

```text
GET /api/health
```

## Notes

- Routes like `/auth`, `/home`, and `/room/<id>` load correctly after the frontend build is present.
- OAuth redirect URLs should use your deployed public domain.
- The collaborative terminal feature requires WebSocket support and a host environment that allows shell processes.

## License & Usage

Copyright (c) 2026 Parth Kansal and Niyati. All Rights Reserved.
This project is a joint academic work developed by the authors.

No part of this repository, including source code, documentation, design, or associated materials, may be used, reproduced, modified, distributed, or transmitted in any form or by any means without the prior written permission of both authors.

Unauthorized use is strictly prohibited.
