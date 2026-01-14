// SeAH CM Condensation Monitor App - Rebuilt Version
// 간결하고 명확한 구조로 재작성

// ========== 1. 상수 및 설정 ==========
const CONFIG = {
    B: 17.27,
    C: 237.7
};

const WAREHOUSE_LOCATIONS = [
    "CGL 제품창고", "SSCL 제품창고",
    "1CCL 원자재동", "1CCL 제품창고",
    "2CCL 원자재동", "2CCL 제품창고",
    "3CCL 원자재동", "3CCL 제품창고"
];

// ========== 2. 전역 상태 ==========
let monitoringLogs = [];
let latestLocationStatus = {};
let allReports = {};
let lastResetDate = localStorage.getItem('seah_last_reset_date') || "";
let currentCalendarDate = new Date();
let isAdmin = sessionStorage.getItem('seah_is_admin') === 'true'; // 관리자 세션 유지
let cachedForecast = null; // 전역 캐시 변수

// 기상청 API 키 - Firebase에서만 관리 (보안 강화)
let kmaShortApiKey = ""; // 단기예보 API 키
let kmaMidApiKey = ""; // 중기예보 API 키

// ========== 3. DOM 요소 참조 ==========
const elements = {
    locationSelect: document.getElementById('location-select'),
    steelTempInput: document.getElementById('steel-temp-input'),
    tempInput: document.getElementById('temp-input'),
    humidityInput: document.getElementById('humidity-input'),
    outdoorHumidityInput: document.getElementById('outdoor-humidity-input'),
    calculateBtn: document.getElementById('calculate-btn'),
    statusText: document.getElementById('status-text'),
    dewPointVal: document.getElementById('dew-point-val'),
    tempDiffVal: document.getElementById('temp-diff-val'),
    riskReasonText: document.getElementById('risk-reason-text'),
    logBody: document.getElementById('log-body'),
    clearBtn: document.getElementById('clear-log-btn'),
    outdoorTemp: document.getElementById('outdoor-temp'),
    weatherAmRain: document.getElementById('weather-am-rain'),
    weatherAmProb: document.getElementById('weather-am-prob'),
    weatherPmRain: document.getElementById('weather-pm-rain'),
    weatherPmProb: document.getElementById('weather-pm-prob'),
    reportDate: document.getElementById('report-date'),
    riskIndicator: document.getElementById('risk-indicator'),
    locationStatusList: document.getElementById('location-status-list'),
    slot0700: document.getElementById('slot-0700'),
    slot1500: document.getElementById('slot-1500'),
    reportTime: document.getElementById('report-time'),
    currentTime: document.getElementById('current-time'),
    outdoorHumidity: document.getElementById('outdoor-humidity')
};

// ========== 4. 유틸리티 함수 ==========
function getLocalDateString(d) {
    const now = d || new Date();
    const krOffset = 9 * 60 * 60 * 1000;
    const krDate = new Date(now.getTime() + krOffset);
    return krDate.toISOString().split('T')[0];
}

function calculateDewPoint(T, RH) {
    const gamma = (CONFIG.B * T) / (CONFIG.C + T) + Math.log(RH / 100);
    const dewPoint = (CONFIG.C * gamma) / (CONFIG.B - gamma);
    return dewPoint.toFixed(1);
}

function getRiskLevel(tempDiff, humidity) {
    // 습도가 높을수록(현장 상황 반영) 위험도 가중
    const humidityWeight = humidity > 70 ? 1.0 : 0;
    const adjustedDiff = tempDiff - humidityWeight;

    if (adjustedDiff > 5) return {
        label: '안전',
        class: 'status-safe',
        reason: '강판 온도가 이슬점보다 충분히 높아 안전한 상태입니다.'
    };
    if (adjustedDiff > 2) return {
        label: '주의',
        class: 'status-caution',
        reason: '강판 온도와 이슬점 차이가 좁혀지고 있거나 습도가 높습니다. 환기 및 온도 관리를 권장합니다.'
    };
    return {
        label: '위험',
        class: 'status-danger',
        reason: '이슬점이 강판 온도에 근접했거나 습도가 매우 높습니다. 결로 발생 가능성이 크므로 즉시 조치가 필요합니다.'
    };
}

function getRiskLevelTextClass(label) {
    if (label === '안전') return 'status-safe';
    if (label === '주의') return 'status-caution';
    return 'status-danger';
}

// ========== 5. 위치별 현황 렌더링 (핵심 기능) ==========
function renderLocationSummary() {
    console.log('=== renderLocationSummary 시작 ===');
    console.log('latestLocationStatus:', latestLocationStatus);

    if (!elements.locationStatusList) {
        console.warn('locationStatusList 요소를 찾을 수 없습니다.');
        return;
    }

    // 모든 위치를 항상 표시
    const todayStr = getLocalDateString();
    const dayReports = allReports[todayStr] || {};

    // 당일 리포트 중 가장 최신 슬롯(15:00 -> 07:00 순) 스냅샷 찾기
    const latestSnapshotSlot = ['15:00', '07:00'].find(slot => dayReports[slot.replace(':', '')] || dayReports[slot]);
    const snapshotData = latestSnapshotSlot ? (dayReports[latestSnapshotSlot.replace(':', '')] || dayReports[latestSnapshotSlot]).snapshot : null;

    // 데이터 기준 시간 표시 (헤더 옆)
    const syncTimeEl = document.getElementById('location-sync-time');
    if (syncTimeEl) {
        if (latestSnapshotSlot) {
            syncTimeEl.textContent = `(${todayStr} ${latestSnapshotSlot} 점검 기준)`;
            syncTimeEl.style.color = 'var(--seah-blue)'; // 공식 데이터는 강조
        } else {
            syncTimeEl.textContent = `(실시간 입력 기준)`;
            syncTimeEl.style.color = '#666';
        }
    }

    const html = WAREHOUSE_LOCATIONS.map(loc => {
        // 1. 당일 리포트 스냅샷이 있으면 우선 사용, 없으면 실시간(latestLocationStatus), 마지막으로 기본값
        const data = (snapshotData && snapshotData[loc]) || latestLocationStatus[loc] || {
            steel: '-',
            dp: '-',
            riskLabel: '미측정',
            riskClass: 'status-safe',
            gate: '닫힘',
            pack: '포장',
            product: '양호',
            time: '-'
        };

        const riskBgClass = data.riskClass.replace('status-', 'bg-');
        const gateClass = data.gate === '열림' ? 'open' : '';
        const packClass = data.pack === '미포장' ? 'unpacked' : '';
        const prodClass = data.product === '결로 인지' ? 'detected' : 'good';

        // 관리자가 아니면 토글 버튼 비활성화 (보이지 않는 화살표 처리 등)
        const toggleDisabled = isAdmin ? '' : 'disabled style="cursor: default;"';
        const arrow = isAdmin ? ' ▾' : '';

        return `
            <div class="status-item">
                <div class="loc-main-content">
                    <div class="loc-header">
                        <span class="loc-name">${loc}</span>
                        <span class="loc-data">${data.steel}°C / ${data.dp}°C <small>(${data.time})</small></span>
                    </div>
                    <div class="status-badges">
                        <button class="badge badge-gate ${gateClass}" data-location="${loc}" data-field="gate" ${toggleDisabled}>GATE: ${data.gate}${arrow}</button>
                        <button class="badge badge-pack ${packClass}" data-location="${loc}" data-field="pack" ${toggleDisabled}>${data.pack}${arrow}</button>
                    </div>
                </div>
                <div class="loc-status-aside">
                    <button class="badge badge-product ${prodClass}" data-location="${loc}" data-field="product" ${toggleDisabled}>${data.product}${arrow}</button>
                    <div class="loc-risk ${riskBgClass}">${data.riskLabel}</div>
                </div>
            </div>
        `;
    }).join('');

    elements.locationStatusList.innerHTML = html;
    console.log('=== renderLocationSummary 완료 - ' + WAREHOUSE_LOCATIONS.length + '개 위치 렌더링됨 ===');
}

// ========== 6. 위치 상태 업데이트 ==========
function updateLocationStatus(location, steel, dp, risk, gate, pack, product) {
    latestLocationStatus[location] = {
        steel: steel,
        dp: dp,
        riskLabel: risk.label,
        riskClass: risk.class,
        gate: gate || '닫힘',
        pack: pack || '포장',
        product: product || '양호',
        time: new Date().toLocaleTimeString(),
        dateStr: getLocalDateString() // 오늘 날짜 저장 (중복 확인용)
    };

    // Firebase 동기화
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`locationStatus/${location}`).set(latestLocationStatus[location]);
    }

    // 로컬 스토리지 저장
    localStorage.setItem('seah_location_status', JSON.stringify(latestLocationStatus));

    // 위치별 현황 다시 렌더링
    renderLocationSummary();

    // 보고 상태 업데이트
    updateTimedReportStatus();
}

// ========== 7. 위치 상태 토글 ==========
function toggleLocationStatus(location, field) {
    // 1. 현재 표시 중인 데이터 원천 파악 (스냅샷 vs 실시간)
    const todayStr = getLocalDateString();
    const dayReports = allReports[todayStr] || {};
    const latestSnapshotSlot = ['15:00', '07:00'].find(slot => dayReports[slot.replace(':', '')] || dayReports[slot]);

    // 현재 UI에 표시되고 있는 데이터 가져오기
    let currentData = null;
    let isSnapshot = false;
    let snapshotSlot = null;

    if (latestSnapshotSlot) {
        snapshotSlot = latestSnapshotSlot.replace(':', '');
        const snapshot = dayReports[snapshotSlot] || dayReports[latestSnapshotSlot];
        if (snapshot && snapshot.snapshot && snapshot.snapshot[location]) {
            currentData = snapshot.snapshot[location];
            isSnapshot = true;
        }
    }

    if (!currentData) {
        currentData = latestLocationStatus[location];
    }

    if (!currentData) {
        alert('토글할 데이터가 없습니다. 먼저 실시간 분석을 수행하거나 점검 기록을 등록해주세요.');
        return;
    }

    // 2. 상태 토글
    if (field === 'gate') {
        currentData.gate = currentData.gate === '열림' ? '닫힘' : '열림';
    } else if (field === 'pack') {
        currentData.pack = currentData.pack === '포장' ? '미포장' : '포장';
    } else if (field === 'product') {
        currentData.product = currentData.product === '양호' ? '결로 인지' : '양호';
    }

    // 3. 데이터 저장
    // 3-1. 실시간 상태 업데이트 (Master)
    updateLocationStatus(location, currentData.steel, (currentData.dp || currentData.dewPoint), { label: currentData.riskLabel, class: currentData.riskClass }, currentData.gate, currentData.pack, currentData.product);

    // 3-2. 만약 스냅샷을 보고 있었다면, 해당 스냅샷(보고서)도 업데이트하여 UI 동기화
    if (isSnapshot && snapshotSlot && typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`reports/${todayStr}/${snapshotSlot}/snapshot/${location}`).update({
            gate: currentData.gate,
            pack: currentData.pack,
            product: currentData.product
        });
    }
}

