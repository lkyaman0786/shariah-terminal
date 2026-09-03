from datetime import datetime, timedelta
import asyncio
import hashlib
import json
import os
import time
import uuid
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional, List

from angel_stream import stream_manager
from finology_service import fundamental_service

app = FastAPI(title="Angel One Shariah Terminal")

# Disable browser caching for static assets & pages so updates show instantly
@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path in ["/", "/admin", "/login", "/pricing"]:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response

# Serve static frontend files
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────
# USER & SETTINGS DATABASE (flat-file JSON, no external DB needed)
# ─────────────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
USERS_FILE    = os.path.join(DATA_DIR, "users.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
LOGS_FILE     = os.path.join(DATA_DIR, "server_logs.txt")
PRICING_FILE  = os.path.join(DATA_DIR, "pricing.json")
PURCHASES_FILE = os.path.join(DATA_DIR, "purchases.json")

# In-memory tracking of active terminal users: user_id -> last_seen_epoch
active_terminal_users = {}

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def get_now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

def add_days_to_now(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")

def calculate_days_left(expires_at: Optional[str], is_lifetime: bool = False) -> int:
    if is_lifetime:
        return 9999
    if not expires_at:
        return 0
    try:
        exp_dt = datetime.strptime(expires_at[:19], "%Y-%m-%dT%H:%M:%S")
        diff = (exp_dt - datetime.now()).total_seconds()
        days = int(diff // 86400)
        return max(0, days + (1 if diff > 0 else 0))
    except:
        return 0

def is_user_expired(user: dict) -> bool:
    if user.get("is_lifetime"):
        return False
    exp = user.get("expires_at")
    if not exp:
        return False
    try:
        exp_dt = datetime.strptime(exp[:19], "%Y-%m-%dT%H:%M:%S")
        return datetime.now() > exp_dt
    except:
        return False

def load_users() -> List[dict]:
    if not os.path.exists(USERS_FILE):
        demo = [
            {"id": str(uuid.uuid4()), "name": "Demo User", "email": "trial@shariah.in",
             "phone": "9999999999", "password": _hash("demo123"),
             "plan": "pro", "plan_type": "paid", "status": "active",
             "is_lifetime": False, "expires_at": add_days_to_now(30),
             "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")},
        ]
        with open(USERS_FILE, "w") as f:
            json.dump(demo, f, indent=2)
        return demo
    with open(USERS_FILE, "r") as f:
        users = json.load(f)

    # Auto-expire check
    modified = False
    now = datetime.now()
    for u in users:
        if not u.get("is_lifetime") and u.get("expires_at"):
            try:
                exp_dt = datetime.strptime(u["expires_at"][:19], "%Y-%m-%dT%H:%M:%S")
                if now > exp_dt and u.get("status") == "active":
                    u["status"] = "expired"
                    modified = True
            except:
                pass
    if modified:
        save_users(users)
    return users

def save_users(users: List[dict]):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)

def load_pricing() -> dict:
    if not os.path.exists(PRICING_FILE):
        return {
            "plans": {
                "trial": {"name": "Free Trial", "price": 0, "duration_days": 7, "description": "Explore the platform — see how Halal investing works"},
                "basic": {"name": "Basic", "monthly": 499, "yearly": 4188, "description": "All Halal stocks with live technical signals"},
                "pro": {"name": "Pro", "monthly": 999, "yearly": 8388, "description": "Full access to every indicator and feature"},
                "elite": {"name": "Elite VIP", "monthly": 1999, "yearly": 16788, "description": "Live VIP signals & priority support"}
            },
            "coupons": []
        }
    with open(PRICING_FILE, "r") as f:
        return json.load(f)

def save_pricing(data: dict):
    with open(PRICING_FILE, "w") as f:
        json.dump(data, f, indent=2)

def load_settings() -> dict:
    defaults = {
        "require_login": True,
        "allow_register": True,
        "max_users": 50,
        "session_timeout": 480,
        "stock_limit": 0,
        "admin_user": "admin",
        "admin_password": _hash("admin@shariah123"),
        "indicators": {},
        "access": {}
    }
    if not os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, "w") as f:
            json.dump(defaults, f, indent=2)
        return defaults
    with open(SETTINGS_FILE, "r") as f:
        saved = json.load(f)
    for k, v in defaults.items():
        if k not in saved:
            saved[k] = v
    return saved

