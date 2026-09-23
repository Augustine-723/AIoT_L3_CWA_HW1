"""
cwa_api.py - 中央氣象署 (CWA) Open Data API 串接與資料解析模組
"""

import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"

# 臺灣 22 個主要縣市清單與經緯度 (供地圖與預設資料使用)
TAIWAN_LOCATIONS = [
    {"name": "臺北市", "lat": 25.0330, "lon": 121.5654},
    {"name": "新北市", "lat": 25.0118, "lon": 121.4658},
    {"name": "基隆市", "lat": 25.1276, "lon": 121.7392},
    {"name": "桃園市", "lat": 24.9936, "lon": 121.3010},
    {"name": "新竹市", "lat": 24.8138, "lon": 120.9675},
    {"name": "新竹縣", "lat": 24.8387, "lon": 121.0177},
    {"name": "苗栗縣", "lat": 24.5602, "lon": 120.8214},
    {"name": "臺中市", "lat": 24.1477, "lon": 120.6736},
    {"name": "彰化縣", "lat": 24.0518, "lon": 120.5161},
    {"name": "南投縣", "lat": 23.9609, "lon": 120.9719},
    {"name": "雲林縣", "lat": 23.7092, "lon": 120.4313},
    {"name": "嘉義市", "lat": 23.4800, "lon": 120.4491},
    {"name": "嘉義縣", "lat": 23.4518, "lon": 120.2555},
    {"name": "臺南市", "lat": 22.9997, "lon": 120.2270},
    {"name": "高雄市", "lat": 22.6273, "lon": 120.3014},
    {"name": "屏東縣", "lat": 22.5519, "lon": 120.5487},
    {"name": "宜蘭縣", "lat": 24.7021, "lon": 121.7377},
    {"name": "花蓮縣", "lat": 23.9872, "lon": 121.6016},
    {"name": "臺東縣", "lat": 22.7583, "lon": 121.1444},
    {"name": "澎湖縣", "lat": 23.5712, "lon": 119.5793},
    {"name": "金門縣", "lat": 24.4493, "lon": 118.3766},
    {"name": "連江縣", "lat": 26.1505, "lon": 119.9499},
]


def fetch_weather_data(api_key: str, location_name: Optional[str] = None) -> Dict[str, Any]:
    """
    呼叫中央氣象署 Open Data API (F-C0032-001: 36小時天氣預報)
    :param api_key: CWA API 授權碼
    :param location_name: 可選，指定縣市名稱 (若未提供則取得全部縣市)
    :return: 回傳原始 JSON 資料字典
    """
    if not api_key:
        raise ValueError("請提供有效的 CWA API 授權碼 (API Key)。")

    params = {
        "Authorization": api_key,
        "format": "JSON",
    }
    if location_name:
        params["locationName"] = location_name

    response = requests.get(CWA_API_BASE_URL, params=params, timeout=15)
    response.raise_for_status()

    data = response.json()
    if not data.get("success") == "true":
        message = data.get("result", {}).get("message", "CWA API 回傳失敗")
        raise RuntimeError(f"CWA API 錯誤: {message}")

    return data