// ========== 7.5 관리자 인증 로직 ==========
function openPwdModal() {
    document.getElementById('pwd-modal').style.display = 'block';
    document.getElementById('admin-pwd-input').focus();
}

function closePwdModal() {
    document.getElementById('pwd-modal').style.display = 'none';
    document.getElementById('admin-pwd-input').value = '';
}

function loginAdmin() {
    const pwdInput = document.getElementById('admin-pwd-input').value;
    // 관리자 암호 설정 (예: 0000)
    if (pwdInput === '0000') {
        isAdmin = true;
        sessionStorage.setItem('seah_is_admin', 'true');
        applyAdminUI();
        closePwdModal();
        alert('관리자 모드로 전환되었습니다.');
    } else {
        alert('암호가 틀렸습니다.');
        document.getElementById('admin-pwd-input').value = '';
    }
}

function logoutAdmin() {
    if (confirm('로그아웃 하시겠습니까?')) {
        isAdmin = false;
        sessionStorage.removeItem('seah_is_admin');
        applyAdminUI();
        alert('로그아웃 되었습니다.');
    }
}

function applyAdminUI() {
    if (isAdmin) {
        document.body.classList.add('is-admin');
    } else {
        document.body.classList.remove('is-admin');
    }
    // 관리자 상태에 따라 리렌더링이 필요한 부분들
    renderLocationSummary();
    updateTimedReportStatus();

    // 입력 필드들 비활성화/활성화 제어
    const inputs = [
        'location-select', 'steel-temp-input', 'temp-input',
        'humidity-input', 'outdoor-temp-input', 'outdoor-humidity-input',
        'report-date', 'report-time',
        'status-inspection-date'
    ];

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isAdmin;
    });
}

// ========== 8. UI 업데이트 ==========
function updateUI(location, steelTemp, indoorTemp, humidity, outdoorTemp, outdoorHum) {
    const dp = calculateDewPoint(indoorTemp, humidity);
    const diff = (steelTemp - dp).toFixed(1);
    const risk = getRiskLevel(diff, humidity);

    // Null 체크와 함께 UI 업데이트
    if (elements.dewPointVal) elements.dewPointVal.textContent = `${dp}°C`;
    if (elements.tempDiffVal) elements.tempDiffVal.textContent = `${diff}°C`;
    if (elements.riskReasonText) elements.riskReasonText.textContent = risk.reason;
    if (elements.statusText) {
        elements.statusText.textContent = risk.label;
        elements.statusText.className = 'status-value ' + risk.class;
    }
    if (elements.riskIndicator) {
        elements.riskIndicator.style.borderLeftColor = `var(--${risk.class})`;
    }

    // 로그 저장
    saveLog(location, steelTemp, indoorTemp, humidity, outdoorTemp, outdoorHum, dp, risk.label);

    // 위치 상태 업데이트
    const existing = latestLocationStatus[location] || { gate: '닫힘', pack: '포장', product: '양호' };
    updateLocationStatus(location, steelTemp, dp, risk, existing.gate, existing.pack, existing.product);
}

// ========== 9. 로그 관리 ==========
function saveLog(location, steelTemp, indoorTemp, humidity, outdoorTemp, outdoorHum, dp, riskLabel) {
    const selDate = elements.reportDate.value;
    const selTime = elements.reportTime.value;
    const targetTime = selTime === '실시간' ? new Date().toLocaleTimeString() : selTime;

    const logEntry = {
        time: `${selDate} ${targetTime}`,
        location: location,
        steel: `${steelTemp}°C`,
        indoor: `${indoorTemp}°C / ${humidity}%`,
        outdoor: `${outdoorTemp}°C / ${outdoorHum}%`,
        outdoorTemp: outdoorTemp,
        outdoorHum: outdoorHum,
        dp: `${dp}°C`,
        risk: riskLabel,
        timestamp: Date.now()
    };

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('logs').push(logEntry);
    } else {
        monitoringLogs.unshift(logEntry);
        localStorage.setItem('seah_logs', JSON.stringify(monitoringLogs));
        renderLogs();
    }
}

function renderLogs() {
    if (!elements.logBody) return;

    const displayLogs = monitoringLogs.slice(0, 5);
    elements.logBody.innerHTML = displayLogs.map(log => `
        <tr>
            <td>${log.time}</td>
            <td>${log.location}</td>
            <td>${log.steel}</td>
            <td>${log.indoor}</td>
            <td>${log.outdoor}</td>
            <td>${log.dp}</td>
            <td><span class="risk-badge ${getRiskLevelTextClass(log.risk)}">${log.risk}</span></td>
        </tr>
    `).join('');

    updateTimedReportStatus();
}

// ========== 10. 날씨 API 유틸리티 (CORS 및 SSL 대응) ==========
/**
 * 기상청 API는 브라우저에서 직접 호출 시 CORS 에러가 발생하므로,
 * 배포 환경(Vercel 등)에서는 vercel.json에 설정된 proxy를 거쳐 요청합니다.
 */
async function requestKma(url) {
    if (!url) return null;

    let target = url;

    // 배포 환경(Vercel) 확인: hostname이 vercel.app인 경우 로컬 프록시 경로 사용
    const isVercel = window.location.hostname.includes('vercel.app');

    if (isVercel) {
        // vercel.json의 rewrite 설정을 이용해 CORS 우회
        target = url.replace('https://apis.data.go.kr/', '/proxy/kma/')
            .replace('http://apis.data.go.kr/', '/proxy/kma/');
    }

    try {
        const response = await fetch(target);

        // 응답 상태 확인
        if (!response.ok) {
            console.error(`KMA API Fetch Failed: ${response.status} ${response.statusText}`);
            // Vercel 프록시 실패 시 AllOrigins로 폴백 시도 (최후의 수단)
            if (isVercel && !url.includes('allorigins')) {
                const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url.replace('http://', 'https://'))}`;
                const res = await fetch(fallbackUrl);
                const json = await res.json();
                return typeof json.contents === 'string' ? JSON.parse(json.contents) : json.contents;
            }
            return null;
        }

        const data = await response.json();
        return data;
    } catch (e) {
        console.error('KMA Request Error:', e);

        // 네트워크 에러 시 AllOrigins로 폴백
        if (!url.includes('allorigins')) {
            try {
                const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url.replace('http://', 'https://'))}`;
                const res = await fetch(fallbackUrl);
                const json = await res.json();
                return typeof json.contents === 'string' ? JSON.parse(json.contents) : json.contents;
            } catch (e2) {
                console.error('Fallback Proxy Failed:', e2);
            }
        }
        return null;
    }
}

// SVG Icons
const WEATHER_ICONS = {
    sunny: `<svg viewBox="0 0 64 64" width="80" height="80"><circle cx="32" cy="32" r="14" fill="#ffb300"/><g stroke="#ffb300" stroke-width="4"><path d="M32 6v8M32 50v8M6 32h8M50 32h8M14 14l6 6M44 44l6 6M14 50l6-6M44 20l6-6"/></g></svg>`,
    cloudy: `<svg viewBox="0 0 64 64" width="80" height="80"><path d="M46 26c0-6.6-5.4-12-12-12-5.4 0-10 3.6-11.4 8.6C21.5 22.2 20.3 22 19 22c-5 0-9 4-9 9 0 .6.1 1.2.2 1.8C6.6 34.6 4 38.5 4 43c0 6.1 4.9 11 11 11h32c6.6 0 12-5.4 12-12 0-6.1-4.7-11.1-10.7-11.9-.3-2.3-1.1-4.4-2.3-6.1z" fill="#90a4ae"/></svg>`,
    rain: `<svg viewBox="0 0 64 64" width="80" height="80"><path d="M48 28c0-6.6-5.4-12-12-12-5.4 0-10 3.6-11.4 8.6C23.5 24.2 22.3 24 21 24c-5 0-9 4-9 9 0 .6.1 1.2.2 1.8C8.6 36.6 6 40.5 6 45c0 6.1 4.9 11 11 11h34c6.6 0 12-5.4 12-12 0-6.1-4.7-11.1-10.7-11.9-.3-2.3-1.1-4.4-2.3-6.1z" fill="#546e7a"/><path d="M22 62a2 2 0 0 1-1.8-1.2l-2-5a2 2 0 1 1 3.7-1.5l2 5A2 2 0 0 1 22 62zm10 0a2 2 0 0 1-1.8-1.2l-2-5a2 2 0 1 1 3.7-1.5l2 5A2 2 0 0 1 32 62zm10 0a2 2 0 0 1-1.8-1.2l-2-5a2 2 0 1 1 3.7-1.5l2 5A2 2 0 0 1 42 62z" fill="#42a5f5"/></svg>`,
    snow: `<svg viewBox="0 0 64 64" width="80" height="80"><path d="M46 26c0-6.6-5.4-12-12-12-5.4 0-10 3.6-11.4 8.6C21.5 22.2 20.3 22 19 22c-5 0-9 4-9 9 0 .6.1 1.2.2 1.8C6.6 34.6 4 38.5 4 43c0 6.1 4.9 11 11 11h32c6.6 0 12-5.4 12-12 0-6.1-4.7-11.1-10.7-11.9-.3-2.3-1.1-4.4-2.3-6.1z" fill="#cfd8dc"/><g stroke="#81d4fa" stroke-width="2"><path d="M22 58h4M30 58h4M38 58h4M22 58l2 2M30 58l2 2M38 58l2 2M22 58l-2 2M30 58l-2 2M38 58l-2 2"/></g></svg>`
};

