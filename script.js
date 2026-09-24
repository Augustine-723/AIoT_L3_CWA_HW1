/**
 * script.js - 臺灣即時氣象地圖前端互動邏輯 (Vercel Edition)
 * 整合 Leaflet Dark Map (Esri Dark Gray)、Chart.js、CWA API (/api/weather) 與 CSV 匯出
 */

// 全域狀態變數
let allStations = [];
let filteredStations = [];
let currentStation = null;
let currentLayer = "temp"; // 'temp', 'rain', 'station'
let map = null;
let markerLayerGroup = null;
let chartInstance = null;

// Windy 溫標色階對應函式
function getWindyColor(temp) {
    if (temp >= 35.0) return "#d73027"; // 紅
    if (temp >= 32.0) return "#f46d43"; // 橙紅
    if (temp >= 28.0) return "#fdae61"; // 暖橙
    if (temp >= 24.0) return "#fee08b"; // 溫黃
    if (temp >= 20.0) return "#d9ef8b"; // 淺綠
    if (temp >= 16.0) return "#7fcdbb"; // 湖綠
    if (temp >= 12.0) return "#abd9e9"; // 淺藍
    return "#2c7bb6"; // 寒深藍
}

// 雨量色彩對應函式
function getRainColor(rainStr) {
    try {
        const val = parseFloat(String(rainStr).replace("mm", "").trim());
        if (isNaN(val) || val === 0) return "#38bdf8";
        if (val < 5.0) return "#06b6d4";
        if (val < 15.0) return "#3b82f6";
        if (val < 35.0) return "#8b5cf6";
        return "#ec4899"; // 大雨粉紫
    } catch {
        return "#38bdf8";
    }
}

// 臺灣主要代表城市座標 (白色/淺灰字體，無多餘鄉鎮干擾)
const MAJOR_CITIES = [
    { name: "台北", lat: 25.0478, lon: 121.5319 },
    { name: "新北", lat: 25.0118, lon: 121.4658 },
    { name: "桃園", lat: 24.9936, lon: 121.3010 },
    { name: "新竹", lat: 24.8039, lon: 120.9647 },
    { name: "台中", lat: 24.1620, lon: 120.6470 },
    { name: "彰化", lat: 24.0818, lon: 120.5383 },
    { name: "嘉義", lat: 23.4800, lon: 120.4491 },
    { name: "台南", lat: 22.9997, lon: 120.2150 },
    { name: "高雄", lat: 22.6273, lon: 120.3014 },
    { name: "屏東", lat: 22.6761, lon: 120.4941 },
    { name: "宜蘭", lat: 24.7570, lon: 121.7530 },
    { name: "花蓮", lat: 23.9872, lon: 121.6016 },
    { name: "台東", lat: 22.7583, lon: 121.1444 },
    { name: "澎湖", lat: 23.5712, lon: 119.5793 }
];

// 初始化地圖 (防禦性載入，避免因地圖或圖層問題阻斷全站邏輯)
function initMap() {
    if (typeof L === 'undefined') {
        console.warn("Leaflet library (L) is not loaded yet.");
        return;
    }
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl || map) return;

    try {
        map = L.map('leaflet-map', { 
            zoomControl: false,
            attributionControl: false
        }).setView([23.82, 120.95], 7);
        
        L.control.zoom({ position: 'topright' }).addTo(map);

        // 1. 底圖底層：Esri Dark Gray，opacity 從 0.35 提高至 0.8
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.8
        }).addTo(map);

        // 2. 臺灣縣市行政區邊界
        if (typeof TW_COUNTIES_GEOJSON !== 'undefined') {
            try {
                L.geoJSON(TW_COUNTIES_GEOJSON, {
                    style: {
                        color: 'rgba(148, 163, 184, 0.45)', // 淡灰細線
                        weight: 1.2,
                        opacity: 0.8,
                        fillColor: '#1f2937',               // 陸地深灰藍
                        fillOpacity: 0.72,
                        dashArray: '3, 4'
                    }
                }).addTo(map);
            } catch (geoErr) {
                console.warn("GeoJSON overlay failed:", geoErr);
            }
        }

        // 3. 標繪主要城市名稱
        MAJOR_CITIES.forEach(c => {
            try {
                const cityIcon = L.divIcon({
                    className: 'city-label-icon',
                    html: `<div class="city-label-text">${c.name}</div>`,
                    iconSize: [40, 16],
                    iconAnchor: [20, 8]
                });
                L.marker([c.lat, c.lon], { icon: cityIcon, interactive: false }).addTo(map);
            } catch (cErr) {
                console.warn("City marker failed:", cErr);
            }
        });

        markerLayerGroup = L.layerGroup().addTo(map);
    } catch (e) {
        console.error("initMap encountered an error:", e);
    }
}

