"""
app.py - 臺灣中央氣象署 (CWA) 互動式天氣預報 Web 應用程式
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

# 設定 Streamlit 頁面設定
st.set_page_config(
    page_title="臺灣天氣預報資訊系統 | AIoT L3 CWA HW1",
    page_icon="🌤️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# 自訂 CSS 美化
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        background: linear-gradient(120deg, #1E88E5, #00ACC1);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1rem;
        color: #607D8B;
        margin-bottom: 1.5rem;
    }
    .metric-card {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        border: 1px solid #e9ecef;
        text-align: center;
    }
    .metric-val {
        font-size: 1.8rem;
        font-weight: bold;
        color: #2c3e50;
    }
    .metric-lbl {
        font-size: 0.85rem;
        color: #7f8c8d;
    }
</style>
""", unsafe_allow_html=True)

# 初始化資料庫
init_db()


def sync_cwa_data(api_key: str):
    """呼叫 CWA API 並寫入 SQLite"""
    try:
        with st.spinner("正在向中央氣象署 (CWA) 取得最新預報資料..."):
            raw_json = fetch_weather_data(api_key)
            parsed_data = parse_weather_json(raw_json)
            count = save_forecasts(parsed_data)
            st.success(f"✅ 成功更新 {count} 筆氣象預報資料至資料庫！")
    except Exception as e:
        st.error(f"❌ 擷取資料失敗: {str(e)}")


def load_demo_data():
    """載入示範預報資料並寫入 SQLite"""
    sample_data = generate_sample_forecasts()
    count = save_forecasts(sample_data)
    st.success(f"✅ 成功載入 {count} 筆示範預報資料至資料庫！")


def create_folium_map(overview_df: pd.DataFrame):
    """建立包含臺灣各縣市氣溫標記的 Folium 地圖"""
    # 臺灣地理中心 (南投附近)
    m = folium.Map(location=[23.8, 120.9], zoom_start=7, tiles="CartoDB positron")

    # 建立縣市對應字典
    loc_coord_map = {item["name"]: (item["lat"], item["lon"]) for item in TAIWAN_LOCATIONS}

    if overview_df.empty:
        return m

    for _, row in overview_df.iterrows():
        name = row["location_name"]
        if name in loc_coord_map:
            lat, lon = loc_coord_map[name]
            maxt = row["max_temp"]
            mint = row["min_temp"]
            wx = row["weather_condition"]
            rain = row["rain_prob"]

            # 依據最高溫變換標記顏色
            if maxt >= 32:
                color = "red"
            elif maxt >= 28:
                color = "orange"
            elif maxt >= 24:
                color = "green"
            else:
                color = "blue"

            popup_html = f"""
            <div style="font-family: sans-serif; font-size: 13px; line-height: 1.5; width: 160px;">
                <h4 style="margin: 0 0 6px 0; color: #1E88E5;">{name}</h4>
                <b>天氣狀態:</b> {wx}<br>
                <b>最高溫:</b> <span style="color: #e53935; font-weight: bold;">{maxt}°C</span><br>
                <b>最低溫:</b> <span style="color: #1e88e5; font-weight: bold;">{mint}°C</span><br>
                <b>降雨機率:</b> {rain}
            </div>
            """

            folium.CircleMarker(
                location=[lat, lon],
                radius=8,
                color=color,
                fill=True,
                fill_color=color,
                fill_opacity=0.8,
                popup=folium.Popup(popup_html, max_width=200),
                tooltip=f"{name}: {mint}~{maxt}°C ({wx})",
            ).add_to(m)

    return m


# ==========================================
# 側邊欄 (Sidebar) 控制區
# ==========================================
with st.sidebar:
    st.image("https://img.icons8.com/clouds/200/sun.png", width=110)
    st.title("🌤️ 控制面板")
    st.caption("AIoT L3 - CWA Weather System")

    st.markdown("---")
    st.subheader("🔑 氣象資料同步")

    server_api_key = os.getenv("CWA_API_KEY", "")
    if server_api_key:
        st.success("🔒 API 授權碼：已於伺服器端環境變數安全啟用")
    else:
        st.info("ℹ️ 尚未於 .env 設定 API Key，可點擊下方載入示範資料")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 同步 CWA 資料", use_container_width=True):
            if not server_api_key:
                st.warning("請先在後端 .env 設定 CWA_API_KEY")
            else:
                sync_cwa_data(server_api_key)
    with col2:
        if st.button("🧪 載入示範資料", use_container_width=True):
            load_demo_data()

    st.markdown("---")
    st.subheader("📍 篩選條件")

    # 取得現有縣市清單
    existing_locations = get_all_locations()
    if not existing_locations:
        # 若初次開啟資料庫無資料，預先載入示範資料
        load_demo_data()
        existing_locations = get_all_locations()

    selected_location = st.selectbox(
        "選擇地區 / 縣市",
        options=existing_locations,
        index=0 if "臺北市" not in existing_locations else existing_locations.index("臺北市"),
    )

    # 取得所有預報資料以供日期篩選
    all_df = get_all_forecasts()
    unique_dates = []
    if not all_df.empty:
        all_df["date"] = all_df["start_time"].apply(lambda x: str(x).split(" ")[0])
        unique_dates = sorted(all_df["date"].unique().tolist())

    selected_date = st.selectbox(
        "篩選日期 (可選)",
        options=["全部日期"] + unique_dates,
        index=0,
    )

    st.markdown("---")
    st.info("💡 提示: 點擊地圖圓點可查看各地區預報詳情；切換地區可即時聯動折線圖與資料表。")


