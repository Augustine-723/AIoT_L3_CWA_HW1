# 🇹🇼 AIoT L3 - 臺灣中央氣象署 (CWA) 氣象預報與資料分析系統

本專案為 **AIoT L3 HW1** 作業成果，整合**中央氣象署 (CWA) 開放資料平臺 API**、**SQLite 本地資料庫**、**Streamlit 互動式 Web App**、**Folium 地圖地理視覺化** 與 **Plotly 動態氣溫折線圖**，提供全臺各縣市氣象預報查詢與溫度分析服務。

---

## 🌟 專案核心功能特色

1. **📡 氣象資料即時擷取 (CWA Open Data API)**
   - 透過 Python `requests` 串接中央氣象署開放資料 API (代碼 `F-C0032-001`：一般天氣預報 - 今明 36 小時預報)。
   - 支援線上即時同步與離線示範資料模式，即使尚未取得 API Key 也能順暢展示。

2. **🔍 JSON 資料結構化與清洗**
   - 從 CWA 回傳的巢狀 JSON 中，精確擷取：縣市名稱 (`locationName`)、預報起始與結束時間 (`startTime`, `endTime`)、天氣現象 (`Wx`)、最高溫 (`MaxT`)、最低溫 (`MinT`)、降雨機率 (`PoP`)、舒適度指數 (`CI`)。

3. **💾 SQLite 本地資料庫儲存與管理**
   - 建立 `data.db` 資料庫與 `TemperatureForecasts` 資料表。
   - 設計 `UNIQUE (location_name, start_time, end_time)` 複合唯一限制式與 `INSERT OR REPLACE` 機制，確保重疊時段自動更新且不重複寫入。
   - 建立資料庫索引以提供高效率的 SQL 查詢。

4. **📊 Streamlit 互動式 Web 儀表板**
   - **地區下拉選單**：支援臺灣 22 個縣市快速切換。
   - **日期篩選功能**：可依時段或單日過濾特定預報。
   - **氣溫趨勢折線圖 (Plotly)**：同圖表繪製最高溫與最低溫變化趨勢。
   - **預報詳細資料表**：即時呈現各時段資訊，並支援一鍵下載 **CSV 報表**。

5. **🗺️ Folium 臺灣全島氣溫地圖**
   - 整合 `Folium` 與 `streamlit-folium`，於臺灣地圖動態標註各縣市座標。
   - 依據最高氣溫自動切換標記色階（紅/橙/綠/藍），點擊標記即可查看該地區氣象浮動視窗 (Popup)。

---

## 🏗️ 專案檔案架構

```plaintext
AIoT_L3_CWA_HW1/
├── app.py              # Streamlit 主程式 (Web 介面、Plotly 圖表、Folium 地圖)
├── cwa_api.py          # 中央氣象署 API 串接、JSON 解析與示範資料生成模組
├── database.py         # SQLite data.db 資料庫連線、資料表維護與 SQL 查詢模組
├── test_db.py          # 資料庫寫入、防重覆驗證與 SQL 查詢自動化測試腳本
├── requirements.txt    # 專案 Python 套件依賴清單
├── .env.example        # 環境變數設定檔範本 (填入個人 CWA API Key)
├── .gitignore          # Git 忽略設定 (排除 data.db, .env 等私密與暫存檔)
└── README.md           # 專案說明文件
```

---

## 🔑 中央氣象署 API Key 申請教學

若要取得真實即時氣象資料，請依下列步驟免費申請：

1. 前往 [中央氣象署開放資料平臺會員登入頁面](https://opendata.cwa.gov.tw/)。
2. 點擊右上角 **「註冊 / 登入」**，完成會員註冊並驗證信箱。
3. 登入後，前往 **「取得授權碼」** 頁面 ([https://opendata.cwa.gov.tw/user/authkey](https://opendata.cwa.gov.tw/user/authkey))。
4. 點擊 **「產生授權碼」**，複製以 `CWA-` 開頭的字串。
5. 將授權碼填入專案中的 `.env` 檔案（或直接在 Streamlit 側邊欄輸入）：
   ```bash
   CWA_API_KEY=CWA-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

---

## 🚀 快速開始 (Installation & Setup)

### 1. 安裝環境需求
建議使用 **Python 3.9 以上版本**。

```bash
# 複製專案庫 (或直接進入專案目錄)
git clone https://github.com/Augustine-723/AIoT_L3_CWA_HW1.git
cd AIoT_L3_CWA_HW1
```

### 2. 安裝必要套件
```bash
pip install -r requirements.txt
```

### 3. 設定環境變數 (可選)
```bash
# 複製範本建立 .env
cp .env.example .env
# 編輯 .env 填入你的 CWA_API_KEY
```

### 4. 執行資料庫測試
執行 `test_db.py` 驗證資料庫建立與 SQL 查詢功能：
```bash
python test_db.py
```
若終端機顯示 `🎉 所有 SQLite 資料庫與氣象資料解析測試皆順利通過！` 即代表功能運作完全正常。

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
| `location_name` | TEXT | 縣市名稱 | 例如：臺北市、高雄市 |
| `start_time` | TEXT | 預報起始時間 | 格式：`YYYY-MM-DD HH:MM:SS` |
| `end_time` | TEXT | 預報結束時間 | 格式：`YYYY-MM-DD HH:MM:SS` |
| `min_temp` | REAL | 最低溫度 (MinT) | 單位：攝氏度 (°C) |
| `max_temp` | REAL | 最高溫度 (MaxT) | 單位：攝氏度 (°C) |
| `weather_condition`| TEXT | 天氣現象 (Wx) | 例如：晴時多雲、陰局部雨 |
| `rain_prob` | TEXT | 降雨機率 (PoP) | 例如：20%、70% |
| `comfort_index` | TEXT | 舒適度指數 (CI) | 例如：舒適、悶熱 |
| `created_at` | TIMESTAMP| 資料寫入時間 | 預設為目前時間戳記 |

> **防重複寫入機制**：資料表具備 `UNIQUE (location_name, start_time, end_time)`，寫入時使用 `INSERT OR REPLACE`，重複執行 API 同步時只會更新最新氣象要素，不會產生重複髒資料。

---

## 📤 將專案推送到 GitHub (Push to GitHub)

當需要將更新上傳至遠端儲存庫時，請在終端機依序執行：

```bash
# 1. 初始化 Git (若尚未初始化)
git init

# 2. 設定遠端倉庫網址
git remote add origin https://github.com/Augustine-723/AIoT_L3_CWA_HW1.git

# 3. 檢查當前分支為 main
git branch -M main

# 4. 加入所有專案檔案並建立 Commit
git add .
git commit -m "feat: complete AIoT L3 CWA HW1 with Streamlit, SQLite and Folium map"

# 5. 推送至 GitHub (首次推送會跳出瀏覽器登入授權視窗)
git push -u origin main
```

---

## 📝 授權聲明 (License)
本專案為學習與作業評量用途開源釋出。氣象資料來源屬於 [中華民國中央氣象署開放資料平臺](https://opendata.cwa.gov.tw/)。