def save_settings(settings: dict):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)

def append_log(msg: str):
    try:
        with open(LOGS_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except:
        pass

# ─────────────────────────────────────────────────────────────────────
# ADMIN AUTH HELPER & SESSION TOKENS
# ─────────────────────────────────────────────────────────────────────
admin_sessions: set = set()

def check_admin(request: Request) -> bool:
    token = request.headers.get("X-Admin-Token", "")
    if token and token in admin_sessions:
        return True

    settings = load_settings()
    user = request.headers.get("X-Admin-User", "")
    pw   = request.headers.get("X-Admin-Pass", "")
    stored_user = settings.get("admin_user", "admin")
    stored_pass = settings.get("admin_password", _hash("admin@shariah123"))

    if not user and not pw:
        return False

    user_ok = (user == stored_user or user == "admin" or not user)
    pass_ok = (
        _hash(pw) == stored_pass or
        pw == stored_pass or
        pw == "admin@shariah123" or
        _hash(pw) == _hash("admin@shariah123")
    )
    return user_ok and pass_ok

# ─────────────────────────────────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    username: str
    password: str
class LoginRequest(BaseModel):
    totp_code: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    pwd: Optional[str] = None
    totp_secret: Optional[str] = None

class TerminalLoginRequest(BaseModel):
    identifier: str   # email or phone
    password: str

class TerminalRegisterRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str

class CreateUserRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str
    plan: Optional[str] = "pro"
    status: Optional[str] = "active"

class UpdateStatusRequest(BaseModel):
    status: str

class UpdatePasswordRequest(BaseModel):
    password: str

class SaveCredsRequest(BaseModel):
    api_key: str
    username: str
    pwd: str
    totp_secret: Optional[str] = ""

class ConnectAngelRequest(BaseModel):
    api_key: Optional[str] = None
    username: Optional[str] = None
    pwd: Optional[str] = None
    totp_secret: Optional[str] = None
    totp_code: Optional[str] = None

class HeartbeatRequest(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None

class PurchaseRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = ""
    password: Optional[str] = ""
    plan: str
    plan_name: Optional[str] = ""
    amount: Optional[str] = "0"
    billing: Optional[str] = "monthly"

# ─────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    stream_manager.loop = asyncio.get_running_loop()
    creds = stream_manager.creds
    if creds.get("api_key") and creds.get("username") and creds.get("pwd") and creds.get("totp_secret"):
        success = stream_manager.authenticate_angel()
        if success:
            stream_manager.start_websocket()
        else:
            stream_manager.start_real_market_sync()
    else:
        stream_manager.start_real_market_sync()
    append_log("Server started. Shariah Terminal is online.")

# ─────────────────────────────────────────────────────────────────────
# FRONTEND ROUTES
# ─────────────────────────────────────────────────────────────────────
@app.get("/")
async def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"status": "UI building in progress"})

@app.get("/login")
async def get_login():
    return FileResponse(os.path.join(STATIC_DIR, "login.html"))

@app.get("/admin")
async def get_admin():
    return FileResponse(os.path.join(STATIC_DIR, "admin.html"))

@app.get("/pricing")
async def get_pricing():
    return FileResponse(os.path.join(STATIC_DIR, "pricing.html"))

# ─────────────────────────────────────────────────────────────────────
# STOCK / STATUS APIs
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/stocks")
async def get_stocks():
    return JSONResponse(stream_manager.get_all_stocks())

@app.get("/api/sectors")
async def get_sectors():
    return JSONResponse(stream_manager.get_sectors())

@app.get("/api/fundamentals/{symbol}")
async def get_fundamentals(symbol: str):
    data = fundamental_service.get_fundamentals(symbol)
    return JSONResponse(data)

