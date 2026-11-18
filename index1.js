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
  // 다음 변화가 지금 시간대 밖(전환 구간 너머)이면 남은 초는 알 수 없음
  const known = true;   // 180초 하나로만 계산하므로 항상 계산 가능
  return { known, green, left, next, seg };
}

/* =====================================================================
   3. 화면
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

const map = document.getElementById("map");
const ui = {};
for (const n of [1, 2, 3, 4, 5]) {
  const c = CROSSWALKS[n];
  const sig = document.createElement("div");
  sig.className = "sig";
  sig.style.left = c.x + "%"; sig.style.top = c.y + "%";
  sig.title = `${n}번 ${c.name}`;
  sig.innerHTML = `<div class="dot"></div>`;
  map.appendChild(sig);
  const times = document.createElement("div");
  times.className = "times";
  times.style.left = c.tx + "%"; times.style.top = c.ty + "%";
  times.innerHTML = `<div class="l1"></div><div class="l2"></div>`;
  map.appendChild(times);
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
  const now = Date.now();
  const tod = todOf(now);
  const k = new Date(now + KST);

  document.body.className = (tod >= 6 * 3600 && tod < 18 * 3600) ? "day" : "night";   // 지도 색: 06~18시 밝게
  document.getElementById("clock").innerHTML = `${hms(now)}<small>.${Math.floor(k.getUTCMilliseconds() / 100)}</small>`;
  const dateText = `${k.getUTCFullYear()}.${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())} (${WEEK[k.getUTCDay()]})`;

  if (now - last >= 100) {
    last = now;
    const seg = segAt(tod);
    document.getElementById("plan").textContent = `${dateText} · 180초 주기`;

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
