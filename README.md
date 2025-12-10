# GST Backend API

Backend server for GST information app with zero dependencies.

## Live Deployment
🔗 **Live API**: https://gst-backend-qfyz.onrender.com

## Deployment Guide

### Render.com (Recommended - FREE)

1. **Sign up**: Go to https://render.com and create account
2. **New Service**: Click "New +" → "Web Service"
3. **Connect**: Upload your backend folder or connect GitHub
4. **Auto-detect**: Render reads `render.yaml` automatically
5. **Deploy**: Click "Create Web Service"
6. **Done**: Your API will be at `https://gst-backend-xxxx.onrender.com`

## Endpoints
- `GET /api/health` – Returns dashboard data with all articles, sets, and counts
- `GET /admin` – Admin dashboard interface
- `GET /extract` – PDF extraction tool interface
- `GET /admin/api/health` – Admin health check

## Run locally
```bash
cd backend
node server.js
```

The server reloads data automatically when `db.json` changes and enables CORS so the Flutter web build can consume it.

Set `PORT`/`HOST` env vars if you need different bindings (defaults to `0.0.0.0:5050`).
