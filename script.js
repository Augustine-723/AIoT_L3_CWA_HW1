/**
 * script.js - 臺灣即時氣象地圖前端互動邏輯 (Vercel Edition)
 * 整合 Leaflet Dark Map (Esri Dark Gray)、Chart.js、CWA API (/api/weather) 與分頁報表
 */

// 全域狀態變數
let allStations = [];
let filteredStations = [];
let currentStation = null;
let currentLayer = "temp"; // 'temp', 'rain', 'station'
let map = null;
let markerLayerGroup = null;
let chartInstance = null;

// 表格分頁狀態
let currentPage = 1;
const PAGE_SIZE = 15;
const expandedStationIds = new Set();

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

// 初始化地圖 (防禦性載入，地圖高度提升至 580px 成為視覺主角)
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

        // 1. 底圖底層：Esri Dark Gray，opacity 為 0.8
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.8
        }).addTo(map);

        // 2. 臺灣縣市行政區邊界
        if (typeof TW_COUNTIES_GEOJSON !== 'undefined') {
            try {
                L.geoJSON(TW_COUNTIES_GEOJSON, {
                    style: {
                        color: 'rgba(148, 163, 184, 0.45)',
                        weight: 1.2,
                        opacity: 0.8,
                        fillColor: '#1f2937',
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

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 200);
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

                // Hover 動態 (200-300ms transition)
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

            // 綁定 Popup
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

// 選擇單一測站並連動更新四張三級層級 KPI 卡片
function selectStation(st) {
    if (!st) return;
    currentStation = st;

    // 1. 更新 4 塊指標卡片 (三級層級：小標題 -> 大數字 -> 次要資訊)
    const stationTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");
    const minTemp = (st.min_temp !== undefined && st.min_temp !== null) ? st.min_temp : "--";
    const maxTemp = (st.max_temp !== undefined && st.max_temp !== null) ? st.max_temp : "--";

    // 卡片 1: 觀測站點
    const elStation = document.getElementById('card-station');
    if (elStation) elStation.innerText = `${st.name || '--'}`;
    const elTagCounty = document.getElementById('tag-county');
    if (elTagCounty) elTagCounty.innerText = st.county || '臺灣';
    const elTime = document.getElementById('card-time');
    if (elTime) elTime.innerText = `觀測時間: ${st.time || '--'}`;

    // 卡片 2: 即時氣溫
    const elCur = document.getElementById('card-cur-temp');
    if (elCur) elCur.innerText = `${stationTemp}°C`;
    const elRange = document.getElementById('card-range');
    if (elRange) elRange.innerText = `今日極值: ${minTemp}°C ~ ${maxTemp}°C`;

    // 卡片 3: 降雨
    const elRain = document.getElementById('card-rain');
    if (elRain) elRain.innerText = st.rain || "0.0 mm";
    const elRainSub = document.getElementById('card-rain-sub');
    if (elRainSub) elRainSub.innerText = `${st.county || ''} 累積水量觀測`;

    // 卡片 4: 天氣型態與大氣
    const elWx = document.getElementById('card-wx');
    if (elWx) elWx.innerText = st.wx || "晴";
    const elHum = document.getElementById('card-hum');
    if (elHum) elHum.innerText = `濕度: ${st.humidity || '--'} · 氣壓: ${st.pressure || '--'}`;

    // 2. 同步下拉選單
    const stationSelect = document.getElementById('select-station');
    if (stationSelect && st.id) {
        stationSelect.value = st.id;
    }

    // 3. 高亮表格列
    document.querySelectorAll('.station-row').forEach(row => {
        if (row.dataset.id === st.id) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }
    });

    // 4. 聚焦地圖
    try {
        if (st.lat && st.lon && map) {
            map.panTo([st.lat, st.lon], { animate: true, duration: 0.8 });
        }
    } catch (e) {
        console.warn("map.panTo error:", e);
    }

    // 5. 重繪標記高亮狀態
    try {
        renderMapMarkers();
    } catch (e) {
        console.warn("renderMapMarkers in selectStation failed:", e);
    }

    // 6. 更新折線圖
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
                        borderColor: '#f43f5e',
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
                        borderColor: '#38bdf8',
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

// 渲染詳細資料表 (預設只顯示：測站、縣市、氣溫、雨量、濕度、觀測時間；其餘欄位放入展開抽屜)
function renderTable(stations) {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    const dataList = stations !== undefined ? stations : filteredStations;
    const totalCount = dataList.length;

    if (totalCount === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px; color:#94a3b8;">查無符合條件的測站記錄。</td></tr>';
        updatePaginationUI(0, 1);
        return;
    }

    const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);
    const pageStations = dataList.slice(startIndex, endIndex);

    const html = pageStations.map(st => {
        const displayTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");
        const latStr = (st.lat !== undefined && st.lat !== null && !isNaN(Number(st.lat))) ? Number(st.lat).toFixed(2) : "--";
        const lonStr = (st.lon !== undefined && st.lon !== null && !isNaN(Number(st.lon))) ? Number(st.lon).toFixed(2) : "--";
        const minT = (st.min_temp !== undefined && st.min_temp !== null) ? st.min_temp : "--";
        const maxT = (st.max_temp !== undefined && st.max_temp !== null) ? st.max_temp : "--";
        const tempColor = getWindyColor(Number(displayTemp) || 25);
        const isExpanded = expandedStationIds.has(st.id);
        const isSelected = currentStation && currentStation.id === st.id;

        return `
        <tr class="station-row ${isSelected ? 'selected' : ''}" data-id="${st.id}" onclick="onTableRowClick('${st.id}')">
            <td>
                <div class="col-station">
                    <span class="station-dot" style="background-color: ${tempColor};"></span>
                    <span class="station-name">${st.name}</span>
                    <span class="station-id-pill">${st.id}</span>
                </div>
            </td>
            <td style="font-weight:600; color:#38bdf8;">${st.county || ''}</td>
            <td style="font-weight:700; color: ${tempColor};">${displayTemp}°C</td>
            <td style="color:#06b6d4;">${st.rain || '0.0 mm'}</td>
            <td style="color:#a78bfa;">${st.humidity || '--'}</td>
            <td style="color:#94a3b8; font-size:11px;">${st.time || ''}</td>
            <td style="text-align: center;">
                <button class="btn-expand-row" onclick="event.stopPropagation(); toggleRowDetail('${st.id}')">
                    <span id="expand-icon-${st.id}">${isExpanded ? '收合 ▴' : '詳細 ▾'}</span>
                </button>
            </td>
        </tr>
        <tr class="detail-row" id="detail-row-${st.id}" style="display: ${isExpanded ? 'table-row' : 'none'};">
            <td colspan="7">
                <div class="detail-drawer">
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="d-label">行政鄉鎮</span>
                            <span class="d-val">${st.county || ''} ${st.town || '市區'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="d-label">今日極值 (Min ~ Max)</span>
                            <span class="d-val"><span class="text-blue">${minT}°C</span> ~ <span class="text-red">${maxT}°C</span></span>
                        </div>
                        <div class="detail-item">
                            <span class="d-label">天氣現象 (Wx)</span>
                            <span class="d-val">${st.wx || '晴'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="d-label">大氣氣壓</span>
                            <span class="d-val">${st.pressure || '--'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="d-label">WGS84 座標</span>
                            <span class="d-val text-mono">${latStr}, ${lonStr}</span>
                        </div>
                    </div>
                    <button class="btn-locate" onclick="event.stopPropagation(); locateStationOnMap('${st.id}')">📍 在地圖中定位</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    tbody.innerHTML = html;
    updatePaginationUI(totalCount, totalPages);
}

// 展開 / 收合詳細資訊
window.toggleRowDetail = function(stationId) {
    const detailRow = document.getElementById(`detail-row-${stationId}`);
    const iconSpan = document.getElementById(`expand-icon-${stationId}`);
    if (!detailRow) return;

    if (expandedStationIds.has(stationId)) {
        expandedStationIds.delete(stationId);
        detailRow.style.display = 'none';
        if (iconSpan) iconSpan.innerText = '詳細 ▾';
    } else {
        expandedStationIds.add(stationId);
        detailRow.style.display = 'table-row';
        if (iconSpan) iconSpan.innerText = '收合 ▴';
    }
};

// 在地圖中定位站點並平滑滾動
window.locateStationOnMap = function(stationId) {
    const st = allStations.find(s => s.id === stationId);
    if (st) {
        selectStation(st);
        window.scrollTo({ top: 180, behavior: 'smooth' });
    }
};

// 更新分頁控制元件狀態
function updatePaginationUI(totalCount, totalPages) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (totalCount === 0) {
            infoEl.innerText = "顯示 0 - 0 筆，共 0 筆測站";
        } else {
            const start = (currentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(currentPage * PAGE_SIZE, totalCount);
            infoEl.innerText = `顯示第 ${start} - ${end} 筆，共 ${totalCount} 筆測站`;
        }
    }

    const pageDisplay = document.getElementById('page-num-display');
    if (pageDisplay) {
        pageDisplay.innerText = `第 ${currentPage} / ${totalPages} 頁`;
    }

    const btnFirst = document.getElementById('btn-first-page');
    if (btnFirst) btnFirst.disabled = (currentPage <= 1);

    const btnPrev = document.getElementById('btn-prev-page');
    if (btnPrev) btnPrev.disabled = (currentPage <= 1);

    const btnNext = document.getElementById('btn-next-page');
    if (btnNext) btnNext.disabled = (currentPage >= totalPages);

    const btnLast = document.getElementById('btn-last-page');
    if (btnLast) btnLast.disabled = (currentPage >= totalPages);
}

// 點選表格列連動切換
window.onTableRowClick = function(stationId) {
    const st = allStations.find(s => s.id === stationId);
    if (st) {
        selectStation(st);
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

    // 重設分頁至第一頁
    currentPage = 1;

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

    if (filteredStations.length > 0) {
        selectStation(filteredStations[0]);
    }

    try { renderMapMarkers(); } catch (e) { console.error("renderMapMarkers error:", e); }
    try { renderTable(filteredStations); } catch (e) { console.error("renderTable error:", e); }
    try { updateChart(); } catch (e) { console.error("updateChart error:", e); }
}

// 骨架屏載入效果 (Skeleton Loading)
function showSkeletonLoading() {
    // 1. 卡片骨架屏
    const elStation = document.getElementById('card-station');
    if (elStation) elStation.innerHTML = '<span class="skeleton" style="width: 140px; height: 36px;"></span>';
    const elCur = document.getElementById('card-cur-temp');
    if (elCur) elCur.innerHTML = '<span class="skeleton" style="width: 120px; height: 36px;"></span>';
    const elRain = document.getElementById('card-rain');
    if (elRain) elRain.innerHTML = '<span class="skeleton" style="width: 110px; height: 36px;"></span>';
    const elWx = document.getElementById('card-wx');
    if (elWx) elWx.innerHTML = '<span class="skeleton" style="width: 90px; height: 36px;"></span>';

    // 2. 表格骨架屏 (6 欄)
    const tbody = document.getElementById('table-body');
    if (tbody) {
        const skeletonRows = Array.from({ length: 6 }).map(() => `
            <tr>
                <td><span class="skeleton" style="width: 120px; height: 18px;"></span></td>
                <td><span class="skeleton" style="width: 60px; height: 18px;"></span></td>
                <td><span class="skeleton" style="width: 50px; height: 18px;"></span></td>
                <td><span class="skeleton" style="width: 60px; height: 18px;"></span></td>
                <td><span class="skeleton" style="width: 50px; height: 18px;"></span></td>
                <td><span class="skeleton" style="width: 110px; height: 18px;"></span></td>
                <td style="text-align:center;"><span class="skeleton" style="width: 55px; height: 24px; border-radius: 6px;"></span></td>
            </tr>
        `).join('');
        tbody.innerHTML = skeletonRows;
    }

    // 3. Hero 區域
    const statEl = document.getElementById('hero-station-count');
    if (statEl) statEl.innerHTML = '<span class="skeleton" style="width: 80px; height: 16px;"></span>';
    const timeEl = document.getElementById('hero-update-time');
    if (timeEl) timeEl.innerHTML = '<span class="skeleton" style="width: 60px; height: 16px;"></span>';
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

// 核心資料載入函式 (含 Skeleton 骨架屏與紅色錯誤處理)
async function loadWeatherData() {
    showSkeletonLoading();

    const heroBadge = document.getElementById('hero-live-badge');
    const heroText = document.getElementById('hero-live-text');
    if (heroBadge) heroBadge.className = "hero-chip chip-live";
    if (heroText) heroText.innerText = "正在更新氣象資料...";

    try {
        console.log("正在請求 /api/weather 即時氣象資料...");
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (!data || !data.stations || data.stations.length === 0) {
            throw new Error("API 資料格式異常或無站點資料");
        }

        console.log("成功取得氣象 API 資料:", data);

        allStations = (data.stations || []).map(st => ({
            ...st,
            temp: (st.temp !== undefined && st.temp !== null) ? st.temp : st.cur_temp,
            cur_temp: (st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : st.temp
        }));
        filteredStations = [...allStations];

        // 更新 Hero 區域：Live 狀態、測站數、最後更新時間
        if (heroBadge) heroBadge.className = data.is_live ? "hero-chip chip-live" : "hero-chip";
        if (heroText) heroText.innerText = data.is_live ? "CWA 即時連線" : "示範模式";

        const statCountEl = document.getElementById('hero-station-count');
        if (statCountEl) statCountEl.innerText = `${allStations.length} 測站監測中`;

        const updateTimeEl = document.getElementById('hero-update-time');
        const latestTime = allStations[0]?.time ? allStations[0].time.slice(11) : new Date().toTimeString().slice(0, 8);
        if (updateTimeEl) updateTimeEl.innerText = latestTime;

        // 填入縣市清單
        const countySelect = document.getElementById('select-county');
        const counties = data.counties || [];
        if (countySelect) {
            countySelect.innerHTML = `<option value="all">全臺灣 (${allStations.length} 測站)</option>` + 
                counties.map(c => `<option value="${c}">${c}</option>`).join('');
        }

        currentPage = 1;
        handleCountyChange();
    } catch (err) {
        console.error("無法取得 /api/weather:", err);
        
        // 當 API 錯誤時，改為紅色提示「氣象資料讀取失敗，請重新整理」
        if (heroBadge) {
            heroBadge.className = "hero-chip chip-error";
        }
        if (heroText) {
            heroText.innerText = "氣象資料讀取失敗";
        }

        // 資料表提示紅色警示
        const tbody = document.getElementById('table-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 36px; color:#fb7185; font-weight:600; font-size: 0.95rem;">❌ 氣象資料讀取失敗，請重新整理</td></tr>';
        }

        // 資訊卡顯示錯誤提示
        const elStation = document.getElementById('card-station');
        if (elStation) elStation.innerText = "讀取失敗";
        const elCur = document.getElementById('card-cur-temp');
        if (elCur) elCur.innerText = "--°C";
        const elRange = document.getElementById('card-range');
        if (elRange) elRange.innerText = "請點擊上方重新整理按鈕重試";
    }
}

// 綁定所有互動事件 (包含分頁按鈕)
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

    // 搜尋過濾表格 (即時搜尋並重設分頁)
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            currentPage = 1;
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

    // 表格分頁按鈕監聽
    const btnFirst = document.getElementById('btn-first-page');
    if (btnFirst) {
        btnFirst.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage = 1;
                renderTable();
            }
        });
    }

    const btnPrev = document.getElementById('btn-prev-page');
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
            }
        });
    }

    const btnNext = document.getElementById('btn-next-page');
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredStations.length / PAGE_SIZE) || 1;
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
            }
        });
    }

    const btnLast = document.getElementById('btn-last-page');
    if (btnLast) {
        btnLast.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredStations.length / PAGE_SIZE) || 1;
            if (currentPage < totalPages) {
                currentPage = totalPages;
                renderTable();
            }
        });
    }

    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);

    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', loadWeatherData);

    // 視窗調整尺寸時自適應 Leaflet
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });
}

// 程式主進入點
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
