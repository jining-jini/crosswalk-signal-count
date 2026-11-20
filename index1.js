/* =====================================================================
   1. 데이터  (시각은 모두 한국 시각, "시:분:초")
   ===================================================================== */

// 횡단보도 5개. x, y = 지도 위 동그라미 중심 (지도 가로·세로의 %), tx, ty = 시각 두 줄 위치
const CROSSWALKS = {
  1: { name: "정문약국 앞",   x: 46.3, y: 41.1, tx: 50.6, ty: 37.9 },
  2: { name: "빽다방 앞",     x: 64.0, y: 46.9, tx: 68.2, ty: 43.6 },
  3: { name: "집 앞",         x: 60.3, y: 57.8, tx: 62.8, ty: 60.2 },
  4: { name: "대학약국 쪽",   x: 44.8, y: 57.5, tx: 42.0, ty: 60.6 },
  5: { name: "충북대병원 쪽", x: 38.0, y: 46.7, tx: 32.9, ty: 49.8 },
};

// 처음 열었을 때 화면 한가운데에 올 지점 = 오거리 중심 (횡단보도 5개 위치의 평균)
const CENTER = {
  x: Object.values(CROSSWALKS).reduce((a, c) => a + c.x, 0) / 5,   // 지도 가로의 %
  y: Object.values(CROSSWALKS).reduce((a, c) => a + c.y, 0) / 5,   // 지도 세로의 %
};

// 켜지는 순서 (시계방향)
const ORDER = [5, 1, 2, 3, 4];

// 신호 계획. g = 녹색 시간, d = 꺼지고 다음 번호가 켜질 때까지 (초)
const PLANS = {
  day: {   // 180초. 11/17 19:47 영상 실측
    C: 180,
    g: { 5: 21.83, 1: 32.80, 2: 25.79, 3: 27.80, 4: 32.82 },
    d: { 5:  5.15, 1:  7.22, 2:  5.22, 3: 14.18, 4:  7.13 },
  },
  night: { // 170초. 11/14 06:24 영상 실측
    C: 170,
    g: { 5: 21.87, 1: 32.80, 2: 25.79, 3: 27.80, 4: 32.82 },
    d: { 5:  5.18, 1:  6.24, 2:  5.19, 3:  5.20, 4:  7.13 },
  },
};

// 하루 종일 180초 하나로 계산 (주간·야간 계획 구분 없음)
// 기준: 11/18 13:11:40.0 3번 녹색 켜짐 (영상 실측). 180초는 하루에 딱 480번이라 매일 같은 시각에 반복
const SEGMENTS = [
  { from: "00:00:00", to: "24:00:00", plan: "day", ref: { n: 3, at: "13:11:40.0" }, label: "180초 고정",
    src: "11/18 13:11:40.0 3번 녹색 (영상 실측)", guess: "실제 신호는 23:00~07:00 무렵 170초로 바뀌므로 그 시간대엔 안 맞음" },
];

/* =====================================================================
   2. 계산
   ===================================================================== */

const KST = 9 * 3600 * 1000;
const sec = hms => { const [h, m, s] = hms.split(":").map(Number); return h * 3600 + m * 60 + s; };
const todOf = ms => (((ms + KST) / 1000) % 86400 + 86400) % 86400;   // 한국 자정부터 지난 초
const dayStartOf = ms => ms - todOf(ms) * 1000;                        // 그날 한국 자정 (ms)

// 계획마다: 5번 녹색 켜짐을 0초로 놓고 각 번호의 녹색 시작 s, 끝 e
// 한 바퀴씩 잰 값의 합계(S)를 실제 주기(C)에 맞게 비례로 조정
for (const P of Object.values(PLANS)) {
  P.S = ORDER.reduce((a, n) => a + P.g[n] + P.d[n], 0);
  const f = P.C / P.S;
  P.s = {}; P.e = {};
  let t = 0;
  for (const n of ORDER) { P.s[n] = t; P.e[n] = t + P.g[n] * f; t += (P.g[n] + P.d[n]) * f; }
}
for (const seg of SEGMENTS) {
  seg.a = sec(seg.from); seg.b = sec(seg.to);
  if (seg.plan) {
    const P = PLANS[seg.plan];
    seg.A = sec(seg.ref.at) - P.s[seg.ref.n];   // 5번 녹색이 켜지는 한 시각 (자정 기준 초)
  }
}
const segAt = tod => SEGMENTS.find(s => tod >= s.a && tod < s.b);

// n번이 녹색으로 켜지는 시각을 fromMs 이후로 count개 (시간표 경계를 넘어가도 계산)
function greenOns(n, fromMs, count) {
  const out = [];
  let day0 = dayStartOf(fromMs);
  for (let guard = 0; guard < 20 && out.length < count; guard++) {
    for (const seg of SEGMENTS) {
      if (!seg.plan) continue;
      const P = PLANS[seg.plan];
      const lo = Math.max(day0 + seg.a * 1000, fromMs), hi = day0 + seg.b * 1000;
      if (lo >= hi) continue;
      const base = day0 + (seg.A + P.s[n]) * 1000;            // 기준이 되는 녹색 시각
      let m = Math.ceil((lo - base) / (P.C * 1000));
      for (let t = base + m * P.C * 1000; t < hi && out.length < count; t += P.C * 1000) out.push(t);
      if (out.length >= count) break;
    }
    day0 += 86400 * 1000;
  }
  return out;
}

