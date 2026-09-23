"""
app.py - 臺灣中央氣象署 (CWA) 氣象觀測與預報 Web 應用程式
整合 CWA O-A0003-001 (全臺 360+ 測站即時觀測) 與 F-C0032-001 (預報)
技術棧: Streamlit + SQLite + Folium + Plotly + Pandas
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
    page_title="臺灣氣象觀測與預報系統 | CWA O-A0003-001",
    page_icon="🌤️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# 自訂現代化 CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        background: linear-gradient(120deg, #1E88E5, #00897B);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 0.95rem;
        color: #546E7A;
        margin-bottom: 1.2rem;
    }
    .metric-card {
        background: #f8fafc;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        border: 1px solid #e2e8f0;
        text-align: center;
    }
    .metric-val {
        font-size: 1.75rem;
        font-weight: bold;
        color: #1e293b;
    }
    .metric-lbl {
        font-size: 0.85rem;
        color: #64748b;
    }
</style>
""", unsafe_allow_html=True)

# 初始化資料庫
init_db()


def sync_oa0003(api_key: str):
    """呼叫 CWA O-A0003-001 API (自動氣象站即時觀測)"""
    try:
        with st.spinner("正在擷取全臺自動氣象站觀測資料 (O-A0003-001)..."):
            raw_json = fetch_oa0003_data(api_key)
            parsed_data = parse_oa0003_json(raw_json)
            count = save_forecasts(parsed_data)
            st.success(f"✅ 成功同步全臺 {count} 個自動氣象站即時觀測資料至資料庫！")
    except Exception as e:
        st.error(f"❌ 擷取 O-A0003-001 失敗: {str(e)}")


def sync_fc0032(api_key: str):
    """呼叫 CWA F-C0032-001 API (36小時預報)"""
    try:
        with st.spinner("正在向中央氣象署擷取 36小時天氣預報 (F-C0032-001)..."):
            raw_json = fetch_weather_data(api_key)
            parsed_data = parse_weather_json(raw_json)
            count = save_forecasts(parsed_data)
            st.success(f"✅ 成功同步 {count} 筆氣象預報資料至資料庫！")
    except Exception as e:
        st.error(f"❌ 擷取預報失敗: {str(e)}")


def load_demo():
    """載入示範資料"""
    sample_data = generate_sample_forecasts()
    count = save_forecasts(sample_data)
    st.success(f"✅ 成功載入 {count} 筆示範氣象資料！")


def create_folium_map(overview_df: pd.DataFrame, focus_location: str = ""):
    """建立包含精確 WGS84 座標之全島氣溫標記地圖"""
    m = folium.Map(location=[23.8, 120.9], zoom_start=7, tiles="OpenStreetMap")

    if overview_df.empty:
        return m

    # 備用縣市中心字典
    loc_coord_map = {item["name"]: (item["lat"], item["lon"]) for item in TAIWAN_LOCATIONS}

    for _, row in overview_df.iterrows():
        name = row["location_name"]
        lat = row.get("lat", 0.0)
        lon = row.get("lon", 0.0)

        # 若無精確經緯度，嘗試由縣市名稱匹配
        if (not lat or not lon or lat == 0.0) and name in loc_coord_map:
            lat, lon = loc_coord_map[name]

        if not lat or not lon or lat == 0.0:
            continue

        maxt = row["max_temp"]
        mint = row["min_temp"]
        wx = row["weather_condition"]
        rain = row["rain_prob"]
        ci = row["comfort_index"]

        # 顏色分級 (依最高溫)
        if maxt >= 32:
            color = "#d32f2f"  # 紅 (高溫)
        elif maxt >= 28:
            color = "#f57c00"  # 橙 (暖熱)
        elif maxt >= 24:
            color = "#388e3c"  # 綠 (適溫)
        else:
            color = "#1976d2"  # 藍 (涼爽)

        is_focused = (name == focus_location)
        radius = 11 if is_focused else 6
        fill_opacity = 0.95 if is_focused else 0.75

        popup_html = f"""
        <div style="font-family: sans-serif; font-size: 13px; line-height: 1.5; width: 170px;">
            <b style="color: #0288d1; font-size: 14px;">{name}</b><br>
            <b>天氣:</b> {wx}<br>
            <b>最高溫:</b> <span style="color: #d32f2f; font-weight: bold;">{maxt}°C</span><br>
            <b>最低溫:</b> <span style="color: #1976d2; font-weight: bold;">{mint}°C</span><br>
            <b>雨量/降雨:</b> {rain}<br>
            <span style="font-size: 11px; color: #64748b;">{ci}</span>
        </div>
        """

        folium.CircleMarker(
            location=[lat, lon],
            radius=radius,
            color="#000" if is_focused else color,
            weight=2 if is_focused else 1,
            fill=True,
            fill_color=color,
            fill_opacity=fill_opacity,
            popup=folium.Popup(popup_html, max_width=220),
            tooltip=f"{name}: {mint}~{maxt}°C ({wx})",
        ).add_to(m)

    return m


