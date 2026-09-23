"""
cwa_api.py - 中央氣象署 (CWA) Open Data API 串接與資料解析模組
支援:
1. O-A0003-001: 自動氣象站即時觀測資料 (觀測溫度、當日最高/最低溫、降雨、經緯度) - 推薦使用
2. F-C0032-001: 一般天氣預報-今明36小時天氣預報
"""

import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

CWA_OA0003_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"
CWA_FC0032_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"

# 臺灣 22 個主要縣市清單與經緯度 (供備用與預設中心座標使用)
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


def fetch_oa0003_data(api_key: str) -> Dict[str, Any]:
    """
    呼叫中央氣象署 Open Data API (O-A0003-001: 自動氣象站即時觀測資料)
    包含全臺 360+ 個自動測站之氣溫、當日最高低溫、濕度、即時雨量與精確 WGS84 經緯度
    """
    if not api_key:
        raise ValueError("請提供有效的 CWA API 授權碼 (API Key)。")

    params = {
        "Authorization": api_key,
        "format": "JSON",
    }
    response = requests.get(CWA_OA0003_URL, params=params, timeout=20)
    response.raise_for_status()

    data = response.json()
    if not data.get("success") == "true":
        message = data.get("result", {}).get("message", "CWA API 回傳失敗")
        raise RuntimeError(f"CWA API 錯誤: {message}")

    return data