function updateWeatherIcon(pty, sky) {
    const container = document.getElementById('weather-icon-container');
    if (!container) return;

    let icon = WEATHER_ICONS.sunny; // Default
    const ptyVal = parseInt(pty || 0);
    const skyVal = parseInt(sky || 1);

    if (ptyVal > 0) {
        if (ptyVal === 3 || ptyVal === 7) {
            icon = WEATHER_ICONS.snow;
        } else {
            icon = WEATHER_ICONS.rain;
        }
    } else {
        if (skyVal >= 3) {
            icon = WEATHER_ICONS.cloudy;
        } else {
            icon = WEATHER_ICONS.sunny;
        }
    }
    container.innerHTML = icon;
}

// ========== 10. 실시간 날씨 연동 (Dashboard) ==========
async function updateWeatherData() {
    console.log('=== 실시간 날씨 업데이트 시작 ===');
    const API_KEY = kmaShortApiKey;
    const nx = 56, ny = 92;

    if (!API_KEY || API_KEY.length < 10) {
        if (elements.outdoorTemp) elements.outdoorTemp.textContent = '--°C';
        return null;
    }

    try {
        const now = new Date();
        const todayStr = getLocalDateString().replace(/-/g, '');

        // 1. 초단기실황 (현재 기온/하늘/강수)
        let ncstHour = now.getHours();
        let ncstDate = todayStr;
        if (now.getMinutes() < 45) ncstHour--;
        if (ncstHour < 0) {
            ncstHour = 23;
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            ncstDate = getLocalDateString(yesterday).replace(/-/g, '');
        }
        const ncstBaseTime = String(ncstHour).padStart(2, '0') + '00';
        const serviceKey = encodeURIComponent(API_KEY);
        const baseUrl = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
        const ncstUrl = `${baseUrl}/getUltraSrtNcst?serviceKey=${serviceKey}&dataType=JSON&base_date=${ncstDate}&base_time=${ncstBaseTime}&nx=${nx}&ny=${ny}`;

        // 2. 단기예보
        const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
        let fcstBaseTime = 2, fcstBaseDate = todayStr;
        if (now.getHours() < 2 || (now.getHours() === 2 && now.getMinutes() < 15)) {
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            fcstBaseDate = getLocalDateString(yesterday).replace(/-/g, '');
            fcstBaseTime = 23;
        } else {
            for (const t of baseTimes) {
                if (now.getHours() > t || (now.getHours() === t && now.getMinutes() > 15)) {
                    fcstBaseTime = t; break;
                }
            }
        }
        const fcstUrl = `${baseUrl}/getVilageFcst?serviceKey=${serviceKey}&dataType=JSON&base_date=${fcstBaseDate}&base_time=${String(fcstBaseTime).padStart(2, '0')}00&nx=${nx}&ny=${ny}&numOfRows=500`;

        const [ncstRes, fcstRes] = await Promise.all([requestKma(ncstUrl), requestKma(fcstUrl)]);

        let currentTemp = 0;
        // Parse NCST
        if (ncstRes?.response?.header?.resultCode === '00') {
            const items = ncstRes.response.body.items.item;
            const tempItem = items.find(i => i.category === 'T1H');
            const ptyItem = items.find(i => i.category === 'PTY');
            // SKY 정보는 초단기실황에 없을 수도 있음 (초단기예보에는 있음), 실황은 PTY 위주
            // 하지만 초단기실황에는 SKY가 없고 PTY, T1H, RN1, REH, UUU, VVV, VEC, WSD 만 줌.
            // 따라서 SKY는 단기예보의 가장 최신 시간대 데이터를 쓰거나 '초단기예보'를 불러야 함. 
            // 여기선 편의상 PTY가 0이면 '맑음' 가정하되 fcst에서 가져옴.

            if (tempItem) {
                currentTemp = parseFloat(tempItem.obsrValue);
                if (elements.outdoorTemp) elements.outdoorTemp.textContent = `${currentTemp}°C`;
                const outdoorInput = document.getElementById('outdoor-temp-input');
                if (outdoorInput && document.activeElement !== outdoorInput) outdoorInput.value = currentTemp;
            }

            const rehItem = items.find(i => i.category === 'REH');
            if (rehItem) {
                const currentHum = parseFloat(rehItem.obsrValue);
                if (elements.outdoorHumidity) elements.outdoorHumidity.textContent = `습도: ${currentHum}%`;
                const outdoorHumInput = document.getElementById('outdoor-humidity-input');
                if (outdoorHumInput && document.activeElement !== outdoorHumInput) outdoorHumInput.value = currentHum;
            }

            // Icon Update Logic
            if (ptyItem) {
                // SKY는 fcstRes에서 현재 시간과 가장 가까운 것을 찾아야 함
                // 여기서는 간단히 pty가 있으면 비/눈, 없으면 맑음(혹은 구름 정보 없음) 처리하되,
                // fcstRes가 있다면 거기서 SKY를 가져와 보완.
                let skyVal = 1;
                if (fcstRes?.response?.header?.resultCode === '00') {
                    const fItems = fcstRes.response.body.items.item;
                    // 현재 시간 이후 첫 SKY 값 찾기
                    const nowTimeStr = String(now.getHours()).padStart(2, '0') + '00';
                    const skyItem = fItems.find(i => i.category === 'SKY' && i.fcstDate === todayStr && i.fcstTime >= nowTimeStr);
                    if (skyItem) skyVal = skyItem.fcstValue;
                }
                updateWeatherIcon(ptyItem.obsrValue, skyVal);
            }
        }

        // Parse FCST (AM/PM Pop & Rain)
        if (fcstRes?.response?.header?.resultCode === '00') {
            const items = fcstRes.response.body.items.item.filter(i => i.fcstDate === todayStr);
            const pops = items.filter(i => i.category === 'POP');
            const pcps = items.filter(i => i.category === 'PCP');

            const getStat = (arr, start, end, mode = 'max') => {
                const slice = arr.filter(i => {
                    const t = parseInt(i.fcstTime);
                    return t >= start && t < end;
                });
                if (slice.length === 0) return 0;
                const vals = slice.map(i => {
                    const v = i.fcstValue;
                    if (v === '강수없음') return 0;
                    return parseFloat(v) || 0;
                });
                return mode === 'max' ? Math.max(...vals) : vals[0];
            };

            const amPop = getStat(pops, 600, 1200);
            const pmPop = getStat(pops, 1200, 2400);
            const amPcp = getStat(pcps, 600, 1200);
            const pmPcp = getStat(pcps, 1200, 2400);

            if (elements.weatherAmProb) elements.weatherAmProb.textContent = `${amPop}%`;
            if (elements.weatherPmProb) elements.weatherPmProb.textContent = `${pmPop}%`;

            const formatPcp = (val) => {
                if (val === 0) return '0mm';
                if (val < 1.0) return '1mm 미만';
                if (val >= 50.0) return '50mm 이상';
                return `${Math.round(val)}mm`;
            };

            if (elements.weatherAmRain) elements.weatherAmRain.textContent = formatPcp(amPcp);
            if (elements.weatherPmRain) elements.weatherPmRain.textContent = formatPcp(pmPcp);
        }

        const rehItem = ncstRes?.response?.header?.resultCode === '00'
            ? ncstRes.response.body.items.item.find(i => i.category === 'REH')
            : null;
        const currentHum = rehItem ? parseFloat(rehItem.obsrValue) : 0;

        return { temp: currentTemp, humidity: currentHum };
    } catch (e) {
        console.error('Weather Sync Error:', e);
        return { temp: 0, humidity: 0 };
    }
}

// ========== 11. 보고서 관리 ==========
async function submitTimedReport(timeSlot) {
    const selDate = document.getElementById('status-inspection-date')?.value || elements.reportDate.value;
    const selTime = elements.reportTime.value;
    const outdoor = await updateWeatherData();

    const targetSlot = timeSlot || (selTime === '실시간' ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : selTime);
    const targetDate = selDate;

    const targetLogs = monitoringLogs.filter(log => log.time.startsWith(targetDate));
    const snapshot = {};

    WAREHOUSE_LOCATIONS.forEach(l => {
        const locLogs = targetLogs.filter(log => log.location === l);
        // monitoringLogs는 최신 로그가 배열의 앞(unshift)으로 들어가므로
        // 필터링된 locLogs에서도 index 0이 "가장 최근" 데이터가 된다.
        const latestLog = locLogs.length > 0 ? locLogs[0] : null;

        if (latestLog) {
            snapshot[l] = {
                steel: latestLog.steel.replace('°C', ''),
                dp: latestLog.dp.replace('°C', ''),
                riskLabel: latestLog.risk,
                riskClass: getRiskLevelTextClass(latestLog.risk),
                gate: latestLocationStatus[l]?.gate || '닫힘',
                pack: latestLocationStatus[l]?.pack || '포장',
                product: latestLocationStatus[l]?.product || '양호',
                time: latestLog.time.split(' ')[1]
            };
        } else {
            if (targetDate === getLocalDateString()) {
                snapshot[l] = latestLocationStatus[l] || {
                    steel: '-', dp: '-', riskLabel: '미측정', riskClass: 'status-safe',
                    gate: '닫힘', pack: '포장', product: '양호', time: '-'
                };
            } else {
                snapshot[l] = {
                    steel: '-', dp: '-', riskLabel: '미측정', riskClass: 'status-safe',
                    gate: '닫힘', pack: '포장', product: '양호', time: '-'
                };
            }
        }
    });

    const reportData = {
        time: `${targetDate} ${targetSlot}`,
        slot: targetSlot,
        location: "전체 창고 (스냅샷)",
        snapshot: snapshot,
        outdoor: outdoor,
        reporter: "관리자",
        timestamp: Date.now()
    };

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`reports/${targetDate}/${targetSlot.replace(':', '')}`).set(reportData);
        updateTimedReportStatus();
        renderHistory();
        alert(`${targetDate} ${targetSlot} 보고가 완료되었습니다.`);
    } else {
        if (!allReports[targetDate]) allReports[targetDate] = {};
        allReports[targetDate][targetSlot] = reportData;
        localStorage.setItem('seah_all_reports', JSON.stringify(allReports));

        updateTimedReportStatus();
        renderHistory();
        alert(`${targetDate} ${targetSlot} 보고가 기록되었습니다.`);
    }
}

