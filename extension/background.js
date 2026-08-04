// 로컬 yts-server(claude -p 구독)로 요약 요청 — API 키 불필요
// 서버가 429(유튜브 자막 레이트리밋)/422(자막 못 받음)를 주면, 백그라운드 탭을 열어
// 유튜브 페이지의 스크립트 패널에서 자막을 긁어 재시도한다 (페이지 자체 요청엔 POT 토큰이 붙어 안 막힘)

const SERVER = "http://127.0.0.1:8790/summarize";
const pendingScrapes = new Map(); // videoId -> resolve(transcript|null)

async function callServer(body) {
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json() };
}

function scrapeTranscript(videoId) {
  return new Promise((resolve) => {
    let tabId;
    const timer = setTimeout(() => {
      pendingScrapes.delete(videoId);
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      resolve(null);
    }, 45000);
    pendingScrapes.set(videoId, (t) => {
      clearTimeout(timer);
      resolve(t);
    });
    chrome.tabs
      .create({ url: `https://www.youtube.com/watch?v=${videoId}#yts-transcript`, active: false })
      .then((tab) => (tabId = tab.id));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "yts-transcript") {
    // 스크레이퍼 탭이 보낸 결과
    pendingScrapes.get(msg.videoId)?.(msg.transcript || null);
    pendingScrapes.delete(msg.videoId);
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id).catch(() => {});
    return;
  }
  if (msg.type !== "summarize") return;
  (async () => {
    try {
      let { res, data } = await callServer({ videoId: msg.videoId, title: msg.title, mode: msg.mode });
      if (!res.ok && (res.status === 429 || res.status === 422)) {
        const transcript = await scrapeTranscript(msg.videoId);
        if (transcript) ({ res, data } = await callServer({ videoId: msg.videoId, title: msg.title, mode: msg.mode, transcript }));
      }
      sendResponse(res.ok ? { summary: data.summary, title: data.title, archived: data.archived } : { error: data.error || `서버 오류 (${res.status})` });
    } catch (e) {
      sendResponse({ error: "로컬 요약 서버에 연결할 수 없습니다. (yts-server가 꺼져 있으면 로그인 후 자동 시작됩니다)" });
    }
  })();
  return true; // async sendResponse
});
