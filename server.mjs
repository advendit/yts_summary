// 유튜브 요약 로컬 서버 — yt-dlp로 자막 추출, claude -p(구독)로 요약, 마크다운 아카이빙
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, unlink, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const HOME = homedir();
const NODE = process.execPath;
const CLAUDE = process.env.YTS_CLAUDE || "claude";
const YTDLP = process.env.YTS_YTDLP || `${HOME}/.local/bin/yt-dlp`;
const YTDLP_BASE = ["--js-runtimes", `node:${NODE}`]; // 유튜브가 JS 런타임 요구 (2026)
const ARCHIVE = `${HOME}/Documents/YouTube요약`;
const PORT = 8790;

const PROMPT =
  "유튜브 영상 스크립트를 한국어로 정리해라. 형식:\n" +
  "## 한 줄 요약\n## 핵심 내용 (불릿 5~10개)\n## 상세 정리 (주제별 단락)\n" +
  "스크립트에 없는 내용은 지어내지 마라. 요약 외 다른 말은 하지 마라.";

async function getTranscript(videoId) {
  const dir = await mkdtemp(join(tmpdir(), "yts-"));
  try {
    let runError = null;
    await run(
      YTDLP,
      [
        ...YTDLP_BASE,
        "--skip-download", "--write-subs", "--write-auto-subs",
        "--sub-langs", "ko,en", "--sub-format", "json3",
        "-o", join(dir, "%(id)s"),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 120000 }
    ).catch((e) => (runError = e)); // 일부 언어만 실패(429 등)해도 받은 자막은 사용
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json3"));
    if (!files.length) {
      if (runError) throw runError;
      return null;
    }
    const file = files.find((f) => f.includes(".ko.")) || files[0];
    const data = JSON.parse(await readFile(join(dir, file), "utf8"));
    const text = (data.events || [])
      .flatMap((e) => e.segs || [])
      .map((s) => s.utf8)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function summarize(title, transcript) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE,
      ["-p", PROMPT],
      { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).slice(0, 500)));
        else resolve(stdout.trim());
      }
    );
    child.stdin.end(`영상 제목: ${title}\n\n스크립트:\n${transcript}`);
  });
}

async function archive(videoId, title, summary) {
  await mkdir(ARCHIVE, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const safeTitle = title.replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const file = `${ts}_${safeTitle}.md`;
  const body =
    `# ${title}\n\n` +
    `- URL: https://www.youtube.com/watch?v=${videoId}\n` +
    `- 요약일: ${now.toLocaleString("ko-KR")}\n\n---\n\n${summary}\n`;
  await writeFile(join(ARCHIVE, file), body);
  return file;
}

const SAFE_FILE = /^[^\/\\]+\.md$/;

async function listArchive() {
  await mkdir(ARCHIVE, { recursive: true });
  const files = (await readdir(ARCHIVE)).filter((f) => f.endsWith(".md"));
  const items = await Promise.all(
    files.map(async (f) => ({ file: f, mtime: (await stat(join(ARCHIVE, f))).mtimeMs }))
  );
  return items.sort((a, b) => b.mtime - a.mtime).map((i) => i.file);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function archivePage(files) {
  const rows = files
    .map(
      (f) => `<li>
        <a href="#" onclick="view('${encodeURIComponent(f)}');return false">${esc(f.replace(/\.md$/, ""))}</a>
        <button onclick="del('${encodeURIComponent(f)}')">삭제</button>
      </li>`
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube 요약 보관함</title>
<style>
  body{font:15px/1.7 -apple-system,'Apple SD Gothic Neo',sans-serif;max-width:860px;margin:30px auto;padding:0 16px;color:#111}
  li{margin:6px 0;list-style:none} ul{padding:0}
  li a{text-decoration:none;color:#065fd4}
  li button{margin-left:8px;border:0;background:#eee;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px}
  #viewer{white-space:pre-wrap;border:1px solid #ddd;border-radius:10px;padding:20px;margin-top:20px;display:none}
</style></head><body>
<h1>📂 YouTube 요약 보관함 <small style="font-size:14px;color:#888">(${files.length}건 · ~/Documents/YouTube요약)</small></h1>
<ul>${rows || "<li style='color:#888'>아직 요약이 없습니다.</li>"}</ul>
<div id="viewer"></div>
<script>
async function view(f){
  const r = await fetch('/archive/raw?f='+f);
  const v = document.getElementById('viewer');
  v.textContent = await r.text();
  v.style.display = 'block';
  v.scrollIntoView({behavior:'smooth'});
}
async function del(f){
  if(!confirm('삭제할까요?')) return;
  await fetch('/archive/raw?f='+f, {method:'DELETE'});
  location.reload();
}
</script></body></html>`;
}

createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  // 보관함 목록 페이지
  if (req.method === "GET" && url.pathname === "/archive") {
    listArchive()
      .then((files) => {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(archivePage(files));
      })
      .catch((e) => res.writeHead(500).end(e.message));
    return;
  }

  // 보관함 파일 읽기/삭제
  if (url.pathname === "/archive/raw") {
    const f = url.searchParams.get("f") || "";
    if (!SAFE_FILE.test(f)) {
      res.writeHead(400).end("bad filename");
      return;
    }
    const p = join(ARCHIVE, f);
    const op = req.method === "DELETE" ? unlink(p).then(() => "deleted") : readFile(p, "utf8");
    op.then((out) => {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(out);
    }).catch(() => res.writeHead(404).end("not found"));
    return;
  }

  // 요약
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method !== "POST" || url.pathname !== "/summarize") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { videoId, title } = JSON.parse(body);
      console.log(new Date().toISOString(), "요청:", videoId, title);
      if (!/^[\w-]{6,20}$/.test(videoId || "")) throw Object.assign(new Error("잘못된 videoId"), { code: 400 });
      const transcript = await getTranscript(videoId);
      if (!transcript) {
        res.writeHead(422).end(JSON.stringify({ error: "이 영상에는 자막(스크립트)이 없습니다." }));
        return;
      }
      // 익스텐션이 제목을 못 뽑았으면 yt-dlp로 실제 제목 조회
      let realTitle = title;
      if (!realTitle || realTitle === videoId) {
        realTitle = (
          await run(YTDLP, [...YTDLP_BASE, "--skip-download", "--print", "%(title)s", `https://www.youtube.com/watch?v=${videoId}`], { timeout: 60000 })
        ).stdout.trim() || videoId;
      }
      const summary = await summarize(realTitle, transcript);
      const file = await archive(videoId, realTitle, summary).catch((e) => {
        console.error("아카이빙 실패:", e.message);
        return null;
      });
      res.end(JSON.stringify({ summary, title: realTitle, archived: file ? `~/Documents/YouTube요약/${file}` : null }));
    } catch (e) {
      res.writeHead(e.code === 400 ? 400 : 500).end(JSON.stringify({ error: e.message.slice(0, 500) }));
    }
  });
})
  .listen(PORT, "127.0.0.1", () => console.log(`yts-server on ${PORT}`))
  .on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `포트 ${PORT} 충돌 — 로컬 포트 대장 확인 필요` : e.message);
    process.exit(1);
  });