function updateTimedReportStatus() {
    const selectedDate = document.getElementById('status-inspection-date')?.value || document.getElementById('report-date').value;
    const dayReports = allReports[selectedDate] || {};

    const times = ['07:00', '15:00'];
    times.forEach(time => {
        const slotKey = time.replace(':', '');
        const slotId = `slot-${slotKey}`;
        const slot = document.getElementById(slotId);
        if (!slot) return;

        const editBtn = document.getElementById(`edit-btn-${slotKey}`);
        const viewBtn = document.getElementById(`view-btn-${time.replace(':', '')}`);
        const statusText = slot.querySelector('.slot-status');

        if (dayReports[slotKey]) {
            // 이미 해당 시간대 보고가 존재하는 경우
            slot.classList.add('completed');
            statusText.innerText = '등록 완료';

            if (editBtn) {
                editBtn.innerText = '수정';
                editBtn.className = 'btn-mini btn-primary-mini';

                // 관리자가 아니면 수정 버튼 숨김
                if (!isAdmin) {
                    editBtn.style.display = 'none';
                } else {
                    editBtn.style.display = 'inline-block';
                }

                editBtn.disabled = !isAdmin;
                editBtn.onclick = () => {
                    if (confirm(`${selectedDate} ${time} 점검 보고서를 최신 데이터로 수정(재기록)하시겠습니까?`)) {
                        document.getElementById('report-date').value = selectedDate;
                        document.getElementById('report-time').value = time;
                        submitTimedReport(time);
                    }
                };
            }

            if (viewBtn) {
                viewBtn.innerText = '조회';
                viewBtn.className = 'btn-mini btn-secondary-mini';
                viewBtn.disabled = false;
                viewBtn.onclick = () => viewReportDetails(time, selectedDate);
            }
        } else {
            // 아직 보고가 없는 경우
            slot.classList.remove('completed');
            statusText.innerText = '미등록';

            if (editBtn) {
                editBtn.innerText = '기록';
                editBtn.className = 'btn-mini btn-primary-mini';
                // 관리자가 아니면 숨김 처리 (CSS로 처리되지만 안전하게 비활성화)
                if (!isAdmin) {
                    editBtn.style.display = 'none';
                } else {
                    editBtn.style.display = 'inline-block';
                }

                editBtn.disabled = !isAdmin;
                editBtn.onclick = () => {
                    if (confirm(`${selectedDate} ${time} 점검 보고서를 현재 최신 데이터로 기록하시겠습니까?`)) {
                        document.getElementById('report-date').value = selectedDate;
                        document.getElementById('report-time').value = time;
                        submitTimedReport(time);
                    }
                };
            }

            if (viewBtn) {
                viewBtn.innerText = '조회';
                viewBtn.className = 'btn-mini btn-secondary-mini';
                viewBtn.disabled = true;
                viewBtn.onclick = null;
            }
        }
    });
}

function viewReportDetails(time, manualDate = null) {
    const todayStr = getLocalDateString();
    const targetDate = manualDate || todayStr;
    const dayData = allReports[targetDate];

    if (!dayData || Object.keys(dayData).length === 0) {
        alert('해당 날짜의 기록을 찾을 수 없습니다.');
        return;
    }

    document.getElementById('modal-title').textContent = `${targetDate} 점검 상세 기록 (전체)`;
    const tbody = document.getElementById('modal-table-body');

    const slots = Object.keys(dayData).sort();
    let tableRows = '';

    slots.forEach(slot => {
        const data = dayData[slot];
        if (!data || !data.snapshot) return;

        const outdoorStr = typeof data.outdoor === 'object' ?
            `${data.outdoor.temp}°C / ${data.outdoor.humidity}%` :
            `${data.outdoor}°C`;

        tableRows += `
            <tr class="slot-header-row">
                <td colspan="7" style="background: #f1f4f8; font-weight: bold; text-align: left; padding-left: 15px;">
                    📅 ${slot} 보고 (실외: ${outdoorStr})
                </td>
            </tr>
        `;

        Object.entries(data.snapshot).forEach(([loc, info]) => {
            tableRows += `
                <tr>
                    <td>${loc}</td>
                    <td>${formatSnapshotTime(info.time, slot)}</td>
                    <td>${info.steel}°C / ${info.dp}°C</td>
                    <td>${info.gate}</td>
                    <td>${info.pack}</td>
                    <td style="color: ${info.product === '결로 인지' ? 'red' : 'green'}; font-weight: bold;">${info.product}</td>
                    <td>
                        <span class="risk-badge ${getRiskLevelTextClass(info.riskLabel)}">
                            ${info.riskLabel}
                        </span>
                    </td>
                </tr>
            `;
        });
    });

    if (tableRows === '') {
        alert('상세 정보를 찾을 수 없습니다.');
        return;
    }

    tbody.innerHTML = tableRows;
    document.getElementById('report-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('report-modal').style.display = 'none';
}

function viewAllLogs() {
    const fullLogBody = document.getElementById('full-log-body');
    fullLogBody.innerHTML = monitoringLogs.map(log => `
        <tr>
            <td>${log.time}</td>
            <td>${log.location}</td>
            <td>${log.steel}</td>
            <td>${log.indoor}</td>
            <td>${log.outdoor}</td>
            <td>${log.dp}</td>
            <td><span class="risk-badge ${getRiskLevelTextClass(log.risk)}">${log.risk}</span></td>
        </tr>
    `).join('');
    document.getElementById('log-modal').style.display = 'block';
}

function closeLogModal() {
    document.getElementById('log-modal').style.display = 'none';
}

// ========== 12. 캘린더 ==========
function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendar();
}

