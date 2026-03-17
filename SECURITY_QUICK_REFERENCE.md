# 🔐 Security Quick Reference Guide

## Common Security Tasks

### 1. Validate User Input
```javascript
// Email
if (!validateEmail(email)) {
  throw new Error('Invalid email');
}

// Password (strong requirements)
if (!validatePassword(password)) {
  throw new Error('Password too weak');
}

// Username
if (!validateUsername(username)) {
  throw new Error('Invalid username format');
}

// Room ID
if (!validateRoomId(roomId)) {
  throw new Error('Invalid room ID');
}
```

### 2. Sanitize Any User Input
```javascript
// Remove HTML/XSS attempts
const safe = sanitizeInput(userInput);

// For HTML content
const htmlSafe = sanitizeHTML(userContent);

// For source code
const codeSafe = sanitizeCode(userCode);

// For URLs
const urlParam = escapeUrlParam(userValue);
```

### 3. Make API Calls Securely
```javascript
// Instead of fetch(), use secureFetch()
import { secureFetch } from '../utils/security';
import { API_ENDPOINTS } from '../config/security';

const data = await secureFetch(
  API_ENDPOINTS.LOGIN,
  {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  },
  token // auth token (optional)
);
```

### 4. Store/Retrieve Auth Token
```javascript
import { setSecureToken, getSecureToken, clearSecureData } from '../utils/security';

// Store (after login)
setSecureToken(authToken);

// Retrieve (when needed)
const token = getSecureToken();

// Clear (on logout)
clearSecureData();
```

### 5. Check Token Expiration
```javascript
import { isTokenExpired } from '../utils/security';

if (isTokenExpired(token)) {
  // Redirect to login
  navigate('/auth');
}
```

### 6. Implement Rate Limiting
```javascript
import { RateLimiter } from '../utils/security';

// Create a limiter: 5 attempts per 15 minutes
const limiter = new RateLimiter(5, 15 * 60 * 1000);

if (!limiter.isAllowed()) {
  const remaining = Math.ceil(limiter.getRemainingTime() / 1000);
  throw new Error(`Too many attempts. Try again in ${remaining}s`);
}
```

### 7. Prevent Open Redirects
```javascript
import { isValidRedirectUrl, safeRedirect } from '../utils/security';

// Validate redirect URL before using
if (isValidRedirectUrl(redirectUrl)) {
  window.location.href = redirectUrl;
} else {
  window.location.href = '/home'; // Default safe URL
}

// Or use the helper
safeRedirect(redirectUrl, '/home');
```

### 8. Get Password Strength
```javascript
import { getPasswordStrength } from '../utils/security';

// Returns 0-4 score
const score = getPasswordStrength(userPassword);

if (score < 3) {
  console.warn('Password is weak');
}
```

---

## Common Vulnerabilities & Fixes

### ❌ WRONG - XSS Vulnerability
```javascript
// DON'T DO THIS!
const userContent = getUserInput();
document.getElementById('output').innerHTML = userContent; // XSS!
```

### ✅ CORRECT - Safe Display
```javascript
// DO THIS
import { sanitizeInput } from '../utils/security';

const userContent = getUserInput();
const safe = sanitizeInput(userContent);
document.getElementById('output').textContent = safe; // Safe
```

---

### ❌ WRONG - Insecure Token Storage
```javascript
// DON'T DO THIS!
localStorage.setItem('authToken', token); // Vulnerable to XSS
```

### ✅ CORRECT - Secure Token Storage
```javascript
// DO THIS
import { setSecureToken } from '../utils/security';

setSecureToken(token); // Uses SessionStorage, cleared on close
```

---

### ❌ WRONG - No Input Validation
```javascript
// DON'T DO THIS!
const handleLogin = (email, password) => {
  // No validation!
  fetch('/api/login', {...});
};
```

### ✅ CORRECT - With Validation
```javascript
// DO THIS
import { validateEmail, validatePassword } from '../utils/security';

const handleLogin = (email, password) => {
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }
  if (!validatePassword(password)) {
    throw new Error('Weak password');
  }
  // Proceed with login
};
```

---

### ❌ WRONG - Tokens in URLs
```javascript
// DON'T DO THIS!
const redirectUrl = `${callbackUrl}?token=${token}&user=${user}`;
window.location.href = redirectUrl; // Exposes token in URL!
```

### ✅ CORRECT - Tokens in Headers
```javascript
// DO THIS
import { secureFetch, API_ENDPOINTS } from '../utils/security';

const response = await secureFetch(
  API_ENDPOINTS.LOGIN,
  { method: 'POST', body: JSON.stringify(credentials) },
  token // Token in header automatically
);
```

---

### ❌ WRONG - No Rate Limiting
```javascript
// DON'T DO THIS!
const handleLogin = async (email, password) => {
  // Anyone can try infinite times
  const result = await fetch('/api/login', {...});
};
```