// 지금 n번 상태
function stateNow(n, nowMs) {
  const seg = segAt(todOf(nowMs));
  const next = greenOns(n, nowMs, 2);
  if (!seg.plan) return { known: false, next };
  const P = PLANS[seg.plan];
  let phi = (todOf(nowMs) - seg.A) % P.C; if (phi < 0) phi += P.C;
  const green = phi >= P.s[n] && phi < P.e[n];
  const left = green ? P.e[n] - phi : (next[0] - nowMs) / 1000;
  const known = true;   // 180초 하나로만 계산하므로 항상 계산 가능
  return { known, green, left, next, seg };
}

/* =====================================================================
   3. 지도 확대·이동 (브라우저 확대 대신 직접 처리 → 아래 시계는 크기 그대로)
   ===================================================================== */

const pz = document.getElementById("pz");          // 손가락을 받는 창
const stage = document.getElementById("stage");    // 지도 판 (1000 x 1333px 기준)
const W0 = 1000, H0 = W0 * 4 / 3;
const MAX_FIRST_W = 760;   // 넓은 화면(컴퓨터)에서 처음 지도 너비 상한 (px)
const MAX_ZOOM = 5;        // 처음 크기의 몇 배까지 확대

let vw = 0, vh = 0;                  // 창 크기
let s = 1, tx = 0, ty = 0;           // 지금 배율, 이동량
let sFirst = 1, sMin = 1, sMax = 5;  // 처음 배율, 최소, 최대

function measure() {
  vw = pz.clientWidth; vh = pz.clientHeight;
  const cover = Math.max(vw / W0, vh / H0);     // 빈 곳 없이 화면을 채우는 배율
  const contain = Math.min(vw / W0, vh / H0);   // 지도 전체가 다 보이는 배율
  sFirst = Math.min(cover, MAX_FIRST_W / W0);
  sMin = Math.min(contain, sFirst);
  sMax = sFirst * MAX_ZOOM;
}

// 지도가 창 밖으로 빠져나가 빈 곳이 생기지 않게 제한
function clampView() {
  s = Math.min(sMax, Math.max(sMin, s));
  const w = W0 * s, h = H0 * s;
  // 지도가 창보다 크면: 창 안에 빈 곳이 안 생기게 / 작으면: 지도가 창 밖으로 안 나가게
  tx = w >= vw ? Math.min(0, Math.max(vw - w, tx)) : Math.max(0, Math.min(vw - w, tx));
  ty = h >= vh ? Math.min(0, Math.max(vh - h, ty)) : Math.max(0, Math.min(vh - h, ty));
}

function applyView() {
  clampView();
  stage.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  // 확대할수록 신호 표시를 거꾸로 줄여서 화면에서 보이는 크기는 그대로 (축소할 땐 지도와 같이 작아짐)
  stage.style.setProperty("--k", Math.min(1, sFirst / s));
}

// 오거리 중심을 화면 한가운데로
function goHome() {
  measure();
  s = sFirst;
  tx = vw / 2 - (CENTER.x / 100) * W0 * s;
  ty = vh / 2 - (CENTER.y / 100) * H0 * s;
  applyView();
}

// (px, py) 지점을 고정한 채로 f 배 확대
function zoomAt(px, py, f) {
  const ns = Math.min(sMax, Math.max(sMin, s * f));
  const k = ns / s;
  tx = px - (px - tx) * k;
  ty = py - (py - ty) * k;
  s = ns;
  applyView();
}

// 손가락 (마우스 포함) 처리: 한 손가락 = 이동, 두 손가락 = 확대·축소
const pts = new Map();
let pair = null;   // 두 손가락일 때 직전 중심점과 거리
function pairInfo() {
  const [a, b] = [...pts.values()];
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}
pz.addEventListener("pointerdown", e => {
  try { pz.setPointerCapture(e.pointerId); } catch (_) {}
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pair = pts.size === 2 ? pairInfo() : null;
});
pz.addEventListener("pointermove", e => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 1) {
    tx += dx; ty += dy; applyView();
  } else if (pts.size === 2 && pair) {
    const now = pairInfo(), r = pz.getBoundingClientRect();
    tx += now.mx - pair.mx; ty += now.my - pair.my;                       // 두 손가락 같이 끌기
    if (pair.d > 0) zoomAt(now.mx - r.left, now.my - r.top, now.d / pair.d); // 벌리기·오므리기
    else applyView();
    pair = now;
  }
});
function pointerEnd(e) {
  pts.delete(e.pointerId);
  pair = pts.size === 2 ? pairInfo() : null;
}
pz.addEventListener("pointerup", pointerEnd);
pz.addEventListener("pointercancel", pointerEnd);

