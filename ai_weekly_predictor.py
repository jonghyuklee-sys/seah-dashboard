import requests
import json
import datetime
import math
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
                # 내부 데이터만 있는 경우, 일단 로그 수집에 포함시킬 수 있으나
                # 주간 예보(실외 예보 기반)에서는 영향력이 제한적임

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
            # 가까운 위험 사례와 안전 사례 비율로 점수 조정
            close_danger_count = (self.danger_patterns.apply(
                lambda x: math.sqrt((x['out_t'] - temp_max)**2 + ((x['out_h'] - humidity)/5)**2), axis=1
            ) < threshold_close).sum() if not self.danger_patterns.empty else 0

            total = close_danger_count + close_safe
            danger_ratio = close_danger_count / total if total > 0 else 0

            if danger_ratio <= 0.3:
                # 안전 사례가 압도적 → 이력 점수 대폭 감소
                danger_score = max(0, int(danger_score * 0.2))
            elif danger_ratio <= 0.6:
                # 비등 → 이력 점수 절반
                danger_score = int(danger_score * 0.5)
            # 0.6 초과 → 위험 유지 (감소 없음)
        elif close_safe > 0 and danger_score == 0:
            # 안전 사례만 있는 경우 → 점수 차감 (안전 바이어스)
            danger_score = max(-15, -close_safe * 5)

        return danger_score

    def run_prediction(self):
        self.analyze_history()
        web_cache = self.fetch_firebase("cachedForecast")
        forecast_list = []
        if isinstance(web_cache, dict) and 'forecast' in web_cache:
            forecast_list = web_cache['forecast']
        
        predictions = []
        for day in forecast_list:
            d_raw = day.get('date', '')
            
            # 타임스탬프 처리 (숫자 형태인 경우)
            try:
                if isinstance(d_raw, (int, float)):
                    dt = datetime.datetime.fromtimestamp(d_raw / 1000.0)
                else:
                    dt_str = str(d_raw).split(' ')[0]
                    dt = datetime.datetime.strptime(dt_str, '%Y-%m-%d')
                
                date_str = dt.strftime('%Y-%m-%d')
            except:
                continue
            
            temp_max = float(day.get('maxTemp', 0))
            humidity = float(day.get('humidity', 0))
            
            # 기본 물리적 점수
            p_score = 30 if humidity >= 80 else 10

            # [개선] 위험/안전 이력 비율 기반 점수
            h_score = self._calc_history_score(temp_max, humidity)
            
            total_score = max(0, min(99, p_score + h_score))

            # 리스크 레벨 결정
            if total_score >= 60:
                risk_label = "위험"
            elif total_score >= 35:
                risk_label = "주의"
            else:
                risk_label = "안전"

            # [개선] 안전 이력 반영 여부를 reason에 표시
            safe_count = 0
            if not self.safe_patterns.empty:
                safe_dist = self.safe_patterns.apply(
                    lambda x: math.sqrt((x['out_t'] - temp_max)**2 + ((x['out_h'] - humidity)/5)**2), axis=1
                )
                safe_count = (safe_dist < 3.0).sum()

            reason = f"AI 분석 {int(total_score)}점"
            if safe_count > 0:
                reason += f" (유사조건 안전 {safe_count}건 반영)"

            predictions.append({
                'date': date_str,
                'score': int(total_score),
                'risk': risk_label,
                'reason': reason
            })
        
        self.push_firebase("aiWeeklyForecast", predictions)
        print("--- AI Predictions Finalized ---")
        for p in predictions[:3]: print(f"Date: {p['date']}, Score: {p['score']}, Risk: {p['risk']}")

if __name__ == "__main__":
    CondensationAIPredictor(FIREBASE_URL).run_prediction()