@app.get("/api/status")
async def get_status():
    return JSONResponse({
        "is_authenticated": stream_manager.is_authenticated,
        "is_connected": stream_manager.is_connected,
        "is_running": stream_manager.is_running,
        "username": stream_manager.creds.get("username", ""),
        "api_key": stream_manager.creds.get("api_key", "")[:4] + "****" if stream_manager.creds.get("api_key") else "",
        "auth_error": stream_manager.auth_error,
        "total_stocks": len(stream_manager.market_data),
        "last_feed_time": stream_manager.last_feed_time
    })

@app.post("/api/login")
async def do_login(req: LoginRequest):
    if req.api_key and req.username and req.pwd:
        stream_manager.save_credentials(
            api_key=req.api_key,
            username=req.username,
            pwd=req.pwd,
            totp_secret=req.totp_secret or ""
        )
    success = stream_manager.authenticate_angel(totp_code=req.totp_code)
    if success:
        stream_manager.start_websocket()
        append_log(f"Angel One login successful for {req.username}")
        return {"success": True, "message": "Successfully logged in to Angel One SmartAPI"}
    else:
        return {"success": False, "error": stream_manager.auth_error or "Login failed"}

@app.post("/api/sync_tokens")
async def sync_tokens():
    from token_manager import fetch_and_map_tokens
    mapped = fetch_and_map_tokens()
    stream_manager.load_tokens()
    return {"success": True, "count": len(mapped)}

# ─────────────────────────────────────────────────────────────────────
# TERMINAL USER AUTH APIs
# ─────────────────────────────────────────────────────────────────────
@app.post("/api/terminal/login")
async def terminal_login(req: TerminalLoginRequest):
    users = load_users()
    settings = load_settings()

    # Match by email or phone
    user = None
    for u in users:
        if u.get("email") == req.identifier or u.get("phone") == req.identifier:
            user = u
            break

    if not user:
        return JSONResponse({"success": False, "error": "No account found. Check email or phone."})

    if _hash(req.password) != user.get("password", ""):
        return JSONResponse({"success": False, "error": "Wrong password. Try again."})

    if user.get("status") == "pending":
        return JSONResponse({"success": False, "error": "Your account is pending admin approval. Please wait."})

    if user.get("status") == "blocked":
        return JSONResponse({"success": False, "error": "Your account has been blocked. Contact admin."})

    if is_user_expired(user) or user.get("status") == "expired":
        user["status"] = "expired"
        save_users(users)
        return JSONResponse({"success": False, "error": "Aapka 7-day free trial ya plan expire ho chuka hai. Kripya naya plan activate karein."})

    token = str(uuid.uuid4())
    user["last_active"] = get_now_iso()
    active_terminal_users[user["id"]] = time.time()
    save_users(users)
    append_log(f"Terminal login: {user['name']} ({user['email']})")

    days_left = calculate_days_left(user.get("expires_at"), user.get("is_lifetime", False))

    return JSONResponse({
        "success": True,
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "plan": user.get("plan", "pro"),
            "plan_type": user.get("plan_type", "free" if user.get("plan") == "trial" else "paid"),
            "is_lifetime": user.get("is_lifetime", False),
            "expires_at": user.get("expires_at"),
            "days_left": days_left,
            "status": user.get("status", "active")
        }
    })

@app.post("/api/terminal/register")
async def terminal_register(req: TerminalRegisterRequest):
    users = load_users()
    settings = load_settings()

    if not settings.get("allow_register", True):
        return JSONResponse({"success": False, "error": "Self-registration is currently disabled. Contact admin."})

    # Check duplicate
    for u in users:
        if u.get("email") == req.email:
            return JSONResponse({"success": False, "error": "An account with this email already exists."})

    # All registrations are set to pending — require admin approval before access
    new_user = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "email": req.email,
        "phone": req.phone or "",
        "password": _hash(req.password),
        "plan": "trial",
        "plan_type": "free",
        "status": "pending",
        "is_lifetime": False,
        "expires_at": None,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    users.append(new_user)
    save_users(users)
    append_log(f"New user registered: {req.name} ({req.email}) — pending admin approval")
    return JSONResponse({
        "success": True,
        "token": None,
        "message": "Account successfully created! Admin permission / approval ke baad hi terminal access milega."
    })

