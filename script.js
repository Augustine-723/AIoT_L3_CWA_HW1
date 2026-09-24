/**
 * script.js - 臺灣即時氣象地圖前端互動邏輯 (Vercel Edition)
 * 整合 Leaflet Dark Map (Esri Dark Gray)、Chart.js、CWA API (/api/weather)、分頁報表與全螢幕放大地圖 Modal
 */

// 全域狀態變數
let allStations = [];
let filteredStations = [];
let currentStation = null;
let currentLayer = "temp"; // 'temp', 'rain', 'wind', 'humidity', 'wx', 'station'
let currentBaseMap = 'dark'; // 'dark' | 'street'
let baseTileLayer = null;
let countyGeoLayer = null;
let showTempLabels = false; // 氣溫數字標籤開關 (28°)
let map = null;
let markerLayerGroup = null;
let markerClusterGroup = null;
let stationMarkerMap = {}; // stationId -> L.Marker / L.CircleMarker
let countyBoundsMap = {};  // countyName -> L.LatLngBounds
let chartInstance = null;

// 表格分頁狀態
let currentPage = 1;
const PAGE_SIZE = 15;
const expandedStationIds = new Set();

// 放大地圖 Modal 狀態
let isMapModalOpen = false;

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

// 風速色彩對應函式 (m/s)
function getWindColor(speed) {
    if (speed === null || speed === undefined || isNaN(speed)) return "#64748b";
    if (speed < 1.5) return "#94a3b8"; // 微風 (灰)
    if (speed < 3.4) return "#38bdf8"; // 輕風 (青)
    if (speed < 5.5) return "#34d399"; // 微風 (綠)
    if (speed < 8.0) return "#fbbf24"; // 和風 (黃)
    if (speed < 10.8) return "#f97316"; // 清風 (橙)
    if (speed < 13.9) return "#ef4444"; // 強風 (紅)
    return "#ec4899"; // 烈風 (粉紫)
}

// 相對濕度色彩對應函式 (%)
function getHumidityColor(humStr) {
    try {
        const val = parseFloat(String(humStr).replace('%', '').trim());
        if (isNaN(val)) return "#06b6d4";
        if (val < 40) return "#f59e0b"; // 乾
        if (val < 60) return "#10b981"; // 舒
        if (val < 75) return "#06b6d4"; // 潤
        if (val < 85) return "#3b82f6"; // 潮
        return "#8b5cf6"; // 極潮
    } catch {
        return "#06b6d4";
    }
}

// 天氣現象色彩對應函式
function getWxColor(wxStr) {
    if (!wxStr) return "#94a3b8";
    if (wxStr.includes("雨")) return "#06b6d4";
    if (wxStr.includes("雷")) return "#a855f7";
    if (wxStr.includes("陰")) return "#64748b";
    if (wxStr.includes("多雲")) return "#38bdf8";
    if (wxStr.includes("晴")) return "#fbbf24";
    return "#38bdf8";
}

// 風向度數轉換文字方向
function getWindDirectionName(deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return "--";
    const dirs = ["北風", "東北風", "東風", "東南風", "南風", "西南風", "西風", "西北風"];
    const idx = Math.round(deg / 45) % 8;
    return dirs[idx];
}