# ==========================================
# 側邊欄 (Sidebar)
# ==========================================
with st.sidebar:
    st.image("https://img.icons8.com/clouds/200/sun.png", width=100)
    st.title("🌤️ 控制面板")
    st.caption("AIoT L3 - CWA Weather System")

    st.markdown("---")
    st.subheader("🔑 氣象資料同步")

    server_api_key = os.getenv("CWA_API_KEY", "")
    if server_api_key:
        st.success("🔒 API 授權碼：已由 .env 安全載入")
    else:
        st.warning("⚠️ 尚未配置 API Key，可點擊載入示範資料")

    # 提供 O-A0003-001 (預設推薦) 與 F-C0032-001
    dataset_choice = st.radio(
        "選擇 CWA 資料集來源",
        options=["O-A0003-001 (自動氣象站即時觀測 - 推薦)", "F-C0032-001 (36小時預報)"],
        index=0,
    )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 同步 CWA 資料", use_container_width=True):
            if not server_api_key:
                st.warning("請先於 .env 填入 CWA_API_KEY")
            else:
                if "O-A0003-001" in dataset_choice:
                    sync_oa0003(server_api_key)
                else:
                    sync_fc0032(server_api_key)
    with col2:
        if st.button("🧪 載入示範資料", use_container_width=True):
            load_demo()

    st.markdown("---")
    st.subheader("📍 測站與地區篩選")

    all_locations = get_all_locations()
    if not all_locations:
        if server_api_key:
            sync_oa0003(server_api_key)
        else:
            load_demo()
        all_locations = get_all_locations()

    # 提取縣市清單供兩層篩選
    taiwan_counties = [
        "全部縣市", "臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣",
        "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣",
        "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣",
        "金門縣", "連江縣"
    ]
    selected_county = st.selectbox("依縣市篩選", options=taiwan_counties, index=0)

    # 依選定縣市過濾測站
    if selected_county == "全部縣市":
        filtered_locations = all_locations
    else:
        filtered_locations = [loc for loc in all_locations if selected_county in loc]
        if not filtered_locations:
            filtered_locations = all_locations

    selected_location = st.selectbox("選擇測站 / 地區", options=filtered_locations, index=0)

    st.markdown("---")
    st.info("💡 提示: CWA O-A0003-001 提供全臺 360+ 自動站之精確經緯度與即時溫濕度。")


# ==========================================
# 主畫面 (Main Content)
# ==========================================
st.markdown('<div class="main-header">🇹🇼 臺灣氣象即時觀測與氣溫分析儀表板</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">整合中央氣象署 CWA API (O-A0003-001 / F-C0032-001)、SQLite 資料庫、Plotly 溫度圖表與 Folium 全臺地圖</div>', unsafe_allow_html=True)

# 查詢所選測站紀錄
loc_df = get_forecasts_by_location(selected_location)