def parse_weather_json(raw_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    解析 CWA API 回傳的 JSON 格式資料，提取以下欄位：
    - location_name: 縣市名稱
    - start_time: 預報起始時間 (YYYY-MM-DD HH:MM:SS)
    - end_time: 預報結束時間 (YYYY-MM-DD HH:MM:SS)
    - weather_condition: 天氣現象 (Wx)
    - rain_prob: 降雨機率 (%) (PoP)
    - min_temp: 最低溫 (MinT, 攝氏度)
    - max_temp: 最高溫 (MaxT, 攝氏度)
    - comfort_index: 舒適度 (CI)
    """
    records = raw_json.get("records", {})
    locations = records.get("location", [])
    parsed_forecasts: List[Dict[str, Any]] = []

    for loc in locations:
        loc_name = loc.get("locationName", "")
        weather_elements = loc.get("weatherElement", [])

        # 整理不同氣象要素的時間段
        element_dict: Dict[str, List[Dict[str, Any]]] = {}
        for elem in weather_elements:
            elem_name = elem.get("elementName", "")
            element_dict[elem_name] = elem.get("time", [])

        # 一般預報包含 3 個時段 (各12小時)
        time_slots = element_dict.get("Wx", [])
        for i, time_item in enumerate(time_slots):
            start_time = time_item.get("startTime", "")
            end_time = time_item.get("endTime", "")
            wx = time_item.get("parameter", {}).get("parameterName", "晴")

            # 提取 PoP (降雨機率)
            pop = "0"
            pop_times = element_dict.get("PoP", [])
            if i < len(pop_times):
                pop = pop_times[i].get("parameter", {}).get("parameterName", "0")

            # 提取 MinT (最低溫)
            min_temp = 20.0
            mint_times = element_dict.get("MinT", [])
            if i < len(mint_times):
                try:
                    min_temp = float(mint_times[i].get("parameter", {}).get("parameterName", 20.0))
                except (ValueError, TypeError):
                    min_temp = 20.0

            # 提取 MaxT (最高溫)
            max_temp = 25.0
            maxt_times = element_dict.get("MaxT", [])
            if i < len(maxt_times):
                try:
                    max_temp = float(maxt_times[i].get("parameter", {}).get("parameterName", 25.0))
                except (ValueError, TypeError):
                    max_temp = 25.0

            # 提取 CI (舒適度)
            ci = "舒適"
            ci_times = element_dict.get("CI", [])
            if i < len(ci_times):
                ci = ci_times[i].get("parameter", {}).get("parameterName", "舒適")

            parsed_forecasts.append({
                "location_name": loc_name,
                "start_time": start_time,
                "end_time": end_time,
                "weather_condition": wx,
                "rain_prob": f"{pop}%",
                "min_temp": min_temp,
                "max_temp": max_temp,
                "comfort_index": ci,
            })

    return parsed_forecasts


def generate_sample_forecasts() -> List[Dict[str, Any]]:
    """
    產生示範用模擬預報資料 (包含臺灣 22 縣市未來的 3 個時段預報)
    可用於尚未取得 API Key 時的本地離線測試與演示。
    """
    now = datetime.now()
    t1 = now.replace(minute=0, second=0, microsecond=0)
    t2 = t1 + timedelta(hours=12)
    t3 = t2 + timedelta(hours=12)
    t4 = t3 + timedelta(hours=12)

    slots = [
        (t1.strftime("%Y-%m-%d %H:%M:%S"), t2.strftime("%Y-%m-%d %H:%M:%S")),
        (t2.strftime("%Y-%m-%d %H:%M:%S"), t3.strftime("%Y-%m-%d %H:%M:%S")),
        (t3.strftime("%Y-%m-%d %H:%M:%S"), t4.strftime("%Y-%m-%d %H:%M:%S")),
    ]

    weather_types = [
        ("晴時多雲", "10%", 23.0, 31.0, "舒適至悶熱"),
        ("多雲短暫陣雨", "40%", 24.0, 30.0, "舒適至微熱"),
        ("陰局部雨", "60%", 22.0, 27.0, "舒適"),
        ("晴天", "0%", 25.0, 33.0, "悶熱"),
        ("多雲午後雷陣雨", "70%", 23.5, 32.5, "悶熱易雨"),
    ]

    samples: List[Dict[str, Any]] = []
    for loc_idx, loc in enumerate(TAIWAN_LOCATIONS):
        base_mint = 21.0 + (loc_idx % 5) * 0.8
        base_maxt = 28.0 + (loc_idx % 6) * 0.9

        for slot_idx, (st, et) in enumerate(slots):
            w_idx = (loc_idx + slot_idx) % len(weather_types)
            cond, pop, _, _, ci = weather_types[w_idx]

            # 夜晚溫度稍低
            mint = round(base_mint - (1.5 if slot_idx == 1 else 0), 1)
            maxt = round(base_maxt + (1.0 if slot_idx == 0 else 0), 1)

            samples.append({
                "location_name": loc["name"],
                "start_time": st,
                "end_time": et,
                "weather_condition": cond,
                "rain_prob": pop,
                "min_temp": mint,
                "max_temp": maxt,
                "comfort_index": ci,
            })

    return samples
