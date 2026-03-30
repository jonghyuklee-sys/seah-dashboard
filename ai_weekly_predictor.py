import requests
import json
import datetime
import math
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import pandas as pd
from typing import List, Dict

FIREBASE_URL = "https://seahcm-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app"

class CondensationAIPredictor:
    def __init__(self, firebase_url):
        self.db_url = firebase_url
        self.danger_patterns = pd.DataFrame()  # 결로 발생 이력
        self.safe_patterns = pd.DataFrame()    # [개선] 결로 미발생 이력

    def fetch_firebase(self, node):
        try:
            response = requests.get(f"{self.db_url}/{node}.json")
            return response.json() if response.status_code == 200 else {}
        except: return {}

    def push_firebase(self, node, data):
        requests.put(f"{self.db_url}/{node}.json", json=data)

    def analyze_history(self):
        """[개선] 결로 발생 이력과 미발생 이력을 모두 분석하여 균형 잡힌 예측 수행"""
        logs = self.fetch_firebase("logs")
        reports = self.fetch_firebase("reports")
        danger_cases = []
        safe_cases = []

        # 로그에서 수집
        if isinstance(logs, dict):
            for log in logs.values():
                if not isinstance(log, dict):
                    continue
                try:
                    out_t = float(log.get('outdoorTemp', 0))
                    out_h = float(log.get('outdoorHum', 0))
                except (TypeError, ValueError):
                    continue

                if log.get('risk') == '위험' or log.get('product') == '결로 인지' or log.get('source') == 'manual_history':
                    danger_cases.append({'out_t': out_t, 'out_h': out_h})
                elif log.get('risk') == '안전':
                    # [핵심 개선] 안전 건도 수집
                    safe_cases.append({'out_t': out_t, 'out_h': out_h})

        # 보고서에서 수집
        if isinstance(reports, dict):
            for date_slots in reports.values():
                if not isinstance(date_slots, dict): continue
                for slot_data in date_slots.values():
                    if not isinstance(slot_data, dict): continue
                    out = slot_data.get('outdoor', {})
                    try:
                        out_t = float(out.get('temp', 0)) if isinstance(out, dict) else float(out)
                        out_h = float(out.get('humidity', 0)) if isinstance(out, dict) else 0
                    except (TypeError, ValueError):
                        continue

                    snap = slot_data.get('snapshot', {})
                    if isinstance(snap, dict):
                        has_condensation = any(
                            loc.get('product') == '결로 인지'
                            for loc in snap.values()
                            if isinstance(loc, dict)
                        )
                        if has_condensation:
                            danger_cases.append({'out_t': out_t, 'out_h': out_h})
                        else:
                            # [핵심 개선] 결로 미발생 건도 수집
                            safe_cases.append({'out_t': out_t, 'out_h': out_h})

        # 엑셀 업로드 데이터에서 수집
        excel_safe = self.fetch_firebase("excelSafeData")
        if isinstance(excel_safe, dict):
            for d in excel_safe.values():
                if not isinstance(d, dict): continue
                # Python 예측기는 주로 실외 데이터(maxTemp)와 매칭하므로 outTemp가 있는 것을 우선 활용
                out_t = d.get('outTemp')
                out_h = d.get('outHumid')
                if out_t is not None and out_h is not None:
                    safe_cases.append({'out_t': float(out_t), 'out_h': float(out_h)})

        if danger_cases:
            self.danger_patterns = pd.DataFrame(danger_cases)
        if safe_cases:
            self.safe_patterns = pd.DataFrame(safe_cases)

        print(f"📊 이력 분석 완료 - 위험 사례: {len(danger_cases)}건, 안전 사례: {len(safe_cases)}건 (엑셀 포함)")

    def _calc_history_score(self, temp_max, humidity):
        """[개선] 위험/안전 이력 비율을 기반으로 균형 잡힌 이력 점수 산출"""
        danger_score = 0
        safe_score = 0
        threshold_close = 3.0
        threshold_far = 8.0

        # 위험 이력과의 거리 계산
        if not self.danger_patterns.empty:
            danger_dist = self.danger_patterns.apply(
                lambda x: math.sqrt((x['out_t'] - temp_max)**2 + ((x['out_h'] - humidity)/5)**2), axis=1
            )
            # 가까운 위험 사례 개수
            close_danger = (danger_dist < threshold_close).sum()
            mid_danger = ((danger_dist >= threshold_close) & (danger_dist < threshold_far)).sum()
            if close_danger > 0:
                danger_score = 65
            elif mid_danger > 0:
                danger_score = 40

        # [핵심 개선] 안전 이력과의 거리 계산
        close_safe = 0
        if not self.safe_patterns.empty:
            safe_dist = self.safe_patterns.apply(
                lambda x: math.sqrt((x['out_t'] - temp_max)**2 + ((x['out_h'] - humidity)/5)**2), axis=1
            )
            close_safe = (safe_dist < threshold_close).sum()

        # 위험/안전 비율 기반 점수 조정
        if danger_score > 0 and close_safe > 0:
            total = close_danger + close_safe
            danger_ratio = close_danger / total if total > 0 else 0

            if danger_ratio <= 0.3:
                danger_score = max(0, int(danger_score * 0.2))
            elif danger_ratio <= 0.6:
                danger_score = int(danger_score * 0.5)
        elif close_safe > 0 and danger_score == 0:
            danger_score = max(-15, -close_safe * 5)

        return danger_score

    def send_notifications(self, predictions):
        """[신규] 경고 발생 시 다수의 관리자에게 이메일 및 문자 통보"""
    def send_notifications(self, predictions):
        today_dt = datetime.datetime.now()
        month = today_dt.month
        
        # [핵심] 11월 ~ 3월이 아니면 알람 발송 스킵 (사용자 요청)
        if not (month >= 11 or month <= 3):
            print(f"🍂 현재 {month}월은 비동절기이므로 알림 발송을 스킵합니다. (11월~3월만 발송)")
            return

        settings = self.fetch_firebase("settings")
        # 쉼표(,) 또는 세미콜론(;)으로 구분된 원시 데이터 가져오기
        admin_email_raw = settings.get('admin_email', '')
        notify_enabled = settings.get('notify_enabled', True)
        last_notified = settings.get('last_notified_date', '')
        
        today = today_dt.strftime('%Y-%m-%d')
        if last_notified == today or not notify_enabled:
            return

        # D+7 전체 주간 예보 중 경고/위험 데이터 필터링 (최우선순위 리포트)
        high_risk_days = [p for p in predictions if p['risk'] in ['위험', '경고']]
        
        if high_risk_days:
            # 메시지 구성 (가독성 강화 버전)
            title = "[세아씨엠] 🔔 결로 위험 감지 알림 리포트"
            
            content = "🔔 [세아씨엠] 결로 위험 감지 알림\n"
            content += "============================\n\n"
            content += "주간 예보 분석 결과,\n결로 발생 위험이 감지되었습니다.\n\n"
            
            for d in high_risk_days:
                content += f"📍 예상 날짜: {d['date']}\n"
                content += f"⚠️ 위험 수준: {d['risk']} ({d['score']}점)\n"
                content += f"🌡️ 예상 기온: 최저 {d['temp_min']}℃ / 최고 {d['temp_max']}℃\n"
                content += f"💧 예상 습도: {d['humidity']}%\n"
                content += f"🔍 분석 사유: {d['reason']}\n"
                content += "----------------------------\n\n"
            
            content += "🔗 실시간 현황 확인하기:\n"
            content += "https://seahcm-dashboard.web.app\n\n"
            content += "※ AI 예측 엔진 기반 자동 발송"

            # 1. 다중 이메일 발송 (사용자 요청에 따라 SMS 제외)
            email_list = []
            if admin_email_raw:
                # 쉼표나 세미콜론으로 분리하여 리스트화
                email_list = [e.strip() for e in str(admin_email_raw).replace(';', ',').split(',') if e.strip()]
                for to_email in email_list:
                    self._send_email(to_email, title, content, settings)
            
            # 발송 기록 업데이트
            self.push_firebase("settings/last_notified_date", today)
            print(f"🚀 총 {len(email_list)}명에게 상세 이메일 알림을 발송했습니다.")

    def _send_email(self, to_email, title, body, settings):
        try:
            smtp_host = settings.get('smtp_host', 'smtp.gmail.com')
            smtp_port = int(settings.get('smtp_port', 465))
            smtp_user = settings.get('smtp_user', '')
            smtp_pass = str(settings.get('smtp_pass', '')).replace(' ', '')

            if not smtp_user or not smtp_pass:
                print("⚠️ SMTP 계정 정보가 없어 이메일을 발송하지 못했습니다.")
                return

            msg = MIMEMultipart()
            msg['From'] = smtp_user
            msg['To'] = to_email
            msg['Subject'] = title
            msg.attach(MIMEText(body, 'plain'))

            with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            print(f"📧 이메일 발송 완료: {to_email}")
        except Exception as e:
            print(f"❌ 이메일 발송 실패: {str(e)}")

    def run_prediction(self):
        self.analyze_history()
        web_cache = self.fetch_firebase("cachedForecast")
        forecast_list = []
        if isinstance(web_cache, dict) and 'forecast' in web_cache:
            forecast_list = web_cache['forecast']
        
        predictions = []
        for day in forecast_list:
            d_raw = day.get('date', '')
            try:
                if isinstance(d_raw, (int, float)):
                    dt = datetime.datetime.fromtimestamp(d_raw / 1000.0)
                else:
                    dt_str = str(d_raw).split(' ')[0]
                    dt = datetime.datetime.strptime(dt_str, '%Y-%m-%d')
                date_str = dt.strftime('%Y-%m-%d')
            except: continue
            
            temp_max = float(day.get('maxTemp', 0))
            temp_min = float(day.get('minTemp', 0))
            humidity = float(day.get('humidity', 0))
            p_score = 30 if humidity >= 80 else 10
            h_score = self._calc_history_score(temp_max, humidity)

            # [핵심 추가] 계절 및 온도 보정 (사용자 요청: 고온기/비동절기 결로 억제)
            month = dt.month
            is_winter = (month >= 11 or month <= 3)
            if temp_max > 20 or (not is_winter and temp_max > 15):
                p_score = max(0, p_score - 20)
                h_score = h_score * 0.3 if h_score > 0 else h_score

            total_score = max(0, min(99, p_score + h_score))

            if total_score >= 60: risk_label = "위험"
            elif total_score >= 35: risk_label = "주의"
            else: risk_label = "안전"

            # [개선] 발생 원인(Reason) 상세 구성
            causes = []
            if humidity >= 80: causes.append("지속적 고습도")
            if h_score >= 40: causes.append("과거 위험 사례와 높은 유사성")
            elif h_score > 10: causes.append("유사 위험 패턴 감지")
            if not is_winter and temp_max < 10: causes.append("비동절기 이상 저온")
            
            reason_str = ", ".join(causes) if causes else "기상 데이터 복합 요인"

            predictions.append({
                'date': date_str,
                'score': int(total_score),
                'risk': risk_label,
                'temp_max': temp_max,
                'temp_min': temp_min,
                'humidity': humidity,
                'reason': reason_str
            })
        
        self.push_firebase("aiWeeklyForecast", predictions)
        self.send_notifications(predictions)
        print("--- AI Predictions Finalized ---")

if __name__ == "__main__":
    CondensationAIPredictor(FIREBASE_URL).run_prediction()