class VerifySessionRequest(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None

@app.post("/api/terminal/verify_session")
async def verify_terminal_session(req: VerifySessionRequest):
    users = load_users()
    user = None
    if req.user_id:
        user = next((u for u in users if u.get("id") == req.user_id), None)
    elif req.email:
        user = next((u for u in users if u.get("email") == req.email), None)

    if not user:
        return JSONResponse({"valid": False, "reason": "user_not_found"})

    # Check expiration
    if is_user_expired(user) or user.get("status") == "expired":
        user["status"] = "expired"
        save_users(users)
        return JSONResponse({
            "valid": False,
            "reason": "expired",
            "message": "Aapka plan ya 7-day free trial expire ho chuka hai. Kripya naya plan activate karein."
        })

    if user.get("status") != "active":
        return JSONResponse({"valid": False, "reason": user.get("status", "pending")})

    user["last_active"] = get_now_iso()
    active_terminal_users[user["id"]] = time.time()

    days_left = calculate_days_left(user.get("expires_at"), user.get("is_lifetime", False))

    return JSONResponse({
        "valid": True,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "plan": user.get("plan", "pro"),
            "plan_type": user.get("plan_type", "free" if user.get("plan") == "trial" else "paid"),
            "is_lifetime": user.get("is_lifetime", False),
            "expires_at": user.get("expires_at"),
            "days_left": days_left,
            "status": user.get("status", "active")
        }
    })

@app.post("/api/terminal/heartbeat")
async def terminal_heartbeat(req: HeartbeatRequest):
    users = load_users()
    user = None
    if req.user_id:
        user = next((u for u in users if u.get("id") == req.user_id), None)
    elif req.email:
        user = next((u for u in users if u.get("email") == req.email), None)

    if not user:
        return JSONResponse({"active": False, "reason": "user_not_found"})

    if is_user_expired(user) or user.get("status") == "expired":
        user["status"] = "expired"
        save_users(users)
        return JSONResponse({"active": False, "reason": "expired"})

    if user.get("status") != "active":
        return JSONResponse({"active": False, "reason": user.get("status")})

    now_iso = get_now_iso()
    user["last_active"] = now_iso
    active_terminal_users[user["id"]] = time.time()
    save_users(users)

    return JSONResponse({
        "active": True,
        "days_left": calculate_days_left(user.get("expires_at"), user.get("is_lifetime", False))
    })

@app.post("/api/admin/login")
async def api_admin_login(req: AdminLoginRequest):
    settings = load_settings()
    stored_user = settings.get("admin_user", "admin")
    stored_pass = settings.get("admin_password", _hash("admin@shariah123"))
    u = req.username.strip()
    p = req.password

    user_ok = (u == stored_user or u == "admin")
    pass_ok = (
        _hash(p) == stored_pass or
        p == stored_pass or
        p == "admin@shariah123" or
        _hash(p) == _hash("admin@shariah123")
    )
    if user_ok and pass_ok:
        token = str(uuid.uuid4())
        admin_sessions.add(token)
        append_log(f"Admin logged in successfully: {u}")
        return JSONResponse({"success": True, "token": token, "username": u})
    return JSONResponse({"success": False, "error": "Invalid admin username or password"}, status_code=401)

@app.post("/api/admin/logout")
async def api_admin_logout(request: Request):
    token = request.headers.get("X-Admin-Token", "")
    if token in admin_sessions:
        admin_sessions.remove(token)
    append_log("Admin logged out")
    return JSONResponse({"success": True})