function renderCalendar() {
    const container = document.getElementById('calendar-container');
    const headerTitle = document.getElementById('calendar-month-year');
    if (!container || !headerTitle) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    headerTitle.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = getLocalDateString();

    let html = `
        <div class="calendar-grid">
            <div class="calendar-day-header">일</div>
            <div class="calendar-day-header">월</div>
            <div class="calendar-day-header">화</div>
            <div class="calendar-day-header">수</div>
            <div class="calendar-day-header">목</div>
            <div class="calendar-day-header">금</div>
            <div class="calendar-day-header">토</div>
    `;

    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = dateStr === today ? 'today' : '';
        const dayRecords = allReports[dateStr] || {};
        const recordSlots = Object.keys(dayRecords).sort();

        let badgesHtml = '';
        recordSlots.forEach(slot => {
            const slotShort = slot.replace(':', '');
            const displayTime = slot === '07:00' ? '7시' : (slot === '15:00' ? '15시' : slot);
            badgesHtml += `<div class="mini-badge b-${slotShort}" onclick="event.stopPropagation(); viewReportDetails('${slot}', '${dateStr}')">${displayTime}</div>`;
        });

        html += `
            <div class="calendar-day ${isToday}" onclick="${recordSlots.length > 0 ? `viewReportDetails(null, '${dateStr}')` : ''}">
                <div class="day-number">${d}</div>
                <div class="day-records">
                    ${badgesHtml}
                </div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderHistory() {
    renderCalendar();
}

// ========== 13. 뷰 관리 ==========
function toggleView(view) {
    const dashboardView = document.getElementById('dashboard-view');
    const forecastView = document.getElementById('forecast-view');
    const historyView = document.getElementById('history-view');

    const navDashboard = document.getElementById('nav-dashboard');
    const navForecast = document.getElementById('nav-forecast');
    const navHistory = document.getElementById('nav-history');

    // 뷰 초기화
    if (dashboardView) dashboardView.classList.remove('active');
    if (forecastView) forecastView.classList.remove('active');
    if (historyView) historyView.classList.remove('active');

    if (navDashboard) navDashboard.classList.remove('active');
    if (navForecast) navForecast.classList.remove('active');
    if (navHistory) navHistory.classList.remove('active');

    // 선택된 뷰 활성화
    if (view === 'dashboard') {
        if (dashboardView) dashboardView.classList.add('active');
        if (navDashboard) navDashboard.classList.add('active');
    } else if (view === 'forecast') {
        if (forecastView) forecastView.classList.add('active');
        if (navForecast) navForecast.classList.add('active');
        updateWeeklyForecast();
    } else if (view === 'history') {
        if (historyView) historyView.classList.add('active');
        if (navHistory) navHistory.classList.add('active');
        updateCondensationHistory();
    }
}

function updateCondensationHistory() {
    const tbody = document.getElementById('history-log-body');
    const msg = document.getElementById('history-message');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (msg) {
        msg.textContent = '데이터를 분석 중입니다...';
        msg.style.display = 'block';
    }

    setTimeout(() => {
        const historyData = [];

        // 1. 모니터링 로그(monitoringLogs)에서 '수동 입력(manual_history)'된 항목만 추출
        // (단순 위험 수치 도달 건은 관리자가 실제 발생여부를 확인한 것이 아니므로 제외)
        if (monitoringLogs && monitoringLogs.length > 0) {
            monitoringLogs.forEach(log => {
                if (log.source === 'manual_history') {
                    historyData.push({
                        id: log.timestamp || new Date(log.time).getTime(),
                        dateStr: log.time,
                        location: log.location,
                        outTemp: log.outdoor || '-',
                        outData: (log.outdoorTemp !== undefined && log.outdoorHum !== undefined) ? `${log.outdoorTemp}°C/${log.outdoorHum}%` : null,
                        inTemp: log.temp,
                        inHumid: log.humidity,
                        dewPoint: log.dp,
                        steelTemp: log.steel,
                        diff: log.tempDiff !== undefined ? log.tempDiff : '-',
                        reason: log.riskReason || '관리자 등록 이력'
                    });
                }
            });
        }

        if (allReports) {
            Object.keys(allReports).forEach(date => {
                const dayReport = allReports[date];
                Object.keys(dayReport).forEach(slotKey => {
                    const report = dayReport[slotKey];
                    if (report && report.snapshot) {
                        Object.keys(report.snapshot).forEach(loc => {
                            const snap = report.snapshot[loc];
                            if (snap.product === '결로 인지') {
                                const outStr = (report.outdoor && typeof report.outdoor === 'object') ?
                                    `${report.outdoor.temp}°C/${report.outdoor.humidity}%` :
                                    (report.outdoor || '-');

                                historyData.push({
                                    id: `snap-${date}-${slotKey}-${loc}`,
                                    dateStr: `${date} ${report.slot || '00:00'}`,
                                    location: loc,
                                    outTemp: outStr,
                                    inTemp: '-',
                                    inHumid: '-',
                                    dewPoint: snap.dp || '-',
                                    steelTemp: snap.steel || '-',
                                    diff: '-',
                                    reason: '관리자 육안 식별(결로 인지)'
                                });
                            }
                        });
                    }
                });
            });
        }

        // 날짜 내림차순 정렬
        historyData.sort((a, b) => {
            const dateA = new Date(a.dateStr.replace(' ', 'T'));
            const dateB = new Date(b.dateStr.replace(' ', 'T'));
            return dateB - dateA;
        });

        // 렌더링
        if (historyData.length === 0) {
            if (msg) msg.textContent = '저장된 결로 발생 이력이 없습니다.';
        } else {
            if (msg) msg.style.display = 'none';
            tbody.innerHTML = historyData.map(item => {
                const isAdminUI = isAdmin ? `
                    <td class="admin-only">
                        <button onclick="editPastRecord('${item.id}')" class="btn-mini">수정</button>
                        <button onclick="deletePastRecord('${item.id}')" class="btn-mini btn-danger">삭제</button>
                    </td>
                ` : '<td class="admin-only">-</td>';

                return `
                    <tr>
                        <td>${item.dateStr}</td>
                        <td>${item.location}</td>
                        <td>${item.outData || item.outTemp}</td>
                        <td>${item.inTemp}</td>
                        <td>${item.inHumid}</td>
                        <td>${item.dewPoint}</td>
                        <td>${item.steelTemp}</td>
                        <td>${item.diff}</td>
                        <td><span class="status-danger" style="font-size: 0.8em; padding: 2px 5px; border-radius: 4px;">${item.reason}</span></td>
                        ${isAdminUI}
                    </tr>
                `;
            }).join('');
        }
    }, 500);
}

function formatSnapshotTime(time, slot) {
    if (!time || time === '-') return slot;
    return time;
}

// 배풍기/열풍기 가동 판단 및 결로 위험도 평가 함수 (습도 반영)
function determineFanHeaterOperation(minTemp, maxTemp, amRainProb, pmRainProb, humidity) {
    // V2 로직으로 통합하여 처리
    return determineFanHeaterOperationV2(minTemp, maxTemp, amRainProb, pmRainProb, humidity);
}


// ========== 14. 이벤트 리스너 ==========
function setupEventListeners() {
    // 계산하기 버튼
    if (elements.calculateBtn) {
        elements.calculateBtn.addEventListener('click', async () => {
            const loc = elements.locationSelect.value;
            const st = parseFloat(elements.steelTempInput.value);
            const it = parseFloat(elements.tempInput.value);
            const h = parseFloat(elements.humidityInput.value);

            if (isNaN(st) || isNaN(it) || isNaN(h)) {
                alert('모든 온도와 습도를 정확히 입력해주세요.');
                return;
            }

            // 중복 데이터 입력 확인 (오늘 날짜로 이미 입력된 경우)
            if (latestLocationStatus[loc] && latestLocationStatus[loc].dateStr === getLocalDateString()) {
                const lastTime = latestLocationStatus[loc].time;
                // 사용자 요청: 이미 입력되어 있으면 수정할 것인지 팝업
                if (!confirm(`'${loc}'의 데이터가 이미 입력되어 있습니다 (${lastTime}).\n새로운 값으로 수정하시겠습니까?`)) {
                    return;
                }
            }

            // 실외 온도/습도: 사용자가 수정한 값 우선 사용, 없으면 API 업데이트
            let outdoorTemp = parseFloat(document.getElementById('outdoor-temp-input').value);
            let outdoorHum = parseFloat(document.getElementById('outdoor-humidity-input').value);

            if (isNaN(outdoorTemp) || isNaN(outdoorHum)) {
                const weather = await updateWeatherData();
                if (isNaN(outdoorTemp)) outdoorTemp = weather.temp;
                if (isNaN(outdoorHum)) outdoorHum = weather.humidity;
            }
            updateUI(loc, st, it, h, outdoorTemp, outdoorHum);
        });
    }

    // 로그 삭제 버튼
    if (elements.clearBtn) {
        elements.clearBtn.addEventListener('click', () => {
            if (confirm('모든 로그 기록을 삭제하시겠습니까?')) {
                monitoringLogs = [];
                localStorage.removeItem('seah_logs');
                renderLogs();
            }
        });
    }

    // 위치별 상태 토글
    if (elements.locationStatusList) {
        elements.locationStatusList.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-location][data-field]');
            if (button) {
                const location = button.getAttribute('data-location');
                const field = button.getAttribute('data-field');
                toggleLocationStatus(location, field);
            }
        });
    }

    // 날짜 변경 이벤트
    const globalDateInput = document.getElementById('report-date');
    const statusDateInput = document.getElementById('status-inspection-date');

    if (statusDateInput && globalDateInput) {
        statusDateInput.value = globalDateInput.value;
        statusDateInput.addEventListener('change', (e) => {
            globalDateInput.value = e.target.value;
            updateTimedReportStatus();
        });
    }

    if (globalDateInput) {
        globalDateInput.addEventListener('change', (e) => {
            if (statusDateInput) statusDateInput.value = e.target.value;
            updateTimedReportStatus();
        });
    }

    // 모달 닫기
    window.onclick = function (event) {
        const modal = document.getElementById('report-modal');
        if (event.target == modal) {
            closeModal();
        }
    };
}

// ========== 15. 초기화 ==========
function init() {
    console.log('=== 앱 초기화 시작 ===');

    // 날짜 설정
    const todayStr = getLocalDateString();
    if (elements.reportDate) {
        elements.reportDate.value = todayStr;
    }

    // 시계 업데이트
    if (elements.currentTime) {
        setInterval(() => {
            elements.currentTime.textContent = new Date().toLocaleString();
        }, 1000);
    }

    // 날씨 업데이트 (1시간마다)
    setInterval(() => {
        updateWeatherData();
    }, 3600000);

    // 초기 날씨 로드
    updateWeatherData();

    // 시간대별 초기값 설정
    if (elements.reportTime) {
        const hour = new Date().getHours();
        if (hour >= 6 && hour < 10) {
            elements.reportTime.value = '07:00';
        } else if (hour >= 14 && hour < 18) {
            elements.reportTime.value = '15:00';
        } else {
            elements.reportTime.value = '실시간';
        }
    }

    // 데이터 로드 (Firebase 또는 로컬스토리지)
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const db = firebase.database();

        db.ref('logs').limitToLast(10).on('value', snapshot => {
            const data = snapshot.val();
            if (data) {
                monitoringLogs = Object.values(data).reverse();
                renderLogs();
            }
        });

        db.ref(`reports/${todayStr}`).on('value', snapshot => {
            updateTimedReportStatus();
        });

        db.ref('locationStatus').on('value', snapshot => {
            latestLocationStatus = snapshot.val() || {};
            renderLocationSummary();
        });

        db.ref('reports').on('value', snapshot => {
            allReports = snapshot.val() || {};
            renderHistory();
            updateTimedReportStatus();
            renderLocationSummary();
        });

        // 기상청 API 키 설정 가져오기 (단기예보 + 중기예보)
        db.ref('settings/kma_short_api_key').on('value', snapshot => {
            const val = snapshot.val();
            if (val) {
                console.log('Firebase에서 단기예보 API 키를 성공적으로 로드했습니다.');
                kmaShortApiKey = val;
                // 키가 업데이트되면 날씨 정보 다시 불러오기
                updateWeatherData();
            } else {
                console.warn('Firebase에 단기예보 API 키가 설정되지 않았습니다. settings/kma_short_api_key 경로에 키를 추가해주세요.');
            }
        });

        db.ref('settings/kma_mid_api_key').on('value', snapshot => {
            const val = snapshot.val();
            if (val) {
                console.log('Firebase에서 중기예보 API 키를 성공적으로 로드했습니다.');
                kmaMidApiKey = val;
            } else {
                console.warn('Firebase에 중기예보 API 키가 설정되지 않았습니다. settings/kma_mid_api_key 경로에 키를 추가해주세요.');
            }
        });
    } else {
        // 로컬스토리지에서 로드
        monitoringLogs = JSON.parse(localStorage.getItem('seah_logs')) || [];
        allReports = JSON.parse(localStorage.getItem('seah_all_reports')) || {};
        latestLocationStatus = JSON.parse(localStorage.getItem('seah_location_status')) || {};

        renderLogs();
        renderLocationSummary();
        renderHistory();
        updateTimedReportStatus();
    }

    // 관리자 UI 적용
    applyAdminUI();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 뷰 설정
    toggleView('dashboard');

    console.log('=== 앱 초기화 완료 ===');

    // ========== 자동 업데이트 스케줄러 ==========
    // 1. 실시간 날씨 및 대시보드 시계: 1분마다 업데이트 (시계용), 날씨는 30분마다
    let minuteCount = 0;
    setInterval(() => {
        minuteCount++;
        // 현재 시각 업데이트 (대시보드 상단)
        updateCurrentTime();

        // 30분마다 날씨 업데이트
        if (minuteCount % 30 === 0) {
            console.log('⏰ 실시간 날씨 자동 갱신');
            updateWeatherData();
        }

        // 60분(1시간)마다 주간 예보 업데이트 체크
        if (minuteCount % 60 === 0) {
            console.log('⏰ 주간 예보 자동 갱신 체크');
            updateWeeklyForecast();
        }
    }, 60 * 1000); // 1분 주기로 실행
}

// ========== 16. 주간 예보 (D+1 ~ D+7) ==========
// 기상청 API 호출 도우미: 응답 코드에 따라 이전 base_time 시도
async function fetchWithBaseTimeSearch(baseUrl, getParams, initialBaseTime, serviceKey) {
    const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
    let currentIdx = baseTimes.indexOf(parseInt(initialBaseTime));
    if (currentIdx === -1) currentIdx = 0;

    for (let i = currentIdx; i < baseTimes.length; i++) {
        const bt = String(baseTimes[i]).padStart(2, '0') + '00';
        const targetBaseUrl = baseUrl.replace('http://', 'https://');
        const url = `${targetBaseUrl}?serviceKey=${serviceKey}&${getParams(bt)}`;
        console.log(`기상청 API 시도 중: ${bt}...`);

        try {
            const res = await requestKma(url);
            if (res?.response?.header?.resultCode === '00') {
                return res;
            }
            console.warn(`기상청 API(${bt}) 결과 코드: ${res?.response?.header?.resultCode}`);
        } catch (e) {
            console.error(`기상청 API(${bt}) 호출 에러:`, e);
        }
    }
    return null;
}

// 주간 예보 강제 새로고침 함수
async function refreshWeeklyForecast() {
    console.log('🔄 사용자가 주간 예보 새로고침 요청');

    // 캐시 초기화
    cachedForecast = null;

    // Firebase 캐시도 삭제
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        try {
            await firebase.database().ref('cachedForecast').remove();
            console.log('🗑️ Firebase 캐시 삭제 완료');
        } catch (e) {
            console.warn('Firebase 캐시 삭제 실패:', e);
        }
    }

    // 새로운 데이터 가져오기
    await updateWeeklyForecast();
}

async function updateWeeklyForecast() {
    const grid = document.getElementById('weekly-forecast-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="text-center" style="grid-column: span 7;">7일 예보 데이터를 확인 중입니다...</p>';

    try {
        const todayStr = getLocalDateString().replace(/-/g, '');
        // 단기예보와 중기예보 키 확인
        const SHORT_API_KEY = kmaShortApiKey;
        const MID_API_KEY = kmaMidApiKey;

        // API 키 검증 먼저 수행
        if (!SHORT_API_KEY || SHORT_API_KEY.length < 10) {
            console.error('❌ 단기예보 API 키가 설정되지 않았습니다.');
            grid.innerHTML = `
                <p class="text-center" style="grid-column: span 7; color: #ff4444; padding: 20px;">
                    ⚠️ 기상청 API 키가 설정되지 않았습니다.<br><br>
                    <strong>Firebase Console</strong>에서 다음 경로에 API 키를 추가해주세요:<br>
                    <code style="background: #f0f0f0; padding: 5px 10px; border-radius: 4px;">
                        settings/kma_short_api_key
                    </code><br><br>
                    자세한 내용은 <strong>FIREBASE_API_SETUP.md</strong> 파일을 참고하세요.
                </p>
            `;
            return;
        }

        if (!MID_API_KEY || MID_API_KEY.length < 10) {
            console.warn('⚠️ 중기예보 API 키가 설정되지 않았습니다. 단기예보 데이터만 사용합니다.');
        }

        console.log('✅ API 키 확인 완료');
        console.log(`📅 오늘 날짜: ${todayStr}`);

        // 1. 전역 메모리 캐시 확인 (가장 빠름)
        if (cachedForecast) {
            console.log('📦 메모리 캐시 사용 (즉시 로드)');
            displayWeeklyForecast(cachedForecast);
            updateManagementGuide(cachedForecast);
            return;
        }

        // 2. Firebase 캐시 확인
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            const db = firebase.database();
            const snapshot = await db.ref('cachedForecast').once('value');
            const data = snapshot.val();

            if (data && data.date === todayStr) {
                // 습도 정보가 포함된 최신 형식의 캐시인지 확인
                const isUpdatedCache = data.forecast && data.forecast.length > 0 && ('humidity' in data.forecast[0]);

                if (isUpdatedCache) {
                    console.log('📦 Firebase 캐시 사용 (오늘 날짜 및 습도 정보 포함)');
                    console.log(`   캐시 생성 시각: ${new Date(data.timestamp).toLocaleString()}`);
                    cachedForecast = data.forecast;
                    displayWeeklyForecast(cachedForecast);
                    updateManagementGuide(cachedForecast);
                    return;
                } else {
                    console.log('🔄 캐시 데이터가 구형(습도 정보 없음)이므로 새로고침을 시도합니다.');
                }
            } else if (data) {
                console.log(`🔄 캐시 날짜 불일치 (캐시: ${data.date}, 오늘: ${todayStr}) - 새로운 데이터 가져오기`);
            }
        }

        // 3. 캐시가 없거나 날짜가 지난 경우 API 호출
        console.log('🌐 기상청 API 호출 시작...');
        grid.innerHTML = '<p class="text-center" style="grid-column: span 7;">기상청 최신 데이터를 가져오는 중입니다 (최대 10초 소요)...</p>';

        const freshForecast = await fetchIntegratedWeeklyForecast(SHORT_API_KEY, MID_API_KEY);

        if (freshForecast && freshForecast.length > 0) {
            console.log(`✅ 예보 데이터 ${freshForecast.length}일치 로드 완료`);
            cachedForecast = freshForecast;

            // 4. Firebase에 캐시 저장
            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                await firebase.database().ref('cachedForecast').set({
                    date: todayStr,
                    forecast: freshForecast,
                    timestamp: Date.now()
                });
                console.log('💾 Firebase에 캐시 저장 완료');
            }

            displayWeeklyForecast(freshForecast);
            updateManagementGuide(freshForecast);
        } else {
            console.error('❌ 예보 데이터를 가져오지 못했습니다.');
            grid.innerHTML = '<p class="text-center" style="grid-column: span 7; color: #ff4444;">예보 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
        }
    } catch (e) {
        console.error('❌ Forecast Update Failed:', e);
        grid.innerHTML = `
            <p class="text-center" style="grid-column: span 7; color: #ff4444;">
                데이터 로드 실패<br>
                <small>${e.message || '알 수 없는 오류'}</small><br><br>
                API 키 및 네트워크 연결을 확인해주세요.
            </p>
        `;
    }
}

async function fetchIntegratedWeeklyForecast(shortApiKey, midApiKey) {
    // 세아씨엠 위치: 전라북도 군산시 자유로 241 (소룡동)
    // 기상청 격자 좌표: nx=56, ny=92
    const nx = 56, ny = 92; // 군산 세아씨엠 (소룡동)
    const regIdTa = '11F20503'; // 군산 - 중기기온예보
    const regIdLand = '11F20000'; // 전북 - 중기육상예보
    const todayStr = getLocalDateString().replace(/-/g, '');
    const now = new Date();

    // API 키 검증
    if (!shortApiKey || shortApiKey.length < 10) {
        console.error('단기예보 API 키가 설정되지 않았습니다.');
        return generateMockWeeklyForecast();
    }
    if (!midApiKey || midApiKey.length < 10) {
        console.warn('중기예보 API 키가 설정되지 않았습니다. 단기예보 데이터만 사용합니다.');
    }

    const encodedShortKey = encodeURIComponent(shortApiKey);
    const encodedMidKey = midApiKey ? encodeURIComponent(midApiKey) : null;

    console.log('=== 주간 예보 API 호출 시작 ===');
    console.log('위치: 군산 세아씨엠 (소룡동)');
    console.log(`격자 좌표: nx=${nx}, ny=${ny}`);
    console.log(`기준 날짜: ${todayStr}`);
    console.log(`현재 시각: ${now.toLocaleString()}`);

    // 1. 단기예보 D+1 ~ D+5 (발표시간에 따라 D+4 또는 D+5)
    const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
    let fcstBaseTime = 2, fcstBaseDate = todayStr;
    if (now.getHours() < 2 || (now.getHours() === 2 && now.getMinutes() < 15)) {
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        fcstBaseDate = yesterday.toISOString().split('T')[0].replace(/-/g, '');
        fcstBaseTime = 23;
    } else {
        for (const t of baseTimes) {
            if (now.getHours() > t || (now.getHours() === t && now.getMinutes() > 15)) {
                fcstBaseTime = t; break;
            }
        }
    }
    // 1. 단기예보 D+1 ~ D+3
    const getShortParams = (bt) => `dataType=JSON&base_date=${fcstBaseDate}&base_time=${bt}&nx=${nx}&ny=${ny}&numOfRows=1200`;
    const shortRes = await fetchWithBaseTimeSearch(
        'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',
        getShortParams,
        fcstBaseTime,
        encodedShortKey
    );

    // 2. 중기예보 D+4 ~ D+10 (발표시간 06:00, 18:00)
    // 중기예보는 발표 시각이 고정되어 있으므로 검색 로직 대신 정확한 시각 시도
    let midTaRes = null, midLandRes = null;

    if (encodedMidKey) {
        let midTmFc = now.getHours() < 18 ? `${todayStr}0600` : `${todayStr}1800`;
        let midTaUrl = `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?serviceKey=${encodedMidKey}&dataType=JSON&regId=${regIdTa}&tmFc=${midTmFc}`;
        let midLandUrl = `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?serviceKey=${encodedMidKey}&dataType=JSON&regId=${regIdLand}&tmFc=${midTmFc}`;

        const midFetch = async (url) => {
            return await requestKma(url);
        };

        [midTaRes, midLandRes] = await Promise.all([
            midFetch(midTaUrl),
            midFetch(midLandUrl)
        ]);

        // 06:00 데이터가 아직 없을 경우 어제 18:00 데이터 시도
        if (midTaRes?.response?.header?.resultCode !== '00' && now.getHours() < 18) {
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            const yestStr = getLocalDateString(yesterday).replace(/-/g, '');
            midTmFc = `${yestStr}1800`;
            midTaUrl = `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?serviceKey=${encodedMidKey}&dataType=JSON&regId=${regIdTa}&tmFc=${midTmFc}`;
            midLandUrl = `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?serviceKey=${encodedMidKey}&dataType=JSON&regId=${regIdLand}&tmFc=${midTmFc}`;

            [midTaRes, midLandRes] = await Promise.all([
                midFetch(midTaUrl),
                midFetch(midLandUrl)
            ]);
        }
    } else {
        console.warn('중기예보 API 키가 없어 중기예보 데이터를 가져오지 않습니다.');
    }

    const result = [];

    // 기준 날짜 설정 (오늘과 내일)
    // todayStr은 이미 함수 상단에서 getLocalDateString()으로 구함
    const todayObj = new Date(todayStr.substring(0, 4), parseInt(todayStr.substring(4, 6)) - 1, todayStr.substring(6, 8));
    const tomorrow = new Date(todayObj);
    tomorrow.setDate(todayObj.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0].replace(/-/g, '');

    console.log(`기상청 API 연동 기준일: 오늘=${todayStr}, 내일(D+1)=${tomorrowStr}`);

    // [단기 데이터 매핑] D+1 ~ D+3
    const shortMap = {};
    if (shortRes?.response?.header?.resultCode === '00') {
        shortRes.response.body.items.item.forEach(item => {
            const dateStr = item.fcstDate;
            const d = new Date(dateStr.substring(0, 4), parseInt(dateStr.substring(4, 6)) - 1, dateStr.substring(6, 8));

            // D+1 (내일)부터의 데이터만 사용 (오늘 데이터 제외가 원칙)
            if (dateStr < tomorrowStr) return;

            if (!shortMap[dateStr]) {
                shortMap[dateStr] = { date: d, dateStr: dateStr, temps: [], pops: [], pty: [], sky: [], hums: [] };
            }
            if (item.category === 'TMP') shortMap[dateStr].temps.push(parseFloat(item.fcstValue));
            if (item.category === 'POP') shortMap[dateStr].pops.push(parseInt(item.fcstValue));
            if (item.category === 'PTY') shortMap[dateStr].pty.push(parseInt(item.fcstValue));
            if (item.category === 'SKY') shortMap[dateStr].sky.push(parseInt(item.fcstValue));
            if (item.category === 'REH') {
                const val = parseFloat(item.fcstValue);
                if (!isNaN(val)) shortMap[dateStr].hums.push(val);
            }
        });
    }

    // 단기 데이터로 result 채우기
    Object.keys(shortMap).sort().forEach(dateStr => {
        const day = shortMap[dateStr];
        // 온도 데이터가 충분치 않으면 스킵
        if (day.temps.length === 0) return;

        const min = Math.min(...day.temps);
        const max = Math.max(...day.temps);
        const avgHum = day.hums.length > 0 ? Math.round(day.hums.reduce((a, b) => a + b, 0) / day.hums.length) : null;
        const amPop = day.pops.length > 0 ? (day.pops.length > 8 ? Math.max(...day.pops.slice(6, 12)) : Math.max(...day.pops)) : 0;
        const pmPop = day.pops.length > 0 ? (day.pops.length > 12 ? Math.max(...day.pops.slice(12, 18)) : Math.max(...day.pops)) : 0;
        const op = determineFanHeaterOperationV2(min, max, amPop, pmPop);

        result.push({
            date: day.date,
            dateStr: dateStr,
            minTemp: min,
            maxTemp: max,
            humidity: avgHum,
            amRainProb: amPop,
            pmRainProb: pmPop,
            weatherType: mapDetailedWeather(day.sky, day.pty),
            locationName: "군산 세아씨엠(단기)",
            ...op
        });
    });

    console.log(`단기예보 연동 결과: ${result.length}일치 (${result.map(r => r.dateStr).join(', ')})`);

    // [중기 데이터 보완] D+3 ~ D+7 (단기예보 이후부터 채움)
    if (midTaRes?.response?.header?.resultCode === '00' && midLandRes?.response?.header?.resultCode === '00') {
        const ta = midTaRes.response.body.items.item[0];
        const land = midLandRes.response.body.items.item[0];

        // 마지막으로 채워진 날짜 확인
        let lastDateObj = result.length > 0 ? new Date(result[result.length - 1].date) : new Date(todayObj);

        // 7일치를 채울 때까지 반복
        while (result.length < 7) {
            // 다음 날짜 계산
            const nextDate = new Date(lastDateObj);
            nextDate.setDate(lastDateObj.getDate() + 1);
            lastDateObj = nextDate; // 갱신

            const nextDateStr = nextDate.toISOString().split('T')[0].replace(/-/g, '');

            // 오늘로부터 며칠 후인지 계산 (D+N) - 시간 정보 제거 후 안전하게 계산
            const d1 = new Date(nextDate); d1.setHours(0, 0, 0, 0);
            const d2 = new Date(todayObj); d2.setHours(0, 0, 0, 0);
            const diffDays = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));

            // 중기예보는 3일 후 ~ 10일 후 데이터 제공
            if (diffDays >= 3 && diffDays <= 10) {
                try {
                    let min = parseFloat(ta[`taMin${diffDays}`]);
                    let max = parseFloat(ta[`taMax${diffDays}`]);

                    // 기온 데이터가 유효하지 않으면 N/A 처리
                    if (isNaN(min) || isNaN(max)) {
                        console.warn(`중기예보 데이터 누락 (D+${diffDays}): ${nextDateStr} - N/A 처리`);
                        min = null;
                        max = null;
                    }

                    // 3~7일후는 오전/오후 구분, 8~10일후는 하루 단위
                    let amPop = 0, pmPop = 0, wfStr = '';
                    if (diffDays <= 7) {
                        amPop = land[`rnSt${diffDays}Am`] !== undefined ? land[`rnSt${diffDays}Am`] : (land[`rnSt${diffDays}`] || 0);
                        pmPop = land[`rnSt${diffDays}Pm`] !== undefined ? land[`rnSt${diffDays}Pm`] : (land[`rnSt${diffDays}`] || 0);
                        wfStr = land[`wf${diffDays}Am`] || land[`wf${diffDays}`] || '';
                    } else {
                        // 8일 이후는 오전/오후 통합
                        amPop = land[`rnSt${diffDays}`] || 0;
                        pmPop = land[`rnSt${diffDays}`] || 0;
                        wfStr = land[`wf${diffDays}`] || '';
                    }

                    // min, max가 null이면 정보없음 처리
                    const op = (min === null || max === null)
                        ? { fan: false, heater: false, risk: '정보없음', reason: '데이터 부족' }
                        : determineFanHeaterOperationV2(min, max, amPop, pmPop);

                    result.push({
                        date: nextDate,
                        dateStr: nextDateStr,
                        minTemp: min,
                        maxTemp: max,
                        humidity: null, // 중기예보는 습도 정보 미제공
                        amRainProb: amPop,
                        pmRainProb: pmPop,
                        weatherType: mapMidStatus(wfStr),
                        locationName: "군산 세아씨엠(중기)",
                        ...op
                    });
                } catch (err) {
                    console.error(`중기예보 매핑 중 에러 (D+${diffDays}):`, err);
                }
            } else {
                console.log(`범위 밖 날짜 혹은 데이터 없음 (D+${diffDays}): ${nextDateStr}`);
                // 10일을 넘어가면 더 이상 데이터 없음
                if (diffDays > 10) break;
            }
        }
    }

    // 결과가 7일이 안될 경우 Mock 데이터로 보정 (최후의 수단)
    if (result.length < 7) {
        console.warn(`예보 데이터 부족 (${result.length}일). 부족분 Mock 데이터 생성.`);
        let lastDate = result.length > 0 ? new Date(result[result.length - 1].date) : new Date(tomorrow);
        while (result.length < 7) {
            lastDate.setDate(lastDate.getDate() + 1);
            const d = new Date(lastDate);
            const min = Math.floor(Math.random() * 5);
            const max = min + 7;
            const op = determineFanHeaterOperation(min, max, 20, 20);
            result.push({
                date: d,
                dateStr: d.toISOString().split('T')[0].replace(/-/g, ''),
                minTemp: min,
                maxTemp: max,
                amRainProb: 20,
                pmRainProb: 20,
                humidity: 60,
                weatherType: 'sunny',
                ...op
            });
        }
    }

    // 최종 결과 로깅
    console.log('=== 주간 예보 최종 결과 ===');
    console.log(`총 ${result.length}일치 예보 데이터`);

    // date 객체가 직렬화 중 유실될 수 있으므로 정규화 처리
    const normalizedResult = result.slice(0, 7).map(day => ({
        ...day,
        date: day.date instanceof Date ? day.date.getTime() : day.date
    }));

    normalizedResult.forEach((day, idx) => {
        const d = new Date(day.date);
        console.log(`D+${idx + 1}: ${day.dateStr} (${d.toLocaleDateString()}) - 최저 ${day.minTemp}°C / 최고 ${day.maxTemp}°C`);
    });

    return normalizedResult;
}

function mapDetailedWeather(skyArr, ptyArr) {
    if (!ptyArr || ptyArr.length === 0) return 'sunny';

    // 비/눈 우선 순위 (눈 > 비 > 구름)
    if (ptyArr.includes(3) || ptyArr.includes(7)) return 'snow';
    if (ptyArr.some(p => [1, 2, 4, 5, 6].includes(p))) return 'rain-light';

    const sky = skyArr && skyArr.length > 0 ? skyArr[Math.floor(skyArr.length / 2)] : 1;
    if (sky === 1) return 'sunny';
    if (sky === 3) return 'cloudy';
    if (sky === 4) return 'cloudy-heavy';
    return 'sunny';
}

function mapMidStatus(wf) {
    if (!wf) return 'sunny';
    if (wf.includes('눈') || wf.includes('진눈깨비')) return 'snow';
    if (wf.includes('비')) return 'rain-light';
    if (wf.includes('흐림')) return 'cloudy-heavy';
    if (wf.includes('구름많음')) return 'cloudy';
    return 'sunny';
}

function generateMockWeeklyForecast() {
    const forecast = [];
    const base = new Date(); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + 1);
    for (let i = 0; i < 7; i++) {
        const d = new Date(base); d.setDate(base.getDate() + i);
        const min = Math.floor(Math.random() * 8) - 4;
        const max = min + Math.floor(Math.random() * 8) + 5;
        const op = determineFanHeaterOperation(min, max, 20, 20);
        forecast.push({
            date: d,
            minTemp: min,
            maxTemp: max,
            amRainProb: 20,
            pmRainProb: 20,
            humidity: 60 + Math.floor(Math.random() * 20),
            weatherType: 'sunny',
            ...op
        });
    }
    return forecast;
}

function displayWeeklyForecast(forecast) {
    const grid = document.getElementById('weekly-forecast-grid');
    if (!grid) return;

    grid.innerHTML = forecast.slice(0, 7).map(day => {
        const d = new Date(day.date);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}(${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]})`;
        const riskClass = day.risk === '안전' ? 'status-safe' : 'status-caution';
        return `
            <div class="forecast-day-card">
                <h4>${dateStr}</h4>
                <div class="forecast-icon icon-${day.weatherType}"></div>
                <div class="forecast-temp">
                    <span class="temp-min">${typeof day.minTemp === 'number' ? day.minTemp.toFixed(1) + '°' : 'N/A'}</span>
                    <span class="temp-max">${typeof day.maxTemp === 'number' ? day.maxTemp.toFixed(1) + '°' : 'N/A'}</span>
                </div>
                <div class="forecast-rain">
                    <div class="rain-item"><span class="rain-label">오전</span><span class="rain-prob">${typeof day.amRainProb === 'number' ? day.amRainProb + '%' : '-'}</span></div>
                    <div class="rain-item"><span class="rain-label">오후</span><span class="rain-prob">${typeof day.pmRainProb === 'number' ? day.pmRainProb + '%' : '-'}</span></div>
                </div>
                <div class="forecast-humidity">
                    <span class="hum-label">평균습도</span>
                    <span class="hum-val">${(day.humidity !== undefined && day.humidity !== null) ? day.humidity + '%' : '--%'}</span>
                </div>
                <div class="equipment-status">
                    <button class="equipment-btn ${day.fan ? 'active' : ''}" title="${day.reason}" disabled>배풍기</button>
                    <button class="equipment-btn ${day.heater ? 'active active-heater' : ''}" title="${day.reason}" disabled>열풍기</button>
                </div>
                <div class="forecast-risk ${riskClass}">${day.risk}</div>
            </div>
        `;
    }).join('');
}

