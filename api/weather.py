"""
api/weather.py - Vercel Serverless Function
安全代理 CWA API 請求，避免前端暴露 API Key
"""

import os
import json
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 臺灣 22 縣市中心座標備用資料
COUNTY_COORDINATES = {
    "臺北市": (25.0330, 121.5654),
    "新北市": (25.0118, 121.4658),
    "基隆市": (25.1276, 121.7392),
    "桃園市": (24.9936, 121.3010),
    "新竹市": (24.8138, 120.9675),
    "新竹縣": (24.8387, 121.0177),
    "苗栗縣": (24.5602, 120.8214),
    "臺中市": (24.1477, 120.6736),
    "彰化縣": (24.0518, 120.5161),
    "南投縣": (23.9609, 120.9719),
    "雲林縣": (23.7092, 120.4313),
    "嘉義市": (23.4800, 120.4491),
    "嘉義縣": (23.4518, 120.2555),
    "臺南市": (22.9997, 120.2270),
    "高雄市": (22.6273, 120.3014),
    "屏東縣": (22.5519, 120.5487),
    "宜蘭縣": (24.7021, 121.7377),
    "花蓮縣": (23.9872, 121.6016),
    "臺東縣": (22.7583, 121.1444),
    "澎湖縣": (23.5712, 119.5793),
    "金門縣": (24.4493, 118.3766),
    "連江縣": (26.1505, 119.9499),
}

