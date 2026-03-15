const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// Secret key for JWT (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// In-memory user storage (use a database in production)
const users = [];

// Middleware
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Passport configuration
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = users.find(u => u.id === id);
    done(null, user);
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET',
    callbackURL: 'http://localhost:3000/api/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
    // Find or create user
    let user = users.find(u => u.googleId === profile.id);
    
    if (!user) {
        user = {
            id: users.length + 1,
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            provider: 'google'
        };
        users.push(user);
    }
    
    return done(null, user);
}));

// GitHub OAuth Strategy
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID || 'YOUR_GITHUB_CLIENT_ID',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || 'YOUR_GITHUB_CLIENT_SECRET',
    callbackURL: 'http://localhost:3000/api/auth/github/callback'
}, (accessToken, refreshToken, profile, done) => {
    // Find or create user
    let user = users.find(u => u.githubId === profile.id);
    
    if (!user) {
        user = {
            id: users.length + 1,
            githubId: profile.id,
            email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
            name: profile.displayName || profile.username,
            provider: 'github'
        };
        users.push(user);
    }
    
    return done(null, user);
}));

// Helper function to generate JWT
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
};

// Routes

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }
        
        // Check if user already exists
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: users.length + 1,
            email,
            password: hashedPassword,
            provider: 'local',
            createdAt: new Date()
        };
        
        users.push(user);
        
        // Generate token
        const token = generateToken(user);
        
        // Return user data (without password)
        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: user.id,
                email: user.email,
                provider: user.provider
            }
        });
    } catch (error) {
        console.error('Sign up error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Sign In
app.post('/api/auth/signin', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        
        // Find user
        const user = users.find(u => u.email === email && u.provider === 'local');
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Generate token
        const token = generateToken(user);
        
        // Return user data
        res.json({
            message: 'Sign in successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                provider: user.provider
            }
        });
    } catch (error) {
        console.error('Sign in error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Google OAuth routes
app.get('/api/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/api/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: 'http://localhost:5500/index.html' }),
    (req, res) => {
        const token = generateToken(req.user);
        const userJson = encodeURIComponent(JSON.stringify({
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            provider: req.user.provider
        }));
        res.redirect(`http://localhost:5500/index.html?token=${token}&user=${userJson}`);
    }
);

// GitHub OAuth routes
app.get('/api/auth/github',
    passport.authenticate('github', { scope: ['user:email'] })
);

app.get('/api/auth/github/callback',
    passport.authenticate('github', { session: false, failureRedirect: 'http://localhost:5500/index.html' }),
    (req, res) => {
        const token = generateToken(req.user);
        const userJson = encodeURIComponent(JSON.stringify({
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            provider: req.user.provider
        }));
        res.redirect(`http://localhost:5500/index.html?token=${token}&user=${userJson}`);
    }
);

// Protected route example
app.get('/api/user/profile', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json({
            id: user.id,
            email: user.email,
            provider: user.provider,
            name: user.name
        });
    } catch (error) {
        res.status(401).json({ message: 'Invalid token' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api`);
});