# JWT Authentication Implementation

## Overview
Secure JWT-based authentication with refresh tokens stored in database.

## Features
✅ JWT signature verification
✅ Token expiration checks  
✅ Database validation of refresh tokens
✅ Secure token generation with proper claims
✅ Constant-time comparison for security
✅ Token revocation support

## Environment Variables
```env
JWT_SECRET=CHANGE_THIS_TO_A_SECURE_RANDOM_STRING_IN_PRODUCTION
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

**IMPORTANT:** Generate a secure JWT_SECRET before production:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Usage

### Protecting Routes
```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CurrentUser } from './modules/auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile(@CurrentUser() user: any) {
  return user;
}
```

### Login Flow
1. User logs in with credentials
2. Server validates and returns access + refresh tokens
3. Client stores tokens securely
4. Client sends access token in Authorization header: `Bearer <token>`

### Token Refresh Flow
1. When access token expires, client calls `/auth/refresh` with refresh token
2. Server validates refresh token against database
3. Server issues new access token
4. Client updates stored access token

## Security Features

### Access Token Claims
- `sub`: User ID
- `email`: User email
- `role`: User role
- `exp`: Expiration time (15 minutes)

### Refresh Token Claims
- `sub`: User ID
- `type`: "refresh"
- `exp`: Expiration time (7 days)

### Database Validation
Refresh tokens are stored in `refresh_tokens` table with:
- Unique token value
- User association
- Expiration timestamp
- Revocation timestamp (for logout)

## API Endpoints

### POST /auth/login
```json
{
  "email": "user@example.com",
  "password": "password"
}
```
Returns: `{ accessToken, refreshToken, user }`

### POST /auth/refresh
```json
{
  "refreshToken": "..."
}
```
Returns: `{ accessToken }`

## TODO for Production
- [ ] Implement bcrypt password hashing
- [ ] Add rate limiting on auth endpoints
- [ ] Implement token blacklisting for logout
- [ ] Add 2FA support
- [ ] Implement password complexity requirements
- [ ] Add account lockout after failed attempts