function updateManagementGuide(forecast) {
    const guide = document.getElementById('weekly-management-guide');
    if (!guide) return;
    const cautionCount = forecast.filter(d => d.risk === '주의').length;
    guide.textContent = cautionCount > 0 ? `향후 7일간 ${cautionCount}일의 결로 주의 기간이 예상됩니다. 설비 가동 준비를 권장합니다.` : '향후 7일간 결로 위험이 낮습니다. 정기 점검을 유지해 주세요.';
}

// 페이지 로드 시 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========== 17. 설정 관리 ==========
function openSettingModal() {
    if (!isAdmin) {
        alert('관리자만 접근할 수 있습니다.');
        return;
    }
    document.getElementById('setting-modal').style.display = 'block';
}

function closeSettingModal() {
    document.getElementById('setting-modal').style.display = 'none';
}

function saveSettings() {
    // 더 이상 브라우저에서 직접 수정하지 않으므로 저장 로직 제거
    alert('설정 정보는 시스템 관리자(Firebase)를 통해 관리됩니다.');
    closeSettingModal();
}

// ========== 18. 과거 이력 관리 (History) ==========
function openPastRecordModal(editId = null) {
    const modal = document.getElementById('past-record-modal');
    const locSelect = document.getElementById('past-location');
    const dateInput = document.getElementById('past-date');
    const idInput = document.getElementById('past-record-id');
    const submitBtn = document.getElementById('past-record-submit-btn');
    if (!modal) return;

    if (locSelect && locSelect.options.length === 0) {
        WAREHOUSE_LOCATIONS.forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc;
            opt.textContent = loc;
            locSelect.appendChild(opt);
        });
    }

    if (editId) {
        // 수정 모드
        const log = monitoringLogs.find(l => (l.timestamp && l.timestamp.toString() === editId) || (new Date(l.time).getTime().toString() === editId));
        if (log) {
            idInput.value = editId;
            dateInput.value = log.time.replace(' ', 'T').slice(0, 16);
            locSelect.value = log.location;
            document.getElementById('past-outdoor').value = log.outdoorTemp || parseFloat(log.outdoor);
            document.getElementById('past-outdoor-humid').value = log.outdoorHum || "";
            document.getElementById('past-steel').value = log.steel;
            document.getElementById('past-indoor').value = log.temp;
            document.getElementById('past-humid').value = log.humidity;
            submitBtn.textContent = '수정완료';
        }
    } else {
        // 등록 모드
        idInput.value = '';
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localIso = new Date(now.getTime() - offset).toISOString().slice(0, 16);
        dateInput.value = localIso;

        document.getElementById('past-outdoor').value = '';
        document.getElementById('past-outdoor-humid').value = '';
        document.getElementById('past-steel').value = '';
        document.getElementById('past-indoor').value = '';
        document.getElementById('past-humid').value = '';
        submitBtn.textContent = '등록하기';
    }
    modal.style.display = 'block';
}

