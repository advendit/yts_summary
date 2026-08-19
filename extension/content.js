// 유튜브 어디서든 요약: watch 페이지는 즉시, 그 외(홈/검색)는 영상 선택 모드
// 요약은 패널에 계속 쌓임(창 유지). 자막 추출/요약은 로컬 서버(yts-server)가 담당

const BTN_ID = "yts-summary-btn";
const PANEL_ID = "yts-summary-panel";
let pickMode = false;
let currentMode = "summary"; // "summary" | "analyze"
const MODES = {
  summary: { icon: "📝", label: "요약", verb: "요약할", color: "#e62117" },
  // 후킹·구성 비중·스토리텔링·타겟을 해부하는 모드 — "분석"만으로는 안 보여서 기획 분석으로 명명
  analyze: { icon: "🔬", label: "기획 분석", verb: "기획 분석할", color: "#7b2ff2" },
};

function currentVideoId() {
  const u = new URL(location.href);
  return u.searchParams.get("v") || (u.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1] || null;
}

// ---------- 자막 스크레이퍼 모드 (백그라운드 탭에서 스크립트 패널 긁기 — 429 폴백) ----------
// ponytail: 유튜브 DOM 셀렉터 의존이라 마크업 개편 시 깨질 수 있음 — 깨지면 이 블록의 셀렉터만 갱신

async function scrapeMode() {
  const videoId = new URL(location.href).searchParams.get("v");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const poll = async (fn, timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await wait(500);
    }
    return null;
  };
  let transcript = null;
  try {
    // 설명란의 "스크립트 표시" 버튼 — 안 보이면 설명을 펼친 뒤 재시도
    let btn = await poll(() => document.querySelector("ytd-video-description-transcript-section-renderer button"), 8000);
    if (!btn) {
      document.querySelector("#description-inline-expander #expand, tp-yt-paper-button#expand")?.click();
      btn = await poll(() => document.querySelector("ytd-video-description-transcript-section-renderer button"), 5000);
    }
    if (btn) {
      btn.click();
      if (await poll(() => document.querySelector("ytd-transcript-segment-renderer"), 10000)) {
        await wait(1500); // 세그먼트 전체 로딩 여유
        transcript = [...document.querySelectorAll("ytd-transcript-segment-renderer .segment-text")]
          .map((el) => el.textContent.trim())
          .join(" ");
      }
    }
  } catch {}
  chrome.runtime.sendMessage({ type: "yts-transcript", videoId, transcript });
}

if (location.hash === "#yts-transcript") scrapeMode();

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
    // .ytLockupMetadataViewModelTitle: 2026 신형 카드(yt-lockup-view-model)의 제목 앵커 — 구 셀렉터론 0/12 실측(08-19)
    card?.querySelector("#video-title, .ytLockupMetadataViewModelTitle, h3, [title]")?.textContent?.trim() ||
    a.getAttribute("title") ||
    titleNearAnchor(a, videoId) ||
    a.getAttribute("aria-label") ||
    videoId;
  return { videoId, title };
}

// 폴백: 같은 videoId로 가는 주변 링크 중 제일 긴 텍스트 = 제목 (셀렉터·태그명 무관 — 유튜브 개편 대비, 08-19 제목 누락 사건)
function titleNearAnchor(a, videoId) {
  for (let el = a.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
    const texts = [...el.querySelectorAll(`a[href*="${videoId}"]`)]
      .map((l) => (l.getAttribute("title") || l.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 3 && !/^\d{1,2}(:\d{2}){1,2}$/.test(t)); // 재생시간 배지 제외
    if (texts.length) {
      // 카드 전체를 감싸는 앵커 텍스트는 "재생시간+제목+채널+조회수" 뒤범벅 — 제목만 담은 후보는 그 뒤범벅의 부분문자열이다
      const sorted = texts.sort((x, y) => y.length - x.length);
      return sorted.find((t) => sorted.some((T) => T !== t && T.includes(t))) || sorted[0];
    }
  }
  return null;
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
  if (document.getElementById(BTN_ID + "-bar")) return;
  // flex 바 하나에 담아 라벨 길이와 무관하게 자동 배치 — 고정 오프셋(겹침 원인) 제거
  const bar = document.createElement("div");
  bar.id = BTN_ID + "-bar";
  bar.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:2147483647;
    display:flex; gap:10px; align-items:center;`;

  for (const mode of ["summary", "analyze"]) {
    const m = MODES[mode];
    const btn = document.createElement("button");
    btn.id = BTN_ID + "-" + mode;
    btn.textContent = m.icon + " " + m.label;
    btn.style.cssText = `
      background:${m.color}; color:#fff; border:0; border-radius:24px;
      padding:10px 18px; font:bold 14px -apple-system,sans-serif;
      cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.3); white-space:nowrap;`;
    btn.onclick = () => onButtonClick(mode);
    bar.appendChild(btn);
  }

  // 보관함 버튼
  const arc = document.createElement("button");
  arc.id = BTN_ID + "-archive";
  arc.textContent = "📂";
  arc.title = "요약 보관함";
  arc.style.cssText = `
    background:#555; color:#fff; border:0; border-radius:24px;
    padding:10px 14px; font:bold 14px -apple-system,sans-serif;
    cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.3);`;
  arc.onclick = () => window.open("http://127.0.0.1:8790/archive", "_blank");
  bar.appendChild(arc);

  document.body.appendChild(bar);
}

injectButton();
window.addEventListener("yt-navigate-finish", () => {
  injectButton();
  if (pickMode) setPickMode(false);
});
