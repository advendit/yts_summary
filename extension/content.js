// 유튜브 어디서든 요약: watch 페이지는 즉시, 그 외(홈/검색)는 영상 선택 모드
// 요약은 패널에 계속 쌓임(창 유지). 자막 추출/요약은 로컬 서버(yts-server)가 담당

const BTN_ID = "yts-summary-btn";
const PANEL_ID = "yts-summary-panel";
let pickMode = false;
let currentMode = "summary"; // "summary" | "analyze"
const MODES = {
  summary: { icon: "📝", label: "요약", verb: "요약할", color: "#e62117" },
  analyze: { icon: "🔬", label: "분석", verb: "분석할", color: "#7b2ff2" },
};

function currentVideoId() {
  const u = new URL(location.href);
  return u.searchParams.get("v") || (u.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1] || null;
}

// ---------- 누적형 패널 ----------

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position:fixed; top:70px; right:16px; width:440px; max-height:78vh; z-index:2147483647;
    background:#fff; color:#111; border:1px solid #ccc; border-radius:12px;
    box-shadow:0 8px 30px rgba(0,0,0,.25); display:flex; flex-direction:column;
    font:14px/1.6 -apple-system,'Apple SD Gothic Neo',sans-serif;`;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #eee;">
      <strong style="flex:1;font-size:14px;">📝 요약·분석 결과</strong>
      <button id="yts-panel-close" style="border:0;background:#f2f2f2;border-radius:6px;padding:4px 10px;cursor:pointer;">✕</button>
    </div>
    <div id="yts-list" style="overflow-y:auto;"></div>`;
  panel.querySelector("#yts-panel-close").onclick = () => panel.remove();
  document.body.appendChild(panel);
  return panel;
}

function addSection(title, m) {
  const list = ensurePanel().querySelector("#yts-list");
  const sec = document.createElement("div");
  sec.style.cssText = "border-bottom:1px solid #eee;padding:12px 14px;";
  sec.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="flex-shrink:0;font-size:11px;font-weight:bold;color:#fff;border-radius:4px;padding:1px 7px;background:${m.color};">${m.label}</span>
      <strong style="flex:1;font-size:13px;"></strong>
      <button class="yts-sec-copy" style="border:0;background:#f2f2f2;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px;display:none;">복사</button>
    </div>
    <div class="yts-sec-body" style="white-space:pre-wrap;margin-top:6px;"></div>
    <div class="yts-sec-file" style="margin-top:8px;font-size:12px;color:#888;"></div>`;
  sec.querySelector("strong").textContent = title;
  sec.querySelector(".yts-sec-copy").onclick = (e) => {
    navigator.clipboard.writeText(sec.querySelector(".yts-sec-body").textContent);
    e.target.textContent = "복사됨";
  };
  list.appendChild(sec);
  sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return sec;
}

async function summarize(videoId, title, mode) {
  const m = MODES[mode] || MODES.summary;
  const sec = addSection("⏳ " + title, m);
  sec.querySelector(".yts-sec-body").textContent = `자막 추출 + Claude ${m.label} 중… (영상 길이에 따라 1~2분)`;
  try {
    const res = await chrome.runtime.sendMessage({ type: "summarize", videoId, title, mode });
    if (res.error) {
      sec.querySelector("strong").textContent = "⚠️ " + title;
      sec.querySelector(".yts-sec-body").textContent = "오류: " + res.error;
      return;
    }
    sec.querySelector("strong").textContent = m.icon + " " + (res.title || title);
    sec.querySelector(".yts-sec-body").textContent = res.summary;
    sec.querySelector(".yts-sec-copy").style.display = "block";
    if (res.archived) sec.querySelector(".yts-sec-file").textContent = "💾 " + res.archived;
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    sec.querySelector(".yts-sec-body").textContent = "오류: " + e.message;
  }
}

// ---------- 영상 선택 모드 (홈/검색/구독 피드 등) ----------

function setPickMode(on, mode) {
  pickMode = on;
  if (mode) currentMode = mode;
  const m = MODES[currentMode];
  const btn = document.getElementById(BTN_ID + "-" + currentMode);
  const other = document.getElementById(BTN_ID + "-" + (currentMode === "summary" ? "analyze" : "summary"));
  btn.textContent = on ? `👆 ${m.verb} 영상을 클릭하세요 (ESC 취소)` : m.icon + " " + m.label;
  btn.style.background = on ? "#065fd4" : m.color;
  if (other) other.style.display = on ? "none" : "";
  document.documentElement.style.cursor = on ? "crosshair" : "";
}

function videoFromClick(e) {
  const a = e.target.closest('a[href*="/watch?v="], a[href^="/shorts/"]');
  if (!a) return null;
  const u = new URL(a.href, location.origin);
  const videoId = u.searchParams.get("v") || (u.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1];
  if (!videoId) return null;
  // 카드 컨테이너에서 제목 찾기 (실패 시 서버가 yt-dlp로 실제 제목 조회)
  const card = a.closest("ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model");
  const title =
    card?.querySelector("#video-title, h3, [title]")?.textContent?.trim() ||
    a.getAttribute("title") ||
    videoId;
  return { videoId, title };
}

document.addEventListener(
  "click",
  (e) => {
    if (!pickMode) return;
    const video = videoFromClick(e);
    if (!video) return; // 영상이 아닌 곳 클릭은 무시(선택 모드 유지)
    e.preventDefault();
    e.stopImmediatePropagation();
    setPickMode(false);
    summarize(video.videoId, video.title, currentMode);
  },
  true // capture: 유튜브 자체 네비게이션보다 먼저 가로채기
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pickMode) setPickMode(false);
});

// ---------- 버튼 ----------

function onButtonClick(mode) {
  if (pickMode) {
    setPickMode(false, mode);
    return;
  }
  currentMode = mode;
  const videoId = currentVideoId();
  if (videoId) {
    // 시청 중인 영상은 바로 처리
    summarize(videoId, document.title.replace(" - YouTube", ""), mode);
  } else {
    setPickMode(true, mode);
  }
}

function injectButton() {
  if (document.getElementById(BTN_ID + "-summary")) return;
  const positions = { summary: 24, analyze: 110 };
  for (const [mode, right] of Object.entries(positions)) {
    const m = MODES[mode];
    const btn = document.createElement("button");
    btn.id = BTN_ID + "-" + mode;
    btn.textContent = m.icon + " " + m.label;
    btn.style.cssText = `
      position:fixed; bottom:24px; right:${right}px; z-index:2147483647;
      background:${m.color}; color:#fff; border:0; border-radius:24px;
      padding:10px 18px; font:bold 14px -apple-system,sans-serif;
      cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.3);`;
    btn.onclick = () => onButtonClick(mode);
    document.body.appendChild(btn);
  }

  // 보관함 버튼
  const arc = document.createElement("button");
  arc.id = BTN_ID + "-archive";
  arc.textContent = "📂";
  arc.title = "요약 보관함";
  arc.style.cssText = `
    position:fixed; bottom:24px; right:196px; z-index:2147483647;
    background:#555; color:#fff; border:0; border-radius:24px;
    padding:10px 14px; font:bold 14px -apple-system,sans-serif;
    cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.3);`;
  arc.onclick = () => window.open("http://127.0.0.1:8790/archive", "_blank");
  document.body.appendChild(arc);
}

injectButton();
window.addEventListener("yt-navigate-finish", () => {
  injectButton();
  if (pickMode) setPickMode(false);
});