// 繪製地圖測站標記
function renderMapMarkers() {
    if (!map || !markerLayerGroup || typeof L === 'undefined') return;
    try {
        markerLayerGroup.clearLayers();

        filteredStations.forEach(st => {
            if (!st.lat || !st.lon) return;

            let marker;
            const isSelected = currentStation && currentStation.id === st.id;
            const stationTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");

            if (currentLayer === "station") {
                marker = L.marker([st.lat, st.lon]);
            } else {
                let markerColor = "#fb923c"; // 預設暖橘
                if (currentLayer === "temp") {
                    markerColor = getWindyColor(Number(stationTemp) || 25);
                } else if (currentLayer === "rain") {
                    markerColor = getRainColor(st.rain);
                }

                const radius = isSelected ? 10 : 7;
                marker = L.circleMarker([st.lat, st.lon], {
                    radius: radius,
                    fillColor: markerColor,
                    fillOpacity: 0.92,
                    color: isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.85)",
                    weight: isSelected ? 3 : 2,
                    className: 'weather-circle-marker'
                });

                // 浮動 Tooltip (提示站名與氣溫)
                marker.bindTooltip(`<b>${st.county || ''} ${st.name}</b>: ${stationTemp}°C (${st.wx || '晴'})`, {
                    direction: 'top',
                    offset: [0, -6]
                });

                // Hover 動態
                marker.on('mouseover', function() {
                    this.setRadius(12);
                    this.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 1 });
                });

                marker.on('mouseout', function() {
                    const isSel = currentStation && currentStation.id === st.id;
                    this.setRadius(isSel ? 10 : 7);
                    this.setStyle({
                        weight: isSel ? 3 : 2,
                        color: isSel ? "#ffffff" : "rgba(255, 255, 255, 0.85)",
                        fillOpacity: 0.92
                    });
                });
            }

            // 綁定 Popup：符合規範格式
            const popupHtml = `
            <div style="font-family: inherit; font-size: 13px; line-height: 1.5; min-width: 170px;">
                <div style="font-size: 14px; margin-bottom: 4px;">
                    <b>${st.name}</b><br>
                    <span style="color:#94a3b8; font-size:12px;">${st.county || ''} ${st.town || ''}</span><br>
                    <span style="color:#fb923c; font-weight:700;">溫度：${stationTemp} °C</span>
                </div>
                <div style="border-top: 1px solid rgba(255,255,255,0.12); margin-top: 6px; padding-top: 6px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
                        <span style="color:#94a3b8;">今日溫幅:</span>
                        <span style="color:#f8fafc; font-weight:600;">${st.min_temp !== undefined ? st.min_temp : '--'}°C ~ ${st.max_temp !== undefined ? st.max_temp : '--'}°C</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
                        <span style="color:#94a3b8;">空氣濕度:</span>
                        <span style="color:#a78bfa; font-weight:600;">${st.humidity || '--'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
                        <span style="color:#94a3b8;">即時降雨:</span>
                        <span style="color:#06b6d4; font-weight:600;">${st.rain || '0.0 mm'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top: 3px;">
                        <span style="color:#94a3b8;">天氣狀況:</span>
                        <span style="color:#38bdf8;">${st.wx || '晴'}</span>
                    </div>
                </div>
            </div>
            `;

            marker.bindPopup(popupHtml, { maxWidth: 240 });

            marker.on('click', () => {
                selectStation(st);
            });

            markerLayerGroup.addLayer(marker);
        });
    } catch (err) {
        console.error("renderMapMarkers error:", err);
    }
}

