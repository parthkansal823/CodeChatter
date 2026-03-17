# 🔒 Server Security Enhancements for FastAPI Backend

This guide provides security improvements for the CodeChatter backend server.

## Current Security Issues in `main.py`

1. ❌ Hardcoded SECRET_KEY: `"your-secret-key-change-this"`
2. ❌ Overly permissive CORS: `allow_methods=["*"], allow_headers=["*"]`
3. ❌ Session secret key hardcoded: `"supersecretkey"`
4. ❌ OAuth credentials exposed in environment (but at least in .env)
5. ❌ JWT tokens passed in URL query parameters (should be headers)
6. ❌ No input validation on OAuth callbacks
7. ❌ No rate limiting
8. ❌ No HTTPS enforcement in production
9. ❌ No password hashing implementation
10. ❌ No database layer shown

## Required Implementations

### 1. Secure Secret Key Management

```python
import secrets
from dotenv import load_dotenv
import os

load_dotenv()

# Get from environment, generate if not set
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if os.getenv("ENVIRONMENT") == "production":
        raise ValueError("SECRET_KEY must be set in production")
    # Generate for development
    SECRET_KEY = secrets.token_urlsafe(32)

# Ensure strong key in production
if os.getenv("ENVIRONMENT") == "production":
    if len(SECRET_KEY) < 32:
        raise ValueError("SECRET_KEY must be at least 32 characters")
```

### 2. Secure CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
ALLOWED_HEADERS = ["Content-Type", "Authorization"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=ALLOWED_METHODS,
    allow_headers=ALLOWED_HEADERS,
    max_age=3600,
)
```

### 3. Security Headers Middleware

```python
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response

app.add_middleware(SecurityHeadersMiddleware)
```

### 4. Password Hashing

```python
from passlib.context import CryptContext

# Use bcrypt for password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
```

### 5. Input Validation & Pydantic Models

```python
from pydantic import BaseModel, EmailStr, constr, validator

class LoginRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=8, max_length=128)

class SignupRequest(BaseModel):
    email: EmailStr
    username: constr(min_length=3, max_length=32, regex=r'^[a-zA-Z0-9_-]+$')
    password: constr(min_length=8, max_length=128)

    @validator('password')
    def validate_password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain digit')
        if not any(c in '!@#$%^&*()_+-=' for c in v):
            raise ValueError('Password must contain special character')
        return v
```

### 6. Rate Limiting

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/auth/login")
@limiter.limit("5/15minutes")
async def login(request: Request, credentials: LoginRequest):
    # Login logic
    pass

@app.post("/api/auth/signup")
@limiter.limit("3/hour")
async def signup(request: Request, user_data: SignupRequest):
    # Signup logic
    pass
```

### 7. Secure OAuth Callback (Don't pass in URL)

```python
from starlette.responses import HTMLResponse

@app.get("/auth/google/callback")
async def auth_google_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
        user = token["userinfo"]

        email = user.get("email")
        name = user.get("name")
        user_id = user.get("sub")

        # Validate inputs
        if not email or not isinstance(email, str):
            raise ValueError("Invalid email from OAuth provider")

        # Create JWT token
        payload = {
            "sub": user_id,
            "email": email,
            "username": name.split()[0] if name else email.split("@")[0],
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(days=7)
        }
        jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        # Don't pass tokens in URL! Use HTTP-only cookies instead
        response = RedirectResponse(url="/auth/success")
        response.set_cookie(
            key="auth_token",
            value=jwt_token,
            httponly=True,
            secure=True,  # HTTPS only
            samesite="lax",
            max_age=7*24*60*60
        )
        return response

    except Exception as e:
        logger.error(f"OAuth error: {str(e)}")
        return RedirectResponse(url="/auth?error=oauth_failed")
```

### 8. JWT Token Validation Middleware

```python
from fastapi import Depends, HTTPException, status
from jose import JWTError, jwt

async def verify_token(request: Request):
    # Try to get token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing token")

    try:
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            raise ValueError("Invalid auth scheme")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Invalid token payload")
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid token")

    return payload

@app.get("/api/auth/me")
async def get_current_user(payload: dict = Depends(verify_token)):
    # Return user info
    return {"id": payload["sub"], "email": payload["email"]}
```

### 9. Database Security (SQLAlchemy)

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Use parameterized queries (automatic with SQLAlchemy ORM)
@app.post("/api/auth/login")
async def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    # This uses parameterized queries automatically (safe from SQL injection)
    user = db.query(User).filter(User.email == credentials.email).first()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Generate and return token
    return {"token": generate_jwt_token(user), "user": user}
```

### 10. Logging without Sensitive Data

```python
import logging

logger = logging.getLogger(__name__)

def log_auth_attempt(email: str, success: bool):
    # Log email (hashed) but never password
    email_hash = hashlib.sha256(email.encode()).hexdigest()[:8]
    logger.info(f"Auth attempt for {email_hash}: {'success' if success else 'failed'}")

# In login endpoint
try:
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.hashed_password):
        log_auth_attempt(credentials.email, False)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    log_auth_attempt(credentials.email, True)
    # Return token
except Exception as e:
    logger.error(f"Unexpected error in login: {str(e)}")
    raise HTTPException(status_code=500, detail="Internal server error")
```

## Updated `.env` for Server

```env
# Security
ENVIRONMENT=development  # or 'production'
SECRET_KEY=your-secure-random-key-min-32-chars-here
SESSION_SECRET_KEY=another-secure-random-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_DAYS=7

# Database
DATABASE_URL=sqlite:///./test.db
# For production: postgresql://user:password@host/dbname

# OAuth Credentials (KEEP SECURE!)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-secret

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
# For production: https://yourdomain.com

# HTTPS
FORCE_HTTPS=false
# For production: true

# Logging
LOG_LEVEL=INFO
# For debugging: DEBUG
```

## Installation Requirements

Update `requirements.txt`:

```
fastapi==0.104.1
uvicorn==0.24.0
python-dotenv==1.0.0
python-jose==3.3.0
passlib==1.7.4
bcrypt==4.1.1
pydantic==2.5.0
pydantic[email]==2.5.0
sqlalchemy==2.0.23
python-multipart==0.0.6
authlib==1.3.0
slowapi==0.1.9
```

Install with:
```bash
pip install -r requirements.txt
```

## Deployment Checklist

- [ ] Set `ENVIRONMENT=production`
- [ ] Generate strong SECRET_KEY (32+ chars): `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- [ ] Generate strong SESSION_SECRET_KEY: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- [ ] Update CORS allowed origins (no wildcards)
- [ ] Enable HTTPS (set FORCE_HTTPS=true)
- [ ] Setup database (PostgreSQL recommended)
- [ ] Configure OAuth credentials securely
- [ ] Enable logging and monitoring
- [ ] Setup automated backups
- [ ] Run security audit: `pip install pip-audit && pip-audit`
- [ ] Run tests: `pytest`
- [ ] Setup rate limiting persistence (Redis)
- [ ] Enable error tracking (Sentry, etc.)

## Security Testing

```bash
# Run security checks
bandit -r . -ll

# Check for vulnerable dependencies
pip-audit

# Run tests
pytest -v

# Load testing (after fixing security issues)
locust -f locustfile.py
```

## Next Steps

1. Implement all the above security measures
2. Add database models and migrations
3. Implement proper session management
4. Add 2FA support
5. Setup monitoring and alerting
6. Regular security audits
7. Keep dependencies updated
