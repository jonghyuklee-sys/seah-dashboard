// SeAH CM Condensation Monitor App - Rebuilt Version
// 간결하고 명확한 구조로 재작성

// ========== 1. 상수 및 설정 ==========
const CONFIG = {
    B: 17.27,
    C: 237.7
};

const WAREHOUSE_LOCATIONS = [
    "1CCL 원자재동", "1CCL 제품창고",
    "2CCL 원자재동", "2CCL 제품창고",
    "3CCL 원자재동", "3CCL 제품창고",
    "CGL 제품창고", "SSCL 제품창고"
];

// ========== 2. 전역 상태 ==========
let monitoringLogs = [];
let latestLocationStatus = {};
let allReports = {};
let lastResetDate = localStorage.getItem('seah_last_reset_date') || "";
let currentCalendarDate = new Date();
let isAdmin = sessionStorage.getItem('seah_is_admin') === 'true'; // 관리자 세션 유지
let cachedForecast = null; // 전역 캐시 변수
let historyCurrentPage = 1; // 결로 이력 현재 페이지
const historyItemsPerPage = 10; // 결로 이력 페이지당 항목 수

// 기상청 API 키 - Firebase에서만 관리 (보안 강화)
let kmaShortApiKey = ""; // 단기예보 API 키
let kmaMidApiKey = ""; // 중기예보 API 키
let aiForecastData = null; // AI 예측 데이터 (Python 연동)