// 選擇單一測站並連動更新全站介面
function selectStation(st) {
    if (!st) return;
    currentStation = st;

    // 1. 更新 4 塊指標卡片 (統一優先使用 st.temp，fallback 到 st.cur_temp)
    const stationTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");
    const minTemp = (st.min_temp !== undefined && st.min_temp !== null) ? st.min_temp : "--";
    const maxTemp = (st.max_temp !== undefined && st.max_temp !== null) ? st.max_temp : "--";

    const elStation = document.getElementById('card-station');
    if (elStation) elStation.innerText = `${st.county || ''} - ${st.name || ''}`;

    const elTime = document.getElementById('card-time');
    if (elTime) elTime.innerText = `觀測時間: ${st.time || '--'}`;

    const elRange = document.getElementById('card-range');
    if (elRange) elRange.innerText = `${minTemp}°C ~ ${maxTemp}°C`;

    const elCur = document.getElementById('card-cur-temp');
    if (elCur) elCur.innerText = `即時氣溫: ${stationTemp}°C`;

    const elRain = document.getElementById('card-rain');
    if (elRain) elRain.innerText = st.rain || "0.0 mm";

    const elWx = document.getElementById('card-wx');
    if (elWx) elWx.innerText = st.wx || "晴";

    const elHum = document.getElementById('card-hum');
    if (elHum) elHum.innerText = `濕度: ${st.humidity || '--'} | 氣壓: ${st.pressure || '--'}`;

    // 2. 同步下拉選單
    const stationSelect = document.getElementById('select-station');
    if (stationSelect && st.id) {
        stationSelect.value = st.id;
    }

    // 3. 聚焦地圖
    try {
        if (st.lat && st.lon && map) {
            map.panTo([st.lat, st.lon], { animate: true, duration: 0.8 });
        }
    } catch (e) {
        console.warn("map.panTo error:", e);
    }

    // 4. 重繪標記高亮狀態
    try {
        renderMapMarkers();
    } catch (e) {
        console.warn("renderMapMarkers in selectStation failed:", e);
    }

    // 5. 更新折線圖
    try {
        updateChart();
    } catch (e) {
        console.warn("updateChart in selectStation failed:", e);
    }
}

// 初始化與更新 Chart.js 折線圖
function updateChart() {
    const canvas = document.getElementById('tempChart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is not loaded yet.");
        return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 取當前選定縣市的前 12 個代表測站進行溫度對比
    const chartDataSources = (filteredStations || []).slice(0, 12);
    const labels = chartDataSources.map(s => s.name);
    const maxTemps = chartDataSources.map(s => (s.max_temp !== undefined && s.max_temp !== null) ? s.max_temp : s.temp);
    const minTemps = chartDataSources.map(s => (s.min_temp !== undefined && s.min_temp !== null) ? s.min_temp : s.temp);

    const countySelect = document.getElementById('select-county');
    const countyName = countySelect ? countySelect.value : 'all';
    const chartTitle = document.getElementById('chart-title');
    if (chartTitle) {
        chartTitle.innerText = countyName === 'all' 
            ? `📈 全臺重點測站氣溫對比 (Chart.js)`
            : `📈 ${countyName} 各觀測站溫度對比 (Chart.js)`;
    }

    if (chartInstance) {
        try {
            chartInstance.destroy();
        } catch (e) {
            console.warn("Error destroying previous chartInstance:", e);
        }
    }

    try {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '最高溫 (MaxT)',
                        data: maxTemps,
                        borderColor: '#f43f5e', // 霓虹珊瑚紅
                        backgroundColor: 'rgba(244, 63, 94, 0.1)',
                        borderWidth: 3,
                        tension: 0.35,
                        pointBackgroundColor: '#f43f5e',
                        pointBorderColor: '#ffffff',
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        fill: true
                    },
                    {
                        label: '最低溫 (MinT)',
                        data: minTemps,
                        borderColor: '#38bdf8', // 霓虹天空藍
                        backgroundColor: 'rgba(56, 189, 248, 0.05)',
                        borderWidth: 3,
                        borderDash: [5, 5],
                        tension: 0.35,
                        pointBackgroundColor: '#38bdf8',
                        pointBorderColor: '#ffffff',
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: '#cbd5e1',
                            font: { family: 'Inter', size: 11 },
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#38bdf8',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y}°C`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8', font: { size: 10 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    y: {
                        title: { display: true, text: '溫度 (°C)', color: '#94a3b8' },
                        ticks: { color: '#94a3b8', font: { size: 10 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    }
                }
            }
        });
    } catch (chartErr) {
        console.error("Chart creation failed:", chartErr);
    }
}

