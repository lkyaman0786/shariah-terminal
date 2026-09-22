import asyncio
import json
import logging
import os
import threading
import time
import requests
import concurrent.futures
from typing import Dict, Any, List, Optional
import pyotp

try:
    from SmartApi import SmartConnect
    from SmartApi.smartWebSocketV2 import SmartWebSocketV2
except ImportError:
    SmartConnect = None
    SmartWebSocketV2 = None

from indicators import StockTechnicalCalculator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("AngelStream")

class AngelStreamManager:
    def __init__(self, credentials_path: str = "credentials.py", tokens_path: str = "shariah_tokens.json"):
        self.credentials_path = credentials_path
        self.tokens_path = tokens_path
        self.smart_api = None
        self.sws = None
        self.is_connected = False
        self.is_authenticated = False
        self.auth_error = None
        self.last_feed_time = None
        self.is_running = True
        
        # Token mapping, price cache, and technical calculators
        self.tokens_map: Dict[str, Dict[str, Any]] = {} # token -> stock info
        self.symbol_map: Dict[str, Dict[str, Any]] = {} # symbol -> stock info
        self.market_data: Dict[str, Dict[str, Any]] = {} # token -> latest live data
        self.calculators: Dict[str, StockTechnicalCalculator] = {} # token -> calculator
        
        # Callbacks for frontend WebSocket broadcast
        self.subscribers = set()
        self.loop = None
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="StockSync")
        self.sync_thread = None

        self.load_tokens()
        self.load_credentials()
        self.start_real_market_sync()

    def load_credentials(self) -> Dict[str, str]:
        creds = {
            "api_key": os.environ.get("ANGEL_API_KEY", ""),
            "username": os.environ.get("ANGEL_USERNAME", ""),
            "pwd": os.environ.get("ANGEL_PIN", ""),
            "totp_secret": os.environ.get("ANGEL_TOTP_SECRET", ""),
            "feed_token": "",
            "jwt_token": ""
        }
        
        # 1. Try DB store first if server DB store is available
        try:
            import sys
            if "server" in sys.modules:
                from server import store_get
                raw_db_creds = store_get("angel_credentials")
                if raw_db_creds:
                    db_creds = json.loads(raw_db_creds)
                    if isinstance(db_creds, dict):
                        if db_creds.get("api_key"): creds["api_key"] = db_creds.get("api_key")
                        if db_creds.get("username"): creds["username"] = db_creds.get("username")
                        if db_creds.get("pwd"): creds["pwd"] = str(db_creds.get("pwd"))
                        if db_creds.get("totp_secret"): creds["totp_secret"] = db_creds.get("totp_secret")
        except Exception as ex:
            logger.debug(f"DB credentials load check note: {ex}")

        # 2. Try credentials.py (local fallback & initial seed)
        if (not creds["api_key"] or not creds["username"]) and os.path.exists(self.credentials_path):
            try:
                namespace = {}
                with open(self.credentials_path, "r", encoding="utf-8") as f:
                    code = f.read()
                exec(code, namespace)
                if namespace.get("api_key"): creds["api_key"] = namespace.get("api_key")
                if namespace.get("username"): creds["username"] = namespace.get("username")
                if namespace.get("pwd"): creds["pwd"] = str(namespace.get("pwd"))
                if namespace.get("totp_secret"): creds["totp_secret"] = namespace.get("totp_secret")
            except Exception as e:
                logger.error(f"Error loading credentials.py: {e}")

        self.creds = creds
        return creds

    def save_credentials(self, api_key: str, username: str, pwd: str, totp_secret: str = ""):
        content = f'''api_key="{api_key}"
username="{username}"
pwd="{pwd}"
totp_secret="{totp_secret}"
url="https://www.google.com/"
'''
        try:
            with open(self.credentials_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            logger.warning(f"Could not write credentials file: {e}")

        # Save to DB store for persistent deployment across restarts / Render hosting
        try:
            import sys
            if "server" in sys.modules:
                from server import store_set
                store_set("angel_credentials", json.dumps({
                    "api_key": api_key,
                    "username": username,
                    "pwd": pwd,
                    "totp_secret": totp_secret
                }))
        except Exception as e:
            logger.error(f"Could not save credentials to DB store: {e}")

        self.load_credentials()

    def load_tokens(self):
        if not os.path.exists(self.tokens_path):
            from token_manager import fetch_and_map_tokens
            fetch_and_map_tokens()

        with open(self.tokens_path, "r", encoding="utf-8") as f:
            stock_list = json.load(f)

        self.tokens_map.clear()
        self.symbol_map.clear()
        
        from shariah_evaluator import evaluate_shariah_compliance

        for item in stock_list:
            token = str(item["token"])
            self.tokens_map[token] = item
            self.symbol_map[item["symbol"]] = item
            
            if token not in self.market_data:
                mcap = item.get("market_cap_cr", 5000)
                cap_cat = item.get("cap_category", "Small Cap")
                shariah_info = evaluate_shariah_compliance(item["symbol"], item.get("company_name", ""))
                
                self.market_data[token] = {
                    "token": token,
                    "symbol": item["symbol"],
                    "trading_symbol": item.get("trading_symbol", item["symbol"] + "-EQ"),
                    "company_name": item["company_name"],
                    "sector": item["sector"],
                    "market_cap_cr": mcap,
                    "cap_category": cap_cat,
                    "ltp": 0.0,
                    "open": 0.0,
                    "high": 0.0,
                    "low": 0.0,
                    "close": 0.0,
                    "change": 0.0,
                    "pChange": 0.0,
                    "volume": 0,
                    "last_update": time.strftime("%H:%M:%S"),
                    "tick_direction": "flat",
                    "ema_8": 0.0,
                    "sma_11": 0.0,
                    "pivot": 0.0,
                    "r1": 0.0,
                    "s1": 0.0,
                    "r2": 0.0,
                    "s2": 0.0,
                    "rsi_14": 50.0,
                    "rsi_sma_20": 50.0,
                    "macd": 0.0,
                    "macd_signal": 0.0,
                    "macd_hist": 0.0,
                    "tech_signal": "NEUTRAL",
                    "tech_class": "neutral",
                    "shariah_status": shariah_info["status"],
                    "is_halal": shariah_info["is_halal"],
                    "shariah_class": shariah_info["badge_class"],
                    "shariah_label": shariah_info["label"],
                    "shariah_reason": shariah_info["reason"],
                    "shariah_purity": shariah_info["purity_score"],
                    "musaffa_url": "https://musaffa.com/"
                }

            if token not in self.calculators:
                self.calculators[token] = StockTechnicalCalculator(initial_ltp=0.0, symbol=item["symbol"], company_name=item.get("company_name", ""))

    def fetch_real_stock_data(self, sym: str) -> Optional[Dict[str, Any]]:
        """Fetch 100% real live market price and historical candles from Yahoo Finance / NSE"""
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}.NS?interval=1d&range=3mo"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            resp = requests.get(url, headers=headers, timeout=5)
            
            if resp.status_code != 200:
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}.BO?interval=1d&range=3mo"
                resp = requests.get(url, headers=headers, timeout=5)

            if resp.status_code == 200:
                data = resp.json()
                res = data.get("chart", {}).get("result")
                if res and len(res) > 0:
                    meta = res[0].get("meta", {})
                    quotes = res[0].get("indicators", {}).get("quote", [{}])[0]
                    
                    ltp = meta.get("regularMarketPrice")
                    prev_close = meta.get("chartPreviousClose", meta.get("previousClose", ltp))
                    day_high = meta.get("regularMarketDayHigh", ltp)
                    day_low = meta.get("regularMarketDayLow", ltp)
                    day_vol = meta.get("regularMarketVolume", 0)

                    closes = quotes.get("close", [])
                    highs = quotes.get("high", [])
                    lows = quotes.get("low", [])
                    opens = quotes.get("open", [])
                    volumes = quotes.get("volume", [])

                    candles = []
                    for i in range(len(closes)):
                        if closes[i] is not None and closes[i] > 0:
                            candles.append({
                                "open": opens[i] if (i < len(opens) and opens[i] is not None) else closes[i],
                                "high": highs[i] if (i < len(highs) and highs[i] is not None) else closes[i],
                                "low": lows[i] if (i < len(lows) and lows[i] is not None) else closes[i],
                                "close": closes[i],
                                "volume": volumes[i] if (i < len(volumes) and volumes[i] is not None) else 0
                            })

                    return {
                        "ltp": float(ltp) if ltp else 0.0,
                        "prev_close": float(prev_close) if prev_close else ltp,
                        "high": float(day_high) if day_high else ltp,
                        "low": float(day_low) if day_low else ltp,
                        "open": float(meta.get("regularMarketDayOpen", prev_close)),
                        "volume": int(day_vol) if day_vol else 0,
                        "candles": candles
                    }
        except Exception:
            pass
        return None

    def _sync_single_stock(self, token_item):
        if not self.is_running:
            return
        token, info = token_item
        sym = info["symbol"]
        real_data = self.fetch_real_stock_data(sym)
        if real_data and real_data["ltp"] > 0:
            ltp = real_data["ltp"]
            if len(real_data["candles"]) >= 2:
                prev_day_close = real_data["candles"][-2]["close"]
            else:
                prev_day_close = real_data["prev_close"]

            change = round(ltp - prev_day_close, 2)
            pChange = round((change / prev_day_close) * 100, 2) if prev_day_close > 0 else 0.0

            comp_name = info.get("company_name", sym)
            calc = StockTechnicalCalculator(real_data["candles"], ltp, sym, comp_name)
            self.calculators[token] = calc
            indicators = calc.compute_from_candles(real_data["candles"], ltp, sym, comp_name)

            updated = {
                "token": token,
                "symbol": sym,
                "trading_symbol": info.get("trading_symbol", sym + "-EQ"),
                "company_name": comp_name,
                "sector": info["sector"],
                "market_cap_cr": info.get("market_cap_cr", 5000),
                "cap_category": info.get("cap_category", "Small Cap"),
                "ltp": ltp,
                "open": real_data["open"],
                "high": real_data["high"],
                "low": real_data["low"],
                "close": prev_day_close,
                "change": change,
                "pChange": pChange,
                "volume": real_data["volume"],
                "last_update": time.strftime("%H:%M:%S"),
                "tick_direction": "flat",
                **indicators
            }

            self.market_data[token] = updated
            self._broadcast_tick(updated)

    def start_real_market_sync(self):
        """Starts persistent safe synchronization loop"""
        if self.sync_thread and self.sync_thread.is_alive():
            return

        def sync_loop():
            logger.info(f"Background Sync Active for {len(self.tokens_map)} Shariah Stocks...")
            
            # Prioritize top 300 stocks (including user watchlist) first
            top_watchlist = [
                'CHENNPETRO', 'MGL', 'FILATEX', 'KPRMILL', 'VIKRAMSOLR', 'TIMETECHNO', 
                'KAYNES', 'CUPID', 'CHOLAHLDNG', 'SKM', 'INTELLECT', 'VINCOFE', 'SANDUMA', 
                'RGL', 'GENUSPOWER', 'UPL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM', 
                'TECHM', 'PERSISTENT', 'COFORGE', 'HINDUNILVR', 'SUNPHARMA', 'CIPLA', 
                'TITAN', 'MARUTI', 'HAL', 'BEL', 'SIEMENS', 'PIDILITIND', 'BHARTIARTL',
                'NTPC', 'TATAPOWER', 'SUZLON', 'WAAREEENER', 'COALINDIA', 'INDHOTEL'
            ]
            
            all_items = list(self.tokens_map.items())

            while self.is_running:
                try:
                    # Sync in batches of 50
                    for i in range(0, len(all_items), 50):
                        if not self.is_running:
                            break
                        batch = all_items[i:i+50]
                        futures = [self.executor.submit(self._sync_single_stock, it) for it in batch]
                        concurrent.futures.wait(futures, timeout=20)
                        time.sleep(0.5)

                    time.sleep(10)
                except (RuntimeError, Exception) as e:
                    logger.debug(f"Sync loop iteration note: {e}")
                    if not self.is_running:
                        break
                    time.sleep(5)

        self.sync_thread = threading.Thread(target=sync_loop, daemon=True)
        self.sync_thread.start()

    def authenticate_angel(self, totp_code: Optional[str] = None) -> bool:
        if not SmartConnect:
            self.auth_error = "SmartApi package not installed."
            return False

        api_key = self.creds.get("api_key")
        username = self.creds.get("username")
        pwd = self.creds.get("pwd")
        totp_secret = self.creds.get("totp_secret")

        if not api_key or not username or not pwd:
            self.auth_error = "Missing API key, Client ID, or PIN in credentials."
            return False

        final_totp = None
        if totp_code:
            final_totp = totp_code.strip()
        elif totp_secret:
            cleaned = totp_secret.replace(" ", "").strip()
            if len(cleaned) == 6 and cleaned.isdigit():
                # User provided a 6-digit OTP code directly
                final_totp = cleaned
            else:
                try:
                    final_totp = pyotp.TOTP(cleaned).now()
                except Exception as e:
                    logger.error(f"Error generating TOTP from secret: {e}")

        if not final_totp:
            self.auth_error = "TOTP code or TOTP Secret Key required for login."
            return False

        try:
            logger.info(f"Authenticating with Angel One SmartAPI for user {username}...")
            self.smart_api = SmartConnect(api_key=api_key)
            session_data = self.smart_api.generateSession(username, pwd, final_totp)
            
            if session_data and session_data.get("status"):
                data = session_data.get("data", {})
                self.jwt_token = data.get("jwtToken")
                self.feed_token = self.smart_api.getfeedToken()
                self.refresh_token = data.get("refreshToken")
                self.is_authenticated = True
                self.auth_error = None
                logger.info("Angel One authentication successful!")
                return True
            else:
                self.auth_error = session_data.get("message", "Login failed") if session_data else "Login failed"
                self.is_authenticated = False
                logger.error(f"Angel One Login Failed: {self.auth_error}")
                return False
        except Exception as e:
            self.auth_error = str(e)
            self.is_authenticated = False
            logger.error(f"Exception during Angel One login: {e}")
            return False

    def start_websocket(self):
        if not self.is_authenticated:
            logger.warning("Cannot start SmartWebSocketV2 without authentication.")
            return

        api_key = self.creds.get("api_key")
        client_code = self.creds.get("username")
        auth_token = self.jwt_token
        feed_token = self.feed_token

        def on_data(wsapp, message, *args, **kwargs):
            self.last_feed_time = time.time()
            self._process_angel_tick(message)

        def on_open(wsapp, *args, **kwargs):
            logger.info("Angel One SmartWebSocketV2 Connected!")
            self.is_connected = True
            token_list = list(self.tokens_map.keys())
            
            token_chunks = [token_list[i:i+50] for i in range(0, min(len(token_list), 500), 50)]
            for idx, chunk in enumerate(token_chunks):
                token_payload = [{"exchangeType": 1, "tokens": chunk}]
                try:
                    if self.sws:
                        self.sws.subscribe(correlation_id=f"shariah_sub_{idx}", mode=3, token_list=token_payload)
                        logger.info(f"Subscribed batch {idx+1}/{len(token_chunks)} ({len(chunk)} tokens)")
                except Exception as ex:
                    logger.error(f"Error subscribing batch {idx}: {ex}")

        def on_error(wsapp, error, *args, **kwargs):
            logger.error(f"SmartWebSocketV2 Error: {error}")
            self.is_connected = False

        def on_close(wsapp, *args, **kwargs):
            logger.info("SmartWebSocketV2 Closed.")
            self.is_connected = False

        try:
            self.sws = SmartWebSocketV2(auth_token, api_key, client_code, feed_token)
            self.sws.on_data = on_data
            self.sws.on_open = on_open
            self.sws.on_error = on_error
            self.sws.on_close = on_close

            ws_thread = threading.Thread(target=self.sws.connect, daemon=True)
            ws_thread.start()
            logger.info("SmartWebSocketV2 connection thread launched.")
        except Exception as e:
            logger.error(f"Error starting SmartWebSocketV2: {e}")

    def _process_angel_tick(self, data):
        try:
            if not isinstance(data, dict):
                return
            token = str(data.get("token", data.get("tk", "")))
            if not token or token not in self.tokens_map:
                return

            stock_info = self.tokens_map[token]
            old_item = self.market_data.get(token, {})
            old_ltp = old_item.get("ltp", 0.0)

            raw_ltp = data.get("last_traded_price", data.get("ltp", 0.0))
            if raw_ltp > 100000 and "divisor" not in data:
                ltp = raw_ltp / 100.0
            else:
                ltp = float(raw_ltp)

            close = float(data.get("closed_price", data.get("close", old_item.get("close", ltp))))
            if close > 100000: close = close / 100.0

            open_p = float(data.get("open_price_of_the_day", data.get("open", old_item.get("open", ltp))))
            if open_p > 100000: open_p = open_p / 100.0

            high_p = float(data.get("high_price_of_the_day", data.get("high", max(old_item.get("high", ltp), ltp))))
            if high_p > 100000: high_p = high_p / 100.0

            low_p = float(data.get("low_price_of_the_day", data.get("low", min(old_item.get("low", ltp), ltp) if old_item.get("low", 0) > 0 else ltp)))
            if low_p > 100000: low_p = low_p / 100.0

            vol = int(data.get("volume_traded_for_the_day", data.get("vol", old_item.get("volume", 0))))

            change = round(ltp - close, 2) if close > 0 else 0.0
            pChange = round((change / close) * 100, 2) if close > 0 else 0.0
            direction = "up" if ltp > old_ltp else ("down" if ltp < old_ltp else "flat")

            comp_name = stock_info.get("company_name", stock_info["symbol"])
            calc = self.calculators.get(token)
            if not calc:
                calc = StockTechnicalCalculator(initial_ltp=ltp)
                self.calculators[token] = calc
            indicators = calc.update_live_tick(ltp, open_p, high_p, low_p, close, stock_info["symbol"], comp_name)

            updated_data = {
                "token": token,
                "symbol": stock_info["symbol"],
                "trading_symbol": stock_info.get("trading_symbol", stock_info["symbol"] + "-EQ"),
                "company_name": comp_name,
                "sector": stock_info["sector"],
                "market_cap_cr": stock_info.get("market_cap_cr", 5000),
                "cap_category": stock_info.get("cap_category", "Small Cap"),
                "ltp": round(ltp, 2),
                "open": round(open_p, 2),
                "high": round(high_p, 2),
                "low": round(low_p, 2),
                "close": round(close, 2),
                "change": change,
                "pChange": pChange,
                "volume": vol,
                "last_update": time.strftime("%H:%M:%S"),
                "tick_direction": direction,
                **indicators
            }

            self.market_data[token] = updated_data
            self._broadcast_tick(updated_data)

        except Exception as e:
            logger.error(f"Error parsing tick: {e}")

    def _broadcast_tick(self, tick_dict: Dict[str, Any]):
        if not self.subscribers or not self.loop:
            return
        payload = json.dumps({"type": "tick", "data": tick_dict})
        for ws in list(self.subscribers):
            try:
                asyncio.run_coroutine_threadsafe(ws.send_text(payload), self.loop)
            except Exception:
                pass

    def get_all_stocks(self) -> List[Dict[str, Any]]:
        return list(self.market_data.values())

    def get_sectors(self) -> List[str]:
        sectors = set()
        for item in self.tokens_map.values():
            s = item.get("sector")
            if s:
                sectors.add(s)
        return sorted(list(sectors))

# Singleton instance
stream_manager = AngelStreamManager()
