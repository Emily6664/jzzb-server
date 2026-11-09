// utils/geo.js —— 定位与手绘图坐标换算
//
// 【问题】GPS 给的是经纬度（GCJ-02），手绘图给的是设计稿像素（750×1334），
//         两者没有天然对应关系，必须靠「标定锚点」拟合一个变换。
//
// 【本文件只算数据，不碰 wx】页面负责权限弹窗、文案、样式，这样几何逻辑能单测。
//
// 【两种落点模式】由 buildModel() 的 ok 决定：
//   precise —— 标定残差 ≤ RMS_TOLERANCE_PX，可以把 GPS 点直接投到手绘图上画「你在这里」
//   near    —— 残差过大（数据不可信），只算「离哪个点位最近、多远、什么方向」
//
// 【怎么开真定位】把 LOCATION_ENABLE 改成 true（接口在 mp 后台批下来之后）
// 【怎么让落点变准】在 CALIBRATION 里填至少 2 组真实坐标 + 图上像素位置

/* eslint-disable no-console */

const R_EARTH = 6371008.8; // 地球平均半径（米）
const DEG = Math.PI / 180;

/**
 * 首选定位方式：
 *   'exact' —— wx.getLocation，米级精度（需要「精确地理位置」接口审核通过）
 *   'fuzzy' —— wx.getFuzzyLocation，约 1 公里精度（审核口径更松）
 *   'off'   —— 不调接口，直接用模拟位置（纯演示）
 * 目标就是精确定位，所以默认 'exact'。
 */
const LOCATION_MODE = 'exact';

/**
 * 是否允许精确失败后降级到模糊定位。
 * 实测微信的硬规则：app.json 的 requiredPrivateInfos 里，
 * 'getLocation' 与 'getFuzzyLocation' **互斥**，同时声明会直接报配置错误、整包起不来。
 * 所以声明了精确接口就没法声明模糊接口，这里只能是 false——
 * 精确拿不到就直接退到「模拟」并在界面上如实标注，不会假装。
 * 如果你哪天决定改用模糊定位：LOCATION_MODE 改成 'fuzzy'，
 * 同时把 app.json 的 requiredPrivateInfos 换成 ['getFuzzyLocation']。
 */
const LOCATION_FALLBACK = false;

/** 兼容旧引用：只要不是 off 就尝试定位 */
const LOCATION_ENABLE = LOCATION_MODE !== 'off';

/** 定位缓存时长：切 tab 回来不重复定位/弹框 */
const LOCATION_TTL_MS = 60 * 1000;

/**
 * 标定锚点：手绘图上取至少 2 个「你确切知道经纬度」的点，填这里。
 * 格式：{ latitude, longitude, mapX, mapY }
 *   - latitude / longitude：GCJ-02（高德、腾讯同源；百度是 BD-09，别混）
 *   - mapX / mapY：该点在 750×1334 设计稿上的像素位置
 *
 * 例（等你用手机在两个点位各取一次坐标后填）：
 *   { latitude: 24.2886, longitude: 116.1225, mapX: 168, mapY: 420 },
 *   { latitude: 24.3014, longitude: 116.1308, mapX: 302, mapY: 742 }
 *
 * 留空时退化为「用 5 个点位自身的经纬度拟合」——
 * 只有当 mock 里的经纬度是真实测绘值时才可靠，否则残差会很大、自动走 near 模式。
 */
const CALIBRATION = [];

/** 演示位置偏移：擂茶老铺往南约 180 米（让「距离」不是 0，看起来像刚走到附近） */
const SIMULATED_OFFSET = { dLat: -0.0016, dLng: 0.0004 };

/** 拟合残差门槛（设计稿像素）。超过就不画精确落点，改用最近点位指示。 */
const RMS_TOLERANCE_PX = 60;

/** 距离分档：决定文案是「你就在这里」还是「你离得还挺远」 */
const HERE_METERS = 60;
const NEAR_METERS = 2000;

function isFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

