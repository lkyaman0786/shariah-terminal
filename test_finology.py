import requests
import re
from bs4 import BeautifulSoup

def scrape_finology(symbol):
    url = f"https://ticker.finology.in/company/{symbol}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    
    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code != 200:
        print(f"Failed with status {resp.status_code}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    
    data = {"symbol": symbol, "source_url": url}
    
    # Finology Company Essentials section
    # Usually in div#mainContent or cards with .productdetails or .cardscreen
    for card in soup.find_all("div", class_=re.compile(r"cardscreen|card-body|compess", re.I)):
        text = card.get_text(separator=" ", strip=True)
        # Look for key-value pairs
    
    # Or search for specific labels
    labels = soup.find_all(["small", "span", "p", "h6"])
    for l in labels:
        label_text = l.get_text(strip=True)
        if label_text in ["Market Cap", "P/E", "P/B", "EPS", "ROE", "ROCE", "Debt to Equity", "Dividend Yield", "Book Value", "Face Value", "Promoter Holding", "Profit Growth", "Sales Growth"]:
            parent = l.parent
            val_el = parent.find(["p", "span", "h5", "h4", "div", "strong"])
            if val_el:
                data[label_text] = val_el.get_text(strip=True)

    print("Parsed Data:", data)
    return data

if __name__ == "__main__":
    scrape_finology("CHENNPETRO")
    scrape_finology("TCS")