// 更新動態圖例 Bar
function updateLegend() {
    const titleEl = document.getElementById('legend-title');
    const stripEl = document.getElementById('legend-gradient-strip');
    const labelsEl = document.getElementById('legend-scale-labels');
    if (!titleEl || !stripEl || !labelsEl) return;

    if (currentLayer === "temp") {
        titleEl.innerText = "°C 氣溫色階";
        stripEl.style.background = "linear-gradient(to right, #2c7bb6, #abd9e9, #7fcdbb, #d9ef8b, #fee08b, #fdae61, #f46d43, #d73027)";
        labelsEl.innerHTML = "<span>&lt;16°</span><span>20°</span><span>24°</span><span>28°</span><span>32°</span><span>36°+</span>";
    } else if (currentLayer === "rain") {
        titleEl.innerText = "mm 降雨量強度";
        stripEl.style.background = "linear-gradient(to right, #38bdf8, #06b6d4, #3b82f6, #8b5cf6, #ec4899)";
        labelsEl.innerHTML = "<span>0mm</span><span>&lt;5mm</span><span>&lt;15mm</span><span>&lt;35mm</span><span>35mm+</span>";
    } else if (currentLayer === "wind") {
        titleEl.innerText = "m/s 風速級距與風向";
        stripEl.style.background = "linear-gradient(to right, #94a3b8, #38bdf8, #34d399, #fbbf24, #f97316, #ef4444, #ec4899)";
        labelsEl.innerHTML = "<span>&lt;1.5</span><span>3.3</span><span>5.4</span><span>7.9</span><span>10.7</span><span>13.8+</span>";
    } else if (currentLayer === "humidity") {
        titleEl.innerText = "% 相對濕度";
        stripEl.style.background = "linear-gradient(to right, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6)";
        labelsEl.innerHTML = "<span>&lt;40%</span><span>50%</span><span>65%</span><span>75%</span><span>85%+</span>";
    } else if (currentLayer === "wx") {
        titleEl.innerText = "⛅ 即時天氣狀態";
        stripEl.style.background = "linear-gradient(to right, #fbbf24, #38bdf8, #94a3b8, #06b6d4, #a855f7)";
        labelsEl.innerHTML = "<span>☀️晴</span><span>⛅多雲</span><span>☁️陰</span><span>🌧️雨</span><span>⛈️雷</span>";
    } else {
        titleEl.innerText = "📍 氣象觀測站點";
        stripEl.style.background = "linear-gradient(to right, #38bdf8, #818cf8, #c084fc)";
        labelsEl.innerHTML = "<span>自動測站</span><span>有人測站</span><span>無人觀測站</span>";
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

// 初始化臺灣各縣市 GeoJSON 邊界範圍 (供縣市選擇自動 fitBounds 使用)
function initCountyBounds() {
    countyBoundsMap = {};
    if (typeof TW_COUNTIES_GEOJSON !== 'undefined' && TW_COUNTIES_GEOJSON.features) {
        TW_COUNTIES_GEOJSON.features.forEach(f => {
            const rawName = f.properties && f.properties.COUNTYNAME;
            if (!rawName) return;
            const normalizedName = rawName.replace(/台/g, '臺');
            const altName = rawName.replace(/臺/g, '台');
            try {
                const layer = L.geoJSON(f);
                const bounds = layer.getBounds();
                [rawName, normalizedName, altName].forEach(name => {
                    if (!countyBoundsMap[name]) {
                        countyBoundsMap[name] = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
                    } else {
                        countyBoundsMap[name].extend(bounds);
                    }
                });
            } catch (err) {
                console.warn("Failed to calculate bounds for feature:", rawName, err);
            }
        });
    }
}

// 初始化地圖 (防禦性載入，高度約 580px 成為視覺主角)
function initMap() {
    if (typeof L === 'undefined') {
        console.warn("Leaflet library (L) is not loaded yet.");
        return;
    }
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl || map) return;

    try {
        initCountyBounds();

        map = L.map('leaflet-map', { 
            zoomControl: false,
            attributionControl: false
        }).setView([23.82, 120.95], 7);
        
        L.control.zoom({ position: 'topright' }).addTo(map);

        // 1. 初始化底圖 (支援深色 / 街道底圖無縫切換，不重建 map)
        baseTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.82
        }).addTo(map);

        // 2. 臺灣縣市行政區邊界 (支援 hover highlight 與 click 篩選聯動)
        if (typeof TW_COUNTIES_GEOJSON !== 'undefined') {
            try {
                countyGeoLayer = L.geoJSON(TW_COUNTIES_GEOJSON, {
                    style: {
                        color: 'rgba(148, 163, 184, 0.45)',
                        weight: 1.2,
                        opacity: 0.8,
                        fillColor: '#1f2937',
                        fillOpacity: 0.72,
                        dashArray: '3, 4'
                    },
                    onEachFeature: function(feature, layer) {
                        const rawName = feature.properties?.COUNTYNAME;
                        layer.on({
                            mouseover: function(e) {
                                const target = e.target;
                                target.setStyle({
                                    color: '#38bdf8',
                                    weight: 2.2,
                                    fillColor: '#0284c7',
                                    fillOpacity: 0.4,
                                    dashArray: ''
                                });
                                target.bringToFront();
                            },
                            mouseout: function(e) {
                                if (countyGeoLayer) {
                                    countyGeoLayer.resetStyle(e.target);
                                }
                            },
                            click: function(e) {
                                L.DomEvent.stopPropagation(e);
                                if (rawName) {
                                    const countySelect = document.getElementById('select-county');
                                    if (countySelect) {
                                        for (let opt of countySelect.options) {
                                            if (opt.value === rawName || 
                                                opt.value.replace(/台/g, '臺') === rawName.replace(/台/g, '臺')) {
                                                countySelect.value = opt.value;
                                                break;
                                            }
                                        }
                                    }
                                    handleCountyChange();
                                }
                            }
                        });
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

        // 4. 初始化深色 Glassmorphism MarkerClusterGroup
        if (typeof L.markerClusterGroup === 'function') {
            markerClusterGroup = L.markerClusterGroup({
                showCoverageOnHover: false,
                maxClusterRadius: 42,
                spiderfyOnMaxZoom: true,
                zoomToBoundsOnClick: true,
                animate: true,
                iconCreateFunction: function(cluster) {
                    const count = cluster.getChildCount();
                    let size = 36;
                    let clusterClass = 'cluster-sm';
                    if (count >= 30) {
                        size = 48;
                        clusterClass = 'cluster-lg';
                    } else if (count >= 12) {
                        size = 42;
                        clusterClass = 'cluster-md';
                    }
                    return L.divIcon({
                        html: `<div class="dark-cluster-badge ${clusterClass}"><span>${count}</span></div>`,
                        className: 'custom-cluster-marker',
                        iconSize: L.point(size, size)
                    });
                }
            });
            map.addLayer(markerClusterGroup);
        } else {
            console.warn("Leaflet.markercluster not found, falling back to L.layerGroup");
            markerClusterGroup = L.layerGroup().addTo(map);
        }

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 200);
    } catch (e) {
        console.error("initMap encountered an error:", e);
    }
}

// 繪製地圖測站標記 (支援 6 大圖層、風速箭頭、氣溫數值標籤與簡要 Popup)
function renderMapMarkers() {
    if (!map || !markerClusterGroup || typeof L === 'undefined') return;
    try {
        markerClusterGroup.clearLayers();
        stationMarkerMap = {};

        filteredStations.forEach(st => {
            if (!st.lat || !st.lon) return;

            let marker;
            const isSelected = currentStation && currentStation.id === st.id;
            const stationTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");

            if (currentLayer === "station") {
                // 1. 測站點位圖層
                const radius = isSelected ? 10 : 7;
                marker = L.circleMarker([st.lat, st.lon], {
                    radius: radius,
                    fillColor: "#38bdf8",
                    fillOpacity: 0.92,
                    color: isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.85)",
                    weight: isSelected ? 3 : 2,
                    className: 'weather-circle-marker'
                });
            } else if (currentLayer === "wind") {
                // 2. 💨 風速風向圖層 (顯示風速與旋轉風向箭頭，缺值顯示 --)
                const speedVal = (st.wind_speed !== null && st.wind_speed !== undefined && !isNaN(st.wind_speed))
                    ? Number(st.wind_speed).toFixed(1)
                    : "--";
                const dirVal = (st.wind_dir !== null && st.wind_dir !== undefined && !isNaN(st.wind_dir))
                    ? Number(st.wind_dir)
                    : null;
                const windColor = getWindColor(st.wind_speed);

                const arrowHtml = dirVal !== null 
                    ? `<span class="wind-arrow-icon" style="transform: rotate(${dirVal}deg);">↑</span>`
                    : '';

                const windIcon = L.divIcon({
                    className: 'wind-div-icon',
                    html: `
                    <div class="wind-marker-badge" style="background-color: ${windColor}; ${isSelected ? 'outline: 2px solid #ffffff; box-shadow: 0 0 14px #38bdf8;' : ''}">
                        ${arrowHtml}<span>${speedVal}</span>
                    </div>`,
                    iconSize: [44, 22],
                    iconAnchor: [22, 11]
                });

                marker = L.marker([st.lat, st.lon], { icon: windIcon });
            } else if (currentLayer === "temp" && showTempLabels) {
                // 3. 氣溫數值標籤 Toggle 開啟模式 (28°)
                const markerColor = getWindyColor(Number(stationTemp) || 25);
                const tempVal = (!isNaN(Number(stationTemp))) ? Math.round(Number(stationTemp)) : stationTemp;

                const tempIcon = L.divIcon({
                    className: 'temp-label-icon',
                    html: `
                    <div class="temp-numeric-badge" style="background-color: ${markerColor}; ${isSelected ? 'outline: 2px solid #ffffff; box-shadow: 0 0 14px #ffffff;' : ''}">
                        <span>${tempVal}°</span>
                    </div>`,
                    iconSize: [38, 22],
                    iconAnchor: [19, 11]
                });

                marker = L.marker([st.lat, st.lon], { icon: tempIcon });
            } else {
                // 4. 氣溫 / 雨量 / 濕度 / 天氣 CircleMarker 模式
                let markerColor = "#fb923c";
                if (currentLayer === "temp") {
                    markerColor = getWindyColor(Number(stationTemp) || 25);
                } else if (currentLayer === "rain") {
                    markerColor = getRainColor(st.rain);
                } else if (currentLayer === "humidity") {
                    markerColor = getHumidityColor(st.humidity);
                } else if (currentLayer === "wx") {
                    markerColor = getWxColor(st.wx);
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

            // 浮動 Tooltip
            marker.bindTooltip(`<b>${st.county || ''} ${st.name}</b>: ${stationTemp}°C (${st.wx || '晴'})`, {
                direction: 'top',
                offset: [0, -6]
            });

            // 簡要 Popup (Popup 只顯示簡要摘要，詳細放入 Station Drawer)
            const popupHtml = `
            <div class="brief-popup">
                <b>${st.name}</b><br>
                <div class="brief-popup-loc">${st.county || ''} ${st.town || ''}</div>
                <div class="brief-popup-val" style="color: #fb923c;">${stationTemp}°C · ${st.wx || '晴'}</div>
            </div>
            `;

            marker.bindPopup(popupHtml, { maxWidth: 180, closeButton: false });

            // 點擊事件：開啟簡要 Popup，並打開右側詳細 Station Drawer
            marker.on('click', () => {
                selectStation(st, false);
                openStationDrawer(st);
            });

            stationMarkerMap[st.id] = marker;
            markerClusterGroup.addLayer(marker);
        });

        updateLegend();
    } catch (err) {
        console.error("renderMapMarkers error:", err);
    }
}

// 標記短暫 Highlight 動畫效果 (放大與發光外框)
function triggerMarkerHighlight(marker, st) {
    if (!marker) return;

    if (typeof marker.setStyle === 'function') {
        // CircleMarker 模式
        marker.setStyle({
            radius: 15,
            weight: 4,
            color: '#38bdf8',
            fillOpacity: 1
        });
        if (marker._path) {
            marker._path.classList.add('marker-highlight-pulse');
        }
        setTimeout(() => {
            if (marker) {
                const isSel = currentStation && currentStation.id === st.id;
                marker.setStyle({
                    radius: isSel ? 10 : 7,
                    weight: isSel ? 3 : 2,
                    color: isSel ? "#ffffff" : "rgba(255, 255, 255, 0.85)",
                    fillOpacity: 0.92
                });
                if (marker._path) {
                    marker._path.classList.remove('marker-highlight-pulse');
                }
            }
        }, 1800);
    } else if (marker._icon) {
        // 傳統 Marker 模式
        marker._icon.classList.add('marker-highlight-pulse');
        setTimeout(() => {
            if (marker && marker._icon) {
                marker._icon.classList.remove('marker-highlight-pulse');
            }
        }, 1800);
    }
}

// 選擇單一測站並連動更新四張三級層級 KPI 卡片 (支援 flyTo、Popup、Highlight)
function selectStation(st, shouldFlyTo = true) {
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

    // 4. 定位地圖並自動開彈窗 + Marker Highlight
    try {
        if (shouldFlyTo && st.lat && st.lon && map) {
            const currentZ = map.getZoom();
            const targetZ = currentZ < 12 ? 13 : currentZ;
            map.flyTo([st.lat, st.lon], targetZ, { duration: 1.0 });
        }

        const marker = stationMarkerMap[st.id];
        if (marker) {
            if (markerClusterGroup && typeof markerClusterGroup.zoomToShowLayer === 'function') {
                markerClusterGroup.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                    triggerMarkerHighlight(marker, st);
                });
            } else {
                marker.openPopup();
                triggerMarkerHighlight(marker, st);
            }
        }
    } catch (e) {
        console.warn("map flyTo / popup error:", e);
    }

    // 5. 更新折線圖
    try {
        updateChart();
    } catch (e) {
        console.warn("updateChart in selectStation failed:", e);
    }

    // 6. 開啟右側詳細 Station Drawer
    try {
        openStationDrawer(st);
    } catch (e) {
        console.warn("openStationDrawer error:", e);
    }

    // 7. 同步 Modal 控制狀態
    if (isMapModalOpen) {
        syncModalControls();
    }
}

// 開啟右側詳細 Station Drawer
function openStationDrawer(st) {
    if (!st) return;
    const drawer = document.getElementById('station-drawer');
    if (!drawer) return;

    const stationTemp = (st.temp !== undefined && st.temp !== null) ? st.temp : ((st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : "--");
    const minTemp = (st.min_temp !== undefined && st.min_temp !== null) ? st.min_temp : "--";
    const maxTemp = (st.max_temp !== undefined && st.max_temp !== null) ? st.max_temp : "--";

    const nameEl = document.getElementById('drawer-station-name');
    if (nameEl) nameEl.innerText = st.name || '--';
    const tagEl = document.getElementById('drawer-tag-county');
    if (tagEl) tagEl.innerText = st.county || '臺灣';
    const idEl = document.getElementById('drawer-station-id');
    if (idEl) idEl.innerText = `#${st.id || '--'}`;

    const tempEl = document.getElementById('drawer-temp');
    if (tempEl) tempEl.innerText = `${stationTemp}°C`;
    const rangeEl = document.getElementById('drawer-range');
    if (rangeEl) rangeEl.innerText = `極值: ${minTemp}°C ~ ${maxTemp}°C`;

    const rainEl = document.getElementById('drawer-rain');
    if (rainEl) rainEl.innerText = st.rain || '0.0 mm';

    const humEl = document.getElementById('drawer-hum');
    if (humEl) humEl.innerText = st.humidity || '--';

    const pressEl = document.getElementById('drawer-pressure');
    if (pressEl) pressEl.innerText = st.pressure || '--';

    const wxEl = document.getElementById('drawer-wx');
    if (wxEl) wxEl.innerText = st.wx || '晴';

    const timeEl = document.getElementById('drawer-time');
    if (timeEl) timeEl.innerText = `觀測時間: ${st.time || '--'}`;

    const townEl = document.getElementById('drawer-full-town');
    if (townEl) townEl.innerText = `${st.county || ''} ${st.town || '市區'}`;

    const coordsEl = document.getElementById('drawer-coords');
    if (coordsEl) coordsEl.innerText = (st.lat && st.lon) ? `${Number(st.lat).toFixed(4)}, ${Number(st.lon).toFixed(4)}` : '--';

    // 風速與風向 (若缺值顯示 --，不可出現 undefined/NaN)
    const windEl = document.getElementById('drawer-wind');
    const arrowEl = document.getElementById('drawer-wind-arrow');
    const windDirEl = document.getElementById('drawer-wind-dir');

    if (st.wind_speed !== null && st.wind_speed !== undefined && !isNaN(st.wind_speed)) {
        if (windEl) windEl.innerText = `${Number(st.wind_speed).toFixed(1)} m/s`;
    } else {
        if (windEl) windEl.innerText = '--';
    }

    if (st.wind_dir !== null && st.wind_dir !== undefined && !isNaN(st.wind_dir)) {
        const dir = Number(st.wind_dir);
        if (arrowEl) {
            arrowEl.style.display = 'inline-block';
            arrowEl.style.transform = `rotate(${dir}deg)`;
        }
        if (windDirEl) windDirEl.innerText = `風向角度: ${dir}° (${getWindDirectionName(dir)})`;
    } else {
        if (arrowEl) arrowEl.style.display = 'none';
        if (windDirEl) windDirEl.innerText = '風向角度: --';
    }

    drawer.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
}

// 關閉 Station Drawer
function closeStationDrawer() {
    const drawer = document.getElementById('station-drawer');
    if (drawer) {
        drawer.classList.remove('active');
        drawer.setAttribute('aria-hidden', 'true');
    }
}

// 切換底圖 (深色 / 街道底圖無縫切換，不重建地圖)
function switchBaseMap() {
    if (!map) return;
    const nextType = currentBaseMap === 'dark' ? 'street' : 'dark';
    currentBaseMap = nextType;
    
    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
    }

    if (currentBaseMap === 'street') {
        baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.9,
            subdomains: ['a', 'b', 'c']
        }).addTo(map);
    } else {
        baseTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.82
        }).addTo(map);
    }
    baseTileLayer.bringToBack();

    const labelEl = document.getElementById('basemap-icon-text');
    if (labelEl) {
        labelEl.innerText = currentBaseMap === 'dark' ? '🌙 深色底圖' : '🛣️ 街道底圖';
    }
}

