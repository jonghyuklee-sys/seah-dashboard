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
        self.history_patterns = pd.DataFrame()

    def fetch_firebase(self, node):
        try:
            response = requests.get(f"{self.db_url}/{node}.json")
            return response.json() if response.status_code == 200 else {}
        except: return {}

    def push_firebase(self, node, data):
        requests.put(f"{self.db_url}/{node}.json", json=data)

    def analyze_history(self):
        logs = self.fetch_firebase("logs")
        reports = self.fetch_firebase("reports")
        cases = []
        if isinstance(logs, dict):
            for log in logs.values():
                if log.get('risk') == '위험' or log.get('product') == '결로 인지':
                    cases.append({'out_t': float(log.get('outdoorTemp', 0)), 'out_h': float(log.get('outdoorHum', 0))})
        if isinstance(reports, dict):
            for date_slots in reports.values():
                if not isinstance(date_slots, dict): continue
                for slot_data in date_slots.values():
                    if not isinstance(slot_data, dict): continue
                    out = slot_data.get('outdoor', {})
                    out_t = out.get('temp', 0) if isinstance(out, dict) else out
                    out_h = out.get('humidity', 0) if isinstance(out, dict) else 0
                    snap = slot_data.get('snapshot', {})
                    if isinstance(snap, dict):
                        for loc in snap.values():
                            if loc.get('product') == '결로 인지':
                                cases.append({'out_t': float(out_t), 'out_h': float(out_h)})
        if cases:
            self.history_patterns = pd.DataFrame(cases)

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
                    # ms -> sec 변환 후 datetime 객체 생성
                    dt = datetime.datetime.fromtimestamp(d_raw / 1000.0)
                else:
                    # 문자열인 경우 기존 방식
                    dt_str = str(d_raw).split(' ')[0]
                    dt = datetime.datetime.strptime(dt_str, '%Y-%m-%d')
                
                date_str = dt.strftime('%Y-%m-%d')
            except:
                continue
            
            temp_max = float(day.get('maxTemp', 0))
            humidity = float(day.get('humidity', 0))
            
            p_score = 30 if humidity >= 80 else 10
            h_score = 0
            if not self.history_patterns.empty:
                dist = self.history_patterns.apply(
                    lambda x: math.sqrt((x['out_t'] - temp_max)**2 + ((x['out_h'] - humidity)/5)**2), axis=1
                ).min()
                if dist < 3.0: h_score = 65
                elif dist < 8.0: h_score = 40
            
            total_score = min(99, p_score + h_score)
            predictions.append({
                'date': date_str,
                'score': int(total_score),
                'risk': "위험" if total_score >= 60 else "주의" if total_score >= 35 else "안전",
                'reason': f"AI 분석 {int(total_score)}점"
            })
        
        self.push_firebase("aiWeeklyForecast", predictions)
        print("--- AI Predictions Finalized ---")
        for p in predictions[:3]: print(f"Date: {p['date']}, Score: {p['score']}")

if __name__ == "__main__":
    CondensationAIPredictor(FIREBASE_URL).run_prediction()
