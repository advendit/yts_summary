// 로컬 yts-server(claude -p 구독)로 요약 요청 — API 키 불필요

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "summarize") return;
  (async () => {
    try {
      const res = await fetch("http://127.0.0.1:8790/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: msg.videoId, title: msg.title }),
      });
      const data = await res.json();
      sendResponse(res.ok ? { summary: data.summary, title: data.title, archived: data.archived } : { error: data.error || `서버 오류 (${res.status})` });
    } catch (e) {
      sendResponse({ error: "로컬 요약 서버에 연결할 수 없습니다. (yts-server가 꺼져 있으면 로그인 후 자동 시작됩니다)" });
    }
  })();
  return true; // async sendResponse
});