function isAnchor(a) {
  return !!a && isFiniteNumber(a.latitude) && isFiniteNumber(a.longitude) && isFiniteNumber(a.mapX) && isFiniteNumber(a.mapY);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * 把经纬度换成「以 origin 为原点」的局部平面米制坐标。
 * y 轴朝下（屏幕习惯），所以北纬增加 = y 减小。
 */
function localMeters(latitude, longitude, origin) {
  const x = (longitude - origin.longitude) * DEG * Math.cos(origin.latitude * DEG) * R_EARTH;
  const y = -(latitude - origin.latitude) * DEG * R_EARTH;
  return { x: x, y: y };
}

/** 两点球面距离（米） */
function haversine(a, b) {
  if (!a || !b) return NaN;
  if (!isFiniteNumber(a.latitude) || !isFiniteNumber(a.longitude)) return NaN;
  if (!isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) return NaN;

  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLat = lat2 - lat1;
  const dLng = (b.longitude - a.longitude) * DEG;

  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 方位角（度，0 = 正北，顺时针） */
function bearingDeg(a, b) {
  if (!a || !b) return NaN;

  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLng = (b.longitude - a.longitude) * DEG;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) / DEG + 360) % 360;
}

const DIRECTION_TEXT = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

/** 方位角 → 八方位中文 */
function bearingText(deg) {
  if (!isFiniteNumber(deg)) return '';
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return DIRECTION_TEXT[idx];
}

/**
 * 把 wx.getLocation 的失败原因分成三类，三类对应完全不同的处理：
 *   'denied'       —— 用户拒绝了授权，可以引导「去设置」
 *   'not-approved' —— 接口没开通/没声明，用户改不了，只能降级或去后台申请
 *   'failed'       —— 超时、无信号等临时失败，可以重试
 */
function classifyLocateError(err) {
  const msg = String((err && err.errMsg) || err || '').toLowerCase();

  if (
    msg.indexOf('auth deny') > -1 ||
    msg.indexOf('auth denied') > -1 ||
    msg.indexOf('authorize') > -1 ||
    msg.indexOf('user denied') > -1 ||
    msg.indexOf('permission denied') > -1
  ) {
    return 'denied';
  }

  if (
    msg.indexOf('not permitted') > -1 ||
    msg.indexOf('not declared') > -1 ||
    msg.indexOf('requiredprivateinfos') > -1 ||
    msg.indexOf('privacy') > -1 ||
    msg.indexOf('not approved') > -1 ||
    msg.indexOf('not support') > -1 ||
    msg.indexOf('api is not') > -1 ||
    msg.indexOf('no permission to call') > -1
  ) {
    return 'not-approved';
  }

  return 'failed';
}

/** 距离 → 人话 */
function formatDistance(meters) {
  if (!isFiniteNumber(meters) || meters < 0) return '';

  const rounded = Math.round(meters / 10) * 10;

  if (rounded === 0) return '不到 10 米';
  if (rounded < 1000) return rounded + ' 米';

  return (Math.round(meters / 100) / 10).toFixed(1) + ' 公里';
}

/** 距离分档：here / near / far */
function distanceBand(meters) {
  if (!isFiniteNumber(meters)) return 'far';
  if (meters <= HERE_METERS) return 'here';
  if (meters <= NEAR_METERS) return 'near';
  return 'far';
}

/** 从点位数据里挑出可当锚点的（有经纬度 + 有图上坐标） */
function pickAnchors(spots) {
  const list = spots || [];
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!isAnchor({ latitude: s.latitude, longitude: s.longitude, mapX: s.mapX, mapY: s.mapY })) continue;
    out.push({
      spotId: s.spotId || '',
      latitude: s.latitude,
      longitude: s.longitude,
      mapX: s.mapX,
      mapY: s.mapY
    });
  }

  return out;
}

/**
 * 用锚点拟合「经纬度 → 图上像素」的相似变换（旋转 + 等比缩放 + 平移）。
 * 用 Procrustes 闭式解，不需要迭代，也不需要外部库。
 *
 * @param {Array} anchors 至少 2 个 { latitude, longitude, mapX, mapY }
 * @returns {{ ok:boolean, reason:string, model:Object|null, rms:number|null, count:number }}
 */
