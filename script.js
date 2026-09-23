/**
 * script.js - 臺灣即時氣象地圖前端互動邏輯 (Vercel Edition)
 * 整合 Leaflet Dark Map、Chart.js、CWA API (/api/weather) 與 CSV 匯出
 */

// 全域狀態變數
let allStations = [];
let filteredStations = [];
let currentStation = null;
let currentLayer = "temp"; // 'temp', 'rain', 'station'
let map = null;
let markerLayerGroup = null;
let chartInstance = null;

// Windy 溫標色帶對應函式
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

// 初始化地圖
function initMap() {
    map = L.map('leaflet-map', { zoomControl: false }).setView([23.85, 120.95], 7);
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 使用 Esri World Dark Gray Base (完全免費、無須 API Key、絕無浮水印)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri &copy; OpenStreetMap contributors',
        maxZoom: 16
    }).addTo(map);

    // 繁體地名與邊界透明標籤圖層
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16
    }).addTo(map);

    markerLayerGroup = L.layerGroup().addTo(map);
}

// 繪製地圖測站圓點標記
function renderMapMarkers() {
    if (!markerLayerGroup) return;
    markerLayerGroup.clearLayers();

    filteredStations.forEach(st => {
        if (!st.lat || !st.lon) return;

        let markerColor = "#38bdf8";
        if (currentLayer === "temp") {
            markerColor = getWindyColor(st.max_temp);
        } else if (currentLayer === "rain") {
            markerColor = getRainColor(st.rain);
        }

        const isSelected = currentStation && currentStation.id === st.id;
        const radius = isSelected ? 10 : 6;
        const fillOpacity = isSelected ? 0.95 : 0.8;

        const circle = L.circleMarker([st.lat, st.lon], {
            radius: radius,
            fillColor: markerColor,
            color: isSelected ? "#ffffff" : markerColor,
            weight: isSelected ? 2 : 1,
            opacity: 1,
            fillOpacity: fillOpacity
        });

        // 浮動 Tooltip
        circle.bindTooltip(`<b>${st.county} ${st.name}</b>: ${st.cur_temp}°C (${st.wx})`, {
            direction: 'top',
            className: 'custom-tooltip'
        });

        // 點擊事件
        circle.on('click', () => {
            selectStation(st);
        });

        markerLayerGroup.addLayer(circle);
    });
}

// 選擇單一測站並連動更新全站介面
function selectStation(st) {
    if (!st) return;
    currentStation = st;

    // 1. 更新 4 塊指標卡片
    document.getElementById('card-station').innerText = `${st.county} - ${st.name}`;
    document.getElementById('card-time').innerText = `觀測時間: ${st.time}`;
    document.getElementById('card-range').innerText = `${st.min_temp}°C ~ ${st.max_temp}°C`;
    document.getElementById('card-cur-temp').innerText = `即時氣溫: ${st.cur_temp}°C`;
    document.getElementById('card-rain').innerText = st.rain || "0.0 mm";
    document.getElementById('card-wx').innerText = st.wx || "晴";
    document.getElementById('card-hum').innerText = `濕度: ${st.humidity} | 氣壓: ${st.pressure}`;

    // 2. 同步下拉選單
    const stationSelect = document.getElementById('select-station');
    if (stationSelect) {
        stationSelect.value = st.id;
    }

    // 3. 聚焦地圖
    if (st.lat && st.lon && map) {
        map.panTo([st.lat, st.lon], { animate: true, duration: 0.8 });
    }

    // 4. 重繪標記高亮狀態
    renderMapMarkers();

    // 5. 更新折線圖
    updateChart();
}

// 初始化與更新 Chart.js 折線圖
function updateChart() {
    const ctx = document.getElementById('tempChart').getContext('2d');
    
    // 取當前選定縣市的前 12 個代表測站進行溫度對比
    const chartDataSources = filteredStations.slice(0, 12);
    const labels = chartDataSources.map(s => s.name);
    const maxTemps = chartDataSources.map(s => s.max_temp);
    const minTemps = chartDataSources.map(s => s.min_temp);

    const countyName = document.getElementById('select-county').value;
    document.getElementById('chart-title').innerText = countyName === 'all' 
        ? `📈 全臺重點測站氣溫對比 (Chart.js)`
        : `📈 ${countyName} 各觀測站溫度對比 (Chart.js)`;

    if (chartInstance) {
        chartInstance.destroy();
    }

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
}

// 渲染詳細資料表
function renderTable(stationsToRender) {
    const tbody = document.getElementById('table-body');
    if (!stationsToRender || stationsToRender.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 25px; color:#94a3b8;">查無符合條件的測站記錄。</td></tr>';
        return;
    }

    const html = stationsToRender.map(st => `
        <tr onclick="onTableRowClick('${st.id}')" style="cursor: pointer;">
            <td style="color:#94a3b8; font-family:monospace;">${st.id}</td>
            <td style="font-weight:600; color:#38bdf8;">${st.county}</td>
            <td style="font-weight:600;">${st.name}</td>
            <td style="color:#94a3b8; font-size:11px;">${st.time}</td>
            <td><span style="background:rgba(255,255,255,0.06); padding:2px 8px; border-radius:4px;">${st.wx}</span></td>
            <td style="font-weight:700; color:#fb923c;">${st.cur_temp}°C</td>
            <td style="color:#f43f5e; font-weight:600;">${st.max_temp}°C</td>
            <td style="color:#38bdf8; font-weight:600;">${st.min_temp}°C</td>
            <td style="color:#06b6d4;">${st.rain}</td>
            <td style="color:#a78bfa;">${st.humidity}</td>
            <td style="color:#64748b; font-size:11px;">${st.lat.toFixed(2)}, ${st.lon.toFixed(2)}</td>
        </tr>
    `).join('');

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
    const county = document.getElementById('select-county').value;
    if (county === 'all') {
        filteredStations = [...allStations];
    } else {
        filteredStations = allStations.filter(s => s.county === county);
    }

    // 更新站點下拉選單
    const stationSelect = document.getElementById('select-station');
    stationSelect.innerHTML = filteredStations.map(st => 
        `<option value="${st.id}">${st.county} - ${st.name}</option>`
    ).join('');

    document.getElementById('station-count-info').innerText = `已顯示 ${filteredStations.length} 個站點 · CARTO Dark Matter`;

    if (filteredStations.length > 0) {
        selectStation(filteredStations[0]);
    }

    renderMapMarkers();
    renderTable(filteredStations);
    updateChart();
}