// 컴퓨터: 마우스 휠·트랙패드로 확대
pz.addEventListener("wheel", e => {
  e.preventDefault();
  const r = pz.getBoundingClientRect();
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

// 아이폰 사파리: 페이지 전체 확대 제스처 막기 (지도 확대는 위에서 직접 처리)
for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(t, e => e.preventDefault());
}

// 화면 크기가 바뀌면 (회전 등) 보고 있던 곳과 배율을 유지
let started = false;
function onResize() {
  if (!started) { started = true; goHome(); return; }
  const cx = (vw / 2 - tx) / s, cy = (vh / 2 - ty) / s;   // 지금 화면 가운데의 지도 위치
  const ratio = s / sFirst;
  measure();
  s = sFirst * ratio;
  tx = vw / 2 - cx * s; ty = vh / 2 - cy * s;
  applyView();
}
if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(pz);
else { window.addEventListener("resize", onResize); onResize(); }

document.getElementById("homeBtn").addEventListener("click", goHome);

// 정보 창 열고 닫기
const panel = document.getElementById("panel");
document.getElementById("infoBtn").addEventListener("click", () => panel.classList.toggle("hide"));
document.getElementById("panelClose").addEventListener("click", () => panel.classList.add("hide"));
document.addEventListener("keydown", e => { if (e.key === "Escape") panel.classList.add("hide"); });

/* =====================================================================
   4. 화면
   ===================================================================== */

const pad = (x, n = 2) => String(x).padStart(n, "0");
function hms(ms) {
  const t = todOf(ms);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(Math.floor(t) % 60)}`;
}
const hmsR = ms => hms(Math.round(ms / 1000) * 1000);   // 예정 시각은 가까운 초로 반올림
function countText(s) {
  const v = Math.ceil(s - 1e-6);
  return v < 100 ? String(v) : `${Math.floor(v / 60)}:${pad(v % 60)}`;
}

// 신호 표시 만들기: 동그라미와 시각 두 줄을 한 묶음(.sig)으로
const ui = {};
for (const n of [1, 2, 3, 4, 5]) {
  const c = CROSSWALKS[n];
  const sig = document.createElement("div");
  sig.className = "sig";
  sig.style.left = c.x + "%"; sig.style.top = c.y + "%";
  sig.title = `${n}번 ${c.name}`;
  sig.innerHTML = `<div class="dot"></div><div class="times"><div class="l1"></div><div class="l2"></div></div>`;
  // 시각 두 줄: 동그라미 기준 상대 위치 (지도 % → cqw. 세로는 지도가 가로의 4/3)
  const times = sig.querySelector(".times");
  times.style.left = `calc(3.6cqw + ${(c.tx - c.x).toFixed(2)}cqw)`;
  times.style.top = `calc(3.6cqw + ${((c.ty - c.y) * 4 / 3).toFixed(2)}cqw)`;
  stage.appendChild(sig);
  ui[n] = { sig, dot: sig.querySelector(".dot"), l1: times.querySelector(".l1"), l2: times.querySelector(".l2") };
}

// 근거 표
document.getElementById("segTable").innerHTML = SEGMENTS.map(s =>
  `<tr><td>${s.from.slice(0, 5)} ~ ${s.to.slice(0, 5)}<br><small>${s.label}</small></td>
   <td>${s.plan ? PLANS[s.plan].C + "초" : "–"}</td>
   <td>${s.src}${s.guess ? `<br><small>※ ${s.guess}</small>` : ""}</td></tr>`).join("");
document.getElementById("cwTable").innerHTML = ORDER.map(n =>
  `<tr><td>${n}번 ${CROSSWALKS[n].name}</td><td>${PLANS.day.g[n].toFixed(1)}초</td>
   <td>${PLANS.day.d[n].toFixed(1)} / ${PLANS.night.d[n].toFixed(1)}초</td></tr>`).join("");

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
let last = 0;

function frame() {
  const now = Date.now();                 // 보는 사람 기기의 시계를 매번 새로 읽음
  const tod = todOf(now);
  const k = new Date(now + KST);

  document.body.className = (tod >= 6 * 3600 && tod < 18 * 3600) ? "day" : "night";   // 지도 색: 06~18시 밝게
  document.getElementById("clock").innerHTML = `${hms(now)}<small>.${Math.floor(k.getUTCMilliseconds() / 100)}</small>`;
  const dateText = `${k.getUTCFullYear()}.${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())} (${WEEK[k.getUTCDay()]})`;

  if (now - last >= 100) {
    last = now;
    document.getElementById("plan").textContent = `${dateText} · 180초 주기 · 실제 신호를 꼭 확인하세요`;

    for (const n of ORDER) {
      const st = stateNow(n, now), u = ui[n];
      u.sig.classList.toggle("unk", !st.known);
      u.sig.classList.toggle("go", st.green === true);
      const txt = st.known ? countText(st.left) : "?";
      u.dot.textContent = txt;
      u.dot.classList.toggle("long", txt.length > 2);
      u.l1.textContent = st.next[0] ? hmsR(st.next[0]) : "";   // 다음 녹색
      u.l2.textContent = st.next[1] ? hmsR(st.next[1]) : "";   // 다다음 녹색
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