// 氣溫數值標籤 Toggle 開關
function toggleTempLabels() {
    showTempLabels = !showTempLabels;
    const btn = document.getElementById('btn-toggle-temp-labels');
    if (btn) {
        if (showTempLabels) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }
    renderMapMarkers();
}

// 定位所在位置
function locateUserPosition() {
    if (!map) return;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                map.flyTo([lat, lon], 13, { duration: 1.2 });
                let closest = null;
                let minDist = Infinity;
                allStations.forEach(st => {
                    if (st.lat && st.lon) {
                        const d = Math.hypot(st.lat - lat, st.lon - lon);
                        if (d < minDist) {
                            minDist = d;
                            closest = st;
                        }
                    }
                });
                if (closest) {
                    selectStation(closest, false);
                }
            },
            (err) => {
                console.warn("Geolocation failed, focusing on current station or Taiwan:", err);
                if (currentStation && currentStation.lat && currentStation.lon) {
                    map.flyTo([currentStation.lat, currentStation.lon], 13, { duration: 1.0 });
                } else {
                    resetToTaiwanView();
                }
            },
            { timeout: 6000 }
        );
    } else if (currentStation && currentStation.lat && currentStation.lon) {
        map.flyTo([currentStation.lat, currentStation.lon], 13, { duration: 1.0 });
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
                onClick: (event, elements) => {
                    if (!elements || elements.length === 0) return;
                    const index = elements[0].index;
                    const targetStation = chartDataSources[index];
                    if (targetStation) {
                        selectStation(targetStation, true);
                        if (!isMapModalOpen) {
                            const mapCard = document.getElementById('map-card-wrapper');
                            if (mapCard) mapCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }
                },
                onHover: (event, chartElement) => {
                    if (event.native && event.native.target) {
                        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
                    }
                },
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
        if (isMapModalOpen) {
            // 已在放大地圖中，平滑移動中心
            if (map && st.lat && st.lon) map.panTo([st.lat, st.lon], { animate: true });
        } else {
            window.scrollTo({ top: 180, behavior: 'smooth' });
        }
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

// 篩選測站處理 (縣市選擇後自動縮放 fitBounds)
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
        stationSelect.innerHTML = `<option value="">請選擇測站或點擊地圖...</option>` + 
            filteredStations.map(st => 
                `<option value="${st.id}">${st.county} - ${st.name}</option>`
            ).join('');
    }

    const countInfo = document.getElementById('station-count-info');
    if (countInfo) {
        countInfo.innerText = `已顯示 ${filteredStations.length} 個站點 · Esri Dark Gray`;
    }

    if (filteredStations.length > 0) {
        selectStation(filteredStations[0], false);
    } else {
        resetKpiCardsToOverview();
    }

    try { renderMapMarkers(); } catch (e) { console.error("renderMapMarkers error:", e); }
    try { renderTable(filteredStations); } catch (e) { console.error("renderTable error:", e); }
    try { updateChart(); } catch (e) { console.error("updateChart error:", e); }

    // 縣市選擇後自動縮放 (Requirement 2)
    if (map) {
        if (county === 'all') {
            map.flyTo([23.82, 120.95], 7, { duration: 1.0 });
        } else {
            let targetBounds = countyBoundsMap[county] || 
                               countyBoundsMap[county.replace(/台/g, '臺')] || 
                               countyBoundsMap[county.replace(/臺/g, '台')];

            if (!targetBounds && filteredStations.length > 0) {
                const validCoords = filteredStations.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon]);
                if (validCoords.length > 0) {
                    targetBounds = L.latLngBounds(validCoords);
                }
            }

            if (targetBounds && targetBounds.isValid()) {
                map.fitBounds(targetBounds, {
                    padding: [30, 30],
                    maxZoom: 12,
                    animate: true,
                    duration: 1.0
                });
            }
        }
    }

    if (isMapModalOpen) {
        syncModalControls();
    }
}

