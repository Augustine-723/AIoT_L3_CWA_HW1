"""
app.py - 臺灣即時氣象觀測地圖 (Windy 風格專業美化版)
參考來源: https://taiwan-weather-map.vercel.app/ (中央氣象署開放資料即時視覺化地圖 - 類 Windy 風格)
技術棧: Streamlit + SQLite + Folium (Dark Matter) + Plotly Dark + Pandas + CWA O-A0003-001
"""

import os
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import folium
from streamlit_folium import st_folium
from dotenv import load_dotenv

from cwa_api import (
    fetch_oa0003_data,
    parse_oa0003_json,
    fetch_weather_data,
    parse_weather_json,
    generate_sample_forecasts,
    TAIWAN_LOCATIONS,
)
from database import (
    init_db,
    save_forecasts,
    get_all_locations,
    get_forecasts_by_location,
    get_all_forecasts,
    get_latest_overview,
    DEFAULT_DB_PATH,
)

# 載入 .env 環境變數
load_dotenv()

# 設定 Streamlit 頁面
st.set_page_config(
    page_title="臺灣即時氣象地圖 | Windy 風格",
    page_icon="🌌",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ==========================================
# 類 Windy 暗黑透明玻璃擬態 (Glassmorphism) CSS
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap');

    html, body, [class*="css"] {
        font-family: 'Inter', 'Noto Sans TC', -apple-system, sans-serif;
    }

    /* 應用程式全站深色主題背景 */
    .stApp {
        background: radial-gradient(circle at 50% 10%, #111827 0%, #080c14 100%) !important;
        color: #f3f4f6 !important;
    }

    /* 頂部 Header 風格 */
    .windy-header-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(17, 24, 39, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 18px 24px;
        backdrop-filter: blur(16px);
        margin-bottom: 20px;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }
    .windy-title {
        font-size: 1.85rem;
        font-weight: 700;
        background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.5px;
    }
    .windy-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        padding: 6px 14px;
        border-radius: 9999px;
        font-size: 0.85rem;
        font-weight: 500;
        border: 1px solid rgba(56, 189, 248, 0.3);
    }

    /* 玻璃擬態指標卡片 (Glassmorphism Metrics) */
    .glass-card {
        background: rgba(17, 24, 39, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 16px 20px;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease, border-color 0.2s ease;
        text-align: left;
    }
    .glass-card:hover {
        transform: translateY(-2px);
        border-color: rgba(56, 189, 248, 0.4);
    }
    .glass-card-lbl {
        font-size: 0.82rem;
        font-weight: 500;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
    }
    .glass-card-val {
        font-size: 1.7rem;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.2;
    }
    .glass-card-sub {
        font-size: 0.8rem;
        color: #64748b;
        margin-top: 4px;
    }

    /* Windy 風格底部色帶圖例 (Color Scale Bar) */
    .windy-legend-bar {
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 10px 16px;
        backdrop-filter: blur(12px);
        margin-top: 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .gradient-line {
        height: 10px;
        border-radius: 9999px;
        background: linear-gradient(to right, #2c7bb6, #5aa2cf, #abd9e9, #7fcdbb, #d9ef8b, #fee08b, #fdae61, #f46d43, #d73027);
        width: 100%;
        margin-bottom: 6px;
    }
    .legend-ticks {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
        font-weight: 600;
    }

    /* 側邊欄樣式修飾 */
    section[data-testid="stSidebar"] {
        background-color: rgba(11, 15, 25, 0.95) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.08);
    }

    /* 調整資料表格深色調 */
    div[data-testid="stDataFrame"] {
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
""", unsafe_allow_html=True)

# 初始化資料庫
init_db()


def sync_oa0003(api_key: str):
    """呼叫 CWA O-A0003-001 (自動氣象站即時觀測)"""
    try:
        with st.spinner("正在向中央氣象署同步全臺自動觀測站 (O-A0003-001)..."):
            raw_json = fetch_oa0003_data(api_key)
            parsed_data = parse_oa0003_json(raw_json)
            count = save_forecasts(parsed_data)
            st.success(f"✨ 成功同步 {count} 個全臺測站即時觀測資料至 SQLite 資料庫！")
    except Exception as e:
        st.error(f"❌ 擷取失敗: {str(e)}")


def sync_fc0032(api_key: str):
    """呼叫 CWA F-C0032-001 (36小時預報)"""
    try:
        with st.spinner("正在擷取 36小時天氣預報 (F-C0032-001)..."):
            raw_json = fetch_weather_data(api_key)
            parsed_data = parse_weather_json(raw_json)
            count = save_forecasts(parsed_data)
            st.success(f"✨ 成功同步 {count} 筆天氣預報資料！")
    except Exception as e:
        st.error(f"❌ 擷取失敗: {str(e)}")


def load_demo():
    """載入示範資料"""
    sample_data = generate_sample_forecasts()
    count = save_forecasts(sample_data)
    st.success(f"✨ 成功載入 {count} 筆示範氣象資料！")


def get_windy_temp_color(temp: float) -> str:
    """類 Windy 溫標漸層色對應表"""
    if temp >= 35.0:
        return "#d73027"  # 酷熱紅
    elif temp >= 32.0:
        return "#f46d43"  # 橙紅
    elif temp >= 28.0:
        return "#fdae61"  # 暖橙
    elif temp >= 24.0:
        return "#fee08b"  # 溫黃
    elif temp >= 20.0:
        return "#d9ef8b"  # 淺黃綠
    elif temp >= 16.0:
        return "#7fcdbb"  # 湖水綠
    elif temp >= 12.0:
        return "#abd9e9"  # 淺天藍
    else:
        return "#2c7bb6"  # 寒冷深藍


def create_windy_dark_map(overview_df: pd.DataFrame, focus_location: str = "", layer_type: str = "氣溫"):
    """
    建立類 Windy 風格的高質感深色地圖：深灰藍海洋、陸地亮一階、細緻縣市邊界、白色城市名稱、發光外框標記
    """
    # 臺灣島中心視角，海洋背景底色深灰藍，道路壓低存在感 (opacity 0.35)
    m = folium.Map(
        location=[23.82, 120.95],
        zoom_start=7,
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        attr="&copy; Esri &copy; OpenStreetMap contributors",
        opacity=0.35,
    )

    # 1. 疊加臺灣縣市行政區邊界 (台北、新北、台中、高雄...細線邊界，陸地 #1f2937 比海洋亮一階)
    geojson_path = os.path.join(os.path.dirname(__file__), "tw_counties.json")
    if os.path.exists(geojson_path):
        try:
            import json
            with open(geojson_path, "r", encoding="utf-8") as f:
                geo_data = json.load(f)
            folium.GeoJson(
                geo_data,
                style_function=lambda feature: {
                    "fillColor": "#1f2937",  # 陸地亮一階
                    "color": "rgba(148, 163, 184, 0.45)",  # 行政區細線
                    "weight": 1.2,
                    "fillOpacity": 0.75,
                    "dashArray": "3, 4",
                },
                name="縣市邊界",
            ).add_to(m)
        except Exception:
            pass

    # 2. 標繪主要城市名稱 (台北、台中、高雄、花蓮、台東... 白色/淺灰字，不顯示雜亂鄉鎮)
    major_cities = [
        ("台北", 25.0478, 121.5319),
        ("新北", 25.0118, 121.4658),
        ("台中", 24.1620, 120.6470),
        ("台南", 22.9997, 120.2150),
        ("高雄", 22.6273, 120.3014),
        ("花蓮", 23.9872, 121.6016),
        ("台東", 22.7583, 121.1444),
        ("宜蘭", 24.7570, 121.7530),
        ("新竹", 24.8039, 120.9647),
        ("桃園", 24.9936, 121.3010),
    ]
    for c_name, c_lat, c_lon in major_cities:
        folium.map.Marker(
            [c_lat, c_lon],
            icon=folium.DivIcon(
                html=f'<div style="color: #e2e8f0; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-shadow: 0 1px 3px rgba(0,0,0,0.95); white-space: nowrap;">{c_name}</div>',
                icon_size=(40, 16),
                icon_anchor=(20, 8),
            ),
        ).add_to(m)

    if overview_df.empty:
        return m

    loc_coord_map = {item["name"]: (item["lat"], item["lon"]) for item in TAIWAN_LOCATIONS}

    for _, row in overview_df.iterrows():
        name = row["location_name"]
        lat = row.get("lat", 0.0)
        lon = row.get("lon", 0.0)

        if (not lat or not lon or lat == 0.0) and name in loc_coord_map:
            lat, lon = loc_coord_map[name]

        if not lat or not lon or lat == 0.0:
            continue

        maxt = row["max_temp"]
        mint = row["min_temp"]
        wx = row["weather_condition"]
        rain = row["rain_prob"]
        ci = row["comfort_index"]

        # 標記色彩依據所選圖層設定
        if layer_type == "氣溫":
            color = get_windy_temp_color(maxt)
        elif layer_type == "雨量":
            # 雨量越大顏色越藍越紫
            try:
                rain_val = float(str(rain).replace("mm", "").replace("%", "").strip())
                color = "#3b82f6" if rain_val == 0.0 else ("#06b6d4" if rain_val < 5.0 else "#8b5cf6")
            except Exception:
                color = "#06b6d4"
        else:
            color = "#38bdf8"

        is_focused = (name == focus_location)
        radius = 10 if is_focused else 6
        fill_opacity = 0.95 if is_focused else 0.8

        popup_html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: #0f172a; color: #f8fafc; padding: 12px; border-radius: 10px;
                    border: 1px solid rgba(56, 189, 248, 0.3); min-width: 175px;">
            <div style="font-size: 14px; font-weight: 700; color: #38bdf8; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">📍 {name}</div>
            <div style="font-size: 12px; margin-bottom: 3px;"><b>最高溫:</b> <span style="color:#f87171; font-weight:700;">{maxt}°C</span></div>
            <div style="font-size: 12px; margin-bottom: 3px;"><b>最低溫:</b> <span style="color:#38bdf8; font-weight:700;">{mint}°C</span></div>
            <div style="font-size: 12px; margin-bottom: 3px;"><b>即時雨量:</b> <span style="color:#06b6d4; font-weight:600;">{rain}</span></div>
            <div style="font-size: 12px; margin-bottom: 3px;"><b>天氣狀態:</b> {wx}</div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px;">{ci}</div>
        </div>
        """

        folium.CircleMarker(
            location=[lat, lon],
            radius=radius,
            color="#ffffff" if is_focused else "rgba(255, 255, 255, 0.85)",  # 白色半透明外框
            weight=3 if is_focused else 2,
            fill=True,
            fill_color=color,
            fill_opacity=fill_opacity,
            popup=folium.Popup(popup_html, max_width=240),
            tooltip=f"{name}: {mint}~{maxt}°C ({wx})",
        ).add_to(m)

    return m


# ==========================================
# 側邊欄控制面板 (Windy-Style Layer Control)
# ==========================================
with st.sidebar:
    st.markdown("""
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <span style="font-size: 28px;">🛰️</span>
        <div>
            <div style="font-size:1.15rem; font-weight:700; color:#f8fafc;">即時氣象圖層</div>
            <div style="font-size:0.75rem; color:#64748b;">TAIWAN LIVE WEATHER</div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("---")
    st.subheader("🎨 地圖圖層選擇 (Layer)")
    layer_mode = st.radio(
        "選擇主要視覺圖層",
        options=["🌡️ 氣溫分佈", "🌧️ 雨量觀測", "📍 測站點位"],
        index=0,
    )

    st.markdown("---")
    st.subheader("🔑 氣象資料同步")

    server_api_key = os.getenv("CWA_API_KEY", "")
    if server_api_key:
        st.markdown('<div style="color:#10b981; font-size:0.85rem; font-weight:600;">🔒 API 金鑰：後端環境變數安全運作中</div>', unsafe_allow_html=True)
    else:
        st.markdown('<div style="color:#f59e0b; font-size:0.85rem;">⚠️ 未配置 API Key，可點擊示範資料</div>', unsafe_allow_html=True)

    dataset_choice = st.radio(
        "CWA 開放資料集來源",
        options=["O-A0003-001 (全臺 360+ 自動站即時觀測)", "F-C0032-001 (36小時預報)"],
        index=0,
    )

    col_btn1, col_btn2 = st.columns(2)
    with col_btn1:
        if st.button("🔄 同步 CWA", use_container_width=True):
            if not server_api_key:
                st.warning("請先在 .env 配置 CWA_API_KEY")
            else:
                if "O-A0003-001" in dataset_choice:
                    sync_oa0003(server_api_key)
                else:
                    sync_fc0032(server_api_key)
    with col_btn2:
        if st.button("🧪 示範資料", use_container_width=True):
            load_demo()

    st.markdown("---")
    st.subheader("📍 測站與縣市篩選")

    all_locations = get_all_locations()
    if not all_locations:
        if server_api_key:
            sync_oa0003(server_api_key)
        else:
            load_demo()
        all_locations = get_all_locations()

    taiwan_counties = [
        "全部縣市", "臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣",
        "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣",
        "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣",
        "金門縣", "連江縣"
    ]
    selected_county = st.selectbox("縣市選單", options=taiwan_counties, index=0)

    if selected_county == "全部縣市":
        filtered_locations = all_locations
    else:
        filtered_locations = [loc for loc in all_locations if selected_county in loc]
        if not filtered_locations:
            filtered_locations = all_locations

    selected_location = st.selectbox("測站 / 觀測地區", options=filtered_locations, index=0)

    st.markdown("---")
    st.caption("✨ 風格參考: taiwan-weather-map (類 Windy 暗色擬態視覺架構)")


# ==========================================
# 主畫面 (Main Content - Windy Style)
# ==========================================
# 頂部風尚 Header
st.markdown("""
<div class="windy-header-container">
    <div>
        <div class="windy-title">🇹🇼 臺灣即時氣象地圖</div>
        <div style="color: #94a3b8; font-size: 0.95rem; margin-top: 3px;">
            中央氣象署開放資料即時視覺化地圖（類 Windy 風格 · O-A0003-001 全島 360+ 自動測站）
        </div>
    </div>
    <div>
        <span class="windy-badge">🟢 即時觀測在線</span>
    </div>
</div>
""", unsafe_allow_html=True)

# 查詢當前選定測站
loc_df = get_forecasts_by_location(selected_location)

# 4 塊玻璃擬態指標卡片 (Glassmorphism Metric Cards)
if not loc_df.empty:
    latest = loc_df.iloc[-1]
    m1, m2, m3, m4 = st.columns(4)

    with m1:
        st.markdown(f"""
        <div class="glass-card">
            <div class="glass-card-lbl">📍 當前觀測站點</div>
            <div class="glass-card-val" style="font-size: 1.35rem; color:#38bdf8;">{selected_location}</div>
            <div class="glass-card-sub">觀測時間: {latest['start_time']}</div>
        </div>
        """, unsafe_allow_html=True)

    with m2:
        st.markdown(f"""
        <div class="glass-card">
            <div class="glass-card-lbl">🌡️ 今日極值溫幅</div>
            <div class="glass-card-val" style="color: #fb923c;">{latest['min_temp']}°C ~ {latest['max_temp']}°C</div>
            <div class="glass-card-sub">最低溫 ~ 最高溫範圍</div>
        </div>
        """, unsafe_allow_html=True)

    with m3:
        st.markdown(f"""
        <div class="glass-card">
            <div class="glass-card-lbl">🌧️ 雨量 / 降雨情況</div>
            <div class="glass-card-val" style="color: #38bdf8;">{latest['rain_prob']}</div>
            <div class="glass-card-sub">即時累積雨量 / 機率</div>
        </div>
        """, unsafe_allow_html=True)

    with m4:
        st.markdown(f"""
        <div class="glass-card">
            <div class="glass-card-lbl">⛅ 天氣型態與大氣</div>
            <div class="glass-card-val" style="font-size: 1.35rem; color: #a78bfa;">{latest['weather_condition']}</div>
            <div class="glass-card-sub">{latest['comfort_index']}</div>
        </div>
        """, unsafe_allow_html=True)

st.write("")

# 核心視覺區：左邊深色地圖，右邊暗黑 Plotly 折線圖
col_map, col_chart = st.columns([1.1, 0.9])

overview_df = get_latest_overview()
if selected_county != "全部縣市" and not overview_df.empty:
    map_display_df = overview_df[overview_df["location_name"].str.contains(selected_county, na=False)]
    if map_display_df.empty:
        map_display_df = overview_df
else:
    map_display_df = overview_df

with col_map:
    layer_name = "氣溫" if "氣溫" in layer_mode else ("雨量" if "雨量" in layer_mode else "點位")
    st.markdown(f"""
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:1.1rem; font-weight:700; color:#f8fafc;">🗺️ 全島觀測地圖 ({len(map_display_df)} 站點)</span>
        <span style="font-size:0.8rem; color:#94a3b8;">底圖: CARTO Dark Matter · 座標: WGS84</span>
    </div>
    """, unsafe_allow_html=True)

    # 渲染 Dark Folium Map
    f_map = create_windy_dark_map(map_display_df, focus_location=selected_location, layer_type=layer_name)
    st_folium(f_map, width=580, height=430)

    # 類 Windy 溫標漸層色帶圖例 (Color Scale Bar)
    st.markdown("""
    <div class="windy-legend-bar">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-size:11px; font-weight:600; color:#cbd5e1;">°C 氣溫色階圖例 (Windy Scale)</span>
            <span style="font-size:10px; color:#64748b;">極低溫 ➔ 極高溫</span>
        </div>
        <div class="gradient-line"></div>
        <div class="legend-ticks">
            <span>5°</span>
            <span>10°</span>
            <span>15°</span>
            <span>20°</span>
            <span>24°</span>
            <span>28°</span>
            <span>32°</span>
            <span>36°C+</span>
        </div>
    </div>
    """, unsafe_allow_html=True)

with col_chart:
    st.markdown(f"""
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:1.1rem; font-weight:700; color:#f8fafc;">📈 {selected_location} 溫度趨勢</span>
        <span style="font-size:0.8rem; color:#94a3b8;">Plotly Dark Cyber Glow</span>
    </div>
    """, unsafe_allow_html=True)

    if not loc_df.empty:
        # 繪製暗黑高對比 Plotly 折線圖
        fig = go.Figure()

        # 最高溫曲線 (霓虹珊瑚紅)
        fig.add_trace(go.Scatter(
            x=loc_df["start_time"],
            y=loc_df["max_temp"],
            mode="lines+markers+text",
            name="最高溫 (MaxT)",
            text=[f"{v}°C" for v in loc_df["max_temp"]],
            textposition="top center",
            textfont=dict(color="#f87171", size=11),
            line=dict(color="#f43f5e", width=3, shape="spline"),
            marker=dict(size=8, color="#f43f5e", line=dict(width=2, color="#ffffff")),
        ))

        # 最低溫曲線 (霓虹天空藍)
        fig.add_trace(go.Scatter(
            x=loc_df["start_time"],
            y=loc_df["min_temp"],
            mode="lines+markers+text",
            name="最低溫 (MinT)",
            text=[f"{v}°C" for v in loc_df["min_temp"]],
            textposition="bottom center",
            textfont=dict(color="#38bdf8", size=11),
            line=dict(color="#38bdf8", width=3, dash="dot", shape="spline"),
            marker=dict(size=8, color="#38bdf8", symbol="diamond", line=dict(width=2, color="#ffffff")),
        ))

        fig.update_layout(
            paper_bgcolor="rgba(17, 24, 39, 0.6)",
            plot_bgcolor="rgba(15, 23, 42, 0.8)",
            font=dict(color="#cbd5e1", family="Inter, sans-serif"),
            height=495,
            margin=dict(l=30, r=20, t=30, b=40),
            xaxis=dict(
                title=dict(text="觀測 / 預報時間", font=dict(color="#94a3b8", size=12)),
                gridcolor="rgba(255, 255, 255, 0.06)",
                tickfont=dict(color="#94a3b8", size=10),
            ),
            yaxis=dict(
                title=dict(text="氣溫 (°C)", font=dict(color="#94a3b8", size=12)),
                gridcolor="rgba(255, 255, 255, 0.06)",
                tickfont=dict(color="#94a3b8", size=10),
            ),
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="right",
                x=1,
                bgcolor="rgba(0,0,0,0)",
                font=dict(color="#e2e8f0", size=11)
            ),
            hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.warning("目前尚無此站點之圖表資料。")

st.markdown("---")

# ==========================================
# 資料表區塊 (Dark Glass Data Table)
# ==========================================
st.markdown("""
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <span style="font-size:1.2rem; font-weight:700; color:#f8fafc;">📋 即時觀測資料庫 (SQLite: data.db / TemperatureForecasts)</span>
</div>
""", unsafe_allow_html=True)

if not loc_df.empty:
    display_df = loc_df[[
        "location_name", "start_time", "weather_condition",
        "min_temp", "max_temp", "rain_prob", "comfort_index", "lat", "lon"
    ]].copy()

    display_df.rename(columns={
        "location_name": "觀測站點",
        "start_time": "觀測時間",
        "weather_condition": "天氣現象",
        "min_temp": "最低溫 (°C)",
        "max_temp": "最高溫 (°C)",
        "rain_prob": "雨量 / 降雨",
        "comfort_index": "大氣狀態",
        "lat": "緯度 (WGS84)",
        "lon": "經度 (WGS84)",
    }, inplace=True)

    st.dataframe(display_df, use_container_width=True)

    csv_data = display_df.to_csv(index=False, encoding="utf-8-sig")
    st.download_button(
        label="📥 匯出選取測站資料 (CSV)",
        data=csv_data,
        file_name=f"{selected_location}_氣象觀測.csv",
        mime="text/csv",
    )