// 渲染詳細資料表
function renderTable(stationsToRender) {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    if (!stationsToRender || stationsToRender.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 25px; color:#94a3b8;">查無符合條件的測站記錄。</td></tr>';
        return;
    }

    const html = stationsToRender.map(st => {
        const displayTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");
        const latStr = (st.lat !== undefined && st.lat !== null && !isNaN(Number(st.lat))) ? Number(st.lat).toFixed(2) : "--";
        const lonStr = (st.lon !== undefined && st.lon !== null && !isNaN(Number(st.lon))) ? Number(st.lon).toFixed(2) : "--";
        const minT = (st.min_temp !== undefined && st.min_temp !== null) ? st.min_temp : "--";
        const maxT = (st.max_temp !== undefined && st.max_temp !== null) ? st.max_temp : "--";

        return `
        <tr onclick="onTableRowClick('${st.id}')" style="cursor: pointer;">
            <td style="color:#94a3b8; font-family:monospace;">${st.id}</td>
            <td style="font-weight:600; color:#38bdf8;">${st.county || ''}</td>
            <td style="font-weight:600;">${st.name || ''}</td>
            <td style="color:#94a3b8; font-size:11px;">${st.time || ''}</td>
            <td><span style="background:rgba(255,255,255,0.06); padding:2px 8px; border-radius:4px;">${st.wx || '晴'}</span></td>
            <td style="font-weight:700; color:#fb923c;">${displayTemp}°C</td>
            <td style="color:#f43f5e; font-weight:600;">${maxT}°C</td>
            <td style="color:#38bdf8; font-weight:600;">${minT}°C</td>
            <td style="color:#06b6d4;">${st.rain || '0.0 mm'}</td>
            <td style="color:#a78bfa;">${st.humidity || '--'}</td>
            <td style="color:#64748b; font-size:11px;">${latStr}, ${lonStr}</td>
        </tr>
        `;
    }).join('');

    tbody.innerHTML = html;
}

// 點選表格列連動切換
window.onTableRowClick = function(stationId) {
    const st = allStations.find(s => s.id === stationId);
    if (st) {
        selectStation(st);
        window.scrollTo({ top: 120, behavior: 'smooth' });
    }
};

// 篩選測站處理
function handleCountyChange() {
    const countySelect = document.getElementById('select-county');
    const county = countySelect ? countySelect.value : 'all';
    
    if (county === 'all') {
        filteredStations = [...allStations];
    } else {
        filteredStations = allStations.filter(s => s.county === county);
    }

    // 更新站點下拉選單
    const stationSelect = document.getElementById('select-station');
    if (stationSelect) {
        stationSelect.innerHTML = filteredStations.map(st => 
            `<option value="${st.id}">${st.county} - ${st.name}</option>`
        ).join('');
    }

    const countInfo = document.getElementById('station-count-info');
    if (countInfo) {
        countInfo.innerText = `已顯示 ${filteredStations.length} 個站點 · Esri Dark Gray`;
    }

    // 優先更新指標卡片 (即使後續地圖或圖表繪製發生異常，卡片資料也已正確灌入)
    if (filteredStations.length > 0) {
        selectStation(filteredStations[0]);
    }

    try { renderMapMarkers(); } catch (e) { console.error("renderMapMarkers error:", e); }
    try { renderTable(filteredStations); } catch (e) { console.error("renderTable error:", e); }
    try { updateChart(); } catch (e) { console.error("updateChart error:", e); }
}

