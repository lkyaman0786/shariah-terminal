import webbrowser
import threading
import time
import os
import sys
import uvicorn

# Fix Unicode output for Windows terminals
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def open_browser(port):
    time.sleep(2.0)
    url = f"http://127.0.0.1:{port}"
    print(f"Opening Shariah Live Terminal in browser at {url} ...")
    webbrowser.open(url)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    # Only open browser on local development
    if os.environ.get("AUTO_OPEN_BROWSER", "1") == "1" and host in ["127.0.0.1", "0.0.0.0", "localhost"]:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    print("=" * 60)
    print("[*] SHARIAH SHARES LIVE MARKET TERMINAL")
    print("[*] Powered by Angel One SmartAPI WebSocket & FastAPI")
    print(f"[*] Access Dashboard: http://127.0.0.1:{port}")
    print("[*] Admin Panel:      http://127.0.0.1:{}/admin".format(port))
    print("=" * 60)
    uvicorn.run("server:app", host=host, port=port, log_level="info")
