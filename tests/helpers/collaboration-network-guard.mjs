// 테스트는 필요한 응답을 직접 모의한다. 실수로 남은 fetch는 원격/로컬 모두 거절한다.
globalThis.fetch=async()=>{throw new Error('공유 검증에서 실제 네트워크 호출은 금지됩니다. 모의 응답을 사용하세요.');};