function closePastRecordModal() {
    const modal = document.getElementById('past-record-modal');
    if (modal) modal.style.display = 'none';
}

function savePastRecord() {
    const editId = document.getElementById('past-record-id').value;
    const dateStr = document.getElementById('past-date').value;
    const location = document.getElementById('past-location').value;
    const outdoor = parseFloat(document.getElementById('past-outdoor').value);
    const outdoorHum = parseFloat(document.getElementById('past-outdoor-humid').value);
    const steel = parseFloat(document.getElementById('past-steel').value);
    const indoor = parseFloat(document.getElementById('past-indoor').value);
    const humid = parseFloat(document.getElementById('past-humid').value);

    if (!dateStr || isNaN(outdoor) || isNaN(steel) || isNaN(indoor) || isNaN(humid)) {
        alert('모든 입력 항목을 정확히 작성해주세요. (외기습도는 비워둘 수 있습니다만 권장됩니다)');
        // 외기습도는 필수 아님 처리 가능하지만 일단 alert
    }

    const b = 17.62; const c = 243.12;
    const gamma = (b * indoor) / (c + indoor) + Math.log(humid / 100.0);
    const dp = (c * gamma) / (b - gamma);
    const dpFixed = dp.toFixed(1);

    let risk = { label: '안전', class: 'status-safe' };
    let reason = '정상 범위';

    if (steel <= dp + 2) {
        risk = { label: '위험', class: 'status-danger' };
        reason = '결로 발생 위험 (강판온도 ≤ 이슬점+2℃)';
    } else if (steel <= dp + 5) {
        risk = { label: '주의', class: 'status-caution' };
        reason = '결로 주의 (강판온도 근접)';
    }

    const newLog = {
        time: dateStr.replace('T', ' ') + ':00',
        location: location,
        temp: indoor,
        humidity: humid,
        outdoor: `${outdoor}°C / ${isNaN(outdoorHum) ? '-' : outdoorHum}%`,
        outdoorTemp: outdoor,
        outdoorHum: isNaN(outdoorHum) ? 0 : outdoorHum,
        steel: steel,
        dp: dpFixed,
        tempDiff: (steel - dp).toFixed(1),
        risk: risk.label,
        riskClass: risk.class,
        riskReason: reason,
        source: 'manual_history',
        timestamp: editId ? parseInt(editId) : Date.now()
    };

    if (editId) {
        // 수정
        const index = monitoringLogs.findIndex(l => l.timestamp && l.timestamp.toString() === editId);
        if (index !== -1) {
            monitoringLogs[index] = newLog;
        } else {
            // 타임스탬프 없을 경우 시간으로 찾기
            const timeIndex = monitoringLogs.findIndex(l => new Date(l.time).getTime().toString() === editId);
            if (timeIndex !== -1) monitoringLogs[timeIndex] = newLog;
        }

        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            // Firebase 수정은 push가 아닌 해당 path에 set 해야 함. 
            // 여기서는 단순화를 위해 logs 전체를 다시 쓰거나, Push된 Key를 알아야 함.
            // 일단 Push로 새로 넣는 방식이 아닌, 기존 로직 유지하며 로컬 우선 처리
            firebase.database().ref('logs').push(newLog);
        }
    } else {
        // 신규
        monitoringLogs.unshift(newLog);
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            firebase.database().ref('logs').push(newLog);
        }
    }

    localStorage.setItem('seah_logs', JSON.stringify(monitoringLogs));
    alert(editId ? '기록이 수정되었습니다.' : '과거 결로 기록이 등록되었습니다.');
    closePastRecordModal();
    updateCondensationHistory();
}

