import firebase_admin
from firebase_admin import credentials, firestore
import requests
import time
import os
import json

# Configuration
FINNHUB_API_KEY = "d7282upr01qqkte01e60d7282upr01qqkte01e6g"
FUND_ID = "fund-1774911041383"
SERVICE_ACCOUNT_FILE = 'mad-capital-firebase-adminsdk-fbsvc-63cd9aecf4.json'

def get_spy_price():
    try:
        url = f"https://finnhub.io/api/v1/quote?symbol=SPY&token={FINNHUB_API_KEY}"
        response = requests.get(url)
        data = response.json()
        return data.get('c', 0)
    except Exception as e:
        print(f"Error fetching SPY: {e}")
        return 0

def get_asset_price(ticker):
    try:
        url = f"https://finnhub.io/api/v1/quote?symbol={ticker}&token={FINNHUB_API_KEY}"
        response = requests.get(url)
        data = response.json()
        return data.get('c', 0)
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        return None

def run_snapshot():
    # 1. Initialize Firebase
    # Check for service account file path in environment or local
    sa_path = os.environ.get('FIREBASE_SERVICE_ACCOUNT_PATH', SERVICE_ACCOUNT_FILE)
    
    # If running in GitHub Actions, we might pass the JSON content as a secret string
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
    if sa_json:
        cred = credentials.Certificate(json.loads(sa_json))
    else:
        cred = credentials.Certificate(sa_path)
        
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print(f"--- STARTING SNAPSHOT FOR {FUND_ID} ---")

    # 2. Get Fund Data
    fund_ref = db.collection('funds').document(FUND_ID)
    fund = fund_ref.get().to_dict()
    if not fund:
        print("Fund not found.")
        return

    cash_balance = fund.get('cashBalance', 0)
    total_units = fund.get('totalUnits', 0)
    
    # 3. Get Assets & Calculate Market Value
    assets = db.collection('assets').where('fundId', '==', FUND_ID).get()
    total_equity_value = 0
    
    for asset_doc in assets:
        asset = asset_doc.to_dict()
        ticker = asset.get('ticker')
        amount = asset.get('amount', 0)
        
        if ticker and amount > 0:
            price = get_asset_price(ticker)
            if price is None:
                price = asset.get('price', 0) # Fallback to DB price
            
            total_equity_value += amount * price
            
            # Update asset price in DB while we are at it
            asset_doc.reference.update({
                'price': price,
                'updatedAt': int(time.time() * 1000)
            })

    total_aum = cash_balance + total_equity_value
    nav_per_unit = total_aum / total_units if total_units > 0 else 10.0

    # 4. Get SPY Benchmark
    current_spy = get_spy_price()

    # 5. Calculate Daily P&L vs Last Snapshot
    snapshots = db.collection('fund_snapshots').where('fundId', '==', FUND_ID).get()
    
    daily_pnl = 0
    if snapshots:
        # Sort locally to avoid needing a Firestore composite index
        sorted_snaps = sorted([s.to_dict() for s in snapshots], key=lambda x: x['date'], reverse=True)
        last_snap = sorted_snaps[0]
        last_nav = last_snap.get('navPerUnit', 10.0)
        daily_pnl = (nav_per_unit - last_nav) * total_units

    # 6. Save Snapshot
    now_ms = int(time.time() * 1000)
    snapshot_data = {
        'fundId': FUND_ID,
        'date': now_ms,
        'totalAum': total_aum,
        'totalUnits': total_units,
        'navPerUnit': nav_per_unit,
        'spyValue': current_spy,
        'dailyPnl': daily_pnl,
        'createdAt': now_ms
    }

    db.collection('fund_snapshots').add(snapshot_data)
    
    # 7. Update Fund AUM/NAV
    fund_ref.update({
        'totalAum': total_aum,
        'navPerUnit': nav_per_unit,
        'updatedAt': now_ms
    })

    print(f"Snapshot Created: AUM=${total_aum:.2f}, NAV=${nav_per_unit:.4f}, SPY=${current_spy}, P&L=${daily_pnl:+.2f}")
    print("--- SUCCESS ---")

if __name__ == "__main__":
    run_snapshot()