// 匯出 CSV 報表
function exportCSV() {
    if (!filteredStations || filteredStations.length === 0) return;
    
    const headers = ["測站代碼", "縣市", "測站名稱", "觀測時間", "天氣現象", "當前氣溫(°C)", "最高溫(°C)", "最低溫(°C)", "雨量", "濕度", "緯度", "經度"];
    const rows = filteredStations.map(s => [
        `"${s.id}"`,
        `"${s.county || ''}"`,
        `"${s.name || ''}"`,
        `"${s.time || ''}"`,
        `"${s.wx || ''}"`,
        s.temp !== undefined ? s.temp : s.cur_temp,
        s.max_temp !== undefined ? s.max_temp : '',
        s.min_temp !== undefined ? s.min_temp : '',
        `"${s.rain || ''}"`,
        `"${s.humidity || ''}"`,
        s.lat || '',
        s.lon || ''
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Taiwan_Weather_Observations_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 核心資料載入函式
async function loadWeatherData() {
    const badge = document.getElementById('status-badge');
    if (badge) {
        badge.innerText = "📡 正在向中央氣象署抓取即時觀測...";
        badge.className = "badge badge-pulse";
    }

    try {
        console.log("正在請求 /api/weather 即時氣象資料...");
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log("成功取得氣象 API 資料:", data);

        allStations = (data.stations || []).map(st => ({
            ...st,
            temp: (st.temp !== undefined && st.temp !== null) ? st.temp : st.cur_temp,
            cur_temp: (st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : st.temp
        }));
        filteredStations = [...allStations];

        // 填入縣市清單
        const countySelect = document.getElementById('select-county');
        const counties = data.counties || [];
        if (countySelect) {
            countySelect.innerHTML = `<option value="all">全臺灣 (${allStations.length} 測站)</option>` + 
                counties.map(c => `<option value="${c}">${c}</option>`).join('');
        }

        if (badge) {
            badge.innerText = data.is_live ? "🟢 CWA O-A0003-001 即時連線" : "🟡 示範資料模式 (可於 Vercel 配置金鑰)";
            badge.className = data.is_live ? "badge badge-live" : "badge";
        }

        handleCountyChange();
    } catch (err) {
        console.warn("無法取得 /api/weather，切換至本機備用展示資料:", err);
        if (badge) {
            badge.innerText = "🟡 離線示範模式";
            badge.className = "badge";
        }
        
        // 使用預設示範資料
        allStations = [
            { id: "466920", name: "臺北", county: "臺北市", town: "中正區", lat: 25.0377, lon: 121.5149, temp: 28.5, cur_temp: 28.5, min_temp: 23.2, max_temp: 31.8, wx: "晴時多雲", rain: "0.0 mm", humidity: "65%", pressure: "1012.4 hPa", time: "2026-09-24 12:00:00" },
            { id: "466880", name: "板橋", county: "新北市", town: "板橋區", lat: 25.0000, lon: 121.4420, temp: 29.1, cur_temp: 29.1, min_temp: 23.8, max_temp: 32.2, wx: "多雲", rain: "0.0 mm", humidity: "68%", pressure: "1012.1 hPa", time: "2026-09-24 12:00:00" },
            { id: "466940", name: "基隆", county: "基隆市", town: "仁愛區", lat: 25.1333, lon: 121.7405, temp: 28.2, cur_temp: 28.2, min_temp: 23.7, max_temp: 28.4, wx: "多雲局部雨", rain: "1.5 mm", humidity: "75%", pressure: "1012.5 hPa", time: "2026-09-24 12:00:00" },
            { id: "467490", name: "臺中", county: "臺中市", town: "北區", lat: 24.1457, lon: 120.6840, temp: 30.4, cur_temp: 30.4, min_temp: 24.5, max_temp: 33.1, wx: "晴天", rain: "0.0 mm", humidity: "60%", pressure: "1011.8 hPa", time: "2026-09-24 12:00:00" },
            { id: "467440", name: "高雄", county: "高雄市", town: "前鎮區", lat: 22.5660, lon: 120.3157, temp: 31.2, cur_temp: 31.2, min_temp: 25.4, max_temp: 33.6, wx: "晴朗", rain: "0.0 mm", humidity: "72%", pressure: "1011.2 hPa", time: "2026-09-24 12:00:00" },
            { id: "467410", name: "臺南", county: "臺南市", town: "中西區", lat: 22.9933, lon: 120.2048, temp: 30.8, cur_temp: 30.8, min_temp: 24.8, max_temp: 32.8, wx: "晴時多雲", rain: "0.0 mm", humidity: "70%", pressure: "1011.5 hPa", time: "2026-09-24 12:00:00" },
        ];
        filteredStations = [...allStations];
        handleCountyChange();
    }
}

// 綁定所有互動事件
function bindEvents() {
    const countySelect = document.getElementById('select-county');
    if (countySelect) countySelect.addEventListener('change', handleCountyChange);
    
    const stationSelect = document.getElementById('select-station');
    if (stationSelect) {
        stationSelect.addEventListener('change', (e) => {
            const st = filteredStations.find(s => s.id === e.target.value);
            if (st) selectStation(st);
        });
    }

    // 圖層切換按鈕
    document.querySelectorAll('.layer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentLayer = e.target.dataset.layer;
            renderMapMarkers();
        });
    });

    // 搜尋過濾表格
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderTable(filteredStations);
                return;
            }
            const matches = filteredStations.filter(s => 
                (s.name && s.name.toLowerCase().includes(query)) ||
                (s.county && s.county.toLowerCase().includes(query)) ||
                (s.wx && s.wx.toLowerCase().includes(query)) ||
                (s.id && s.id.toLowerCase().includes(query))
            );
            renderTable(matches);
        });
    }

    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);

    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', loadWeatherData);
}

// 程式主進入點：安全支援 DOMContentLoaded 及已載入完成狀態
function initApp() {
    console.log("氣象地圖應用程式初始化中...");
    try {
        initMap();
    } catch (e) {
        console.error("Map initialization failed:", e);
    }
    loadWeatherData();
    bindEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
