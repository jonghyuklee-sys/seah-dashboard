# 기상청 API 키 Firebase 설정 가이드

## 개요
이 문서는 SeAH CM 결로 모니터링 시스템에서 기상청 API 키를 Firebase Realtime Database에 안전하게 저장하고 관리하는 방법을 안내합니다.

## API 키 정보
- **단기예보 API 키**: `b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b`
- **중기예보 API 키**: `b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b`

## Firebase 설정 방법

### 1. Firebase Console 접속
1. [Firebase Console](https://console.firebase.google.com/)에 접속합니다.
2. `seahcm-dashboard` 프로젝트를 선택합니다.

### 2. Realtime Database 설정
1. 왼쪽 메뉴에서 **"Realtime Database"**를 클릭합니다.
2. 데이터베이스 화면 상단의 **"데이터"** 탭을 선택합니다.

### 3. API 키 추가

#### 방법 1: Firebase Console UI 사용
1. 데이터베이스 루트에서 `settings` 노드를 찾습니다. (없으면 생성)
2. `settings` 노드를 클릭하고 **"+"** 버튼을 클릭하여 자식 노드를 추가합니다.
3. 다음 두 개의 키-값 쌍을 추가합니다:

   **단기예보 API 키:**
   - 이름: `kma_short_api_key`
   - 값: `b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b`

   **중기예보 API 키:**
   - 이름: `kma_mid_api_key`
   - 값: `b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b`

#### 방법 2: JSON 직접 입력
1. 데이터베이스 루트를 클릭합니다.
2. 오른쪽 상단의 **"⋮"** (더보기) 메뉴를 클릭합니다.
3. **"JSON 가져오기"**를 선택합니다.
4. 다음 JSON을 붙여넣습니다:

```json
{
  "settings": {
    "kma_short_api_key": "b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b",
    "kma_mid_api_key": "b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b"
  }
}
```

### 4. 데이터베이스 구조 확인
설정 완료 후 데이터베이스 구조는 다음과 같아야 합니다:

```
seahcm-dashboard-default-rtdb
├── cachedForecast
├── locationStatus
├── logs
├── reports
└── settings
    ├── kma_short_api_key: "b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b"
    └── kma_mid_api_key: "b1e8a3cd4d8e225f27ee1b04f5ea8175d3afbaeac216a2158087681991c48a4b"
```

## 보안 규칙 설정 (권장)

API 키를 보호하기 위해 Firebase Database 규칙을 설정하는 것이 좋습니다:

1. Firebase Console에서 **"Realtime Database"** > **"규칙"** 탭을 클릭합니다.
2. 다음 규칙을 추가하여 settings 노드를 읽기 전용으로 설정합니다:

```json
{
  "rules": {
    "settings": {
      ".read": true,
      ".write": false
    },
    "logs": {
      ".read": true,
      ".write": true
    },
    "reports": {
      ".read": true,
      ".write": true
    },
    "locationStatus": {
      ".read": true,
      ".write": true
    },
    "cachedForecast": {
      ".read": true,
      ".write": true
    }
  }
}
```

3. **"게시"** 버튼을 클릭하여 규칙을 적용합니다.

## 확인 방법

1. 웹 애플리케이션을 새로고침합니다.
2. 브라우저 개발자 도구(F12)를 열고 **"Console"** 탭을 확인합니다.
3. 다음 메시지가 표시되면 성공입니다:
   - `Firebase에서 단기예보 API 키를 성공적으로 로드했습니다.`
   - `Firebase에서 중기예보 API 키를 성공적으로 로드했습니다.`

4. 대시보드에서 날씨 정보가 정상적으로 표시되는지 확인합니다.
5. "주간 예측" 탭에서 7일 예보가 정상적으로 표시되는지 확인합니다.

## 문제 해결

### API 키가 로드되지 않는 경우
- Firebase Console에서 데이터베이스 경로가 정확한지 확인합니다.
- 브라우저 콘솔에서 오류 메시지를 확인합니다.
- 네트워크 탭에서 Firebase 연결 상태를 확인합니다.

### 날씨 데이터가 표시되지 않는 경우
- API 키가 올바른지 확인합니다.
- 기상청 API 서비스 상태를 확인합니다.
- 브라우저 콘솔에서 API 호출 오류를 확인합니다.

## 주의사항

⚠️ **보안 주의사항**
- API 키는 절대 GitHub 등 공개 저장소에 커밋하지 마세요.
- Firebase Database 규칙을 설정하여 무단 수정을 방지하세요.
- 정기적으로 API 키를 갱신하는 것이 좋습니다.

## 추가 정보

- 기상청 API 문서: https://www.data.go.kr/
- Firebase Realtime Database 문서: https://firebase.google.com/docs/database