// 重設全島 Overview 卡片資料
function resetKpiCardsToOverview() {
    const elStation = document.getElementById('card-station');
    if (elStation) elStation.innerText = "全臺灣監測";
    const elTagCounty = document.getElementById('tag-county');
    if (elTagCounty) elTagCounty.innerText = "全臺灣";
    const elTime = document.getElementById('card-time');
    const latestTime = allStations[0]?.time ? allStations[0].time.slice(11, 16) : '--:--';
    if (elTime) elTime.innerText = `觀測時間: ${latestTime}`;

    const validTemps = allStations.map(s => Number(s.temp !== undefined ? s.temp : s.cur_temp)).filter(t => !isNaN(t));
    const avgTemp = validTemps.length > 0 ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1) : "--";
    const minT = validTemps.length > 0 ? Math.min(...validTemps).toFixed(1) : "--";
    const maxT = validTemps.length > 0 ? Math.max(...validTemps).toFixed(1) : "--";

    const elCur = document.getElementById('card-cur-temp');
    if (elCur) elCur.innerText = `${avgTemp}°C`;
    const elRange = document.getElementById('card-range');
    if (elRange) elRange.innerText = `全臺極值: ${minT}°C ~ ${maxT}°C`;

    const elRain = document.getElementById('card-rain');
    if (elRain) elRain.innerText = "即時監測中";
    const elRainSub = document.getElementById('card-rain-sub');
    if (elRainSub) elRainSub.innerText = "全島累積水量觀測";

    const elWx = document.getElementById('card-wx');
    if (elWx) elWx.innerText = "全島觀測";
    const elHum = document.getElementById('card-hum');
    if (elHum) elHum.innerText = `監測測站總數: ${allStations.length} 站`;
}

