"""
api/index.py - Vercel Serverless Entrypoint for Taiwan Weather Map
支援 Vercel 一鍵部署，提供類 Windy 深色擬態全島氣象地圖 Web 介面
"""

import os
import json
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>臺灣即時氣象地圖 | AIoT L3 CWA</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif; }
        body { background: #0b0f19; color: #f1f5f9; overflow: hidden; height: 100vh; width: 100vw; display: flex; flex-direction: column; }
        
        /* 頂部 Header */
        header {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 1000;
        }
        .logo { font-size: 1.25rem; font-weight: 700; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .badge { background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 4px 12px; border-radius: 9999px; font-size: 0.8rem; border: 1px solid rgba(56, 189, 248, 0.3); }

        /* 主地圖容器 */
        #map { flex: 1; width: 100%; height: 100%; z-index: 1; }

        /* 浮動圖例 (Windy Scale) */
        .legend {
            position: absolute;
            bottom: 24px;
            right: 24px;
            z-index: 1000;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            padding: 12px 18px;
            width: 280px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .legend-title { font-size: 0.75rem; font-weight: 600; color: #94a3b8; margin-bottom: 6px; display: flex; justify-content: space-between; }
        .gradient-bar { height: 10px; border-radius: 5px; background: linear-gradient(to right, #2c7bb6, #5aa2cf, #7fcdbb, #fee08b, #fdae61, #f46d43, #d73027); margin-bottom: 4px; }
        .ticks { display: flex; justify-content: space-between; font-size: 9px; color: #cbd5e1; font-weight: 600; }

        /* 浮動資訊面板 */
        .info-panel {
            position: absolute;
            top: 75px;
            left: 20px;
            z-index: 1000;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            padding: 16px;
            width: 300px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .info-header { font-size: 0.95rem; font-weight: 700; color: #38bdf8; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px; }
        .info-item { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem; }
        .info-lbl { color: #94a3b8; }
        .info-val { font-weight: 600; color: #f8fafc; }
    </style>
</head>
<body>
    <header>
        <div class="logo">🇹🇼 臺灣即時氣象地圖 (Vercel Edition)</div>
        <div style="display:flex; gap:12px; align-items:center;">
            <span class="badge">📡 CWA O-A0003-001</span>
            <span class="badge" style="color:#10b981; border-color:rgba(16,185,129,0.4); background:rgba(16,185,129,0.15);">🟢 線上部署</span>
        </div>
    </header>

    <div id="map"></div>

    <div class="info-panel" id="panel">
        <div class="info-header" id="st-name">📍 點擊地圖測站查看即時數據</div>
        <div class="info-item"><span class="info-lbl">天氣現象:</span><span class="info-val" id="st-wx">-</span></div>
        <div class="info-item"><span class="info-lbl">當前氣溫:</span><span class="info-val" id="st-temp" style="color:#f59e0b;">-</span></div>
        <div class="info-item"><span class="info-lbl">今日極值:</span><span class="info-val" id="st-range">-</span></div>
        <div class="info-item"><span class="info-lbl">即時雨量:</span><span class="info-val" id="st-rain">-</span></div>
        <div class="info-item"><span class="info-lbl">空氣濕度:</span><span class="info-val" id="st-hum">-</span></div>
    </div>

    <div class="legend">
        <div class="legend-title"><span>°C 氣溫色階 (Windy Scale)</span><span>極低 ➔ 極高</span></div>
        <div class="gradient-bar"></div>
        <div class="ticks">
            <span>5°</span><span>12°</span><span>18°</span><span>24°</span><span>28°</span><span>32°</span><span>36°+</span>
        </div>
    </div>

    <script>
        const map = L.map('map', { zoomControl: false }).setView([23.85, 120.95], 8);
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Esri Dark Matter 底圖 (完全免費、免 API Key、無浮水印)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri &copy; OpenStreetMap',
            maxZoom: 16
        }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16
        }).addTo(map);

        function getColor(temp) {
            if (temp >= 35) return '#d73027';
            if (temp >= 32) return '#f46d43';
            if (temp >= 28) return '#fdae61';
            if (temp >= 24) return '#fee08b';
            if (temp >= 20) return '#d9ef8b';
            if (temp >= 16) return '#7fcdbb';
            if (temp >= 12) return '#abd9e9';
            return '#2c7bb6';
        }

        const stations = %STATIONS_JSON%;

        stations.forEach(st => {
            if (!st.lat || !st.lon) return;
            const color = getColor(st.max_temp);
            const circle = L.circleMarker([st.lat, st.lon], {
                radius: 6,
                fillColor: color,
                color: '#ffffff',
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.85
            }).addTo(map);

            circle.bindTooltip(`<b>${st.name}</b>: ${st.cur_temp}°C (${st.wx})`, { direction: 'top' });

            circle.on('click', () => {
                document.getElementById('st-name').innerText = `📍 ${st.name}`;
                document.getElementById('st-wx').innerText = st.wx;
                document.getElementById('st-temp').innerText = `${st.cur_temp}°C`;
                document.getElementById('st-range').innerText = `${st.min_temp}°C ~ ${st.max_temp}°C`;
                document.getElementById('st-rain').innerText = `${st.rain}`;
                document.getElementById('st-hum').innerText = `${st.humidity}`;
            });
        });

        if (stations.length > 0) {
            const first = stations[0];
            document.getElementById('st-name').innerText = `📍 ${first.name}`;
            document.getElementById('st-wx').innerText = first.wx;
            document.getElementById('st-temp').innerText = `${first.cur_temp}°C`;
            document.getElementById('st-range').innerText = `${first.min_temp}°C ~ ${first.max_temp}°C`;
            document.getElementById('st-rain').innerText = `${first.rain}`;
            document.getElementById('st-hum').innerText = `${first.humidity}`;
        }
    </script>
</body>
</html>
"""

def fetch_stations():
    key = os.getenv("CWA_API_KEY", "")
    stations = []
    if key:
        try:
            url = f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization={key}&limit=200"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as response:
                data = json.loads(response.read().decode())
                for s in data.get("records", {}).get("Station", []):
                    name = s.get("StationName", "")
                    geo = s.get("GeoInfo", {})
                    county = geo.get("CountyName", "")
                    coords = {c.get("CoordinateName"): c for c in geo.get("Coordinates", [])}
                    wgs = coords.get("WGS84", {})
                    lat = float(wgs.get("StationLatitude", 0))
                    lon = float(wgs.get("StationLongitude", 0))
                    we = s.get("WeatherElement", {})
                    air = float(we.get("AirTemperature", 25))
                    de = we.get("DailyExtreme", {})
                    hi = float(de.get("DailyHigh", {}).get("TemperatureInfo", {}).get("AirTemperature", air))
                    lo = float(de.get("DailyLow", {}).get("TemperatureInfo", {}).get("AirTemperature", air))
                    wx = we.get("Weather", "多雲時晴")
                    rain = f"{we.get('Now', {}).get('Precipitation', '0.0')} mm"
                    hum = f"{we.get('RelativeHumidity', '70')}%"

                    if lat and lon:
                        stations.append({
                            "name": f"{county} {name}",
                            "lat": lat,
                            "lon": lon,
                            "cur_temp": air,
                            "min_temp": lo,
                            "max_temp": hi,
                            "wx": wx,
                            "rain": rain,
                            "humidity": hum
                        })
        except Exception:
            pass

    # 備用資料
    if not stations:
        mock = [
            {"name": "臺北市 臺北", "lat": 25.0330, "lon": 121.5654, "cur_temp": 28.5, "min_temp": 23.0, "max_temp": 31.0, "wx": "晴時多雲", "rain": "0.0 mm", "humidity": "65%"},
            {"name": "新北市 板橋", "lat": 25.0118, "lon": 121.4658, "cur_temp": 29.1, "min_temp": 23.5, "max_temp": 31.5, "wx": "多雲", "rain": "0.0 mm", "humidity": "68%"},
            {"name": "臺中市 臺中", "lat": 24.1477, "lon": 120.6736, "cur_temp": 30.2, "min_temp": 24.0, "max_temp": 32.5, "wx": "晴天", "rain": "0.0 mm", "humidity": "62%"},
            {"name": "高雄市 高雄", "lat": 22.6273, "lon": 120.3014, "cur_temp": 31.0, "min_temp": 25.2, "max_temp": 33.0, "wx": "晴朗", "rain": "0.0 mm", "humidity": "72%"},
            {"name": "宜蘭縣 宜蘭", "lat": 24.7021, "lon": 121.7377, "cur_temp": 26.8, "min_temp": 22.5, "max_temp": 29.0, "wx": "陰局部雨", "rain": "2.5 mm", "humidity": "82%"},
            {"name": "花蓮縣 花蓮", "lat": 23.9872, "lon": 121.6016, "cur_temp": 27.5, "min_temp": 23.0, "max_temp": 30.0, "wx": "多雲短暫雨", "rain": "1.0 mm", "humidity": "75%"},
        ]
        stations = mock

    return stations

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        stations = fetch_stations()
        html = HTML_TEMPLATE.replace("%STATIONS_JSON%", json.dumps(stations, ensure_ascii=False))
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))
