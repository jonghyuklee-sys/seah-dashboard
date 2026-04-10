import requests

DB_URL = "https://seahcm-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app"
NODE = "excelSafeData"

def cleanup():
    print("📡 Fetching data from Firebase...")
    r = requests.get(f"{DB_URL}/{NODE}.json")
    data = r.json()
    
    if not data:
        print("❌ No data found.")
        return

    targets = []
    
    print("🔍 Analyzing entries...")
    for key, val in data.items():
        dt = val.get('dateTime')
        is_target = False
        
        if isinstance(dt, str):
            # Check for various date formats
            if "2026-04-09" in dt or "2026-04-10" in dt or "04-09" in dt or "04-10" in dt:
                is_target = True
        elif isinstance(dt, (int, float)):
            # Excel serial for 2026-04-09 is 46117
            if 46117 <= dt < 46119:
                is_target = True
                
        if is_target:
            targets.append(key)

    total = len(targets)
    if total == 0:
        print("✅ No matching entries for 4/9 or 4/10 found in 'Safe Data'.")
        return

    print(f"🗑️ Found {total} entries to delete. Starting deletion...")
    
    for i, key in enumerate(targets):
        res = requests.delete(f"{DB_URL}/{NODE}/{key}.json")
        if res.status_code == 200:
            if (i+1) % 50 == 0 or (i+1) == total:
                print(f"  - Deleted {i+1}/{total}...")
        else:
            print(f"  - ❌ Failed to delete {key}: {res.status_code}")

    print("✨ Cleanup complete!")

if __name__ == "__main__":
    cleanup()
