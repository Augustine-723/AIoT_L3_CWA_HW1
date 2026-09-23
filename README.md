# 🇹🇼 AIoT L3 - 臺灣中央氣象署 (CWA) 氣象觀測與資料分析系統

本專案為 **AIoT L3 HW1** 作業成果，整合**中央氣象署 (CWA) 開放資料平臺 API (主推 `O-A0003-001` 自動氣象站即時觀測資料)**、**SQLite 本地資料庫**、**Streamlit 互動式 Web App**、**Folium 地圖地理視覺化 (360+ 測站 GPS 精確定位)** 與 **Plotly 動態氣溫折線圖**，提供全臺各縣市氣溫觀測、預報與溫度分析服務。

---

## 🌟 專案核心功能特色

1. **📡 氣象資料即時擷取 (CWA Open Data API)**
   - **`O-A0003-001` (推薦主資料集)**：自動氣象站即時觀測資料，涵蓋全臺 360+ 個有人與自動觀測站之即時氣溫、當日最高溫 (`DailyHigh`)、當日最低溫 (`DailyLow`)、雨量、相對濕度、氣壓與精確 **WGS84 經緯度座標**。
   - **`F-C0032-001` (預報模式)**：一般天氣預報 - 今明 36 小時預報。
   - 支援線上即時同步與離線示範資料模式，提供即時無縫切換。

2. **🔍 JSON 資料結構化與清洗**
   - 從 CWA 回傳的巢狀 JSON 中，精確擷取：測站名稱 (`StationName`)、縣市鄉鎮 (`CountyName`, `TownName`)、WGS84 座標 (`StationLatitude`, `StationLongitude`)、觀測時間 (`ObsTime`)、當前氣溫與當日最高/最低溫 (`AirTemperature`, `DailyExtreme`)、降雨/雨量、天氣現象 (`Weather`)。

3. **💾 SQLite 本地資料庫儲存與管理**
   - 建立 `data.db` 資料庫與 `TemperatureForecasts` 資料表。
   - 包含 `lat` 與 `lon` 經緯度欄位，支援空間地理點位查詢。
   - 設計 `UNIQUE (location_name, start_time, end_time)` 複合唯一限制式與 `INSERT OR REPLACE` 機制，確保重疊時段自動更新且不重複寫入。

4. **📊 Streamlit 互動式 Web 儀表板**
   - **兩層式篩選**：先依縣市篩選 (臺北市、新北市、高雄市...)，再精準挑選鄉鎮與自動測站。
   - **氣溫統計與趨勢圖 (Plotly)**：同圖表呈現當日最高溫與最低溫變化趨勢。
   - **預報/觀測詳細資料表**：即時呈現各時段資訊，並支援一鍵下載 **CSV 報表**。

5. **🗺️ Folium 臺灣全島氣象測站地圖**
   - 整合 `Folium` 與 `streamlit-folium`，於臺灣地圖動態標註全臺 360+ 個自動氣象站點。
   - 依據最高氣溫自動切換標記色階（紅/橙/綠/藍），點擊標記即可查看該測站即時氣溫、雨量與濕度浮動視窗 (Popup)。

6. **🔒 資訊安全規範實踐**
   - API Key 嚴格儲存於伺服器後端環境變數 ([`.env`](.env))，網頁前端不包含任何輸入欄位或明文暴露。
   - [`.env`](.env) 已納入 [`.gitignore`](.gitignore)，杜絕金鑰外洩風險。

---

## 🏗️ 專案檔案架構

```plaintext
AIoT_L3_CWA_HW1/
├── app.py              # Streamlit 主程式 (Web 介面、Plotly 圖表、Folium 地圖)
├── cwa_api.py          # 中央氣象署 API 串接 (O-A0003-001 & F-C0032-001) 與資料清洗
├── database.py         # SQLite data.db 資料庫連線、資料表維護 (含 GPS 欄位) 與查詢
├── test_db.py          # 資料庫寫入、防重覆驗證與 SQL 查詢自動化測試腳本
├── requirements.txt    # 專案 Python 套件依賴清單
├── .env.example        # 環境變數設定檔範本 (填入個人 CWA API Key)
├── .gitignore          # Git 忽略設定 (排除 data.db, .env 等私密與暫存檔)
└── README.md           # 專案說明文件
```

