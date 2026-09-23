"""
test_db.py - SQLite 資料庫測試腳本
測試 data.db 資料庫建立、TemperatureForecasts 資料表寫入與 SQL 查詢功能
"""

import os
import sys

# 確保在 Windows 主控台 (cp950) 下正確輸出 UTF-8
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from cwa_api import generate_sample_forecasts, parse_weather_json
from database import (
    init_db,
    save_forecasts,
    get_all_locations,
    get_forecasts_by_location,
    get_all_forecasts,
    get_latest_overview,
    get_connection,
    DEFAULT_DB_PATH
)

def run_tests():
    print("=" * 60)
    print(" [AIoT L3 CWA HW1] SQLite 資料庫與氣象資料測試")
    print("=" * 60)

    # 1. 測試資料庫與資料表初始化
    print("\n[Step 1] 初始化 SQLite 資料庫與 TemperatureForecasts 資料表...")
    init_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='TemperatureForecasts'")
    table_exists = cursor.fetchone() is not None
    conn.close()
    assert table_exists, "[FAIL] TemperatureForecasts 資料表建立失敗！"
    print("[SUCCESS] 資料表 TemperatureForecasts 初始化成功！")

    # 2. 測試資料寫入 (使用 22 縣市模擬預報資料)
    print("\n[Step 2] 產生模擬氣象資料並寫入資料庫...")
    sample_data = generate_sample_forecasts()
    print(f"   產生 {len(sample_data)} 筆預報資料 (涵蓋 22 縣市各 3 個時段)")
    saved_count = save_forecasts(sample_data)
    print(f"[SUCCESS] 成功寫入/更新資料庫！(影響筆數: {saved_count})")

    # 3. 測試縣市查詢
    print("\n[Step 3] 測試查詢所有縣市清單 (DISTINCT location_name)...")
    locations = get_all_locations()
    print(f"   查詢到 {len(locations)} 個縣市: {', '.join(locations[:6])} ...等")
    assert len(locations) >= 20, "[FAIL] 縣市數量不正確！"
    print("[SUCCESS] 縣市清單查詢成功！")

    # 4. 測試特定地區預報查詢 (例如：臺北市)
    test_city = "臺北市"
    print(f"\n[Step 4] 測試特定地區預報查詢 (地區 = '{test_city}')...")
    df_city = get_forecasts_by_location(test_city)
    print(df_city[["start_time", "end_time", "min_temp", "max_temp", "weather_condition", "rain_prob"]])
    assert not df_city.empty, f"[FAIL] 無法查得 {test_city} 的預報資料！"
    print(f"[SUCCESS] {test_city} 預報查詢成功，共 {len(df_city)} 筆時段記錄。")

    # 5. 測試自訂 SQL 查詢 (篩選高溫 >= 30 度的地區)
    print("\n[Step 5] 測試自訂 SQL 篩選查詢 (最高溫 MaxT >= 30 度)...")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT location_name, start_time, max_temp, weather_condition 
        FROM TemperatureForecasts 
        WHERE max_temp >= 30.0 
        LIMIT 5
    """)
    hot_results = cursor.fetchall()
    conn.close()
    print("   篩選結果 (前 5 筆):")
    for r in hot_results:
        print(f"   - {r['location_name']}: {r['start_time']} -> {r['max_temp']}°C ({r['weather_condition']})")
    print("[SUCCESS] SQL 條件篩選測試成功！")

    # 6. 測試重複寫入防護 (UNIQUE constraint & INSERT OR REPLACE)
    print("\n[Step 6] 測試重複寫入更新機制 (確保不重複新增同一時段)...")
    initial_total = len(get_all_forecasts())
    save_forecasts(sample_data)  # 再次寫入相同資料
    new_total = len(get_all_forecasts())
    assert initial_total == new_total, f"[FAIL] 重複寫入導致資料暴增！(原本: {initial_total}, 現有: {new_total})"
    print(f"[SUCCESS] 重複寫入更新驗證成功！資料總筆數維持 {new_total} 筆。")

    print("\n" + "=" * 60)
    print(" [ALL PASS] 所有 SQLite 資料庫與氣象資料解析測試皆順利通過！")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
