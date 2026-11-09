// utils/map-calc.js —— 手绘地图坐标换算工具
//
// 手绘地图不是标准地理坐标系，点位在 mock 里以「设计稿原始像素」标注（mapX / mapY，
// 设计稿 750 x 1334，原点在左上角）。页面渲染尺寸与设计稿不同，必须按比例换算，
// 否则不同屏幕上的小狗点位会偏移。
//
// 本文件只做纯数学换算，不依赖 wx / 页面实例，方便复用与单测。

/**
 * 是否为合法数字
 * @param {*} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

/**
 * 是否为合法坐标点
 * @param {{x: number, y: number}} point
 * @returns {boolean}
 */
function isPoint(point) {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/**
 * 是否为合法尺寸（宽高必须大于 0，否则会除零）
 * @param {{width: number, height: number}} size
 * @returns {boolean}
 */
function isSize(size) {
  return !!size && isFiniteNumber(size.width) && isFiniteNumber(size.height) && size.width > 0 && size.height > 0;
}

/**
 * 保留两位小数，避免一长串浮点误差
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * 原图坐标 -> 页面渲染坐标（按宽高各自的比例缩放）
 * @param {{x: number, y: number}} point 原图坐标系下的点，单位与 source 一致
 * @param {{width: number, height: number}} source 手绘地图原图尺寸（设计稿尺寸）
 * @param {{width: number, height: number}} target 页面渲染区域尺寸
 * @returns {{x: number, y: number}|null} 页面渲染区域坐标系下的点；入参非法时返回 null
 */
function imageToView(point, source, target) {
  if (!isPoint(point) || !isSize(source) || !isSize(target)) return null;

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;

  return {
    x: round2(point.x * scaleX),
    y: round2(point.y * scaleY)
  };
}

/**
 * 页面渲染坐标 -> 原图坐标（imageToView 的逆运算，用于把点击位置换算回设计稿坐标）
 * @param {{x: number, y: number}} point 页面渲染区域坐标系下的点
 * @param {{width: number, height: number}} source 手绘地图原图尺寸（设计稿尺寸）
 * @param {{width: number, height: number}} target 页面渲染区域尺寸
 * @returns {{x: number, y: number}|null} 原图坐标系下的点；入参非法时返回 null
 */
function viewToImage(point, source, target) {
  if (!isPoint(point) || !isSize(source) || !isSize(target)) return null;

  const scaleX = source.width / target.width;
  const scaleY = source.height / target.height;

  return {
    x: round2(point.x * scaleX),
    y: round2(point.y * scaleY)
  };
}

/**
 * 百分比坐标 -> 页面渲染坐标（点位以 0~100 标注时使用，超出范围会夹到边界）
 * @param {{x: number, y: number}} percent 百分比坐标，取值 0~100
 * @param {{width: number, height: number}} target 页面渲染区域尺寸
 * @returns {{x: number, y: number}|null} 页面渲染区域坐标系下的点；入参非法时返回 null
 */
function percentToView(percent, target) {
  if (!isPoint(percent) || !isSize(target)) return null;

  const px = Math.min(Math.max(percent.x, 0), 100);
  const py = Math.min(Math.max(percent.y, 0), 100);

  return {
    x: round2((px / 100) * target.width),
    y: round2((py / 100) * target.height)
  };
}

module.exports = {
  imageToView,
  viewToImage,
  percentToView
};
