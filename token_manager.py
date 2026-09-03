import json
import os
import requests

OUTPUT_FILE = "shariah_tokens.json"
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"

# Shariah Exclusion rules
EXCLUDE_KEYWORDS = [
    'BANK', 'FINANCE', 'FINANCIAL', 'HOUSING FIN', 'MICROFINANCE', 'LEASING', 
    'SECURITIES', 'INSURANCE', 'BREW', 'DISTILLER', 'SPIRIT', 'LIQUOR', 
    'ALCOHOL', 'WINER', 'BEER', 'TOBACCO', 'CIGARETTE', 'CASINO', 'GAMING', 
    'CINEMA', 'THEATRE', 'DEBT', 'BOND', 'REIT', 'INVIT', 'MUTUAL FUND'
]

EXCLUDE_EXACT = {
    'ITC', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 
    'BAJAJFINSV', 'DELTACORP', 'RADICO', 'UNITDSPR', 'PVRINOX', 'HDFCLIFE', 'SBILIFE', 
    'ICICIPRULI', 'MUTHOOTFIN', 'MANAPPURAM', 'CHOLAFIN', 'SHRIRAMFIN', 'M&MFIN', 
    'CANBK', 'PNB', 'BANKBARODA', 'INDUSINDBK', 'FEDERALBNK', 'IDFCFIRSTB', 'BANDHANBNK',
    'AUBANK', 'POONAWALLA', 'L&TFH', 'LICHSGFIN', 'ABCAPITAL', 'PEL', 'CREDITACC',
    'SULA', 'GLOBUSSPR', 'SOMDIST', 'VSTIND', 'GODFRYPHLP'
}

# Curated sector mappings for prominent companies
SECTOR_MAP = {
    'TCS': ('Information Technology', 1520000, 'Large Cap'),
    'INFY': ('Information Technology', 760000, 'Large Cap'),
    'HCLTECH': ('Information Technology', 475000, 'Large Cap'),
    'WIPRO': ('Information Technology', 285000, 'Large Cap'),
    'LTIM': ('Information Technology', 165000, 'Large Cap'),
    'TECHM': ('Information Technology', 155000, 'Large Cap'),
    'PERSISTENT': ('Information Technology', 82000, 'Mid Cap'),
    'COFORGE': ('Information Technology', 49000, 'Mid Cap'),
    'MPHASIS': ('Information Technology', 56000, 'Mid Cap'),
    'KPITTECH': ('Information Technology', 45000, 'Mid Cap'),
    'TATAELXSI': ('Information Technology', 43000, 'Mid Cap'),
    'INTELLECT': ('Information Technology', 9500, 'Small Cap'),
    'HINDUNILVR': ('FMCG', 620000, 'Large Cap'),
    'NESTLEIND': ('FMCG', 235000, 'Large Cap'),
    'BRITANNIA': ('FMCG', 138000, 'Large Cap'),
    'TATACONSUM': ('FMCG', 112000, 'Large Cap'),
    'DABUR': ('FMCG', 98000, 'Large Cap'),
    'MARICO': ('FMCG', 85000, 'Mid Cap'),
    'COLPAL': ('FMCG', 86000, 'Mid Cap'),
    'SUNPHARMA': ('Pharmaceuticals', 415000, 'Large Cap'),
    'CIPLA': ('Pharmaceuticals', 128000, 'Large Cap'),
    'DRREDDY': ('Pharmaceuticals', 112000, 'Large Cap'),
    'DIVISLAB': ('Pharmaceuticals', 132000, 'Large Cap'),
    'ZYDUSLIFE': ('Pharmaceuticals', 105000, 'Large Cap'),
    'LUPIN': ('Pharmaceuticals', 98000, 'Mid Cap'),
    'AUROPHARMA': ('Pharmaceuticals', 82000, 'Mid Cap'),
    'TITAN': ('Consumer Durables', 315000, 'Large Cap'),
    'ASIANPAINT': ('Consumer Durables', 285000, 'Large Cap'),
    'HAVELLS': ('Consumer Durables', 118000, 'Large Cap'),
    'MARUTI': ('Automobile', 395000, 'Large Cap'),
    'BAJAJ-AUTO': ('Automobile', 290000, 'Large Cap'),
    'EICHERMOT': ('Automobile', 132000, 'Large Cap'),
    'HEROMOTOCO': ('Automobile', 103000, 'Large Cap'),
    'TVSMOTOR': ('Automobile', 126000, 'Large Cap'),
    'HAL': ('Defense & Aerospace', 315000, 'Large Cap'),
    'BEL': ('Defense & Aerospace', 216000, 'Large Cap'),
    'SIEMENS': ('Capital Goods', 255000, 'Large Cap'),
    'ABB': ('Capital Goods', 172000, 'Large Cap'),
    'PIDILITIND': ('Chemicals', 160000, 'Large Cap'),
    'SRF': ('Chemicals', 71000, 'Mid Cap'),
    'ULTRACEMCO': ('Cement', 325000, 'Large Cap'),
    'GRASIM': ('Cement & Materials', 178000, 'Large Cap'),
    'NTPC': ('Power Generation', 385000, 'Large Cap'),
    'TATAPOWER': ('Power Generation', 138000, 'Large Cap'),
    'BHARTIARTL': ('Telecommunication', 910000, 'Large Cap'),
    'CHENNPETRO': ('Refineries & Oil', 20250, 'Mid Cap'),
    'MGL': ('Gas Distribution', 11000, 'Mid Cap'),
    'FILATEX': ('Textiles & Synthetics', 3500, 'Small Cap'),
    'KPRMILL': ('Textiles & Apparel', 38500, 'Mid Cap'),
    'VIKRAMSOLR': ('Renewable Energy', 7500, 'Small Cap'),
    'TIMETECHNO': ('Industrial Products', 4200, 'Small Cap'),
    'KAYNES': ('Electronics & EMS', 26000, 'Mid Cap'),
    'CUPID': ('Healthcare & Consumer', 3700, 'Small Cap'),
    'SKM': ('Agriculture & Foods', 1100, 'Small Cap'),
    'VINCOFE': ('Beverages', 2100, 'Small Cap'),
    'SANDUMA': ('Mining & Metals', 5600, 'Small Cap'),
    'RGL': ('Gems & Jewellery', 1300, 'Small Cap'),
    'GENUSPOWER': ('Electrical Equipment', 10200, 'Small Cap'),
    'UPL': ('Agro Chemicals', 43500, 'Mid Cap')
}