---

## 🔑 中央氣象署 API Key 設定教學

若要取得真實即時氣象資料，請依下列步驟免費申請：

1. 前往 [中央氣象署開放資料平臺會員登入頁面](https://opendata.cwa.gov.tw/)。
2. 點擊右上角 **「註冊 / 登入」**，完成會員註冊並驗證信箱。
3. 登入後，前往 **「取得授權碼」** 頁面 ([https://opendata.cwa.gov.tw/user/authkey](https://opendata.cwa.gov.tw/user/authkey))。
4. 點擊 **「產生授權碼」**，複製以 `CWA-` 開頭的字串。
5. 將授權碼填入專案根目錄的 `.env` 檔案：
   ```bash
   CWA_API_KEY=CWA-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

---

## 🚀 快速開始 (Installation & Setup)

### 1. 安裝環境需求
建議使用 **Python 3.9 以上版本**。

```bash
# 複製專案庫
git clone https://github.com/Augustine-723/AIoT_L3_CWA_HW1.git
cd AIoT_L3_CWA_HW1
```

### 2. 安裝必要套件
```bash
pip install -r requirements.txt
```

### 3. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env 填入你的 CWA_API_KEY
```

### 4. 執行資料庫測試
執行 `test_db.py` 驗證資料庫建立與 SQL 查詢功能：
```bash
python test_db.py
```
若終端機顯示 `[ALL PASS] 所有 SQLite 資料庫與氣象資料解析測試皆順利通過！` 即代表功能運作完全正常。

### 5. 啟動 Streamlit Web 應用程式
```bash
streamlit run app.py
```
啟動後瀏覽器會自動開啟 `http://localhost:8501`。

---

## 🗄️ 資料庫架構 (Database Schema)

資料庫檔案為 `data.db`，包含資料表 `TemperatureForecasts`：

| 欄位名稱 | 型態 | 說明 | 備註 |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | 主鍵 (Primary Key) | 自動遞增 |
| `location_name` | TEXT | 測站與地區名稱 | 例如：臺北市 - 臺北、南投縣 - 仁愛鄉 (清境) |
| `start_time` | TEXT | 觀測或預報起始時間 | 格式：`YYYY-MM-DD HH:MM:SS` |
| `end_time` | TEXT | 觀測或預報結束時間 | 格式：`YYYY-MM-DD HH:MM:SS` |
| `min_temp` | REAL | 最低溫度 / 當日最低溫 | 單位：攝氏度 (°C) |
| `max_temp` | REAL | 最高溫度 / 當日最高溫 | 單位：攝氏度 (°C) |
| `weather_condition`| TEXT | 天氣現象 (Wx) | 例如：晴時多雲、陰局部雨 |
| `rain_prob` | TEXT | 雨量或降雨機率 | 例如：0.0 mm、20% |
| `comfort_index` | TEXT | 舒適度或溫濕指標 | 例如：濕度 65%, 氣壓 1013 hPa |
| `lat` | REAL | 測站緯度 (WGS84) | 供 Folium 地圖定位 |
| `lon` | REAL | 測站經度 (WGS84) | 供 Folium 地圖定位 |
| `created_at` | TIMESTAMP| 資料寫入時間 | 預設為目前時間戳記 |

---

## 📤 將更新推送到 GitHub (Push to GitHub)

```bash
git add .
git commit -m "feat: upgrade to CWA O-A0003-001 with 360+ automatic weather stations and precise GPS coordinates"
git push origin main
```

---

## 📝 授權聲明 (License)
本專案為學習與作業評量用途開源釋出。氣象資料來源屬於 [中華民國中央氣象署開放資料平臺](https://opendata.cwa.gov.tw/)。
