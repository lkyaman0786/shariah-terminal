# 🌙 Shariah Shares Live Market Terminal

Advanced NSE Live Market Terminal for **100% Musaffa Halal-Certified Equities**, powered by Angel One SmartAPI, technical indicators, and automated membership management.

---

## 🚀 Quick Start (Local)

1. Double click `run.bat` (or run `python main.py`).
2. Server will launch at `http://127.0.0.1:8000`.
3. Client opens `/` -> If not logged in, automatically opens `/login`. After logging in, the live terminal opens.

---

## 🌐 Custom Domain & Cloud Deployment

This repository is pre-configured with `Procfile` and `Dockerfile` for one-click deployment to **Render**, **Railway**, **VPS**, or any custom domain:

1. **Deploy to Render / Railway / Heroku**:
   - Connect this GitHub repository.
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
2. **Add Custom Domain**:
   - In your cloud host settings, add your custom domain (e.g. `terminal.yourdomain.com`).
   - Point your DNS CNAME/A record as instructed by your provider.
   - Any client visiting your domain will land directly on the **Login / Free Trial** page and access the terminal upon authentication.

---

## 🛡️ Admin Panel & Configuration

- Admin URL: `http://yourdomain.com/admin`
- Default Username: `admin`
- Default Password: `admin@shariah123`
- Features:
  - **Angel One SmartAPI**: Connect via 32-character TOTP Secret Key (auto-login) or 6-digit live OTP.
  - **Live User Tracking**: Real-time view of clients currently active in the terminal.
  - **7-Day Free Trial Auto-Expiry**: Lockout countdown and plan validity management.
  - **Plans & Coupons**: Modify subscription prices and create promotional discount coupons.