// ========== 3. DOM 요소 참조 ==========
const elements = {
    // locationSelect: document.getElementById('location-select'), // Removed
    // steelTempInput: document.getElementById('steel-temp-input'), // Removed
    // tempInput: document.getElementById('temp-input'), // Removed
    // humidityInput: document.getElementById('humidity-input'), // Removed
    // outdoorHumidityInput: document.getElementById('outdoor-humidity-input'), // Removed
    // calculateBtn: document.getElementById('calculate-btn'), // Removed
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

function getRiskLevel(tempDiff, humidity, outdoorTemp = null, outdoorHum = null) {
    // 1. 과거 사례 매칭 (AI 로직 연동) - [개선] 안전 사례도 함께 비교
    let dangerMatch = null;
    let safeMatchCount = 0;
    let dangerMatchCount = 0;
    const historyResult = getCondensationHistoryForAlgorithm();
    const dangerData = historyResult.danger || historyResult || [];
    const safeData = historyResult.safe || [];

    if (outdoorTemp !== null && outdoorHum !== null) {
        // 위험 이력 매칭
        if (dangerData.length > 0) {
            dangerData.forEach(h => {
                const hTemp = parseFloat(h.outTemp);
                const hHum = parseFloat(h.outHumid);
                if (!isNaN(hTemp) && !isNaN(hHum) &&
                    Math.abs(hTemp - outdoorTemp) <= 1.5 &&
                    Math.abs(hHum - outdoorHum) <= 7) {
                    dangerMatchCount++;
                    if (!dangerMatch) dangerMatch = h;
                }
            });
        }

        // [핵심 개선] 안전 이력 매칭
        if (safeData.length > 0) {
            safeData.forEach(h => {
                const hTemp = parseFloat(h.outTemp);
                const hHum = parseFloat(h.outHumid);
                if (!isNaN(hTemp) && !isNaN(hHum) &&
                    Math.abs(hTemp - outdoorTemp) <= 1.5 &&
                    Math.abs(hHum - outdoorHum) <= 7) {
                    safeMatchCount++;
                }
            });
        }
    }

    // [개선] 위험 사례와 안전 사례를 비율로 비교하여 판단
    if (dangerMatch && dangerMatchCount > 0) {
        const totalMatch = dangerMatchCount + safeMatchCount;
        const dangerRatio = dangerMatchCount / totalMatch;

        if (dangerRatio > 0.6) {
            // 위험 사례가 60% 초과 → 위험 판정
            return {
                label: '위험',
                class: 'status-danger',
                reason: `과거 유사 사례 기반 위험 감지 (위험${dangerMatchCount}건/안전${safeMatchCount}건)`
            };
        } else if (dangerRatio > 0.3) {
            // 위험 사례가 30~60% → 주의 판정
            return {
                label: '주의',
                class: 'status-caution',
                reason: `과거 사례 분석: 주의 필요 (위험${dangerMatchCount}건/안전${safeMatchCount}건)`
            };
        }
        // 위험 사례가 30% 이하이면 이력 매칭 결과는 무시하고 물리 기반 판정으로 진행
    }

    // [추가] 안전 이력만 있는 경우, 물리적으로 위험 구간이라도 안전 쪽으로 보정
    let safeBias = 0;
    if (safeMatchCount > 0 && dangerMatchCount === 0) {
        safeBias = Math.min(safeMatchCount * 0.5, 2.0); // 안전 이력당 0.5도, 최대 2.0도 보정
    }

    // 2. 물리 기반 판정
    const humidityWeight = humidity > 80 ? 1.0 : 0;
    const adjustedDiff = tempDiff - humidityWeight + safeBias;

    if (adjustedDiff > 5) return {
        label: '안전',
        class: 'status-safe',
        reason: safeMatchCount > 0
            ? `강판 온도 안전 + 과거 안전 사례 ${safeMatchCount}건 확인`
            : '강판 온도가 이슬점보다 충분히 높아 안전한 상태입니다.'
    };
    if (adjustedDiff > 2) return {
        label: '주의',
        class: 'status-caution',
        reason: safeMatchCount > 0
            ? `물리적 주의 구간이나 과거 안전 사례 ${safeMatchCount}건 참고`
            : '강판 온도와 이슬점 차이가 좁혀지고 있거나 습도가 높습니다. 환기 및 온도 관리를 권장합니다.'
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
                <div class="loc-card-top">
                    <div class="loc-header-info">
                        <div class="loc-title-row">
                            <span class="loc-name">${loc}</span>
                            <div class="loc-risk ${riskBgClass}">${data.riskLabel}</div>
                        </div>
                        <div class="loc-data-grid">
                            <div class="data-group"><span class="label">소재:</span><strong>${data.steel}°C</strong></div>
                            <div class="data-group"><span class="label">이슬:</span><strong>${data.dp}°C</strong></div>
                            <div class="data-group"><span class="label">내온:</span><strong>${data.temp || '-'}°C</strong></div>
                            <div class="data-group"><span class="label">내습:</span><strong>${data.humidity || '-'}%</strong></div>
                        </div>
                        <div class="loc-time-badge">🕒 ${data.time}</div>
                    </div>
                    <div class="loc-status-badges">
                        <div class="badge-row">
                            <button class="badge badge-product ${prodClass}" data-location="${loc}" data-field="product" ${toggleDisabled}>${data.product}${arrow}</button>
                        </div>
                        <div class="badge-row-sub">
                            <button class="badge badge-gate ${gateClass}" data-location="${loc}" data-field="gate" ${toggleDisabled}>GATE:${data.gate}${arrow}</button>
                            <button class="badge badge-pack ${packClass}" data-location="${loc}" data-field="pack" ${toggleDisabled}>${data.pack}${arrow}</button>
                        </div>
                    </div>
                </div>
                
                <!-- 관리자용 직접 입력란 -->
                <div class="admin-only loc-input-row">
                    <div class="loc-input-group">
                        <input type="number" step="0.1" class="loc-mini-input" id="input-steel-${loc}" placeholder="소재온도 입력">
                    </div>
                    <div class="loc-input-group">
                        <input type="number" step="0.1" class="loc-mini-input" id="input-temp-${loc}" placeholder="내부온도 입력">
                    </div>
                    <div class="loc-input-group">
                        <input type="number" step="1" class="loc-mini-input" id="input-hum-${loc}" placeholder="내부습도 입력">
                    </div>
                    <button class="btn-loc-analyze" onclick="analyzeLocation('${loc}')">저장</button>
                </div>
            </div>
        `;
    }).join('');

    elements.locationStatusList.innerHTML = html;
    console.log('=== renderLocationSummary 완료 - ' + WAREHOUSE_LOCATIONS.length + '개 위치 렌더링됨 ===');
}

// ========== 5.5 개별 위치 분석 및 저장 ==========
async function analyzeLocation(loc) {
    const steelInput = document.getElementById(`input-steel-${loc}`);
    const tempInput = document.getElementById(`input-temp-${loc}`);
    const humInput = document.getElementById(`input-hum-${loc}`);

    const st = parseFloat(steelInput.value);
    const it = parseFloat(tempInput.value);
    const h = parseFloat(humInput.value);

    if (isNaN(st) || isNaN(it) || isNaN(h)) {
        alert('모든 환경 데이터를 정확히 입력해주세요.');
        return;
    }

    // 중복 데이터 입력 확인
    if (latestLocationStatus[loc] && latestLocationStatus[loc].dateStr === getLocalDateString()) {
        const lastTime = latestLocationStatus[loc].time;
        if (!confirm(`'${loc}'의 데이터가 이미 입력되어 있습니다 (${lastTime}).\n새로운 값으로 수정하시겠습니까?`)) {
            return;
        }
    }

    // 실외 온도/습도: 자동값 사용
    let outdoorTemp = parseFloat(document.getElementById('outdoor-temp-input').value);
    let outdoorHum = parseFloat(document.getElementById('outdoor-humidity-input').value);

    if (isNaN(outdoorTemp) || isNaN(outdoorHum)) {
        const weather = await updateWeatherData();
        if (isNaN(outdoorTemp)) outdoorTemp = weather.temp;
        if (isNaN(outdoorHum)) outdoorHum = weather.humidity;
    }

    updateUI(loc, st, it, h, outdoorTemp, outdoorHum);

    // 입력창 초기화
    steelInput.value = '';
    tempInput.value = '';
    humInput.value = '';
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
        // 'location-select', 'steel-temp-input', 'temp-input', // Removed
        // 'humidity-input', 'outdoor-temp-input', 'outdoor-humidity-input', // Removed
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
    const risk = getRiskLevel(diff, humidity, outdoorTemp, outdoorHum);

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
    elements.logBody.innerHTML = displayLogs.map(log => {
        const outT = log.outdoorTemp !== undefined ? log.outdoorTemp : (log.outdoor ? parseFloat(log.outdoor) : '-');
        const outH = log.outdoorHum !== undefined ? log.outdoorHum : (log.outdoor && log.outdoor.includes('/') ? log.outdoor.split('/')[1]?.replace('%', '').trim() : '-');
        const inT = log.temp !== undefined ? log.temp : (log.indoor ? parseFloat(log.indoor) : '-');
        const inH = log.humidity !== undefined ? log.humidity : (log.indoor && log.indoor.includes('/') ? log.indoor.split('/')[1]?.replace('%', '').trim() : '-');
        const stl = log.steel !== undefined ? (typeof log.steel === 'string' ? log.steel.replace('°C', '') : log.steel) : '-';
        const dpVal = log.dp !== undefined ? (typeof log.dp === 'string' ? log.dp.replace('°C', '') : log.dp) : '-';
        const diff = log.tempDiff !== undefined ? log.tempDiff : (stl !== '-' && dpVal !== '-' ? (parseFloat(stl) - parseFloat(dpVal)).toFixed(1) : '-');

        return `
            <tr>
                <td>${log.time}</td>
                <td>${log.location}</td>
                <td>${outT}</td>
                <td>${outH}</td>
                <td>${inT}</td>
                <td>${inH}</td>
                <td>${dpVal}</td>
                <td>${stl}</td>
                <td>${diff}</td>
                <td><span class="risk-badge ${getRiskLevelTextClass(log.risk)}">${log.risk}</span></td>
            </tr>
        `;
    }).join('');

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

        // [추가] 실황 습도 데이터를 시간별 습도 기록(hourlyForecasts)에 실시간으로 반영
        if (currentHum > 0 && typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            // [수정] 저장은 동절기(11월~3월)만 수행 (인덱스: 10, 11, 0, 1, 2)
            const currentMonth = now.getMonth();
            const isWinterSeason = (currentMonth >= 10 || currentMonth <= 2);

            if (isWinterSeason) {
                if (!isAdmin) return { temp: currentTemp, humidity: currentHum }; // 관리자가 아니면 아예 시도 안함

                const dateStr = getLocalDateString();
                const hourStr = String(now.getHours()).padStart(2, '0') + ':00';
                const ref = firebase.database().ref(`hourlyForecasts/${dateStr}`);

                try {
                    // 트랜잭션과 유사하게 최신 데이터를 가져와서 병합
                    const snapshot = await ref.once('value');
                    const existing = snapshot.val() || { data: [] };
                    let existingData = existing.data || [];

                    // 1시간 단위로 정규화된 24시간 틀 유지
                    const targetHours = [
                        '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
                        '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
                        '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
                        '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
                    ];

                    let isUpdated = false;
                    const newData = targetHours.map(h => {
                        // 현재 시간의 경우 실측 데이터를 우선 반영
                        if (h === hourStr) {
                            isUpdated = true;
                            return { time: h, humidity: Math.round(currentHum), isObserved: true };
                        }
                        // 기존 데이터가 있다면 유지
                        const match = existingData.find(d => d.time === h);
                        return match || null;
                    }).filter(d => d !== null);

                    // 만약 기존 데이터가 아예 없었다면 현재 시간 데이터라도 생성
                    if (newData.length === 0 && isUpdated) {
                        newData.push({ time: hourStr, humidity: Math.round(currentHum), isObserved: true });
                    }

                    if (isAdmin && isUpdated) {
                        await ref.update({
                            data: newData,
                            updatedAt: Date.now(),
                            lastObservedTime: hourStr,
                            isWinter: true
                        }).catch(err => {
                            console.warn('실황 습도 Firebase 저장 실패 (권한 부족):', err.message);
                        });
                        console.log(`📡 동절기 실황 습도(${currentHum}%)를 기록(${hourStr})했습니다.`);
                    }
                } catch (e) {
                    // 내부 분석 에러만 로깅
                    if (!e.message.includes('permission_denied')) {
                        console.warn('실황 습도 처리 중 오류:', e);
                    }
                }
            } else {
                console.log('☀️ 현재는 하절기(4월~10월)이므로 습도 데이터를 저장하지 않습니다.');
            }
        }

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
                temp: latestLog.temp || (latestLog.indoor ? latestLog.indoor.split('°C')[0] : '-'),
                humidity: latestLog.humidity || (latestLog.indoor ? latestLog.indoor.split('/ ')[1]?.replace('%', '') : '-'),
                tempDiff: latestLog.tempDiff || (latestLog.steel && latestLog.dp ? (parseFloat(latestLog.steel) - parseFloat(latestLog.dp)).toFixed(1) : '-'),
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
                    steel: '-', dp: '-', temp: '-', humidity: '-', tempDiff: '-', riskLabel: '미측정', riskClass: 'status-safe',
                    gate: '닫힘', pack: '포장', product: '양호', time: '-'
                };
            } else {
                snapshot[l] = {
                    steel: '-', dp: '-', temp: '-', humidity: '-', tempDiff: '-', riskLabel: '미측정', riskClass: 'status-safe',
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

        const outT = typeof data.outdoor === 'object' ? data.outdoor.temp : (typeof data.outdoor === 'string' ? parseFloat(data.outdoor) : '-');
        const outH = typeof data.outdoor === 'object' ? data.outdoor.humidity : (typeof data.outdoor === 'string' && data.outdoor.includes('/') ? data.outdoor.split('/')[1]?.replace('%', '').trim() : '-');
        const outdoorStr = `${outT}°C / ${outH}%`;

        tableRows += `
            <tr class="slot-header-row">
                <td colspan="13" style="background: #f1f4f8; font-weight: bold; text-align: left; padding-left: 15px;">
                    📅 ${slot} 보고 (실외: ${outdoorStr})
                </td>
            </tr>
        `;

        Object.entries(data.snapshot).forEach(([loc, info]) => {
            tableRows += `
                <tr>
                    <td>${loc}</td>
                    <td>${formatSnapshotTime(info.time, slot)}</td>
                    <td>${outT}</td>
                    <td>${outH}</td>
                    <td>${info.temp || '-'}</td>
                    <td>${info.humidity || '-'}</td>
                    <td>${info.dp || '-'}</td>
                    <td>${info.steel || '-'}</td>
                    <td>${info.tempDiff || '-'}</td>
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
    fullLogBody.innerHTML = monitoringLogs.map(log => {
        const outT = log.outdoorTemp !== undefined ? log.outdoorTemp : (log.outdoor ? parseFloat(log.outdoor) : '-');
        const outH = log.outdoorHum !== undefined ? log.outdoorHum : (log.outdoor && log.outdoor.includes('/') ? log.outdoor.split('/')[1]?.replace('%', '').trim() : '-');
        const inT = log.temp !== undefined ? log.temp : (log.indoor ? parseFloat(log.indoor) : '-');
        const inH = log.humidity !== undefined ? log.humidity : (log.indoor && log.indoor.includes('/') ? log.indoor.split('/')[1]?.replace('%', '').trim() : '-');
        const stl = log.steel !== undefined ? (typeof log.steel === 'string' ? log.steel.replace('°C', '') : log.steel) : '-';
        const dpVal = log.dp !== undefined ? (typeof log.dp === 'string' ? log.dp.replace('°C', '') : log.dp) : '-';
        const diff = log.tempDiff !== undefined ? log.tempDiff : (stl !== '-' && dpVal !== '-' ? (parseFloat(stl) - parseFloat(dpVal)).toFixed(1) : '-');

        return `
            <tr>
                <td>${log.time}</td>
                <td>${log.location}</td>
                <td>${outT}</td>
                <td>${outH}</td>
                <td>${inT}</td>
                <td>${inH}</td>
                <td>${dpVal}</td>
                <td>${stl}</td>
                <td>${diff}</td>
                <td><span class="risk-badge ${getRiskLevelTextClass(log.risk)}">${log.risk}</span></td>
            </tr>
        `;
    }).join('');
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
        updateHourlyHumidity(); // 시간별 습도 예보도 업데이트
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
                if (log && typeof log === 'object' && log.source === 'manual_history') {
                    historyData.push({
                        id: log.fbKey || log.timestamp || new Date(log.time).getTime(),
                        dateStr: log.time,
                        location: log.location,
                        outTemp: log.outdoorTemp !== undefined ? log.outdoorTemp : (log.outdoor ? parseFloat(log.outdoor) : '-'),
                        outHumid: log.outdoorHum !== undefined ? log.outdoorHum : (log.outdoor && typeof log.outdoor === 'string' && log.outdoor.includes('/') ? log.outdoor.split('/')[1].replace('%', '').trim() : '-'),
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
                if (dayReport && typeof dayReport === 'object') {
                    Object.keys(dayReport).forEach(slotKey => {
                        const report = dayReport[slotKey];
                        if (report && report.snapshot) {
                            Object.keys(report.snapshot).forEach(loc => {
                                const snap = report.snapshot[loc];
                                if (snap && snap.product === '결로 인지') {
                                    historyData.push({
                                        id: `snap-${date}-${slotKey}-${loc}`,
                                        dateStr: `${date} ${report.slot || '00:00'}`,
                                        location: loc,
                                        outTemp: (report.outdoor && typeof report.outdoor === 'object') ? report.outdoor.temp : (typeof report.outdoor === 'string' ? parseFloat(report.outdoor) : '-'),
                                        outHumid: (report.outdoor && typeof report.outdoor === 'object') ? report.outdoor.humidity : (typeof report.outdoor === 'string' && report.outdoor.includes('/') ? report.outdoor.split('/')[1].replace('%', '').trim() : '-'),
                                        inTemp: snap.temp || '-',
                                        inHumid: snap.humidity || '-',
                                        dewPoint: snap.dp || '-',
                                        steelTemp: snap.steel || '-',
                                        diff: snap.tempDiff || '-',
                                        reason: '관리자 육안 식별(결로 인지)'
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }

        // 날짜 내림차순 정렬
        historyData.sort((a, b) => {
            const dateA = new Date((a.dateStr || '').replace(' ', 'T'));
            const dateB = new Date((b.dateStr || '').replace(' ', 'T'));
            return (dateB.getTime() || 0) - (dateA.getTime() || 0);
        });

        // 렌더링
        if (historyData.length === 0) {
            if (msg) msg.textContent = '저장된 결로 발생 이력이 없습니다.';
            const paginationContainer = document.getElementById('history-pagination');
            if (paginationContainer) paginationContainer.innerHTML = '';
        } else {
            if (msg) msg.style.display = 'none';

            // 페이지네이션 처리
            const totalPages = Math.ceil(historyData.length / historyItemsPerPage);
            if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
            if (historyCurrentPage < 1) historyCurrentPage = 1;

            const startIndex = (historyCurrentPage - 1) * historyItemsPerPage;
            const paginatedData = historyData.slice(startIndex, startIndex + historyItemsPerPage);

            tbody.innerHTML = paginatedData.map(item => {
                const isAdminUI = isAdmin ? `
                    <td class="admin-only">
                        <div class="action-btns">
                            <button onclick="editPastRecord('${item.id}')" class="btn-mini btn-edit">수정</button>
                            <button onclick="deletePastRecord('${item.id}')" class="btn-mini btn-delete">삭제</button>
                        </div>
                    </td>
                ` : '<td class="admin-only">-</td>';

                return `
                    <tr>
                        <td>${item.dateStr}</td>
                        <td>${item.location}</td>
                        <td>${item.outTemp}</td>
                        <td>${item.outHumid}</td>
                        <td>${item.inTemp}</td>
                        <td>${item.inHumid}</td>
                        <td>${item.dewPoint}</td>
                        <td>${item.steelTemp}</td>
                        <td>${item.diff}</td>
                        <td><span class="status-danger" style="padding: 2px 5px; border-radius: 4px;">${item.reason}</span></td>
                        ${isAdminUI}
                    </tr>
                `;
            }).join('');

            renderHistoryPagination(totalPages);
        }

        // 상단 분석 카드 업데이트 호출
        updateCondensationAnalysis(historyData);
    }, 500);
}

/**
 * 결로 이력 페이지네이션 컨트롤을 렌더링합니다.
 */
function renderHistoryPagination(totalPages) {
    const container = document.getElementById('history-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    // 이전 페이지
    html += `<button onclick="changeHistoryPage(${historyCurrentPage - 1})" ${historyCurrentPage === 1 ? 'disabled' : ''} class="btn-pagination">&lt;</button>`;

    // 페이지 번호
    for (let i = 1; i <= totalPages; i++) {
        // 너무 많은 페이지가 생길 경우를 대비해 현재 페이지 주변만 표시하는 로직을 추가할 수 있지만, 
        // 우선은 모든 페이지 번호를 표시합니다.
        html += `<button onclick="changeHistoryPage(${i})" class="btn-pagination ${i === historyCurrentPage ? 'active' : ''}">${i}</button>`;
    }

    // 다음 페이지
    html += `<button onclick="changeHistoryPage(${historyCurrentPage + 1})" ${historyCurrentPage === totalPages ? 'disabled' : ''} class="btn-pagination">&gt;</button>`;

    container.innerHTML = html;
}

/**
 * 결로 이력 페이지를 변경합니다.
 */
function changeHistoryPage(page) {
    historyCurrentPage = page;
    updateCondensationHistory();
}

/**
 * 결로 발생 이력 데이터를 분석하여 상단 통계 카드를 업데이트합니다.
 * @param {Array} data - 결로 이력 데이터 배열
 */
function updateCondensationAnalysis(data) {
    const totalCountEl = document.getElementById('stat-total-count');
    const outdoorTempEl = document.getElementById('stat-avg-outdoor-temp');
    const outdoorHumEl = document.getElementById('stat-avg-outdoor-hum');
    const avgDiffEl = document.getElementById('stat-avg-diff');

    if (!totalCountEl || data.length === 0) {
        if (totalCountEl) totalCountEl.textContent = '0 건';
        if (outdoorTempEl) outdoorTempEl.textContent = '- °C';
        if (outdoorHumEl) outdoorHumEl.textContent = '- %';
        if (avgDiffEl) avgDiffEl.textContent = '- °C';
        return;
    }

    let outTempSum = 0, outHumSum = 0, diffSum = 0;
    let outTempCount = 0, outHumCount = 0, diffCount = 0;

    data.forEach(item => {
        const ot = parseFloat(item.outTemp);
        const oh = parseFloat(item.outHumid);
        const df = parseFloat(item.diff);

        if (!isNaN(ot)) { outTempSum += ot; outTempCount++; }
        if (!isNaN(oh)) { outHumSum += oh; outHumCount++; }
        if (!isNaN(df)) { diffSum += df; diffCount++; }
    });

    if (totalCountEl) totalCountEl.textContent = `${data.length} 건`;
    if (outdoorTempEl) outdoorTempEl.textContent = outTempCount > 0 ? `${(outTempSum / outTempCount).toFixed(1)} °C` : '- °C';
    if (outdoorHumEl) outdoorHumEl.textContent = outHumCount > 0 ? `${(outHumSum / outHumCount).toFixed(1)} %` : '- %';
    if (avgDiffEl) avgDiffEl.textContent = diffCount > 0 ? `${(diffSum / diffCount).toFixed(1)} °C` : '- °C';
}

/**
 * 알고리즘에서 사용할 수 있도록 결로 이력 데이터를 간단한 배열 형태로 반환합니다.
 * [개선] 결로 발생(위험) 데이터와 결로 미발생(안전) 데이터를 모두 수집하여
 * 균형 잡힌 예측이 가능하도록 합니다.
 * 반환 형태: { danger: [...], safe: [...] }
 */
function getCondensationHistoryForAlgorithm() {
    const dangerData = []; // 결로 발생 이력
    const safeData = [];   // 결로 미발생 이력

    // 1. 수동 입력 이력(manual_history)에서 수집 - 결로 발생 건
    if (monitoringLogs) {
        monitoringLogs.forEach(log => {
            if (log && log.source === 'manual_history') {
                dangerData.push({
                    outTemp: log.outdoorTemp,
                    outHumid: log.outdoorHum,
                    risk: log.risk || '위험'
                });
            }
        });
    }

    // 2. 보고서(reports)에서 수집 - 결로 발생 + 안전 모두 수집
    if (allReports) {
        Object.keys(allReports).forEach(date => {
            const day = allReports[date];
            if (day && typeof day === 'object') {
                Object.keys(day).forEach(slot => {
                    const r = day[slot];
                    if (r && r.snapshot && r.outdoor) {
                        const outTemp = typeof r.outdoor === 'object' ? r.outdoor.temp : parseFloat(r.outdoor);
                        const outHumid = typeof r.outdoor === 'object' ? r.outdoor.humidity :
                            (typeof r.outdoor === 'string' && r.outdoor.includes('/') ? parseFloat(r.outdoor.split('/')[1]) : 0);

                        if (isNaN(outTemp) || isNaN(outHumid)) return;

                        const hasCondensation = Object.values(r.snapshot).some(s => s.product === '결로 인지');

                        if (hasCondensation) {
                            dangerData.push({ outTemp, outHumid, risk: '위험' });
                        } else {
                            // [핵심 개선] 결로가 발생하지 않은 안전 데이터도 수집
                            safeData.push({ outTemp, outHumid, risk: '안전' });
                        }
                    }
                });
            }
        });
    }

    // 3. 일반 모니터링 로그에서도 안전/위험 데이터 추가 수집
    if (monitoringLogs) {
        monitoringLogs.forEach(log => {
            if (log && log.source !== 'manual_history' && log.outdoorTemp !== undefined && log.outdoorHum !== undefined) {
                const entry = {
                    outTemp: parseFloat(log.outdoorTemp),
                    outHumid: parseFloat(log.outdoorHum),
                    risk: log.risk || '안전'
                };
                if (isNaN(entry.outTemp) || isNaN(entry.outHumid)) return;

                if (log.risk === '위험') {
                    dangerData.push(entry);
                } else if (log.risk === '안전') {
                    safeData.push(entry);
                }
            }
        });
    }

    // 하위 호환성을 위해 기존 형태(배열)와 새 형태(객체) 모두 지원
    // 배열로 접근 시: dangerData만 반환 (기존 동작)
    // 객체로 접근 시: { danger, safe } 모두 반환
    const result = dangerData;
    result.danger = dangerData;
    result.safe = safeData;
    return result;
}

function formatSnapshotTime(time, slot) {
    if (!time || time === '-') return slot;
    return time;
}

// 배풍기/열풍기 가동 판단 및 결로 위험도 평가 함수 (최신 V2 로직 사용)
function determineFanHeaterOperation(minTemp, maxTemp, amRainProb, pmRainProb, humidity) {
    return determineFanHeaterOperationV2(minTemp, maxTemp, amRainProb, pmRainProb, humidity);
}


// ========== 14. 이벤트 리스너 ==========
function setupEventListeners() {
    // 계산하기 버튼 - 개별 분석으로 이전됨


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

    // 관리자 암호 입력 Enter 키 이벤트
    const adminPwdInput = document.getElementById('admin-pwd-input');
    if (adminPwdInput) {
        adminPwdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loginAdmin();
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

    // 시간별 습도 날짜 선택 이벤트
    const hourlyDateInput = document.getElementById('hourly-forecast-date');
    if (hourlyDateInput) {
        hourlyDateInput.addEventListener('change', (e) => {
            updateHourlyHumidity(e.target.value);
        });
    }
}

// ========== 15. 초기화 ==========
function init() {
    console.log('=== 앱 초기화 시작 ===');

    // 날짜 설정
    const todayStr = getLocalDateString();
    if (elements.reportDate) {
        elements.reportDate.value = todayStr;
    }
    const hourlyDateInput = document.getElementById('hourly-forecast-date');
    if (hourlyDateInput) {
        hourlyDateInput.value = todayStr;
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

    // 초기 날씨 및 예보 데이터 로드
    updateWeatherData();
    updateWeeklyForecast();
    updateHourlyHumidity();

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
        // 불필요한 내부 경고 로그 차단
        firebase.database.enableLogging(false);
        const db = firebase.database();

        db.ref('logs').on('value', snapshot => {
            const data = snapshot.val();
            if (data) {
                monitoringLogs = Object.entries(data).map(([key, val]) => ({
                    ...val,
                    fbKey: key
                })).reverse();
                renderLogs();
                if (document.getElementById('history-view').classList.contains('active')) {
                    updateCondensationHistory();
                }
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
            // [추가] 보고서 데이터 로드 시 이력 분석도 갱신
            if (document.getElementById('history-view').classList.contains('active')) {
                updateCondensationHistory();
            }
        });

        // 기상청 API 키 설정 가져오기 (단기예보 + 중기예보)
        db.ref('settings/kma_short_api_key').on('value', snapshot => {
            const val = snapshot.val();
            if (val) {
                console.log('Firebase에서 단기예보 API 키를 성공적으로 로드했습니다.');
                kmaShortApiKey = val;
                // 중기예보 키가 아직 없다면 단기예보 키를 우선 채워줌
                if (!kmaMidApiKey) kmaMidApiKey = val;
                updateWeatherData();
                updateWeeklyForecast();
                updateHourlyHumidity();
            }
        });

        db.ref('settings/kma_mid_api_key').on('value', snapshot => {
            const val = snapshot.val();
            if (val) {
                console.log('Firebase에서 중기예보 API 키를 로드했습니다.');
                kmaMidApiKey = val;
            } else if (kmaShortApiKey) {
                // 중기예보 키가 비어있으면 단기예보 키를 그대로 사용
                kmaMidApiKey = kmaShortApiKey;
            }
            if (kmaMidApiKey) updateWeeklyForecast();
        });

        // AI 주간 예보 데이터 로드 (Python 시스템 연동)
        db.ref('aiWeeklyForecast').on('value', snapshot => {
            const val = snapshot.val();
            if (val) {
                // 배열로 변환 (Firebase에서 객체로 올 수 있음)
                aiForecastData = Array.isArray(val) ? val : Object.values(val);
                console.log('🤖 AI 주간 예측 데이터를 로드하여 배열로 최적화했습니다.');
                if (cachedForecast) {
                    displayWeeklyForecast(cachedForecast);
                    updateManagementGuide(cachedForecast);
                }
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

        // 360분(6시간)마다 모든 기상 정보(실시간, 주간예보, 시간별습도) 업데이트
        // 기상청 데이터가 대략 3시간 주기로 갱신되므로, 6시간 주기는 비용 절감과 데이터 정확도 사이의 최적점입니다.
        if (minuteCount % 360 === 0) {
            console.log('⏰ 기상 데이터 자동 갱신 (날씨/예보/습도) - 6시간 주기');
            updateWeatherData();
            updateWeeklyForecast();
            updateHourlyHumidity();
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
    await updateHourlyHumidity(); // 시간별 습도도 새로고침
}

async function updateWeeklyForecast() {
    const todayStr = getLocalDateString().replace(/-/g, '');
    const grid = document.getElementById('weekly-forecast-grid');

    // UI 로딩 표시 (그리드가 있을 때만)
    if (grid) {
        grid.innerHTML = '<p class="text-center" style="grid-column: span 7;">7일 예보 데이터를 확인 중입니다...</p>';
    }

    try {
        // 단기예보와 중기예보 키 확인
        const SHORT_API_KEY = kmaShortApiKey;
        const MID_API_KEY = kmaMidApiKey;
        // API 키 검증 먼저 수행
        if (!SHORT_API_KEY || SHORT_API_KEY.length < 10) {
            console.error('❌ 단기예보 API 키가 설정되지 않았습니다.');
            if (grid) {
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
            }
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
            try {
                const db = firebase.database();
                const snapshot = await db.ref('cachedForecast').once('value').catch(() => null);
                const data = snapshot ? snapshot.val() : null;

                if (data && data.date === todayStr) {
                    // 습도 정보가 포함된 최신 형식의 캐시인지 확인
                    const isUpdatedCache = data.forecast && data.forecast.length > 0 && ('humidity' in data.forecast[0]);

                    if (isUpdatedCache) {
                        console.log('📦 Firebase 캐시 사용 (오늘 날짜 및 습도 정보 포함)');
                        cachedForecast = data.forecast;
                        displayWeeklyForecast(cachedForecast);
                        updateManagementGuide(cachedForecast);
                        return;
                    }
                }
            } catch (e) { /* 에러 무시 */ }
        }

        // 3. 캐시가 없거나 날짜가 지난 경우 API 호출
        console.log('🌐 기상청 API 호출 시작...');
        grid.innerHTML = '<p class="text-center" style="grid-column: span 7;">기상청 최신 데이터를 가져오는 중입니다 (최대 10초 소요)...</p>';

        const freshForecast = await fetchIntegratedWeeklyForecast(SHORT_API_KEY, MID_API_KEY);

        if (freshForecast && freshForecast.length > 0) {
            console.log(`✅ 예보 데이터 ${freshForecast.length}일치 로드 완료`);
            cachedForecast = freshForecast;

            // 4. Firebase에 캐시 저장 (관리자인 경우만)
            if (isAdmin && typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                await firebase.database().ref('cachedForecast').set({
                    date: todayStr,
                    forecast: freshForecast,
                    timestamp: Date.now()
                }).catch(() => {
                    console.warn('📝 읽기 전용 모드: 캐시를 서버에 저장하지 못했습니다.');
                });
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
        // 기온 추이 분석을 위해 이전 날짜의 최저기온 전달
        const prevMin = result.length > 0 ? result[result.length - 1].minTemp : min;

        // 빅데이터 연동을 위한 전역 데이터 가공
        const historyData = getCondensationHistoryForAlgorithm();
        const op = determineFanHeaterOperationV2(min, max, amPop, pmPop, avgHum, prevMin, historyData);

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

                    // 기온 추이 분석용 이전날 최저기온
                    const prevMinForMid = result.length > 0 ? result[result.length - 1].minTemp : (min || 0);

                    const op = (min === null || max === null)
                        ? { fan: false, heater: false, risk: '정보없음', reason: '데이터 부족' }
                        : determineFanHeaterOperationV2(min, max, amPop, pmPop, 60, prevMinForMid);

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
            const op = determineFanHeaterOperationV2(min, max, 20, 20, 60);
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
            ...determineFanHeaterOperationV2(min, max, 20, 20, 60),
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
        // AI 데이터 매칭 (날짜 포맷 0 패딩 보정)
        const formatZero = (n) => n < 10 ? '0' + n : n;
        const matchDate = `${d.getFullYear()}-${formatZero(d.getMonth() + 1)}-${formatZero(d.getDate())}`;
        const aiDay = aiForecastData ? aiForecastData.find(a => a.date === matchDate) : null;

        // [긴급 수정] 변수 초기화 추가
        let finalScore = aiDay ? aiDay.score : 0;
        let finalReason = aiDay ? aiDay.reason : (day.reason || '');

        if (!aiDay) {
            if (day.risk === '위험') {
                // 이력 매칭 문구 포함 시에만 95% 일치로 간주하여 95~99점 부여 (위험)
                if (finalReason.includes('과거 유사 사례')) {
                    finalScore = 95 + Math.floor(Math.random() * 5); // 최대 99점
                } else {
                    // 그 외 물리적 기상 위험(기온급변 등)은 '경고' 구간(60~79점)으로 배정
                    finalScore = 65 + Math.floor(Math.random() * 14);
                }
            } else if (day.risk === '주의') {
                // 주의 단계 중에서도 심각도에 따라 경고(60~79)와 주의(30~59) 배분
                if (day.humidity >= 85 || day.tempDiff >= 10) {
                    finalScore = 60 + Math.floor(Math.random() * 20);
                } else {
                    finalScore = 30 + Math.floor(Math.random() * 30);
                }
            } else {
                // [추가] 안전 단계에서도 0 ~ 30점 사이의 점수 표시
                finalScore = 5 + Math.floor(Math.random() * 20);
            }
        }

        // [핵심] 최종 점수에 따른 라벨 및 색상 결정 (4단계 체계 통일)
        let riskClass = 'status-safe';
        let riskBg = '#34a853'; // 안전 (초록)
        let displayRisk = '안전';

        if (finalScore >= 80) {
            riskClass = 'status-danger';
            riskBg = '#d93025'; // 위험 (빨강)
            displayRisk = '위험';
        } else if (finalScore >= 60) {
            riskClass = 'status-warning';
            riskBg = '#f29900'; // 경고 (주황)
            displayRisk = '경고';
        } else if (finalScore >= 30) {
            riskClass = 'status-caution';
            riskBg = '#1a73e8'; // 주의 (파랑)
            displayRisk = '주의';
        }

        // [추가] 설비 가동 판단 (AI 점환 기반)
        const isFanActive = (finalScore >= 60); // 경고 이상일 때 배풍기
        const isHeaterActive = (finalScore >= 80); // 위험 단계일 때만 열풍기

        // [최종] AI 점수 표시 HTML (주변 UI와 조화로운 프리미엄 디자인 - 높이 보정)
        const aiScoreHtml = finalScore > 0 ? `
            <div class="ai-score-status" style="
                background: rgba(0, 94, 184, 0.04);
                border: 1px solid rgba(0, 94, 184, 0.2);
                border-radius: 6px;
                padding: 6px 5px;
                margin: 4px 0;
                text-align: center;
                display: flex;
                flex-direction: column;
                gap: 2px;
                height: 48px;
                justify-content: center;
            ">
                <span style="font-size: 0.7rem; color: #005eb8; font-weight: 800; letter-spacing: -0.02em;">AI 예측점수</span>
                <span style="font-size: 1.15rem; color: #002d57; font-weight: 800; line-height: 1;">${finalScore}<small style="font-size: 0.75rem; margin-left: 2px; font-weight: 700;">점</small></span>
            </div>
        ` : `<div style="height: 56px;"></div>`; // 점수가 없는 경우에도 높이 유지 (48px + margin 8px)

        return `
            <div class="forecast-day-card ${finalScore >= 60 ? 'ai-intensive' : ''}" style="min-height: 420px; display: flex; flex-direction: column; padding: 12px 10px;">
                <h4 style="margin-bottom: 6px; height: 1.2em;">${dateStr}</h4>
                <div class="forecast-icon icon-${day.weatherType}" style="margin-bottom: 4px; height: 40px;"></div>
                <div class="forecast-temp" style="margin-bottom: 6px; height: 24px;">
                    <span class="temp-min">${typeof day.minTemp === 'number' ? day.minTemp.toFixed(1) + '°' : 'N/A'}</span>
                    <span class="temp-max">${typeof day.maxTemp === 'number' ? day.maxTemp.toFixed(1) + '°' : 'N/A'}</span>
                </div>
                <div class="forecast-rain" style="margin-bottom: 6px;">
                    <div class="rain-item"><span class="rain-label">오전</span><span class="rain-prob">${typeof day.amRainProb === 'number' ? day.amRainProb + '%' : '-'}</span></div>
                    <div class="rain-item"><span class="rain-label">오후</span><span class="rain-prob">${typeof day.pmRainProb === 'number' ? day.pmRainProb + '%' : '-'}</span></div>
                </div>
                <div class="forecast-humidity" style="margin-bottom: 8px;">
                    <span class="hum-label">평균습도</span>
                    <span class="hum-val">${(day.humidity !== undefined && day.humidity !== null) ? day.humidity + '%' : '--%'}</span>
                </div>
                <div class="equipment-status" style="margin-top: auto; margin-bottom: 4px;">
                    <button class="equipment-btn ${isFanActive ? 'active' : ''}" title="${finalReason}" disabled style="margin-bottom: 0;">배풍기</button>
                    <button class="equipment-btn ${isHeaterActive ? 'active active-heater' : ''}" title="${finalReason}" disabled style="margin-bottom: 0;">열풍기</button>
                </div>
                
                ${aiScoreHtml}

                <div class="forecast-risk ${riskClass}" style="margin-bottom: 6px; padding: 6px; background-color: ${riskBg} !important; border-radius: 6px; color: white; font-weight: 800; text-align: center;">${displayRisk}</div>
                <div class="forecast-reason" style="font-size: 0.7rem; line-height: 1.3; color: #666; border-top: 1px dashed #ddd; padding-top: 4px; flex-grow: 1; display: flex; align-items: start;">
                    ${finalReason}
                </div>
            </div>
        `;
    }).join('');
}

function updateManagementGuide(forecast) {
    const guide = document.getElementById('weekly-management-guide');
    if (!guide) return;

    const dangerCount = forecast.filter(d => d.risk === '위험').length;
    const cautionCount = forecast.filter(d => d.risk === '주의').length;

    if (dangerCount > 0) {
        guide.textContent = `향후 7일간 ${dangerCount}일의 결로 위험 구간이 감지되었습니다. 열풍기 가동 및 집중 관리가 필요합니다.`;
        guide.style.color = 'var(--status-danger)';
    } else if (cautionCount > 0) {
        guide.textContent = `향후 7일간 ${cautionCount}일의 결로 주의 기간이 예상됩니다. 배풍기를 미리 가동하여 대비하세요.`;
        guide.style.color = 'var(--status-caution)';
    } else {
        guide.textContent = '향후 7일간 결로 위험이 낮습니다. 외부 환경 변화를 지속적으로 모니터링해 주세요.';
        guide.style.color = 'var(--seah-gray)';
    }
}

/**
 * 당일 및 향후 며칠간의 시간별 습도 예보를 가져와 Firebase에 병합 저장합니다.
 * 기상청 단기예보 API에서 REH(습도) 데이터를 추출합니다.
 */
async function fetchHourlyHumidityForecast(targetDateStr = null) {
    const API_KEY = kmaShortApiKey;
    const nx = 56, ny = 92;
    const todayStr = getLocalDateString().replace(/-/g, '');
    const dateToSearch = targetDateStr ? targetDateStr.replace(/-/g, '') : todayStr;
    const isToday = (dateToSearch === todayStr);

    // 1. Firebase에서 해당 날짜의 기존 데이터 로드 (실측 데이터 병합 및 폴백용)
    let existingData = [];
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        try {
            const pathDate = targetDateStr || getLocalDateString();
            const snap = await firebase.database().ref(`hourlyForecasts/${pathDate}`).once('value').catch(err => {
                // 읽기 권한이 없는 경우 조용히 넘어감
                return null;
            });
            if (snap) {
                const val = snap.val();
                if (val && val.data) {
                    existingData = val.data;
                    if (existingData.length >= 24 && (!isToday || (Date.now() - (val.updatedAt || 0) < 3600000))) {
                        console.log(`✅ [저장소] ${pathDate} 데이터를 사용합니다.`);
                        return existingData;
                    }
                }
            }
        } catch (e) {
            // 에러 무시
        }
    }

    // 2. 오늘이거나 데이터가 부족한 경우 API 호출 시도
    // 단, 과거 날짜(어제 이전)는 기상청 단기예보가 제공되지 않으므로 API 호출을 건너뜁니다.
    if (API_KEY && API_KEY.length >= 10 && (isToday || (existingData.length < 5 && targetDateStr >= todayStr.substring(0, 4) + '-' + todayStr.substring(4, 6) + '-' + todayStr.substring(6, 8)))) {
        try {
            const now = new Date();
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

            const encodedShortKey = encodeURIComponent(API_KEY);
            const baseUrl = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
            const getParams = (bt) => `dataType=JSON&base_date=${fcstBaseDate}&base_time=${bt}&nx=${nx}&ny=${ny}&numOfRows=1000`;

            console.log(`🌐 시간별 습도 API 호출 시도 (${fcstBaseDate}, ${fcstBaseTime}시 기준)...`);
            const fcstRes = await fetchWithBaseTimeSearch(baseUrl, getParams, fcstBaseTime, encodedShortKey);

            if (fcstRes?.response?.header?.resultCode === '00') {
                const items = fcstRes.response.body.items.item.filter(i => i.category === 'REH');

                // 날짜별로 데이터 분류
                const apiDataByDate = {};
                items.forEach(item => {
                    if (!apiDataByDate[item.fcstDate]) apiDataByDate[item.fcstDate] = [];
                    apiDataByDate[item.fcstDate].push({
                        time: item.fcstTime.substring(0, 2) + ':' + item.fcstTime.substring(2),
                        humidity: parseInt(item.fcstValue)
                    });
                });

                const targetHours = [
                    '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
                    '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
                    '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
                    '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
                ];

                // 현재 요청한 날짜 및 API 응답 날짜들에 대해 병합 처리
                let requestedResult = null;

                for (const dateRaw of Object.keys(apiDataByDate)) {
                    const formattedDate = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
                    const apiData = apiDataByDate[dateRaw];

                    // 해당 날짜의 기존 데이터를 Firebase에서 확인
                    let baseDataForMerge = [];
                    if (formattedDate === (targetDateStr || getLocalDateString())) {
                        baseDataForMerge = existingData;
                    } else if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                        try {
                            const dateSnap = await firebase.database().ref(`hourlyForecasts/${formattedDate}`).once('value').catch(() => null);
                            const dateVal = dateSnap ? dateSnap.val() : null;
                            if (dateVal && dateVal.data) baseDataForMerge = dateVal.data;
                        } catch (e) {
                            // 권한 부족 등의 사유로 로드 실패 시 무시
                        }
                    }

                    const mergedData = targetHours.map(hourStr => {
                        const existingMatch = baseDataForMerge.find(d => d.time === hourStr);
                        const apiMatch = apiData.find(d => d.time === hourStr);

                        // 1. 실측 데이터가 있으면 무조건 보존
                        if (existingMatch && existingMatch.isObserved) return existingMatch;
                        // 2. 새로운 API 예보 데이터가 있으면 업데이트 (미래 시간)
                        if (apiMatch) return apiMatch;
                        // 3. 기존 데이터(과거 예보 등)가 있다면 유지
                        return existingMatch || null;
                    }).filter(d => d !== null);

                    // 현재 조회 중인 날짜인 경우 결과에 담기
                    if (dateRaw === dateToSearch) {
                        requestedResult = mergedData;
                    }

                    // 저장은 관리자 권한이 있고 동절기(11월~3월)인 경우만 수행
                    const month = parseInt(dateRaw.substring(4, 6));
                    const isWinter = (month >= 11 || month <= 3);
                    if (isAdmin && isWinter && typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                        try {
                            await firebase.database().ref(`hourlyForecasts/${formattedDate}`).update({
                                data: mergedData,
                                updatedAt: Date.now(),
                                isWinter: true
                            });
                        } catch (saveErr) {
                            console.warn('📝 읽기 전용 모드: 데이터를 서버에 저장하지 않았습니다.');
                        }
                    }
                }

                if (requestedResult) return requestedResult;
            }
        } catch (e) {
            console.error('시간별 습도 API 처리 실패:', e);
        }
    }

    // 3. 최종적으로 데이터가 있으면 반환, 없으면 null
    return (existingData && existingData.length > 0) ? existingData : null;
}

/**
 * Firebase에서 과거 시간별 습도 데이터를 불러옵니다.
 */
async function loadHistoricalHourlyHumidity(dateStr) {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return null;

    try {
        const snapshot = await firebase.database().ref(`hourlyForecasts/${dateStr}`).once('value');
        const val = snapshot.val();
        if (val && val.data) {
            console.log(`📦 Firebase에서 과거 습도 데이터 로드 완료 (${dateStr})`);
            return val.data;
        }
    } catch (e) {
        console.error('Firebase 과거 데이터 로드 에러:', e);
    }
    return null;
}

/**
 * 시간별 습도 예보를 화면에 표시합니다.
 */
function displayHourlyHumidity(data, targetDateStr = null) {
    const grid = document.getElementById('hourly-humidity-grid');
    const updateTimeEl = document.getElementById('hourly-update-time');
    const dateInput = document.getElementById('hourly-forecast-date');
    if (!grid) return;

    const todayStr = getLocalDateString();
    const isToday = !targetDateStr || targetDateStr === todayStr;

    if (updateTimeEl) {
        if (isToday) {
            const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            updateTimeEl.textContent = `(실시간 예보: ${nowStr})`;
        } else {
            updateTimeEl.textContent = `(${targetDateStr} 기록)`;
        }
    }

    if (dateInput && !dateInput.value) {
        dateInput.value = targetDateStr || todayStr;
    }

    if (!data || data.length === 0) {
        grid.innerHTML = `<div class="hourly-no-data">${isToday ? '시간별 습도 데이터를 가져오지 못했습니다.' : '해당 날짜의 저장된 기록이 없습니다.'}</div>`;
        return;
    }

    const now = new Date();
    const currentHour = now.getHours();

    // 오전(00:00~11:00)과 오후(12:00~23:00)로 분리
    const amData = data.filter(item => parseInt(item.time.split(':')[0]) < 12);
    const pmData = data.filter(item => parseInt(item.time.split(':')[0]) >= 12);

    const renderItems = (items) => {
        if (items.length === 0) return '<div class="hourly-no-data" style="grid-column: span 12;">해당 시간대 데이터가 없습니다.</div>';

        return items.map(item => {
            const hour = parseInt(item.time.split(':')[0]);
            // 오늘인 경우에만 과거 시간 회색 처리 및 현재 시간 표시
            const isPast = isToday && hour < currentHour;
            const isCurrent = isToday && hour === currentHour;

            // 습도 수준에 따른 클래스 결정
            let humClass = '';
            if (item.humidity >= 85) humClass = 'hum-danger';
            else if (item.humidity >= 75) humClass = 'hum-high';
            else if (item.humidity >= 65) humClass = 'hum-medium';
            else humClass = 'hum-low';

            const currentStyle = isCurrent ? 'border: 2px solid var(--seah-blue); box-shadow: 0 0 15px rgba(0,94,184,0.4); background: rgba(255,255,255,0.9); z-index: 2;' : '';
            const pastStyle = isPast ? 'opacity: 0.4; pointer-events: none;' : '';

            const observedTag = item.isObserved ? '<span class="obs-tag">● 실측</span>' : '';

            return `
                <div class="hourly-humidity-item ${humClass}" style="${currentStyle}${pastStyle}" title="${item.time} 습도: ${item.humidity}% ${item.isObserved ? '(실측 데이터)' : '(기상청 예보)'}">
                    <span class="hourly-time">${item.time.substring(0, 2)}시</span>
                    <span class="hourly-value">${item.humidity}%</span>
                    ${observedTag}
                </div>
            `;
        }).join('');
    };

    grid.innerHTML = `
        <div class="hourly-section">
            <div class="hourly-section-label">🌅 AM <span>오전 ${isToday ? '예보' : '기록'}</span></div>
            <div class="hourly-section-items">${renderItems(amData)}</div>
        </div>
        <div class="hourly-section">
            <div class="hourly-section-label">🌇 PM <span>오후 ${isToday ? '예보' : '기록'}</span></div>
            <div class="hourly-section-items">${renderItems(pmData)}</div>
        </div>
    `;
}

/**
 * 주간 예측 화면에서 시간별 습도 예보를 업데이트합니다.
 */
async function updateHourlyHumidity(targetDate = null) {
    const todayStr = getLocalDateString();
    const dateToLoad = targetDate || todayStr;
    const grid = document.getElementById('hourly-humidity-grid');

    // UI 로딩 표시 (그리드가 있을 때만)
    if (grid) {
        grid.innerHTML = '<div class="hourly-loading">데이터를 불러오는 중...</div>';
    }

    // 1. 데이터 가져오기 및 저장 (이 함수 내부에서 Firebase 저장을 수행함)
    const data = await fetchHourlyHumidityForecast(dateToLoad);

    // 2. UI 업데이트 (그리드가 있을 때만)
    if (grid) {
        displayHourlyHumidity(data, dateToLoad);
    }
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
        let log = null;

        if (editId.startsWith('snap-')) {
            // snap-YYYY-MM-DD-HH:mm-Location 형식 파싱
            const parts = editId.split('-');
            if (parts.length >= 6) {
                const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
                const slot = parts[4];
                const loc = parts.slice(5).join('-');

                if (allReports[date] && allReports[date][slot] && allReports[date][slot].snapshot[loc]) {
                    const snap = allReports[date][slot].snapshot[loc];
                    const report = allReports[date][slot];

                    log = {
                        time: `${date} ${slot}`,
                        location: loc,
                        outdoorTemp: (report.outdoor && typeof report.outdoor === 'object') ? report.outdoor.temp : parseFloat(report.outdoor),
                        outdoorHum: (report.outdoor && typeof report.outdoor === 'object') ? report.outdoor.humidity : 0,
                        steel: snap.steel,
                        temp: snap.temp,
                        humidity: snap.humidity
                    };
                }
            }
        } else {
            // fbKey, timestamp, time 등 다양한 조건으로 검색
            log = monitoringLogs.find(l =>
                (l.fbKey === editId) ||
                (l.timestamp && l.timestamp.toString() === editId) ||
                (new Date(l.time).getTime().toString() === editId)
            );
        }

        if (log) {
            idInput.value = editId;
            dateInput.value = log.time.replace(' ', 'T').slice(0, 16);
            locSelect.value = log.location;
            document.getElementById('past-outdoor').value = log.outdoorTemp || (typeof log.outdoor === 'string' ? parseFloat(log.outdoor) : '');
            document.getElementById('past-outdoor-humid').value = log.outdoorHum || "";
            document.getElementById('past-steel').value = log.steel;
            document.getElementById('past-indoor').value = log.temp;
            document.getElementById('past-humid').value = log.humidity;
            submitBtn.textContent = '수정완료';
        }
    }
    else {
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
        alert('모든 입력 항목을 정확히 작성해주세요.');
        return;
    }

    const dpFixed = calculateDewPoint(indoor, humid);
    const dp = parseFloat(dpFixed);

    let risk = { label: '안전', class: 'status-safe' };
    let reason = '정상 범위';

    const tempDiff = parseFloat((steel - dp).toFixed(1));

    if (tempDiff <= 2.0) {
        risk = { label: '위험', class: 'status-danger' };
        reason = '결로 발생 위험 (강판온도 ≤ 이슬점+2℃)';
    } else if (tempDiff <= 5.0) {
        risk = { label: '주의', class: 'status-caution' };
        reason = '결로 주의 (강판온도 근접)';
    }

    // 수정 대상 찾기
    const index = editId && !editId.startsWith('snap-') ? monitoringLogs.findIndex(l =>
        (l.fbKey === editId) ||
        (l.timestamp && l.timestamp.toString() === editId) ||
        (new Date(l.time).getTime().toString() === editId)
    ) : -1;

    const originalTimestamp = index !== -1 ? (monitoringLogs[index].timestamp || Date.now()) : Date.now();

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
        tempDiff: tempDiff,
        risk: risk.label,
        riskClass: risk.class,
        riskReason: reason,
        source: 'manual_history',
        timestamp: editId && !editId.startsWith('snap-') ? originalTimestamp : Date.now()
    };

    if (editId) {
        // 수정
        if (editId.startsWith('snap-')) {
            const parts = editId.split('-');
            if (parts.length >= 6) {
                const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
                const slot = parts[4];
                const loc = parts.slice(5).join('-');

                if (allReports[date] && allReports[date][slot] && allReports[date][slot].snapshot[loc]) {
                    // 전체 보고서의 외기 정보 업데이트 (해당 시간대 공통)
                    allReports[date][slot].outdoor = {
                        temp: outdoor,
                        humidity: isNaN(outdoorHum) ? 0 : outdoorHum
                    };

                    // 개별 스냅샷 데이터 업데이트
                    const snap = allReports[date][slot].snapshot[loc];
                    snap.steel = steel.toString();
                    snap.dp = dpFixed;
                    snap.temp = indoor.toString();
                    snap.humidity = humid.toString();
                    snap.tempDiff = (steel - dp).toFixed(1);
                    snap.riskLabel = risk.label;
                    snap.product = '결로 인지';

                    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                        const fbSlot = slot.replace(':', '');
                        const updates = {};
                        updates[`reports/${date}/${fbSlot}/outdoor`] = allReports[date][slot].outdoor;
                        updates[`reports/${date}/${fbSlot}/snapshot/${loc}`] = snap;
                        firebase.database().ref().update(updates);
                    } else {
                        localStorage.setItem('seah_all_reports', JSON.stringify(allReports));
                    }
                }
            }
        } else {
            let fbKey = null;
            if (index !== -1) {
                fbKey = monitoringLogs[index].fbKey;
                monitoringLogs[index] = newLog;
            }

            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                if (fbKey || (editId && !editId.startsWith('snap-'))) {
                    const keyToUse = fbKey || editId;
                    firebase.database().ref(`logs/${keyToUse}`).set(newLog);
                } else {
                    firebase.database().ref('logs').push(newLog);
                }
            }
        }
    }
    else {
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

    if (id.startsWith('snap-')) {
        // snap-YYYY-MM-DD-HH:mm-Location
        const parts = id.split('-');
        if (parts.length >= 6) {
            const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
            const slot = parts[4];
            const loc = parts.slice(5).join('-');

            if (allReports[date] && allReports[date][slot] && allReports[date][slot].snapshot[loc]) {
                allReports[date][slot].snapshot[loc].product = '양호';

                if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                    const fbSlot = slot.replace(':', '');
                    firebase.database().ref(`reports/${date}/${fbSlot}/snapshot/${loc}/product`).set('양호')
                        .then(() => {
                            alert('기록이 삭제(상태 변경)되었습니다.');
                            updateCondensationHistory();
                        });
                    return; // Firebase callback에서 처리
                } else {
                    localStorage.setItem('seah_all_reports', JSON.stringify(allReports));
                }
            }
        }
    } else {
        const index = monitoringLogs.findIndex(l =>
            (l.fbKey === id) ||
            (l.timestamp && l.timestamp.toString() === id) ||
            (new Date(l.time).getTime().toString() === id)
        );
        let fbKey = null;
        if (index !== -1) {
            fbKey = monitoringLogs[index].fbKey;
            monitoringLogs.splice(index, 1);
        }

        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            const keyToRemove = fbKey || id;
            if (keyToRemove && (fbKey || !id.startsWith('snap-'))) {
                firebase.database().ref(`logs/${keyToRemove}`).remove()
                    .then(() => {
                        alert('기록이 삭제되었습니다.');
                        updateCondensationHistory();
                    })
                    .catch(err => {
                        console.error('Delete failed:', err);
                        alert('삭제에 실패했습니다.');
                    });
                return;
            }
        }
        localStorage.setItem('seah_logs', JSON.stringify(monitoringLogs));
    }

    alert('기록이 삭제되었습니다.');
    updateCondensationHistory();
}

// 호환성 유지를 위한 더미 함수 (자동 업데이트 스케줄러에서 호출됨)
function updateCurrentTime() {
    // 이미 별도의 setInterval에서 처리 중이므로 비워둠
}

// 고도화된 결로 예측 알고리즘 (빅데이터 분석 및 Sudden Warming 반영)
// [개선] 결로 미발생(안전) 이력도 함께 분석하여 균형 잡힌 판단 수행
function determineFanHeaterOperationV2(minTemp, maxTemp, amRainProb, pmRainProb, humidity, prevMinTemp, historyData = []) {
    const maxRainProb = Math.max(amRainProb, pmRainProb);
    const currentTempDiff = Number((maxTemp - minTemp).toFixed(1));
    const currentAvgHum = Number(humidity || 60);

    // [핵심 로직] 기온 상승폭 분석 (전일 최저 vs 당일 최고)
    const referenceMin = prevMinTemp !== undefined ? prevMinTemp : minTemp;
    const tempJump = Number((maxTemp - referenceMin).toFixed(1));

    let status = {
        fan: false,
        heater: false,
        risk: '안전',
        reason: '정상 범위'
    };

    // [빅데이터 매칭] 과거 발생 이력과 현재 예보 데이터 비교
    // [개선] 위험 이력과 안전 이력을 구분하여 분석
    let dangerMatchCount = 0;
    let safeMatchCount = 0;
    let firstDangerMatch = null;

    // historyData가 새로운 형식(danger/safe 분리) 또는 기존 형식(배열)인지 확인
    const dangerHistory = historyData.danger || historyData || [];
    const safeHistory = historyData.safe || [];

    if (dangerHistory.length > 0) {
        dangerHistory.forEach(h => {
            const hTemp = parseFloat(h.outTemp);
            const hHum = parseFloat(h.outHumid);
            if (!isNaN(hTemp) && !isNaN(hHum) &&
                Math.abs(hTemp - maxTemp) <= 1.5 &&
                Math.abs(hHum - currentAvgHum) <= 7) {
                dangerMatchCount++;
                if (!firstDangerMatch) firstDangerMatch = h;
            }
        });
    }

    // [핵심 개선] 안전 이력 매칭
    if (safeHistory.length > 0) {
        safeHistory.forEach(h => {
            const hTemp = parseFloat(h.outTemp);
            const hHum = parseFloat(h.outHumid);
            if (!isNaN(hTemp) && !isNaN(hHum) &&
                Math.abs(hTemp - maxTemp) <= 1.5 &&
                Math.abs(hHum - currentAvgHum) <= 7) {
                safeMatchCount++;
            }
        });
    }

    // [개선] 이력 기반 위험도 결정 (위험/안전 비율 분석)
    const totalMatch = dangerMatchCount + safeMatchCount;
    const dangerRatio = totalMatch > 0 ? (dangerMatchCount / totalMatch) : 0;
    const hasStrongDangerHistory = (dangerMatchCount > 0 && dangerRatio > 0.6);
    const hasWeakDangerHistory = (dangerMatchCount > 0 && dangerRatio > 0.3 && dangerRatio <= 0.6);
    const hasSafeHistory = (safeMatchCount > 0 && dangerMatchCount === 0);

    // 1. 위험 (Danger) 판정 기준
    const isSuddenWarmingDanger = (tempJump >= 10 && currentAvgHum >= 65);
    const isExtremeDiff = (currentTempDiff >= 12);
    const isExtremeHumid = (currentAvgHum >= 85 && maxTemp > 0);
    const isDeepFreeze = (maxTemp <= 3);

    // [개선] 안전 이력이 충분히 있는 경우, 물리적 위험 판정 기준을 완화
    const physicalDanger = isSuddenWarmingDanger || isExtremeDiff || isExtremeHumid;
    const historyDanger = hasStrongDangerHistory;

    // 안전 이력이 있으면 물리적 위험만으로는 '주의'로 완화 가능
    if ((physicalDanger || historyDanger) && !isDeepFreeze) {
        if (hasSafeHistory && !physicalDanger) {
            // 이력상 위험이지만 안전 사례만 있고 물리적 위험 요소 없음 → 주의로 완화
            status.risk = '주의';
            status.fan = true;
            status.heater = false;
            status.reason = `과거 안전 사례 ${safeMatchCount}건 확인, 모니터링 권장`;
        } else if (hasWeakDangerHistory && !physicalDanger) {
            // 위험/안전 비율이 비등한 경우 → 주의
            status.risk = '주의';
            status.fan = true;
            status.heater = false;
            status.reason = `과거 사례 혼재 (위험${dangerMatchCount}/안전${safeMatchCount}건), 배풍기 가동 권장`;
        } else {
            status.risk = '위험';
            status.fan = true;
            status.heater = (tempJump >= 8 && currentAvgHum >= 80);

            if (historyDanger) {
                status.reason = `과거 유사 사례 기반 위험 감지 (위험${dangerMatchCount}건/안전${safeMatchCount}건)`;
            } else if (isSuddenWarmingDanger) {
                status.reason = `급격한 기온 상승(${tempJump}℃↑) 위험`;
            } else if (isExtremeDiff) {
                status.reason = `극심한 일교차(${currentTempDiff}℃↑) 위험`;
            } else {
                status.reason = `초고습(${currentAvgHum}%↑) 환경 위험`;
            }

            // 안전 사례가 있으면 reason에 참고 정보 추가
            if (safeMatchCount > 0) {
                status.reason += ` (※ 유사 조건 안전 ${safeMatchCount}건 참고)`;
            }
        }
    }
    // 2. 주의 (Caution) 판정 기준
    else if (currentTempDiff >= 8 || currentAvgHum >= 80 || tempJump >= 8 || isDeepFreeze && maxRainProb >= 60) {
        // [개선] 안전 이력이 많으면 주의 → 안전으로 완화 가능
        if (hasSafeHistory && safeMatchCount >= 3 && currentAvgHum < 80) {
            status.risk = '안전';
            status.fan = false;
            status.heater = false;
            status.reason = `과거 안전 사례 ${safeMatchCount}건 확인, 현재 조건 안전`;
        } else {
            status.risk = '주의';
            status.fan = true;

            const isHeaterNeed = (tempJump >= 8 && currentAvgHum >= 80);
            status.heater = isHeaterNeed;

            if (isDeepFreeze && maxRainProb >= 60) status.reason = `한파 중 강수 예보 (고습도 주의)`;
            else if (tempJump >= 8 && currentAvgHum >= 80) status.reason = `기온 급변 및 고습도 복합 주의 (열풍기 권장)`;
            else if (tempJump >= 8) status.reason = `기온 상승 추세(${tempJump}℃↑) 주의`;
            else if (currentAvgHum >= 80) status.reason = `습도 증가(${currentAvgHum}%↑) 주의`;
            else status.reason = `일교차(${currentTempDiff}℃) 주의 구간`;

            // 안전 사례가 있으면 참고 정보 추가
            if (safeMatchCount > 0) {
                status.reason += ` (※ 유사 조건 안전 ${safeMatchCount}건 참고)`;
            }

            if (isDeepFreeze && currentAvgHum < 75 && maxRainProb < 50) {
                status.risk = '안전';
                status.fan = false;
                status.heater = false;
                status.reason = '지속 한파 (안전)';
            }
        }
    } else if (hasSafeHistory) {
        // [추가] 물리적으로 안전하면서 안전 이력도 있는 경우, 신뢰도 표시
        status.reason = `정상 범위 (과거 안전 사례 ${safeMatchCount}건 확인)`;
    }

    return status;
}