# 頂部指標卡片
if not loc_df.empty:
    latest = loc_df.iloc[-1]
    m1, m2, m3, m4 = st.columns(4)

    with m1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">📍 觀測測站 / 地區</div>
            <div class="metric-val">{selected_location}</div>
        </div>
        """, unsafe_allow_html=True)

    with m2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">🌡️ 今日溫幅 (最低 ~ 最高)</div>
            <div class="metric-val" style="color: #e65100;">{latest['min_temp']}°C ~ {latest['max_temp']}°C</div>
        </div>
        """, unsafe_allow_html=True)

    with m3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">🌧️ 雨量 / 降雨</div>
            <div class="metric-val" style="color: #0288d1;">{latest['rain_prob']}</div>
        </div>
        """, unsafe_allow_html=True)

    with m4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">☁️ 天氣現象與狀態</div>
            <div class="metric-val" style="font-size: 1.3rem;">{latest['weather_condition']}</div>
            <div style="font-size: 0.8rem; color: #64748b;">{latest['comfort_index']}</div>
        </div>
        """, unsafe_allow_html=True)

st.write("")

# 左右兩欄：地圖與折線圖
col_map, col_chart = st.columns([1, 1])

overview_df = get_latest_overview()
if selected_county != "全部縣市" and not overview_df.empty:
    map_display_df = overview_df[overview_df["location_name"].str.contains(selected_county, na=False)]
    if map_display_df.empty:
        map_display_df = overview_df
else:
    map_display_df = overview_df

with col_map:
    st.subheader("🗺️ 全臺自動測站氣溫分佈圖 (Folium)")
    st.caption(f"目前顯示 {len(map_display_df)} 個測站座標。點擊圓點可查看測站即時資訊。")
    f_map = create_folium_map(map_display_df, focus_location=selected_location)
    st_folium(f_map, width=540, height=430)

with col_chart:
    st.subheader(f"📈 {selected_location} - 氣溫統計與趨勢圖 (Plotly)")
    if not loc_df.empty:
        fig = go.Figure()

        fig.add_trace(go.Scatter(
            x=loc_df["start_time"],
            y=loc_df["max_temp"],
            mode="lines+markers+text",
            name="最高溫 (MaxT)",
            text=[f"{v}°C" for v in loc_df["max_temp"]],
            textposition="top center",
            line=dict(color="#FF5722", width=3),
            marker=dict(size=8, symbol="circle"),
        ))

        fig.add_trace(go.Scatter(
            x=loc_df["start_time"],
            y=loc_df["min_temp"],
            mode="lines+markers+text",
            name="最低溫 (MinT)",
            text=[f"{v}°C" for v in loc_df["min_temp"]],
            textposition="bottom center",
            line=dict(color="#2196F3", width=3, dash="dot"),
            marker=dict(size=8, symbol="diamond"),
        ))

        fig.update_layout(
            height=430,
            margin=dict(l=20, r=20, t=30, b=30),
            xaxis_title="觀測/預報時間",
            yaxis_title="溫度 (°C)",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.warning("無該測站圖表資料。")

st.markdown("---")

# ==========================================
# 資料表區塊
# ==========================================
st.subheader(f"📋 觀測資料記錄表 (SQLite: data.db / TemperatureForecasts)")

if not loc_df.empty:
    display_df = loc_df[[
        "location_name", "start_time", "weather_condition",
        "min_temp", "max_temp", "rain_prob", "comfort_index", "lat", "lon"
    ]].copy()

    display_df.rename(columns={
        "location_name": "測站 / 地區",
        "start_time": "觀測/預報時間",
        "weather_condition": "天氣現象",
        "min_temp": "最低溫 (°C)",
        "max_temp": "最高溫 (°C)",
        "rain_prob": "雨量 / 降雨",
        "comfort_index": "氣象指標",
        "lat": "緯度 (Lat)",
        "lon": "經度 (Lon)",
    }, inplace=True)

    st.dataframe(display_df, use_container_width=True)

    csv_data = display_df.to_csv(index=False, encoding="utf-8-sig")
    st.download_button(
        label="📥 下載觀測資料 (CSV)",
        data=csv_data,
        file_name=f"{selected_location}_氣象資料.csv",
        mime="text/csv",
    )