// 匯出 CSV 報表
function exportCSV() {
    if (!filteredStations || filteredStations.length === 0) return;
    
    const headers = ["測站代碼", "縣市", "測站名稱", "觀測時間", "天氣現象", "當前氣溫(°C)", "最高溫(°C)", "最低溫(°C)", "雨量", "濕度", "緯度", "經度"];
    const rows = filteredStations.map(s => [
        `"${s.id}"`,
        `"${s.county}"`,
        `"${s.name}"`,
        `"${s.time}"`,
        `"${s.wx}"`,
        s.cur_temp,
        s.max_temp,
        s.min_temp,
        `"${s.rain}"`,
        `"${s.humidity}"`,
        s.lat,
        s.lon
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

// 核心資料載入
async function loadWeatherData() {
    const badge = document.getElementById('status-badge');
    badge.innerText = "📡 正在向中央氣象署抓取即時觀測...";
    badge.className = "badge badge-pulse";

    try {
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        allStations = data.stations || [];
        filteredStations = [...allStations];

        // 填入縣市清單
        const countySelect = document.getElementById('select-county');
        const counties = data.counties || [];
        countySelect.innerHTML = `<option value="all">全臺灣 (${allStations.length} 測站)</option>` + 
            counties.map(c => `<option value="${c}">${c}</option>`).join('');

        badge.innerText = data.is_live ? "🟢 CWA O-A0003-001 即時連線" : "🟡 示範資料模式 (可於 Vercel 配置金鑰)";
        badge.className = data.is_live ? "badge badge-live" : "badge";

        handleCountyChange();
    } catch (err) {
        console.warn("無法取得 /api/weather，切換至本機備用展示資料:", err);
        badge.innerText = "🟡 離線示範模式";
        badge.className = "badge";
        
        // 使用預設示範資料
        allStations = [
            { id: "466920", name: "臺北", county: "臺北市", town: "中正區", lat: 25.0377, lon: 121.5149, cur_temp: 28.5, min_temp: 23.2, max_temp: 31.8, wx: "晴時多雲", rain: "0.0 mm", humidity: "65%", pressure: "1012.4 hPa", time: "2026-09-23 11:30:00" },
            { id: "466880", name: "板橋", county: "新北市", town: "板橋區", lat: 25.0000, lon: 121.4420, cur_temp: 29.1, min_temp: 23.8, max_temp: 32.2, wx: "多雲", rain: "0.0 mm", humidity: "68%", pressure: "1012.1 hPa", time: "2026-09-23 11:30:00" },
            { id: "466940", name: "基隆", county: "基隆市", town: "仁愛區", lat: 25.1333, lon: 121.7405, cur_temp: 28.2, min_temp: 23.7, max_temp: 28.4, wx: "多雲局部雨", rain: "1.5 mm", humidity: "75%", pressure: "1012.5 hPa", time: "2026-09-23 11:30:00" },
            { id: "467490", name: "臺中", county: "臺中市", town: "北區", lat: 24.1457, lon: 120.6840, cur_temp: 30.4, min_temp: 24.5, max_temp: 33.1, wx: "晴天", rain: "0.0 mm", humidity: "60%", pressure: "1011.8 hPa", time: "2026-09-23 11:30:00" },
            { id: "467440", name: "高雄", county: "高雄市", town: "前鎮區", lat: 22.5660, lon: 120.3157, cur_temp: 31.2, min_temp: 25.4, max_temp: 33.6, wx: "晴朗", rain: "0.0 mm", humidity: "72%", pressure: "1011.2 hPa", time: "2026-09-23 11:30:00" },
            { id: "467410", name: "臺南", county: "臺南市", town: "中西區", lat: 22.9933, lon: 120.2048, cur_temp: 30.8, min_temp: 24.8, max_temp: 32.8, wx: "晴時多雲", rain: "0.0 mm", humidity: "70%", pressure: "1011.5 hPa", time: "2026-09-23 11:30:00" },
        ];
        filteredStations = [...allStations];
        handleCountyChange();
    }
}

// 事件監聽綁定
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadWeatherData();

    document.getElementById('select-county').addEventListener('change', handleCountyChange);
    
    document.getElementById('select-station').addEventListener('change', (e) => {
        const st = filteredStations.find(s => s.id === e.target.value);
        if (st) selectStation(st);
    });

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
    document.getElementById('table-search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderTable(filteredStations);
            return;
        }
        const matches = filteredStations.filter(s => 
            s.name.toLowerCase().includes(query) ||
            s.county.toLowerCase().includes(query) ||
            s.wx.toLowerCase().includes(query) ||
            s.id.toLowerCase().includes(query)
        );
        renderTable(matches);
    });

    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-refresh').addEventListener('click', loadWeatherData);
});