def parse_oa0003_json(raw_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    解析 O-A0003-001 JSON 資料，轉換為 TemperatureForecasts 資料格式
    """
    records = raw_json.get("records", {})
    stations = records.get("Station", [])
    parsed_records: List[Dict[str, Any]] = []

    for s in stations:
        station_name = s.get("StationName", "")
        station_id = s.get("StationId", "")
        geo = s.get("GeoInfo", {})
        county = geo.get("CountyName", "")
        town = geo.get("TownName", "")

        # 取得 WGS84 座標
        lat, lon = 0.0, 0.0
        coords = {c.get("CoordinateName"): c for c in geo.get("Coordinates", [])}
        if "WGS84" in coords:
            try:
                lat = float(coords["WGS84"].get("StationLatitude", 0.0))
                lon = float(coords["WGS84"].get("StationLongitude", 0.0))
            except (ValueError, TypeError):
                lat, lon = 0.0, 0.0

        # 觀測時間
        obs_time_raw = s.get("ObsTime", {}).get("DateTime", "")
        # 格式化為標準字串
        obs_time = obs_time_raw.replace("T", " ")[:19] if obs_time_raw else datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        we = s.get("WeatherElement", {})
        # 當前氣溫
        try:
            air_temp = float(we.get("AirTemperature", -99.0))
        except (ValueError, TypeError):
            air_temp = 25.0

        if air_temp <= -50.0:  # 儀器維護或無資料代碼
            continue

        # 當日最高溫與最低溫
        de = we.get("DailyExtreme", {})
        hi_raw = de.get("DailyHigh", {}).get("TemperatureInfo", {}).get("AirTemperature")
        lo_raw = de.get("DailyLow", {}).get("TemperatureInfo", {}).get("AirTemperature")

        try:
            max_temp = float(hi_raw) if hi_raw is not None else air_temp
        except (ValueError, TypeError):
            max_temp = air_temp

        try:
            min_temp = float(lo_raw) if lo_raw is not None else air_temp
        except (ValueError, TypeError):
            min_temp = air_temp

        # 天氣現象與其他指標
        wx = we.get("Weather", "晴")
        if not wx or wx == "-99":
            wx = "多雲時晴"

        precip = we.get("Now", {}).get("Precipitation", "0.0")
        humidity = we.get("RelativeHumidity", "70")
        pressure = we.get("AirPressure", "1013.0")

        loc_label = f"{county} - {town} ({station_name})" if town else f"{county} - {station_name}"

        parsed_records.append({
            "location_name": loc_label,
            "start_time": obs_time,
            "end_time": obs_time,
            "min_temp": min_temp,
            "max_temp": max_temp,
            "weather_condition": wx,
            "rain_prob": f"{precip} mm",
            "comfort_index": f"濕度 {humidity}%, 氣壓 {pressure} hPa",
            "lat": lat,
            "lon": lon,
        })

    return parsed_records


def fetch_weather_data(api_key: str, location_name: Optional[str] = None) -> Dict[str, Any]:
    """
    呼叫 F-C0032-001 (今明 36 小時預報)
    """
    if not api_key:
        raise ValueError("請提供有效的 CWA API 授權碼 (API Key)。")

    params = {"Authorization": api_key, "format": "JSON"}
    if location_name:
        params["locationName"] = location_name

    response = requests.get(CWA_FC0032_URL, params=params, timeout=15)
    response.raise_for_status()
    data = response.json()
    if not data.get("success") == "true":
        raise RuntimeError("CWA API 回傳失敗")
    return data


def parse_weather_json(raw_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """解析 F-C0032-001 預報 JSON"""
    records = raw_json.get("records", {})
    locations = records.get("location", [])
    parsed_forecasts: List[Dict[str, Any]] = []

    # 經緯度對應
    loc_coord = {item["name"]: (item["lat"], item["lon"]) for item in TAIWAN_LOCATIONS}

    for loc in locations:
        loc_name = loc.get("locationName", "")
        lat, lon = loc_coord.get(loc_name, (23.8, 120.9))
        weather_elements = loc.get("weatherElement", [])

        element_dict: Dict[str, List[Dict[str, Any]]] = {}
        for elem in weather_elements:
            element_dict[elem.get("elementName", "")] = elem.get("time", [])

        time_slots = element_dict.get("Wx", [])
        for i, time_item in enumerate(time_slots):
            start_time = time_item.get("startTime", "")
            end_time = time_item.get("endTime", "")
            wx = time_item.get("parameter", {}).get("parameterName", "晴")

            pop = "0%"
            pop_times = element_dict.get("PoP", [])
            if i < len(pop_times):
                pop = f"{pop_times[i].get('parameter', {}).get('parameterName', '0')}%"

            min_temp, max_temp = 20.0, 25.0
            mint_times = element_dict.get("MinT", [])
            if i < len(mint_times):
                try:
                    min_temp = float(mint_times[i].get("parameter", {}).get("parameterName", 20.0))
                except Exception:
                    pass

            maxt_times = element_dict.get("MaxT", [])
            if i < len(maxt_times):
                try:
                    max_temp = float(maxt_times[i].get("parameter", {}).get("parameterName", 25.0))
                except Exception:
                    pass

            ci = "舒適"
            ci_times = element_dict.get("CI", [])
            if i < len(ci_times):
                ci = ci_times[i].get("parameter", {}).get("parameterName", "舒適")

            parsed_forecasts.append({
                "location_name": loc_name,
                "start_time": start_time,
                "end_time": end_time,
                "weather_condition": wx,
                "rain_prob": pop,
                "min_temp": min_temp,
                "max_temp": max_temp,
                "comfort_index": ci,
                "lat": lat,
                "lon": lon,
            })

    return parsed_forecasts


def generate_sample_forecasts() -> List[Dict[str, Any]]:
    """產生示範用模擬預報資料 (包含 22 縣市與精確座標)"""
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
        ("晴時多雲", "0.0 mm", 23.0, 31.5, "濕度 65%, 舒適"),
        ("多雲短暫陣雨", "2.5 mm", 24.0, 30.0, "濕度 78%, 微熱有雨"),
        ("陰局部雨", "8.0 mm", 22.0, 27.5, "濕度 85%, 涼爽陰雨"),
        ("晴天", "0.0 mm", 25.0, 33.2, "濕度 60%, 炎熱"),
    ]

    samples: List[Dict[str, Any]] = []
    for loc_idx, loc in enumerate(TAIWAN_LOCATIONS):
        base_mint = 21.5 + (loc_idx % 4) * 0.8
        base_maxt = 28.5 + (loc_idx % 5) * 0.9

        for slot_idx, (st, et) in enumerate(slots):
            w_idx = (loc_idx + slot_idx) % len(weather_types)
            cond, rain, _, _, ci = weather_types[w_idx]

            mint = round(base_mint - (1.0 if slot_idx == 1 else 0), 1)
            maxt = round(base_maxt + (0.8 if slot_idx == 0 else 0), 1)

            samples.append({
                "location_name": f"{loc['name']} - 測站",
                "start_time": st,
                "end_time": et,
                "weather_condition": cond,
                "rain_prob": rain,
                "min_temp": mint,
                "max_temp": maxt,
                "comfort_index": ci,
                "lat": loc["lat"],
                "lon": loc["lon"],
            })

    return samples