function editPastRecord(id) {
    openPastRecordModal(id);
}

function deletePastRecord(id) {
    if (!confirm('정말 이 기록을 삭제하시겠습니까?')) return;

    monitoringLogs = monitoringLogs.filter(l => (l.timestamp && l.timestamp.toString() !== id) && (new Date(l.time).getTime().toString() !== id));
    localStorage.setItem('seah_logs', JSON.stringify(monitoringLogs));

    alert('기록이 삭제되었습니다.');
    updateCondensationHistory();
}

// 호환성 유지를 위한 더미 함수 (자동 업데이트 스케줄러에서 호출됨)
function updateCurrentTime() {
    // 이미 별도의 setInterval에서 처리 중이므로 비워둠
}

// 운영 기준 변경 적용 (배풍기: 일교차 10도 or 습도 90% / 열풍기: 이력 기반)
function determineFanHeaterOperationV2(minTemp, maxTemp, amRainProb, pmRainProb, humidity) {
    const maxRainProb = Math.max(amRainProb, pmRainProb);
    const tempDiff = maxTemp - minTemp;
    const avgHum = humidity || 60;

    let status = {
        fan: false,
        heater: false,
        risk: '안전',
        reason: '정상 범위'
    };

    // 1. 배풍기 가동 (Moderate Risk)
    // 일교차가 10℃ 이상이거나 습도가 90% 이상일 때
    if (tempDiff >= 10 || avgHum >= 90 || maxRainProb >= 50) {
        status.fan = true;
        status.risk = '주의';
        status.reason = avgHum >= 90 ? '고습도 환경(90%↑)으로 배풍기 가동 권장' : '큰 일교차(10℃↑)로 인한 배풍기 가동 권장';
    }

    // 2. 열풍기 가동 (High Risk - 과거 이력 기반)
    // 배풍기 가동 조건임에도 불구하고, 과거에 유사한 기온 조건에서 결로가 발생한 기록이 있는 경우
    if (typeof monitoringLogs !== 'undefined' && monitoringLogs.length > 0) {
        let matchCount = 0;
        const recentLogs = monitoringLogs.slice(0, 100);
        recentLogs.forEach(log => {
            // manual_history는 실제로 결로가 발생하여 관리자가 수동 등록한 기록임
            if (log.source === 'manual_history' && log.outdoor !== undefined) {
                const pastTemp = parseFloat(log.outdoor);
                // 오차범위 1도 내의 동일 기온 조건에서 발생 이력이 있는지 확인
                if (!isNaN(pastTemp) && pastTemp >= minTemp - 1 && pastTemp <= maxTemp + 1) {
                    matchCount++;
                }
            }
        });

        if (matchCount > 0) {
            status.heater = true;
            status.fan = false; // 열풍기 중점 가동
            status.risk = '위험';
            status.reason = `과거 동일 기온 결로 발생 이력 ${matchCount}건 (열풍기 상시 가동 권장)`;
        }
    }

    // 예외: 영하권 극한 추위는 예방 차원에서 주의 유지
    if (minTemp <= -5 && status.risk === '안전') {
        status.risk = '주의';
        status.reason = '극한 기온(-5℃↓)에 따른 선제적 모니터링 필요';
    }

    return status;
}

