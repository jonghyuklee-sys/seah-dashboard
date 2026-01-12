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

// ========== 3. DOM 요소 참조 ==========
const elements = {
    locationSelect: document.getElementById('location-select'),
    steelTempInput: document.getElementById('steel-temp-input'),
    tempInput: document.getElementById('temp-input'),
    humidityInput: document.getElementById('humidity-input'),
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
    currentTime: document.getElementById('current-time')
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

function getRiskLevel(tempDiff) {
    if (tempDiff > 5) return {
        label: '안전',
        class: 'status-safe',
        reason: '강판 온도가 이슬점보다 5°C 이상 높아 매우 안전한 상태입니다.'
    };
    if (tempDiff > 2) return {
        label: '주의',
        class: 'status-caution',
        reason: '강판 온도와 이슬점 차이가 좁혀지고 있습니다. 환기 및 온도 관리를 권장합니다.'
    };
    return {
        label: '위험',
        class: 'status-danger',
        reason: '이슬점이 강판 온도에 근접했습니다. 결로 발생 가능성이 매우 높으므로 즉시 조치가 필요합니다.'
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
    const html = WAREHOUSE_LOCATIONS.map(loc => {
        // 데이터가 있으면 사용, 없으면 기본값
        const data = latestLocationStatus[loc] || {
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

        return `
            <div class="status-item">
                <div class="loc-main-content">
                    <div class="loc-header">
                        <span class="loc-name">${loc}</span>
                        <span class="loc-data">${data.steel}°C / ${data.dp}°C <small>(${data.time})</small></span>
                    </div>
                    <div class="status-badges">
                        <button class="badge badge-gate ${gateClass}" data-location="${loc}" data-field="gate">GATE: ${data.gate} ▾</button>
                        <button class="badge badge-pack ${packClass}" data-location="${loc}" data-field="pack">${data.pack} ▾</button>
                    </div>
                </div>
                <div class="loc-status-aside">
                    <button class="badge badge-product ${prodClass}" data-location="${loc}" data-field="product">${data.product} ▾</button>
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
        time: new Date().toLocaleTimeString()
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
    const data = latestLocationStatus[location];
    if (!data) {
        alert('먼저 해당 위치의 환경 데이터를 입력해주세요.');
        return;
    }

    if (field === 'gate') {
        data.gate = data.gate === '열림' ? '닫힘' : '열림';
    } else if (field === 'pack') {
        data.pack = data.pack === '포장' ? '미포장' : '포장';
    } else if (field === 'product') {
        data.product = data.product === '양호' ? '결로 인지' : '양호';
    }

    updateLocationStatus(location, data.steel, data.dp, { label: data.riskLabel, class: data.riskClass }, data.gate, data.pack, data.product);
}

// ========== 8. UI 업데이트 ==========
function updateUI(location, steelTemp, indoorTemp, humidity, outdoor) {
    const dp = calculateDewPoint(indoorTemp, humidity);
    const diff = (steelTemp - dp).toFixed(1);
    const risk = getRiskLevel(diff);

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
    saveLog(location, steelTemp, indoorTemp, humidity, outdoor, dp, risk.label);

    // 위치 상태 업데이트
    const existing = latestLocationStatus[location] || { gate: '닫힘', pack: '포장', product: '양호' };
    updateLocationStatus(location, steelTemp, dp, risk, existing.gate, existing.pack, existing.product);
}

// ========== 9. 로그 관리 ==========
function saveLog(location, steelTemp, indoorTemp, humidity, outdoor, dp, riskLabel) {
    const selDate = elements.reportDate.value;
    const selTime = elements.reportTime.value;
    const targetTime = selTime === '실시간' ? new Date().toLocaleTimeString() : selTime;

    const logEntry = {
        time: `${selDate} ${targetTime}`,
        location: location,
        steel: `${steelTemp}°C`,
        indoor: `${indoorTemp}°C / ${humidity}%`,
        outdoor: `${outdoor}°C`,
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

// ========== 10. 날씨 API ==========
// ========== 10. 실시간 날씨 연동 (Dashboard) ==========
// 세아씨엠 위치: 전라북도 군산시 자유로 241 (소룡동)
// 기상청 격자 좌표: nx=56, ny=127 (군산 소룡동/조촌동 지역)
async function updateWeatherData() {
    const API_KEY = localStorage.getItem('kma_api_key');
    const nx = 56, ny = 127; // 군산 세아씨엠 (소룡동)

    if (!API_KEY || API_KEY === 'MOCK_KEY') {
        const hours = new Date().getHours();
        const mockTemp = (5 + Math.cos((hours - 14) * Math.PI / 12) * 5).toFixed(1);
        if (elements.outdoorTemp) elements.outdoorTemp.textContent = `${mockTemp}°C`;
        return parseFloat(mockTemp);
    }

    try {
        const now = new Date();
        const todayStr = getLocalDateString().replace(/-/g, '');

        // 1. 초단기실황 (현재 기온) - 날짜변경 처리 포함
        let ncstHour = now.getHours();
        let ncstDate = todayStr;
        if (now.getMinutes() < 45) ncstHour--;
        if (ncstHour < 0) {
            ncstHour = 23;
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            ncstDate = getLocalDateString(yesterday).replace(/-/g, '');
        }
        const ncstBaseTime = String(ncstHour).padStart(2, '0') + '00';
        const encodedKey = encodeURIComponent(API_KEY);
        const ncstUrl = `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${encodedKey}&dataType=JSON&base_date=${ncstDate}&base_time=${ncstBaseTime}&nx=${nx}&ny=${ny}`;

        // 2. 단기예보 (오늘 강수 정보)
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
        const fcstUrl = `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${encodedKey}&dataType=JSON&base_date=${fcstBaseDate}&base_time=${String(fcstBaseTime).padStart(2, '0')}00&nx=${nx}&ny=${ny}&numOfRows=500`;

        const [ncstRes, fcstRes] = await Promise.all([
            fetch(ncstUrl).then(r => r.json()),
            fetch(fcstUrl).then(r => r.json())
        ]);

        let currentTemp = 0;
        if (ncstRes?.response?.header?.resultCode === '00') {
            const tempItem = ncstRes.response.body.items.item.find(i => i.category === 'T1H');
            if (tempItem) {
                currentTemp = parseFloat(tempItem.obsrValue);
                if (elements.outdoorTemp) elements.outdoorTemp.textContent = `${currentTemp}°C`;
            }
        }

        if (fcstRes?.response?.header?.resultCode === '00') {
            const items = fcstRes.response.body.items.item.filter(i => i.fcstDate === todayStr);
            const pops = items.filter(i => i.category === 'POP');
            const pcps = items.filter(i => i.category === 'PCP');

            const getStat = (arr, start, end) => {
                const slice = arr.filter(i => {
                    const t = parseInt(i.fcstTime);
                    return t >= start && t < end;
                });
                return slice.length > 0 ? Math.max(...slice.map(i => parseInt(i.fcstValue) || 0)) : 0;
            };

            const amPop = getStat(pops, 600, 1200);
            const pmPop = getStat(pops, 1200, 2400);

            if (elements.weatherAmProb) elements.weatherAmProb.textContent = `${amPop}%`;
            if (elements.weatherPmProb) elements.weatherPmProb.textContent = `${pmPop}%`;
            if (elements.weatherAmRain) elements.weatherAmRain.textContent = '0mm'; // PCP 파싱 복잡성으로 우선 0mm 처리 유지
            if (elements.weatherPmRain) elements.weatherPmRain.textContent = '0mm';
        }

        return currentTemp;
    } catch (e) {
        console.error('Weather Sync Error:', e);
        return 0;
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
    const rawAllReports = localStorage.getItem('seah_all_reports');
    const reports = JSON.parse(rawAllReports || '{}');
    const selectedDate = document.getElementById('status-inspection-date')?.value || document.getElementById('report-date').value;
    const dayReports = reports[selectedDate] || {};

    const times = ['07:00', '15:00'];
    times.forEach(time => {
        const slotId = `slot-${time.replace(':', '')}`;
        const slot = document.getElementById(slotId);
        if (!slot) return;

        const editBtn = document.getElementById(`edit-btn-${time.replace(':', '')}`);
        const viewBtn = document.getElementById(`view-btn-${time.replace(':', '')}`);
        const statusText = slot.querySelector('.slot-status');

        if (dayReports[time]) {
            // 이미 해당 시간대 보고가 존재하는 경우
            slot.classList.add('completed');
            statusText.innerText = '등록 완료';

            if (editBtn) {
                editBtn.innerText = '수정';
                editBtn.className = 'btn-mini btn-primary-mini';
                editBtn.disabled = false;
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
                editBtn.disabled = false;
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

    // 항상 localStorage의 최신 데이터를 기준으로 히스토리를 조회하도록 보정
    const rawAllReports = localStorage.getItem('seah_all_reports');
    const reports = JSON.parse(rawAllReports || '{}');
    const dayData = reports[targetDate];

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

        tableRows += `
            <tr class="slot-header-row">
                <td colspan="7" style="background: #f1f4f8; font-weight: bold; text-align: left; padding-left: 15px;">
                    📅 ${slot} 보고 (실외: ${data.outdoor}°C)
                </td>
            </tr>
        `;

        Object.entries(data.snapshot).forEach(([loc, info]) => {
            tableRows += `
                <tr>
                    <td>${loc}</td>
                    <td>${slot}</td>
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
    const navDashboard = document.getElementById('nav-dashboard');
    const navForecast = document.getElementById('nav-forecast');

    if (!dashboardView || !forecastView) return;

    if (view === 'dashboard') {
        dashboardView.classList.add('active');
        forecastView.classList.remove('active');
        if (navDashboard) navDashboard.classList.add('active');
        if (navForecast) navForecast.classList.remove('active');
    } else {
        dashboardView.classList.remove('active');
        forecastView.classList.add('active');
        if (navDashboard) navDashboard.classList.remove('active');
        if (navForecast) navForecast.classList.add('active');
        updateWeeklyForecast();
    }
}

// 배풍기/열풍기 가동 판단 및 결로 위험도 평가 함수
function determineFanHeaterOperation(minTemp, maxTemp, amRainProb, pmRainProb) {
    const avgTemp = (minTemp + maxTemp) / 2;
    const maxRainProb = Math.max(amRainProb, pmRainProb);

    // 기본값: 설비 가동 안함, 안전
    let status = {
        fan: false,
        heater: false,
        risk: '안전',
        reason: '정상 범위'
    };

    // 1. 열풍기 가동 조건: 평균 기온 5도 이하 (저온으로 인한 강판 과냉각 위험)
    if (avgTemp <= 5) {
        status.heater = true;
        status.risk = '주의';
        status.reason = '저온으로 인한 결로 위험 (열풍기 가동 권장)';
    }

    // 2. 배풍기 가동 조건: 강수확률 30% 이하 & 기온 5~15도 (환기 가능 조건)
    else if (maxRainProb <= 30 && avgTemp > 5 && avgTemp <= 15) {
        status.fan = true;
        status.reason = '환기 권장 (낮은 강수확률)';
    }

    // 3. 결로 주의 조건 보완: 강수확률이 높거나 습도가 높을 것으로 예상되는 경우
    if (maxRainProb > 50) {
        status.risk = '주의';
        status.reason = '높은 강수 확률로 인한 습도 상승 주의';
    }

    return status;
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

            const outdoor = await updateWeatherData();
            updateUI(loc, st, it, h, outdoor);
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
            const todayReports = snapshot.val() || {};
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

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 뷰 설정
    toggleView('dashboard');

    console.log('=== 앱 초기화 완료 ===');
    console.log('위치별 현황이 표시되어야 합니다.');
}

// ========== 16. 주간 예보 (D+1 ~ D+7) ==========
// 기상청 API 호출 도우미: 응답 코드에 따라 이전 base_time 시도
async function fetchWithBaseTimeSearch(baseUrl, getParams, initialBaseTime, serviceKey) {
    const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
    let currentIdx = baseTimes.indexOf(parseInt(initialBaseTime));
    if (currentIdx === -1) currentIdx = 0;

    for (let i = currentIdx; i < baseTimes.length; i++) {
        const bt = String(baseTimes[i]).padStart(2, '0') + '00';
        const url = `${baseUrl}?serviceKey=${serviceKey}&${getParams(bt)}`;
        console.log(`기상청 API 시도 중: ${bt}...`);

        try {
            const res = await fetch(url).then(r => r.json());
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

async function updateWeeklyForecast() {
    const grid = document.getElementById('weekly-forecast-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="text-center" style="grid-column: span 7;">실시간 7일 예보를 불러오는 중입니다...</p>';

    try {
        const API_KEY = localStorage.getItem('kma_api_key');
        let forecast = [];

        if (!API_KEY || API_KEY === 'MOCK_KEY') {
            forecast = generateMockWeeklyForecast();
        } else {
            forecast = await fetchIntegratedWeeklyForecast(API_KEY);
        }

        displayWeeklyForecast(forecast);
        updateManagementGuide(forecast);
    } catch (e) {
        console.error('Forecast Update Failed:', e);
        grid.innerHTML = '<p class="text-center" style="grid-column: span 7; color: #ff4444;">데이터 로드 실패. API 키를 확인해주세요.</p>';
    }
}

async function fetchIntegratedWeeklyForecast(apiKey) {
    // 세아씨엠 위치: 전라북도 군산시 자유로 241 (소룡동)
    // 기상청 격자 좌표: nx=56, ny=127
    const nx = 56, ny = 127; // 군산 세아씨엠 (소룡동)
    const regIdTa = '11F20503'; // 군산 - 중기기온예보
    const regIdLand = '11F20000'; // 전북 - 중기육상예보
    const todayStr = getLocalDateString().replace(/-/g, '');
    const now = new Date();
    const encodedKey = encodeURIComponent(apiKey);

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
    const getShortParams = (bt) => `dataType=JSON&base_date=${fcstBaseDate}&base_time=${bt}&nx=${nx}&ny=${ny}&numOfRows=1000`;
    const shortRes = await fetchWithBaseTimeSearch(
        'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',
        getShortParams,
        fcstBaseTime,
        encodedKey
    );

    // 2. 중기예보 D+4 ~ D+10 (발표시간 06:00, 18:00)
    // 중기예보는 발표 시각이 고정되어 있으므로 검색 로직 대신 정확한 시각 시도
    let midTmFc = now.getHours() < 18 ? `${todayStr}0600` : `${todayStr}1800`;
    let midTaUrl = `http://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?serviceKey=${encodedKey}&dataType=JSON&regId=${regIdTa}&tmFc=${midTmFc}`;
    let midLandUrl = `http://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?serviceKey=${encodedKey}&dataType=JSON&regId=${regIdLand}&tmFc=${midTmFc}`;

    let [midTaRes, midLandRes] = await Promise.all([
        fetch(midTaUrl).then(r => r.json()).catch(() => null),
        fetch(midLandUrl).then(r => r.json()).catch(() => null)
    ]);

    // 06:00 데이터가 아직 없을 경우 어제 18:00 데이터 시도
    if (midTaRes?.response?.header?.resultCode !== '00' && now.getHours() < 18) {
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        const yestStr = getLocalDateString(yesterday).replace(/-/g, '');
        midTmFc = `${yestStr}1800`;
        midTaUrl = `http://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?serviceKey=${encodedKey}&dataType=JSON&regId=${regIdTa}&tmFc=${midTmFc}`;
        midLandUrl = `http://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?serviceKey=${encodedKey}&dataType=JSON&regId=${regIdLand}&tmFc=${midTmFc}`;

        [midTaRes, midLandRes] = await Promise.all([
            fetch(midTaUrl).then(r => r.json()).catch(() => null),
            fetch(midLandUrl).then(r => r.json()).catch(() => null)
        ]);
    }

    const result = [];
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const tomorrowStr = tomorrow.toISOString().split('T')[0].replace(/-/g, '');
    console.log(`D+1 시작일: ${tomorrowStr} (${tomorrow.toLocaleDateString()})`);

    // [단기 데이터 매핑] D+1 ~ D+3 (오늘 데이터 제외)
    const shortMap = {};
    if (shortRes?.response?.header?.resultCode === '00') {
        console.log('단기예보 API 응답 성공');
        shortRes.response.body.items.item.forEach(item => {
            const dateStr = item.fcstDate;
            const d = new Date(dateStr.substring(0, 4), parseInt(dateStr.substring(4, 6)) - 1, dateStr.substring(6, 8));

            // D+1 (내일)부터의 데이터만 사용 - 오늘 데이터 완전 제외
            if (dateStr < tomorrowStr) return;

            if (!shortMap[dateStr]) {
                shortMap[dateStr] = { date: d, dateStr: dateStr, temps: [], pops: [], pty: [], sky: [] };
            }
            if (item.category === 'TMP') shortMap[dateStr].temps.push(parseFloat(item.fcstValue));
            if (item.category === 'POP') shortMap[dateStr].pops.push(parseInt(item.fcstValue));
            if (item.category === 'PTY') shortMap[dateStr].pty.push(parseInt(item.fcstValue));
            if (item.category === 'SKY') shortMap[dateStr].sky.push(parseInt(item.fcstValue));
        });
        console.log('단기예보 매핑된 날짜:', Object.keys(shortMap).sort());
    } else {
        console.warn('단기예보 API 응답 실패:', shortRes?.response?.header?.resultCode);
    }

    // 단기 데이터로 D+1 ~ D+3 채우기
    const shortKeys = Object.keys(shortMap).sort();
    shortKeys.forEach(dateStr => {
        if (result.length >= 3) return; // D+1, D+2, D+3만 우선 사용
        const day = shortMap[dateStr];
        const min = Math.min(...day.temps);
        const max = Math.max(...day.temps);
        const amPop = day.pops.length > 8 ? Math.max(...day.pops.slice(6, 12)) : Math.max(...day.pops);
        const pmPop = day.pops.length > 12 ? Math.max(...day.pops.slice(12, 18)) : Math.max(...day.pops);
        const op = determineFanHeaterOperation(min, max, amPop, pmPop);

        result.push({
            date: day.date,
            dateStr: dateStr,
            minTemp: min,
            maxTemp: max,
            amRainProb: amPop,
            pmRainProb: pmPop,
            weatherType: mapDetailedWeather(day.sky, day.pty),
            locationName: "군산 세아씨엠",
            ...op
        });
    });

    console.log(`단기예보 연동 완료: ${result.length}일치`);

    // [중기 데이터 보완] D+4 ~ D+7
    console.log('=== 중기예보 데이터 처리 ===');
    if (midTaRes?.response?.header?.resultCode === '00' && midLandRes?.response?.header?.resultCode === '00') {
        console.log('중기예보 API 응답 성공');
        const ta = midTaRes.response.body.items.item[0];
        const land = midLandRes.response.body.items.item[0];

        // i=3 이 날씨누리 기준 '3일 후' (즉 D+3), 우리는 D+4(i=4)부터 필요하지만 
        // 데이터 정합성을 위해 i=3부터 체크하여 result에 없는 날짜를 추가
        for (let i = 3; i <= 7; i++) {
            const d = new Date(tomorrow);
            d.setDate(tomorrow.getDate() + (i - 1));
            const targetDateStr = d.toISOString().split('T')[0].replace(/-/g, '');

            // 이미 단기예보로 해당 날짜가 있으면 스킵
            if (result.some(r => r.dateStr === targetDateStr)) continue;
            if (result.length >= 7) break;

            const min = parseFloat(ta[`taMin${i}`]);
            const max = parseFloat(ta[`taMax${i}`]);
            const amPop = land[`rnSt${i}Am`] !== undefined ? land[`rnSt${i}Am`] : land[`rnSt${i}`];
            const pmPop = land[`rnSt${i}Pm`] !== undefined ? land[`rnSt${i}Pm`] : land[`rnSt${i}`];
            const wf = land[`wf${i}Am`] || land[`wf${i}`];
            const op = determineFanHeaterOperation(min, max, amPop, pmPop);

            result.push({
                date: d,
                dateStr: targetDateStr,
                minTemp: min,
                maxTemp: max,
                amRainProb: amPop,
                pmRainProb: pmPop,
                weatherType: mapMidStatus(wf),
                locationName: "군산 세아씨엠",
                ...op
            });
        }
    }

    // 결과가 7일이 안될 경우 Mock 데이터로 보정 (최후의 수단)
    if (result.length < 7) {
        console.warn(`예보 데이터 부족 (${result.length}일). 부족분 Mock 데이터 생성.`);
        const lastDate = result.length > 0 ? new Date(result[result.length - 1].date) : new Date(tomorrow);
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
                weatherType: 'sunny',
                ...op
            });
        }
    }

    // 최종 결과 로깅
    console.log('=== 주간 예보 최종 결과 ===');
    console.log(`총 ${result.length}일치 예보 데이터`);
    result.slice(0, 7).forEach((day, idx) => {
        console.log(`D+${idx + 1}: ${day.dateStr} (${day.date.toLocaleDateString()}) - 최저 ${day.minTemp}°C / 최고 ${day.maxTemp}°C`);
    });

    return result.slice(0, 7);
}

function mapDetailedWeather(skyArr, ptyArr) {
    if (!ptyArr.length) return 'sunny';
    // 하루 중 가장 "심각한" 기상 상태를 우선 표시 (눈 > 비 > 구름)
    if (ptyArr.includes(3)) return 'snow';
    if (ptyArr.some(p => p === 1 || p === 2 || p === 4)) return 'rain-light';

    const midIdx = Math.floor(skyArr.length / 2);
    const sky = skyArr[midIdx] || 1;
    if (sky === 1) return 'sunny';
    if (sky === 3) return 'cloudy';
    return 'cloudy-heavy';
}

function mapMidStatus(wf) {
    if (!wf) return 'sunny';
    if (wf.includes('비')) return 'rain-light';
    if (wf.includes('눈')) return 'snow';
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
        const dateStr = `${day.date.getMonth() + 1}/${day.date.getDate()}(${['일', '월', '화', '수', '목', '금', '토'][day.date.getDay()]})`;
        const riskClass = day.risk === '안전' ? 'status-safe' : 'status-caution';
        return `
            <div class="forecast-day-card">
                <h4>${dateStr}</h4>
                <div class="forecast-icon icon-${day.weatherType}"></div>
                <div class="forecast-temp">
                    <span class="temp-min">${day.minTemp.toFixed(1)}°</span>
                    <span class="temp-max">${day.maxTemp.toFixed(1)}°</span>
                </div>
                <div class="forecast-rain">
                    <div class="rain-item"><span class="rain-label">오전</span><span class="rain-prob">${day.amRainProb}%</span></div>
                    <div class="rain-item"><span class="rain-label">오후</span><span class="rain-prob">${day.pmRainProb}%</span></div>
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
    const modal = document.getElementById('setting-modal');
    const input = document.getElementById('kma-api-key');
    if (modal && input) {
        input.value = localStorage.getItem('kma_api_key') || '';
        modal.style.display = 'block';
    }
}

function closeSettingModal() {
    const modal = document.getElementById('setting-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function saveSettings() {
    const input = document.getElementById('kma-api-key');
    if (input) {
        const apiKey = input.value.trim();
        if (apiKey) {
            localStorage.setItem('kma_api_key', apiKey);
            alert('설정이 저장되었습니다.\n이제 기상청 API를 사용하여 주간 날씨를 업데이트합니다.');
            updateWeeklyForecast(); // 데이터 새로고침
        } else {
            localStorage.removeItem('kma_api_key');
            alert('API 키가 삭제되었습니다. 데모 모드로 전환됩니다.');
            updateWeeklyForecast();
        }
        closeSettingModal();
    }
}