# ==========================================
# 主畫面 (Main Content Area)
# ==========================================
st.markdown('<div class="main-header">🇹🇼 臺灣氣象即時預報與氣溫分析儀表板</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">整合中央氣象署 CWA API、SQLite 資料庫儲存、互動式溫度折線圖與 Folium 臺灣地圖視覺化</div>', unsafe_allow_html=True)

# 查詢所選縣市的預報資料
loc_df = get_forecasts_by_location(selected_location)
if selected_date != "全部日期" and not loc_df.empty:
    loc_df["date"] = loc_df["start_time"].apply(lambda x: str(x).split(" ")[0])
    loc_df = loc_df[loc_df["date"] == selected_date]

# 指標概覽卡片 (Metrics Cards)
if not loc_df.empty:
    latest_record = loc_df.iloc[0]
    m1, m2, m3, m4 = st.columns(4)

    with m1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">📍 當前選擇地區</div>
            <div class="metric-val">{selected_location}</div>
        </div>
        """, unsafe_allow_html=True)

    with m2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">🌡️ 氣溫區間 (Min ~ Max)</div>
            <div class="metric-val" style="color: #e65100;">{latest_record['min_temp']}°C ~ {latest_record['max_temp']}°C</div>
        </div>
        """, unsafe_allow_html=True)

    with m3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">🌧️ 降雨機率 (PoP)</div>
            <div class="metric-val" style="color: #0288d1;">{latest_record['rain_prob']}</div>
        </div>
        """, unsafe_allow_html=True)

    with m4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-lbl">☁️ 天氣現象與舒適度</div>
            <div class="metric-val" style="font-size: 1.25rem;">{latest_record['weather_condition']}</div>
            <div style="font-size: 0.8rem; color: #78909c;">{latest_record['comfort_index']}</div>
        </div>
        """, unsafe_allow_html=True)

st.write("")

# 建立兩欄版面：左邊為地圖，右邊為溫度折線圖
col_map, col_chart = st.columns([1, 1])

with col_map:
    st.subheader("🗺️ 全臺縣市溫度分佈圖 (Folium)")
    st.caption("紅/橙: 偏熱；綠/藍: 舒適涼爽。點擊標記可查看各縣市資訊。")
    overview_df = get_latest_overview()
    folium_map = create_folium_map(overview_df)
    st_folium(folium_map, width=540, height=420)

with col_chart:
    st.subheader(f"📈 {selected_location} - 最高／最低溫時段趨勢圖")
    if not loc_df.empty:
        # 繪製 Plotly 折線圖
        fig = go.Figure()

        # 最高溫曲線
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

        # 最低溫曲線
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
            height=420,
            margin=dict(l=20, r=20, t=30, b=30),
            xaxis_title="預報時段 (開始時間)",
            yaxis_title="溫度 (°C)",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.warning("此篩選條件下無氣溫趨勢資料。")

st.markdown("---")

# ==========================================
# 資料表區塊 (Data Table Section)
# ==========================================
st.subheader(f"📋 {selected_location} 預報詳細資料表 (SQLite data.db)")

if not loc_df.empty:
    display_df = loc_df[[
        "start_time", "end_time", "weather_condition",
        "min_temp", "max_temp", "rain_prob", "comfort_index"
    ]].copy()

    display_df.rename(columns={
        "start_time": "預報起始時間",
        "end_time": "預報結束時間",
        "weather_condition": "天氣現象 (Wx)",
        "min_temp": "最低溫 (°C)",
        "max_temp": "最高溫 (°C)",
        "rain_prob": "降雨機率",
        "comfort_index": "舒適度 (CI)"
    }, inplace=True)

    st.dataframe(display_df, use_container_width=True)

    # 支援 CSV 下載功能
    csv_data = display_df.to_csv(index=False, encoding="utf-8-sig")
    st.download_button(
        label="📥 下載預報資料 (CSV)",
        data=csv_data,
        file_name=f"{selected_location}_氣象預報.csv",
        mime="text/csv",
    )
else:
    st.info("尚無符合條件的預報資料。")