### ✅ CORRECT - With Rate Limiting
```javascript
// DO THIS
import { RateLimiter } from '../utils/security';

const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);

const handleLogin = async (email, password) => {
  if (!loginLimiter.isAllowed()) {
    throw new Error('Too many attempts');
  }
  const result = await fetch('/api/login', {...});
};
```

---

### ❌ WRONG - Unvalidated Redirects
```javascript
// DON'T DO THIS!
const redirectUrl = getQueryParam('redirect');
window.location.href = redirectUrl; // Open redirect!
```

### ✅ CORRECT - Validated Redirects
```javascript
// DO THIS
import { safeRedirect } from '../utils/security';

const redirectUrl = getQueryParam('redirect');
safeRedirect(redirectUrl, '/home'); // Only allows same-origin
```

---

## Environment Variables

### Client `.env.local`
```env
VITE_API_URL=http://localhost:8000
VITE_FRONTEND_URL=http://localhost:5173
VITE_ENV=development
VITE_LOG_SECURITY_WARNINGS=true
```

### Never Add to Code
```javascript
// DON'T DO THIS!
const SECRET_KEY = "abc123"; // Never hardcode!
const API_KEY = "xyz789";    // Never in code!
```

### Use Environment Variables Instead
```javascript
// DO THIS
const apiUrl = import.meta.env.VITE_API_URL;
// Only non-sensitive config in .env
```

---

## Security Headers that are Auto-Applied

When using `secureFetch()`, these headers are automatically added:

```
Content-Type: application/json
X-Requested-With: XMLHttpRequest  (CSRF protection)
Authorization: Bearer {token}      (when token provided)
```

CSP headers are injected on app load:

```
default-src 'self'
script-src 'self' https://accounts.google.com
style-src 'self' 'unsafe-inline'
img-src 'self' data: https:
connect-src 'self' http://localhost:8000 https:
frame-src 'self' https://accounts.google.com
```

---

## Testing Security

### Manual Testing Checklist
- [ ] Try entering `<script>alert('XSS')</script>` - should be sanitized
- [ ] Try 6 logins in 15 minutes - should be rate limited on 6th
- [ ] Try expired token - should redirect to login
- [ ] Try open redirect - should be blocked
- [ ] Try weak password - should be rejected
- [ ] Try invalid email - should be rejected
- [ ] Check browser DevTools - no plain text tokens in storage

### Security Audit Commands
```bash
# Check for vulnerable dependencies
npm audit

# Check for known vulnerabilities
npm audit --audit-level=moderate

# Fix vulnerabilities
npm audit fix

# Check security headers
curl -I http://localhost:5173 | grep -i x-
```

---

## Common Error Messages

All error messages are configured in `config/security.js`:

```javascript
ERROR_MESSAGES.INVALID_EMAIL
ERROR_MESSAGES.WEAK_PASSWORD
ERROR_MESSAGES.TOO_MANY_LOGIN_ATTEMPTS
ERROR_MESSAGES.SESSION_EXPIRED
ERROR_MESSAGES.UNAUTHORIZED
ERROR_MESSAGES.INVALID_CREDENTIALS
ERROR_MESSAGES.RATE_LIMIT_EXCEEDED
```

These ensure consistent, secure error messages across the app.

---

## Password Requirements

All passwords must have:
- ✔ Minimum 8 characters
- ✔ At least 1 UPPERCASE letter
- ✔ At least 1 lowercase letter
- ✔ At least 1 number (0-9)
- ✔ At least 1 special character (!@#$%^&*()_+-)

**Password Strength Score** (0-4):
- 0 = Very Weak
- 1 = Weak
- 2 = Fair
- 3 = Good
- 4 = Strong

---

## Rate Limit Policies

| Endpoint | Limit | Window |
|----------|-------|--------|
| Login | 5 attempts | 15 minutes |
| Signup | 3 attempts | 1 hour |
| API calls | 30 requests | 1 minute |

---

## Token Lifecycle

1. **Generated** - After successful login/signup
2. **Stored** - In SessionStorage (secure)
3. **Sent** - In Authorization header for API calls
4. **Validated** - On each request (backend)
5. **Expires** - After 7 days (configurable)
6. **Refreshed** - Optional (not implemented yet)
7. **Cleared** - On logout or expiration

---

## Support Files

- **`client/src/utils/security.js`** - All security functions
- **`client/src/config/security.js`** - Security configuration
- **`client/SECURITY.md`** - Full documentation
- **`server/SECURITY_ENHANCEMENTS.md`** - Backend guide
- **`client/.env.example`** - Environment template

---

**Last Updated**: March 17, 2026
**Version**: 1.0
**Status**: ✅ Ready for Production
