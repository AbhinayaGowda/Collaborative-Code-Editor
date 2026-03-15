# Authentication Application

A complete authentication system with email/password login and OAuth integration for Google and GitHub.

## Features

- ✨ Clean, modern UI design
- 📧 Email/Password authentication
- 🔐 Secure password hashing with bcrypt
- 🎫 JWT token-based authentication
- 🌐 Google OAuth 2.0 integration
- 🐙 GitHub OAuth integration
- 📱 Responsive design
- 🔒 Protected dashboard route
- 💾 Token persistence with localStorage

## Tech Stack

### Frontend
- HTML5
- CSS3 (vanilla, no frameworks)
- JavaScript (ES6+)

### Backend
- Node.js
- Express.js
- Passport.js (OAuth)
- JWT (JSON Web Tokens)
- bcryptjs (password hashing)

## Project Structure

```
.
├── index.html          # Login/Signup page
├── dashboard.html      # Protected dashboard page
├── styles.css          # Styling for login page
├── app.js             # Frontend JavaScript
├── server.js          # Backend server
├── package.json       # Node.js dependencies
└── .env.example       # Environment variables template
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

### 3. Set Up Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

### 4. Set Up GitHub OAuth (Optional)

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
4. Copy Client ID and Client Secret to `.env`

### 5. Start the Backend Server

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

Server will run on `http://localhost:3000`

### 6. Start the Frontend

You can use any static file server. Here are some options:

**Option 1: Using VS Code Live Server**
- Install Live Server extension
- Right-click on `index.html` and select "Open with Live Server"

**Option 2: Using Python**
```bash
python -m http.server 5500
```

**Option 3: Using npx**
```bash
npx serve .
```

Frontend will typically run on `http://localhost:5500`

## API Endpoints

### Authentication

- `POST /api/auth/signup` - Create new account
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

- `POST /api/auth/signin` - Sign in with email/password
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/github` - Initiate GitHub OAuth

### Protected Routes

- `GET /api/user/profile` - Get user profile (requires JWT token)
  - Header: `Authorization: Bearer <token>`

### Health Check

- `GET /api/health` - Server health check

## Usage

### Sign Up Flow

1. Open `http://localhost:5500` in your browser
2. Click "Sign up" link
3. Enter email and password
4. Click "Sign up" button
5. Automatically redirected to dashboard

### Sign In Flow

1. Open `http://localhost:5500`
2. Enter email and password
3. Click "Sign in" button
4. Redirected to dashboard

### OAuth Flow

1. Click "Continue with Google" or "Continue with GitHub"
2. Complete OAuth authentication
3. Redirected back to app with token
4. Automatically logged in and redirected to dashboard

## Security Notes

⚠️ **This is a demo application. For production use:**

1. **Use a database** instead of in-memory storage
2. **Use environment variables** for all secrets
3. **Enable HTTPS** for all communications
4. **Add rate limiting** to prevent brute force attacks
5. **Add email verification** for new accounts
6. **Implement password reset** functionality
7. **Add CSRF protection**
8. **Sanitize user inputs** to prevent XSS
9. **Use secure session management**
10. **Add proper error logging**

## Customization

### Change Colors

Edit `styles.css` and modify these variables:
- Primary color: `#4F46E5`
- Background gradient: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`

### Change Logo

Replace the SVG in the `.logo` section of `index.html` and `dashboard.html`

### Add More OAuth Providers

1. Install the appropriate Passport strategy
2. Configure it in `server.js`
3. Add button in `index.html`
4. Add click handler in `app.js`

## Troubleshooting

### "CORS Error"
- Make sure the backend server is running on port 3000
- Check that CORS is enabled in `server.js`

### "OAuth Redirect Failed"
- Verify OAuth credentials in `.env`
- Check redirect URIs match in OAuth provider settings

### "Token Invalid"
- Token might be expired (7 day expiry)
- Clear localStorage and sign in again

### "Cannot POST /api/auth/signup"
- Ensure backend server is running
- Check `API_BASE_URL` in `app.js` matches your backend URL

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!