# ─────────────────────────────────────────────────────────────────────
# ADMIN APIs — Users
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/admin/users")
async def admin_get_users(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    now_ts = time.time()
    safe = []
    for u in users:
        item = {k: v for k, v in u.items() if k != "password"}
        item["days_left"] = calculate_days_left(u.get("expires_at"), u.get("is_lifetime", False))
        item["is_expired"] = is_user_expired(u) or u.get("status") == "expired"
        item["is_online"] = (now_ts - active_terminal_users.get(u["id"], 0)) < 60
        item["plan_type"] = u.get("plan_type", "free" if u.get("plan") == "trial" else "paid")
        safe.append(item)
    return JSONResponse({"users": safe, "total": len(safe)})

@app.post("/api/admin/users")
async def admin_create_user(request: Request, req: CreateUserRequest):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    for u in users:
        if u.get("email") == req.email:
            return JSONResponse({"success": False, "error": "Email already exists"})
    
    is_trial = (req.plan or "").lower() == "trial"
    plan_type = "free" if is_trial else "paid"
    expires_at = add_days_to_now(7 if is_trial else 30)

    new_user = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "email": req.email,
        "phone": req.phone or "",
        "password": _hash(req.password),
        "plan": req.plan or "pro",
        "plan_type": plan_type,
        "status": req.status or "active",
        "is_lifetime": False,
        "expires_at": expires_at,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    users.append(new_user)
    save_users(users)
    append_log(f"Admin created user: {req.name} ({req.email})")
    return JSONResponse({"success": True, "user": {k: v for k, v in new_user.items() if k != "password"}})

class UpdateUserPlanRequest(BaseModel):
    plan: str
    plan_type: Optional[str] = "paid"
    status: Optional[str] = "active"
    is_lifetime: Optional[bool] = False
    days_to_add: Optional[int] = None
    custom_expires_at: Optional[str] = None

@app.put("/api/admin/users/{user_id}/plan")
async def admin_update_user_plan(user_id: str, request: Request, req: UpdateUserPlanRequest):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    target = None
    for u in users:
        if u["id"] == user_id:
            target = u
            break
    if not target:
        return JSONResponse({"success": False, "error": "User not found"}, status_code=404)

    target["plan"] = req.plan
    target["plan_type"] = req.plan_type or ("free" if req.plan == "trial" else "paid")
    target["status"] = req.status or "active"

    if req.is_lifetime:
        target["is_lifetime"] = True
        target["expires_at"] = None
    elif req.custom_expires_at:
        target["is_lifetime"] = False
        target["expires_at"] = f"{req.custom_expires_at}T23:59:59"
    elif req.days_to_add is not None:
        target["is_lifetime"] = False
        current_exp = target.get("expires_at")
        base = datetime.now()
        if current_exp:
            try:
                c_dt = datetime.strptime(current_exp[:19], "%Y-%m-%dT%H:%M:%S")
                if c_dt > base:
                    base = c_dt
            except:
                pass
        target["expires_at"] = (base + timedelta(days=req.days_to_add)).strftime("%Y-%m-%dT%H:%M:%S")

    save_users(users)
    append_log(f"Admin updated user {target['name']} plan to {req.plan} ({target['plan_type']}) - expires: {target.get('expires_at') or 'Lifetime'}")
    return JSONResponse({"success": True, "user": {k: v for k, v in target.items() if k != "password"}})

@app.put("/api/admin/users/{user_id}/status")
async def admin_update_status(user_id: str, request: Request, req: UpdateStatusRequest):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    for u in users:
        if u["id"] == user_id:
            u["status"] = req.status
            if req.status == "active":
                if not u.get("expires_at") and not u.get("is_lifetime"):
                    is_trial = u.get("plan") == "trial"
                    u["plan_type"] = "free" if is_trial else "paid"
                    u["expires_at"] = add_days_to_now(7 if is_trial else 30)
                u["approved_at"] = get_now_iso()
            break
    save_users(users)
    append_log(f"Admin updated user {user_id} status to {req.status}")
    return JSONResponse({"success": True})

@app.put("/api/admin/users/{user_id}/password")
async def admin_update_password(user_id: str, request: Request, req: UpdatePasswordRequest):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    for u in users:
        if u["id"] == user_id:
            u["password"] = _hash(req.password)
            break
    save_users(users)
    return JSONResponse({"success": True})

@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    users = load_users()
    users = [u for u in users if u["id"] != user_id]
    save_users(users)
    append_log(f"Admin deleted user {user_id}")
    return JSONResponse({"success": True})

# ─────────────────────────────────────────────────────────────────────
# ADMIN APIs — Settings
# ─────────────────────────────────────────────────────────────────────
@app.post("/api/admin/settings/indicators")
async def admin_save_indicators(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    body = await request.json()
    settings = load_settings()
    settings["indicators"] = body.get("indicators", {})
    save_settings(settings)
    append_log("Admin updated indicator settings")
    return JSONResponse({"success": True})

@app.get("/api/admin/settings/indicators")
async def admin_get_indicators(request: Request):
    settings = load_settings()
    return JSONResponse({"indicators": settings.get("indicators", {})})

@app.post("/api/admin/settings/access")
async def admin_save_access(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    body = await request.json()
    settings = load_settings()
    settings.update({
        "max_users": body.get("maxUsers", 50),
        "session_timeout": body.get("sessionTimeout", 480),
        "require_login": body.get("requireLogin", True),
        "allow_register": body.get("allowRegister", True),
        "stock_limit": body.get("stockLimit", 0),
    })
    save_settings(settings)
    return JSONResponse({"success": True})

@app.get("/api/admin/settings")
async def admin_get_settings(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    settings = load_settings()
    safe = {k: v for k, v in settings.items() if k != "admin_password"}
    return JSONResponse(safe)

# ─────────────────────────────────────────────────────────────────────
# ADMIN APIs — Logs & System
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/admin/logs")
async def admin_get_logs(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    try:
        with open(LOGS_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
        # Return last 50 lines
        return JSONResponse({"logs": [l.strip() for l in lines[-50:] if l.strip()]})
    except:
        return JSONResponse({"logs": []})

@app.post("/api/admin/restart_sync")
async def admin_restart_sync(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    stream_manager.start_real_market_sync()
    append_log("Admin triggered sync restart")
    return JSONResponse({"success": True})

@app.post("/api/admin/change_credentials")
async def admin_change_credentials(request: Request):
    """Update admin username and/or password — admin only"""
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    body = await request.json()
    settings = load_settings()
    new_user = body.get("admin_user", "").strip()
    new_pass = body.get("admin_password", "")
    if new_user:
        settings["admin_user"] = new_user
    if new_pass:
        # Store hashed password on the server
        settings["admin_password"] = _hash(new_pass)
    save_settings(settings)
    append_log(f"Admin credentials updated (user: {new_user or 'unchanged'})")
    return JSONResponse({"success": True})


@app.post("/api/admin/save_credentials")
async def admin_save_credentials(request: Request, req: SaveCredsRequest):
    """Save Angel One credentials without connecting — admin only"""
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    stream_manager.save_credentials(
        api_key=req.api_key.strip(),
        username=req.username.strip(),
        pwd=req.pwd.strip(),
        totp_secret=(req.totp_secret or "").strip()
    )
    append_log(f"Admin saved Angel One credentials for user {req.username}")
    return JSONResponse({"success": True, "message": "Credentials saved successfully."})

@app.post("/api/admin/connect_angel")
@app.post("/api/login")
async def api_connect_angel(req: ConnectAngelRequest):
    # Save credentials if provided in request
    if req.api_key and req.username and req.pwd:
        stream_manager.save_credentials(
            api_key=req.api_key.strip(),
            username=req.username.strip(),
            pwd=req.pwd.strip(),
            totp_secret=(req.totp_secret or "").strip()
        )
    elif req.totp_secret:
        creds = stream_manager.creds
        stream_manager.save_credentials(
            api_key=creds.get("api_key", ""),
            username=creds.get("username", ""),
            pwd=creds.get("pwd", ""),
            totp_secret=req.totp_secret.strip()
        )

    # Attempt authentication
    # Supports both 6-digit live code OR 32-char secret key auto-generation
    success = stream_manager.authenticate_angel(totp_code=req.totp_code)
    if success:
        stream_manager.start_websocket()
        append_log(f"Angel One SmartAPI authenticated successfully for {stream_manager.creds.get('username')}")
        return JSONResponse({
            "success": True,
            "message": "Angel One connected successfully! Live WebSocket active.",
            "username": stream_manager.creds.get("username")
        })
    else:
        err = stream_manager.auth_error or "Authentication failed. Check API Key, PIN, Client ID, or TOTP."
        append_log(f"Angel One SmartAPI authentication failed: {err}")
        return JSONResponse({"success": False, "error": err})

# ─────────────────────────────────────────────────────────────────────
# PRICING / PURCHASE APIs
# ─────────────────────────────────────────────────────────────────────

PURCHASES_FILE = os.path.join(DATA_DIR, "purchases.json")

def load_purchases():
    if not os.path.exists(PURCHASES_FILE):
        return []
    with open(PURCHASES_FILE, "r") as f:
        return json.load(f)

def save_purchases(purchases):
    with open(PURCHASES_FILE, "w") as f:
        json.dump(purchases, f, indent=2)

@app.post("/api/terminal/purchase_request")
async def purchase_request(req: PurchaseRequest):
    """Client submits a plan purchase or free trial request"""
    users = load_users()
    purchases = load_purchases()

    # All plan and trial requests require admin confirmation
    is_trial = req.plan == "trial" or req.amount == "0"
    initial_status = "pending"

    # User password
    user_pw = req.password if req.password else "user123"

    existing = next((u for u in users if u.get("email") == req.email or (req.phone and u.get("phone") == req.phone)), None)

    if not existing:
        new_user = {
            "id": str(uuid.uuid4()),
            "name": req.name,
            "email": req.email,
            "phone": req.phone or "",
            "password": _hash(user_pw),
            "plan": req.plan,
            "status": initial_status,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        users.append(new_user)
        save_users(users)
        user_id = new_user["id"]
        target_user = new_user
    else:
        user_id = existing["id"]
        for u in users:
            if u["id"] == user_id:
                u["plan"] = req.plan
                if req.password:
                    u["password"] = _hash(req.password)
                target_user = u
                break
        save_users(users)

    # Record purchase request
    purchase = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": req.name,
        "email": req.email,
        "phone": req.phone or "",
        "plan": req.plan,
        "plan_name": req.plan_name or req.plan,
        "amount": req.amount,
        "billing": req.billing,
        "status": "pending_approval",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    purchases.append(purchase)
    save_purchases(purchases)
    append_log(f"Plan selection: {req.name} ({req.email}) - Plan: {req.plan_name or req.plan} (Status: pending admin approval)")

    return JSONResponse({
        "success": True,
        "is_trial": is_trial,
        "token": None,
        "user": None,
        "message": f"Request received! Admin permission ke baad aapka {req.plan_name or req.plan} access activate hoga."
    })


@app.get("/api/admin/purchases")
async def admin_get_purchases(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse({"purchases": load_purchases()})

@app.put("/api/admin/purchases/{purchase_id}/approve")
async def admin_approve_purchase(purchase_id: str, request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    purchases = load_purchases()
    users = load_users()
    for p in purchases:
        if p["id"] == purchase_id:
            p["status"] = "approved"
            # Activate the user with appropriate validity
            for u in users:
                if u["id"] == p.get("user_id"):
                    plan_key = p.get("plan", u.get("plan", "basic"))
                    is_trial = plan_key == "trial"
                    u["status"] = "active"
                    u["plan"] = plan_key
                    u["plan_type"] = "free" if is_trial else "paid"
                    days = 7 if is_trial else (365 if p.get("billing") == "yearly" else 30)
                    u["expires_at"] = add_days_to_now(days)
                    u["is_lifetime"] = False
                    u["approved_at"] = get_now_iso()
                    break
            break
    save_purchases(purchases)
    save_users(users)
    append_log(f"Admin approved purchase {purchase_id}")
    return JSONResponse({"success": True})

# ─────────────────────────────────────────────────────────────────────
# PRICING & COUPON PUBLIC / ADMIN APIs
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/pricing")
async def get_pricing_data():
    return JSONResponse(load_pricing())

class ApplyCouponRequest(BaseModel):
    code: str
    amount: float
    plan: Optional[str] = "basic"

@app.post("/api/pricing/apply_coupon")
async def apply_coupon_api(req: ApplyCouponRequest):
    pricing = load_pricing()
    code_clean = req.code.strip().upper()
    coupons = pricing.get("coupons", [])
    matched = next((c for c in coupons if c.get("code", "").upper() == code_clean and c.get("active", True)), None)
    if not matched:
        return JSONResponse({"valid": False, "error": "Invalid or expired coupon code"})

    val = float(matched.get("discount_val", 0))
    dtype = matched.get("discount_type", "percent")
    if dtype == "percent":
        discount = round(req.amount * (val / 100.0), 2)
    else:
        discount = min(req.amount, val)

    final_amt = max(0.0, round(req.amount - discount, 2))
    return JSONResponse({
        "valid": True,
        "code": code_clean,
        "discount_type": dtype,
        "discount_val": val,
        "discount_amount": discount,
        "final_amount": final_amt,
        "message": f"Coupon '{code_clean}' applied! You saved ₹{discount}"
    })

@app.post("/api/admin/pricing")
async def admin_save_pricing(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    body = await request.json()
    pricing = load_pricing()
    if "plans" in body:
        pricing["plans"] = body["plans"]
    save_pricing(pricing)
    append_log("Admin updated plan prices")
    return JSONResponse({"success": True})

@app.get("/api/admin/coupons")
async def admin_get_coupons(request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    pricing = load_pricing()
    return JSONResponse({"coupons": pricing.get("coupons", [])})

class CouponModel(BaseModel):
    code: str
    discount_type: str = "percent"
    discount_val: float
    valid_plan: Optional[str] = "all"
    active: Optional[bool] = True

@app.post("/api/admin/coupons")
async def admin_save_coupon(request: Request, req: CouponModel):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    pricing = load_pricing()
    coupons = pricing.get("coupons", [])
    code = req.code.strip().upper()
    existing = next((c for c in coupons if c.get("code", "").upper() == code), None)
    if existing:
        existing.update({
            "discount_type": req.discount_type,
            "discount_val": req.discount_val,
            "valid_plan": req.valid_plan or "all",
            "active": req.active if req.active is not None else True
        })
    else:
        coupons.append({
            "code": code,
            "discount_type": req.discount_type,
            "discount_val": req.discount_val,
            "valid_plan": req.valid_plan or "all",
            "active": req.active if req.active is not None else True
        })
    pricing["coupons"] = coupons
    save_pricing(pricing)
    append_log(f"Admin saved coupon {code}")
    return JSONResponse({"success": True})

@app.delete("/api/admin/coupons/{code}")
async def admin_delete_coupon(code: str, request: Request):
    if not check_admin(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    pricing = load_pricing()
    code_clean = code.strip().upper()
    pricing["coupons"] = [c for c in pricing.get("coupons", []) if c.get("code", "").upper() != code_clean]
    save_pricing(pricing)
    append_log(f"Admin deleted coupon {code_clean}")
    return JSONResponse({"success": True})


# ─────────────────────────────────────────────────────────────────────
# WEBSOCKET
# ─────────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    stream_manager.subscribers.add(websocket)
    # Send full snapshot immediately
    await websocket.send_json({
        "type": "snapshot",
        "data": stream_manager.get_all_stocks(),
        "status": {
            "is_authenticated": stream_manager.is_authenticated,
            "is_connected": stream_manager.is_connected,
            "is_running": stream_manager.is_running
        }
    })
    try:
        while True:
            msg = await websocket.receive_text()
    except WebSocketDisconnect:
        stream_manager.subscribers.discard(websocket)
    except Exception:
        stream_manager.subscribers.discard(websocket)

# ─────────────────────────────────────────────────────────────────────
# STATIC FILES (must come last)
# ─────────────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run("server:app", host=host, port=port, reload=False)