def fetch_and_map_tokens():
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(curr_dir, OUTPUT_FILE)

    print("Fetching Angel One Scrip Master...")
    resp = requests.get(SCRIP_MASTER_URL, timeout=30)
    resp.raise_for_status()
    scrip_data = resp.json()
    print(f"Fetched {len(scrip_data)} scrips from Angel One.")

    # Filter NSE Equity series
    nse_scrips = [s for s in scrip_data if s.get("exch_seg") == "NSE" and s.get("symbol", "").endswith("-EQ")]
    print(f"Found {len(nse_scrips)} NSE Equity scrips.")

    mapped_list = []
    seen_symbols = set()

    for scrip in nse_scrips:
        full_symbol = scrip.get("symbol", "")
        clean_sym = full_symbol.replace("-EQ", "").strip().upper()
        comp_name = scrip.get("name", "").strip()
        name_upper = comp_name.upper()

        if clean_sym in seen_symbols:
            continue
        if clean_sym in EXCLUDE_EXACT:
            continue
        if any(k in name_upper for k in EXCLUDE_KEYWORDS):
            continue
        if 'BEES' in clean_sym or 'ETF' in clean_sym or 'GOLD' in clean_sym or 'NIFTY' in clean_sym:
            continue

        seen_symbols.add(clean_sym)

        # Determine sector and mcap
        if clean_sym in SECTOR_MAP:
            sector, mcap, cap_cat = SECTOR_MAP[clean_sym]
        else:
            # Automatic sector classification
            if any(w in name_upper for w in ['PHARMA', 'HEALTH', 'DRUG', 'LAB', 'LIFE', 'MED']):
                sector = 'Pharmaceuticals'
            elif any(w in name_upper for w in ['TECH', 'INFO', 'SOFT', 'DIGITAL', 'SYSTEM']):
                sector = 'Information Technology'
            elif any(w in name_upper for w in ['CHEM', 'PETRO', 'FERT', 'ORGANIC', 'GAS']):
                sector = 'Chemicals & Energy'
            elif any(w in name_upper for w in ['AUTO', 'MOTOR', 'TYRE', 'WHEEL', 'ENGINE']):
                sector = 'Automobile'
            elif any(w in name_upper for w in ['FOOD', 'TEA', 'SUGAR', 'CONSUMER', 'DAIRY', 'FMCG']):
                sector = 'FMCG & Consumer'
            elif any(w in name_upper for w in ['SOLAR', 'ENERGY', 'POWER', 'GREEN', 'WIND']):
                sector = 'Renewable Energy'
            elif any(w in name_upper for w in ['TEXTILE', 'MILL', 'FABRIC', 'SPIN', 'COTTON', 'APPAREL', 'GARMENT']):
                sector = 'Textiles & Apparel'
            elif any(w in name_upper for w in ['STEEL', 'METAL', 'MINE', 'IRON', 'ALUM', 'FORG']):
                sector = 'Metals & Mining'
            elif any(w in name_upper for w in ['INFRA', 'BUILD', 'CONSTRUCT', 'ENGINEER', 'PIPE', 'CEMENT']):
                sector = 'Infrastructure & Materials'
            elif any(w in name_upper for w in ['ELECT', 'CABLE', 'POWER', 'EQUIP', 'LIGHT']):
                sector = 'Electrical Equipment'
            else:
                sector = 'General Equities'

            mcap = 5000
            cap_cat = 'Small Cap'

        mapped_list.append({
            "symbol": clean_sym,
            "trading_symbol": full_symbol,
            "token": scrip.get("token", ""),
            "company_name": comp_name,
            "sector": sector,
            "market_cap_cr": mcap,
            "cap_category": cap_cat,
            "exch_seg": "NSE",
            "lotsize": scrip.get("lotsize", "1"),
            "tick_size": scrip.get("tick_size", "5.000000")
        })

    print(f"Generated complete Shariah universe of {len(mapped_list)} Indian NSE equities!")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(mapped_list, f, indent=2)

    print(f"Saved complete Shariah universe to {output_path}")
    return mapped_list

def get_shariah_tokens():
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(curr_dir, OUTPUT_FILE)
    if not os.path.exists(output_path):
        return fetch_and_map_tokens()
    with open(output_path, "r", encoding="utf-8") as f:
        return json.load(f)

if __name__ == "__main__":
    fetch_and_map_tokens()