function buildModel(anchors) {
  const list = (anchors || []).filter(isAnchor);

  if (list.length < 2) {
    return { ok: false, reason: 'need-2-anchors', model: null, rms: null, count: list.length };
  }

  let latSum = 0;
  let lngSum = 0;
  for (let i = 0; i < list.length; i++) {
    latSum += list[i].latitude;
    lngSum += list[i].longitude;
  }

  const origin = { latitude: latSum / list.length, longitude: lngSum / list.length };

  const ps = list.map(function (a) {
    return localMeters(a.latitude, a.longitude, origin);
  });
  const qs = list.map(function (a) {
    return { x: a.mapX, y: a.mapY };
  });

  let pBarX = 0;
  let pBarY = 0;
  let qBarX = 0;
  let qBarY = 0;

  for (let i = 0; i < ps.length; i++) {
    pBarX += ps[i].x;
    pBarY += ps[i].y;
    qBarX += qs[i].x;
    qBarY += qs[i].y;
  }

  pBarX /= ps.length;
  pBarY /= ps.length;
  qBarX /= qs.length;
  qBarY /= qs.length;

  let numA = 0;
  let numB = 0;
  let den = 0;

  for (let i = 0; i < ps.length; i++) {
    const dx = ps[i].x - pBarX;
    const dy = ps[i].y - pBarY;
    const ex = qs[i].x - qBarX;
    const ey = qs[i].y - qBarY;

    numA += dx * ex + dy * ey;
    numB += dx * ey - dy * ex;
    den += dx * dx + dy * dy;
  }

  if (den < 1e-9) {
    return { ok: false, reason: 'degenerate-anchors', model: null, rms: null, count: list.length };
  }

  const a = numA / den;
  const b = numB / den;

  const model = {
    origin: origin,
    a: a,
    b: b,
    tx: qBarX - (a * pBarX - b * pBarY),
    ty: qBarY - (b * pBarX + a * pBarY),
    scale: Math.sqrt(a * a + b * b),
    rotationDeg: (Math.atan2(b, a) / DEG + 360) % 360
  };

  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const p = projectToMap(list[i].latitude, list[i].longitude, model);
    const dx = p.x - list[i].mapX;
    const dy = p.y - list[i].mapY;
    sum += dx * dx + dy * dy;
  }

  const rms = Math.sqrt(sum / list.length);
  const ok = rms <= RMS_TOLERANCE_PX;

  return {
    ok: ok,
    reason: ok ? 'ok' : 'rms-too-large',
    model: model,
    rms: rms,
    count: list.length
  };
}

/** 经纬度 → 设计稿像素（750×1334）。model 必须来自 buildModel()。 */
function projectToMap(latitude, longitude, model) {
  if (!model || !model.origin) return null;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;

  const p = localMeters(latitude, longitude, model.origin);

  return {
    x: round2(model.a * p.x - model.b * p.y + model.tx),
    y: round2(model.b * p.x + model.a * p.y + model.ty)
  };
}

/** 找离给定位置最近的点位，附带距离与方位 */
function nearestSpot(latitude, longitude, spots) {
  const here = { latitude: latitude, longitude: longitude };
  const list = spots || [];
  let best = null;

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!isFiniteNumber(s.latitude) || !isFiniteNumber(s.longitude)) continue;

    const distance = haversine(here, s);

    if (best && distance >= best.distance) continue;

    const deg = bearingDeg(here, s);

    best = {
      spot: s,
      distance: distance,
      distanceText: formatDistance(distance),
      bearingDeg: round2(deg),
      bearingText: bearingText(deg),
      band: distanceBand(distance)
    };
  }

  return best;
}

/** 演示位置：取擂茶老铺（没有就取第一个点位）往南偏移一点点 */
function simulatedPosition(spots) {
  const list = spots || [];
  if (!list.length) return null;

  let base = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].spotId === 'spot-03') base = list[i];
  }
  if (!base) base = list[0];
  if (!isFiniteNumber(base.latitude) || !isFiniteNumber(base.longitude)) return null;

  return {
    latitude: round2((base.latitude + SIMULATED_OFFSET.dLat) * 1e6) / 1e6,
    longitude: round2((base.longitude + SIMULATED_OFFSET.dLng) * 1e6) / 1e6
  };
}

module.exports = {
  LOCATION_MODE: LOCATION_MODE,
  LOCATION_FALLBACK: LOCATION_FALLBACK,
  LOCATION_ENABLE: LOCATION_ENABLE,
  LOCATION_TTL_MS: LOCATION_TTL_MS,
  CALIBRATION: CALIBRATION,
  RMS_TOLERANCE_PX: RMS_TOLERANCE_PX,
  HERE_METERS: HERE_METERS,
  NEAR_METERS: NEAR_METERS,

  classifyLocateError: classifyLocateError,
  haversine: haversine,
  bearingDeg: bearingDeg,
  bearingText: bearingText,
  formatDistance: formatDistance,
  distanceBand: distanceBand,

  pickAnchors: pickAnchors,
  buildModel: buildModel,
  projectToMap: projectToMap,
  nearestSpot: nearestSpot,
  simulatedPosition: simulatedPosition
};
