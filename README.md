# Duplicate Poker — Deploy Guide

## What You Need
- A Google account (for Firebase)
- A GitHub account  
- 15 minutes

## Step 1: Firebase Setup (Database)

1. Go to https://console.firebase.google.com/
2. Click **"Create a project"** → name it `duplicate-poker` → Continue
3. (Disable Google Analytics if asked) → **Create Project**
4. In the left sidebar → **Build** → **Firestore Database**
5. Click **"Create database"** → Start in **test mode** → Choose any location → **Enable**
6. In the left sidebar → click the **gear icon** → **Project settings**
7. Scroll down → **"Your apps"** → click the **</>** (web) icon
8. Register app name: `duplicate-poker` → **Register app**
9. You'll see a config block like this — **copy these 6 values**:
   ```
   apiKey: "AIza..."
   authDomain: "duplicate-poker-xxxxx.firebaseapp.com"
   projectId: "duplicate-poker-xxxxx"
   storageBucket: "duplicate-poker-xxxxx.appspot.com"
   messagingSenderId: "123456789"
   appId: "1:123456789:web:abc123"
   ```

## Step 2: GitHub (Code Hosting)

1. Go to https://github.com → **New repository**
2. Name: `duplicate-poker` → **Public** → **Create repository**
3. Upload all files from this project folder to the repository
   - Or use git: `git init && git add . && git commit -m "init" && git remote add origin YOUR_URL && git push -u origin main`

## Step 3: Vercel (Free Hosting)

1. Go to https://vercel.com → Sign in with GitHub
2. Click **"Add New Project"** → Import your `duplicate-poker` repo
3. **Framework Preset**: Vite
4. Expand **"Environment Variables"** → Add these 6 variables:
   ```
   VITE_FIREBASE_API_KEY            → paste your apiKey
   VITE_FIREBASE_AUTH_DOMAIN        → paste your authDomain  
   VITE_FIREBASE_PROJECT_ID         → paste your projectId
   VITE_FIREBASE_STORAGE_BUCKET     → paste your storageBucket
   VITE_FIREBASE_MESSAGING_SENDER_ID → paste your messagingSenderId
   VITE_FIREBASE_APP_ID             → paste your appId
   ```
5. Click **Deploy** → Wait ~60 seconds → Done!

Your app is now live at `https://duplicate-poker-XXXX.vercel.app`

## What's Stored in Firebase

- **rooms/{CODE}** — Room config, player list, orbit seeds
- **rooms/{CODE}/results/p{N}-o{N}** — Each player's orbit results + stats  
- **profiles/{name}** — Player ratings, career stats, session history

## Local Development (Optional)

```bash
npm install
cp .env.example .env   # then fill in your Firebase values
npm run dev             # opens on localhost:5173
```

## Files

- `src/App.jsx` — Full game engine, UI, rating system (~1200 lines)
- `src/db.js` — Firebase Firestore adapter
- `src/main.jsx` — React entry point
- `index.html` — HTML shell
- `vite.config.js` — Build config
- `package.json` — Dependencies (React, Firebase, Vite)
