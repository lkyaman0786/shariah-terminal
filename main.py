import webbrowser
import threading
import time
import os
import sys
import uvicorn
import uuid
import platform
import requests
import tkinter as tk
from tkinter import messagebox

def verify_license():
    try:
        machine_id = str(uuid.getnode())
        computer_name = platform.node()
        
        # Yahan apna Google Apps Script ka Web App URL paste karein
        web_app_url = "https://script.google.com/macros/s/AKfycbw_BVimMO44wjDGG79ghAw_fnx8qLxQO3NT6aNS5TUIGAPdvkz1cpbvimIQJwKuVr0/exec"
        
        payload = {
            "action": "verify",
            "machine_id": machine_id,
            "computer_name": computer_name
        }
        
        response = requests.post(web_app_url, json=payload, timeout=8)
        result = response.json()
        current_status = str(result.get("status", "Active")).strip().capitalize()
        
        if current_status == "Pending":
            root = tk.Tk()
            root.withdraw()
            messagebox.showwarning("Approval Pending", "Aapki license request admin ke paas pending hai. Approval milne par hi software chalega.")
            root.destroy()
            os._exit(0)
            
        elif current_status == "Blocked":
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror("Access Denied", "Aapka license blocked ya expire ho chuka hai.")
            root.destroy()
            os._exit(0)
            
    except Exception as e:
        pass

# Fix Unicode output for Windows terminals
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def open_browser(port):
    time.sleep(2.0)
    url = f"http://127.0.0.1:{port}"
    print(f"Opening Shariah Live Terminal in browser at {url} ...")
    webbrowser.open(url)

if __name__ == "__main__":
    # 2. App start hote hi background me license verify karega
    threading.Thread(target=verify_license, daemon=True).start()
    
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    # Only open browser on local development
    if os.environ.get("AUTO_OPEN_BROWSER", "1") == "1" and host in ["127.0.0.1", "0.0.0.0", "localhost"]:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    print("=" * 60)
    print("[*] SHARIAH SHARES LIVE MARKET TERMINAL")
    print("[*] Powered by Angel One SmartAPI WebSocket & FastAPI")
    print(f"[*] Access Dashboard: http://127.0.0.1:{port}")
    print("[*] Admin Panel:   http://127.0.0.1:{}/admin".format(port))
    print("=" * 60)
    uvicorn.run("server:app", host=host, port=port, log_level="info")