def get_sample_stations():
    """離線或未配置金鑰時的示範資料"""
    return [
        {"id": "466920", "name": "臺北", "county": "臺北市", "town": "中正區", "lat": 25.0377, "lon": 121.5149, "temp": 28.5, "cur_temp": 28.5, "min_temp": 23.2, "max_temp": 31.8, "wx": "晴時多雲", "rain": "0.0 mm", "humidity": "65%", "pressure": "1012.4 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "466880", "name": "板橋", "county": "新北市", "town": "板橋區", "lat": 25.0000, "lon": 121.4420, "temp": 29.1, "cur_temp": 29.1, "min_temp": 23.8, "max_temp": 32.2, "wx": "多雲", "rain": "0.0 mm", "humidity": "68%", "pressure": "1012.1 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "466940", "name": "基隆", "county": "基隆市", "town": "仁愛區", "lat": 25.1333, "lon": 121.7405, "temp": 28.2, "cur_temp": 28.2, "min_temp": 23.7, "max_temp": 28.4, "wx": "多雲局部雨", "rain": "1.5 mm", "humidity": "75%", "pressure": "1012.5 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467490", "name": "臺中", "county": "臺中市", "town": "北區", "lat": 24.1457, "lon": 120.6840, "temp": 30.4, "cur_temp": 30.4, "min_temp": 24.5, "max_temp": 33.1, "wx": "晴天", "rain": "0.0 mm", "humidity": "60%", "pressure": "1011.8 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467440", "name": "高雄", "county": "高雄市", "town": "前鎮區", "lat": 22.5660, "lon": 120.3157, "temp": 31.2, "cur_temp": 31.2, "min_temp": 25.4, "max_temp": 33.6, "wx": "晴朗悶熱", "rain": "0.0 mm", "humidity": "72%", "pressure": "1011.2 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467410", "name": "臺南", "county": "臺南市", "town": "中西區", "lat": 22.9933, "lon": 120.2048, "temp": 30.8, "cur_temp": 30.8, "min_temp": 24.8, "max_temp": 32.8, "wx": "晴時多雲", "rain": "0.0 mm", "humidity": "70%", "pressure": "1011.5 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467080", "name": "宜蘭", "county": "宜蘭縣", "town": "宜蘭市", "lat": 24.7640, "lon": 121.7565, "temp": 27.2, "cur_temp": 27.2, "min_temp": 22.8, "max_temp": 29.5, "wx": "陰短暫雨", "rain": "4.0 mm", "humidity": "82%", "pressure": "1013.0 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "466990", "name": "花蓮", "county": "花蓮縣", "town": "花蓮市", "lat": 23.9752, "lon": 121.6133, "temp": 27.8, "cur_temp": 27.8, "min_temp": 23.1, "max_temp": 30.2, "wx": "多雲短暫雨", "rain": "0.5 mm", "humidity": "78%", "pressure": "1012.8 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467660", "name": "臺東", "county": "臺東縣", "town": "臺東市", "lat": 22.7554, "lon": 121.1546, "temp": 29.3, "cur_temp": 29.3, "min_temp": 24.0, "max_temp": 31.5, "wx": "晴時多雲", "rain": "0.0 mm", "humidity": "71%", "pressure": "1012.0 hPa", "time": "2026-09-23 11:30:00"},
        {"id": "467550", "name": "恆春", "county": "屏東縣", "town": "恆春鎮", "lat": 22.0039, "lon": 120.7463, "temp": 30.0, "cur_temp": 30.0, "min_temp": 25.0, "max_temp": 32.0, "wx": "多雲微風", "rain": "0.0 mm", "humidity": "76%", "pressure": "1011.0 hPa", "time": "2026-09-23 11:30:00"},
    ]

def fetch_live_cwa_oa0003(api_key: str):
    """向中央氣象署抓取 O-A0003-001 (自動氣象站即時資料)"""
    url = f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization={api_key}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        stations = []
        raw_stations = data.get("records", {}).get("Station", [])
        
        for s in raw_stations:
            station_name = s.get("StationName", "")
            station_id = s.get("StationId", "")
            geo = s.get("GeoInfo", {})
            county = geo.get("CountyName", "")
            town = geo.get("TownName", "")
            
            coords = {c.get("CoordinateName"): c for c in geo.get("Coordinates", [])}
            wgs = coords.get("WGS84", {})
            try:
                lat = float(wgs.get("StationLatitude", 0))
                lon = float(wgs.get("StationLongitude", 0))
            except (ValueError, TypeError):
                lat, lon = 0.0, 0.0

            if (not lat or not lon) and county in COUNTY_COORDINATES:
                lat, lon = COUNTY_COORDINATES[county]

            if not lat or not lon:
                continue

            we = s.get("WeatherElement", {})
            try:
                cur_temp = float(we.get("AirTemperature", -99.0))
            except (ValueError, TypeError):
                cur_temp = 25.0

            if cur_temp <= -50.0:
                continue

            de = we.get("DailyExtreme", {})
            hi_val = de.get("DailyHigh", {}).get("TemperatureInfo", {}).get("AirTemperature")
            lo_val = de.get("DailyLow", {}).get("TemperatureInfo", {}).get("AirTemperature")

            try:
                max_temp = float(hi_val) if hi_val is not None else cur_temp
            except Exception:
                max_temp = cur_temp

            try:
                min_temp = float(lo_val) if lo_val is not None else cur_temp
            except Exception:
                min_temp = cur_temp

            wx = we.get("Weather", "晴時多雲")
            if not wx or wx == "-99":
                wx = "多雲時晴"

            rain = f"{we.get('Now', {}).get('Precipitation', '0.0')} mm"
            humidity = f"{we.get('RelativeHumidity', '70')}%"
            pressure = f"{we.get('AirPressure', '1013.0')} hPa"
            obs_time = s.get("ObsTime", {}).get("DateTime", "").replace("T", " ")[:19]

            stations.append({
                "id": station_id,
                "name": station_name,
                "county": county,
                "town": town,
                "lat": lat,
                "lon": lon,
                "temp": cur_temp,
                "cur_temp": cur_temp,
                "min_temp": min_temp,
                "max_temp": max_temp,
                "wx": wx,
                "rain": rain,
                "humidity": humidity,
                "pressure": pressure,
                "time": obs_time,
            })

        return stations

class handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=120")
        self.end_headers()

        api_key = os.getenv("CWA_API_KEY", "")
        stations = []
        is_live = False

        if api_key:
            try:
                stations = fetch_live_cwa_oa0003(api_key)
                if stations:
                    is_live = True
            except Exception as e:
                print(f"Fetch CWA error: {e}")

        if not stations:
            stations = get_sample_stations()

        # 彙整所有縣市清單
        counties = sorted(list(set(st["county"] for st in stations if st["county"])))

        result = {
            "success": True,
            "is_live": is_live,
            "dataset": "O-A0003-001 (自動氣象站即時觀測)",
            "total_stations": len(stations),
            "counties": counties,
            "stations": stations,
        }

        self.wfile.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

# Vercel entrypoint alias
app = handler