// 回到全臺灣視角並清除目前選取的測站 (Requirement 4)
function resetToTaiwanView() {
    const countySelect = document.getElementById('select-county');
    if (countySelect) countySelect.value = 'all';

    currentStation = null;
    filteredStations = [...allStations];
    currentPage = 1;

    // 恢復站點選單
    const stationSelect = document.getElementById('select-station');
    if (stationSelect) {
        stationSelect.innerHTML = `<option value="">請選擇測站或點擊地圖...</option>` + 
            filteredStations.map(st => `<option value="${st.id}">${st.county} - ${st.name}</option>`).join('');
    }

    const countInfo = document.getElementById('station-count-info');
    if (countInfo) {
        countInfo.innerText = `已顯示 ${filteredStations.length} 個站點 · Esri Dark Gray`;
    }

    // 移除表格列選取狀態
    document.querySelectorAll('.station-row').forEach(r => r.classList.remove('selected'));

    resetKpiCardsToOverview();

    try { renderMapMarkers(); } catch (e) { console.error("renderMapMarkers error:", e); }
    try { renderTable(filteredStations); } catch (e) { console.error("renderTable error:", e); }
    try { updateChart(); } catch (e) { console.error("updateChart error:", e); }

    // 回到全臺灣視角
    if (map) {
        map.flyTo([23.82, 120.95], 7, { duration: 1.0 });
    }

    if (isMapModalOpen) {
        syncModalControls();
    }
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

// =========================================================
// 放大地圖 Modal (Fullscreen Overlay) 功能實作
// =========================================================

// 同步 Modal 內的縣市、測站與圖層按鈕狀態
function syncModalControls() {
    const mainCounty = document.getElementById('select-county');
    const modalCounty = document.getElementById('modal-select-county');
    if (mainCounty && modalCounty) {
        modalCounty.innerHTML = mainCounty.innerHTML;
        modalCounty.value = mainCounty.value;
    }

    const mainStation = document.getElementById('select-station');
    const modalStation = document.getElementById('modal-select-station');
    if (mainStation && modalStation) {
        modalStation.innerHTML = mainStation.innerHTML;
        modalStation.value = mainStation.value;
    }

    document.querySelectorAll('.modal-layer-btn').forEach(btn => {
        if (btn.dataset.layer === currentLayer) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const modalInfo = document.getElementById('modal-station-count-info');
    const mainInfo = document.getElementById('station-count-info');
    if (modalInfo && mainInfo) {
        modalInfo.innerText = mainInfo.innerText;
    }
}

// 開啟放大地圖 (約佔 90% 畫面)
function openMapModal() {
    if (isMapModalOpen) return;
    isMapModalOpen = true;

    // 將 Leaflet map 移動至 Modal 掛載槽
    const mapEl = document.getElementById('leaflet-map');
    const modalBody = document.getElementById('map-modal-body');
    if (mapEl && modalBody) {
        modalBody.appendChild(mapEl);
    }

    // 將圖例移動至 Modal 底部
    const legendEl = document.getElementById('windy-legend-bar');
    const modalFooter = document.getElementById('map-modal-footer');
    if (legendEl && modalFooter) {
        modalFooter.appendChild(legendEl);
    }

    syncModalControls();

    const overlay = document.getElementById('map-modal-overlay');
    if (overlay) {
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
    }
    document.body.style.overflow = 'hidden';

    // 尺寸改變後呼叫 map.invalidateSize() 確保 Tile 顯示完整
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 200);
}

// 關閉放大地圖，恢復原本 Dashboard 位置與尺寸
function closeMapModal() {
    if (!isMapModalOpen) return;
    isMapModalOpen = false;

    const overlay = document.getElementById('map-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';

    // 將 Leaflet map 移回原始插槽
    const mapEl = document.getElementById('leaflet-map');
    const origSlot = document.getElementById('map-slot-original');
    if (mapEl && origSlot) {
        origSlot.appendChild(mapEl);
    }

    // 將圖例移回原本卡片
    const legendEl = document.getElementById('windy-legend-bar');
    const cardWrapper = document.getElementById('map-card-wrapper');
    if (legendEl && cardWrapper) {
        cardWrapper.appendChild(legendEl);
    }

    // 恢復尺寸後呼叫 map.invalidateSize()
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 200);
}

// 核心資料載入函式 (含即時狀態列與紅色錯誤處理 Requirement 6)
async function loadWeatherData() {
    showSkeletonLoading();

    const heroBadge = document.getElementById('hero-live-badge');
    const heroText = document.getElementById('hero-live-text');
    if (heroBadge) heroBadge.className = "hero-chip chip-syncing";
    if (heroText) heroText.innerHTML = `<span class="chip-spin">⟳</span> SYNC · 正在取得氣象資料...`;

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
            cur_temp: (st.cur_temp !== undefined && st.cur_temp !== null) ? st.cur_temp : st.temp,
            wind_speed: (st.wind_speed !== undefined && st.wind_speed !== null && !isNaN(st.wind_speed)) ? Number(st.wind_speed) : null,
            wind_dir: (st.wind_dir !== undefined && st.wind_dir !== null && !isNaN(st.wind_dir)) ? Number(st.wind_dir) : null,
        }));
        filteredStations = [...allStations];

        // 更新 Hero 即時狀態列 (Requirement 6: ● LIVE · 347 stations · Updated 12:43)
        const latestTime = allStations[0]?.time ? allStations[0].time.slice(11, 16) : new Date().toTimeString().slice(0, 5);
        if (heroBadge) heroBadge.className = "hero-chip chip-live";
        if (heroText) {
            heroText.innerHTML = `<span class="chip-pulse-dot"></span> LIVE · ${allStations.length} stations · Updated ${latestTime}`;
        }

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
        
        // 當 API 錯誤時，改為明確紅色錯誤狀態 (Requirement 6)
        if (heroBadge) {
            heroBadge.className = "hero-chip chip-error";
        }
        if (heroText) {
            heroText.innerHTML = `<span class="chip-pulse-dot" style="background:#fb7185;"></span> ERROR · 氣象資料讀取失敗，請重新整理`;
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

    // 切換圖層共用函式 (支援 6 大圖層)
    function setLayer(layer) {
        if (!layer) return;
        currentLayer = layer;
        document.querySelectorAll('.layer-btn, .compact-layer-btn, .modal-layer-btn').forEach(b => {
            if (b.dataset.layer === currentLayer) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        renderMapMarkers();
    }

    // 監聽所有圖層按鈕 (包含 compact-layer-panel、side panel、modal)
    document.querySelectorAll('.layer-btn, .compact-layer-btn, .modal-layer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setLayer(e.currentTarget.dataset.layer);
        });
    });

    // 底圖切換按鈕
    const btnBasemap = document.getElementById('btn-toggle-basemap');
    if (btnBasemap) btnBasemap.addEventListener('click', switchBaseMap);

    // 氣溫數值標籤 Toggle
    const btnTempLabels = document.getElementById('btn-toggle-temp-labels');
    if (btnTempLabels) btnTempLabels.addEventListener('click', toggleTempLabels);

    // 定位按鈕
    const btnLocate = document.getElementById('btn-locate-user');
    if (btnLocate) btnLocate.addEventListener('click', locateUserPosition);

    // 關閉 Station Drawer
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeStationDrawer);

    // Drawer 內部動作按鈕
    const drawerFlyBtn = document.getElementById('drawer-btn-fly');
    if (drawerFlyBtn) {
        drawerFlyBtn.addEventListener('click', () => {
            if (currentStation && currentStation.lat && currentStation.lon && map) {
                map.flyTo([currentStation.lat, currentStation.lon], 13, { duration: 1.0 });
            }
        });
    }

    const drawerExpandBtn = document.getElementById('drawer-btn-expand');
    if (drawerExpandBtn) {
        drawerExpandBtn.addEventListener('click', openMapModal);
    }

    // 回到全臺按鈕 (主面板與 Modal 均支援 Requirement 4)
    const btnResetMap = document.getElementById('btn-reset-map');
    if (btnResetMap) btnResetMap.addEventListener('click', resetToTaiwanView);

    const modalBtnResetMap = document.getElementById('modal-btn-reset-map');
    if (modalBtnResetMap) modalBtnResetMap.addEventListener('click', resetToTaiwanView);

    // 搜尋過濾表格 (支援即時搜尋與 Enter 自動定位)
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
        const doSearch = () => {
            const query = searchInput.value.toLowerCase().trim();
            currentPage = 1;
            if (!query) {
                renderTable(filteredStations);
                return [];
            }
            const matches = filteredStations.filter(s => 
                (s.name && s.name.toLowerCase().includes(query)) ||
                (s.county && s.county.toLowerCase().includes(query)) ||
                (s.wx && s.wx.toLowerCase().includes(query)) ||
                (s.id && s.id.toLowerCase().includes(query))
            );
            renderTable(matches);
            return matches;
        };

        searchInput.addEventListener('input', doSearch);

        // Enter 鍵自動定位符合的第一個站點
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const matches = doSearch();
                if (matches && matches.length > 0) {
                    selectStation(matches[0], true);
                }
            }
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

    // =========================================================
    // 放大地圖 Modal 按鈕與事件監聽
    // =========================================================
    const btnExpand = document.getElementById('btn-expand-map');
    if (btnExpand) {
        btnExpand.addEventListener('click', openMapModal);
    }

    const btnCloseMapModal = document.getElementById('btn-close-map-modal');
    if (btnCloseMapModal) {
        btnCloseMapModal.addEventListener('click', closeMapModal);
    }

    // 點擊 Modal 外部半透明區域可關閉
    const modalOverlay = document.getElementById('map-modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeMapModal();
            }
        });
    }

    // ESC 鍵關閉抽屜與放大地圖
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeStationDrawer();
            if (isMapModalOpen) {
                closeMapModal();
            }
        }
    });

    // Modal 內的縣市下拉切換
    const modalCountySelect = document.getElementById('modal-select-county');
    if (modalCountySelect) {
        modalCountySelect.addEventListener('change', (e) => {
            const mainCounty = document.getElementById('select-county');
            if (mainCounty) mainCounty.value = e.target.value;
            handleCountyChange();
            syncModalControls();
        });
    }

    // Modal 內的測站下拉切換
    const modalStationSelect = document.getElementById('modal-select-station');
    if (modalStationSelect) {
        modalStationSelect.addEventListener('change', (e) => {
            const mainStation = document.getElementById('select-station');
            if (mainStation) mainStation.value = e.target.value;
            const st = filteredStations.find(s => s.id === e.target.value);
            if (st) selectStation(st);
            syncModalControls();
        });
    }

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
