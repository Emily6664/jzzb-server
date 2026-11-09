// utils/storage.js —— 本地存储统一封装
//
// 约定：业务代码一律通过本文件读写 storage，不要直接调用 wx.setStorageSync 等，
// 这样 key 集中、异常集中，将来换成别的存储方案只改这一处。

/**
 * 写入本地存储
 * @param {string} key   存储键
 * @param {*}      value 任意可被序列化的值（对象 / 数组 / 基本类型）
 * @returns {boolean} 写入是否成功
 */
function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (err) {
    console.error('[storage] set 失败:', key, err);
    return false;
  }
}

/**
 * 读取本地存储
 * @param {string} key          存储键
 * @param {*}      defaultValue 读取失败或键不存在时返回的兜底值
 * @returns {*} 已存储的值，或 defaultValue
 */
function get(key, defaultValue) {
  const fallback = defaultValue === undefined ? null : defaultValue;
  try {
    const value = wx.getStorageSync(key);
    // 键不存在时微信返回空字符串
    return value === '' || value === undefined || value === null ? fallback : value;
  } catch (err) {
    console.error('[storage] get 失败:', key, err);
    return fallback;
  }
}

/**
 * 删除单个存储键
 * @param {string} key 存储键
 * @returns {boolean} 是否删除成功
 */
function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (err) {
    console.error('[storage] remove 失败:', key, err);
    return false;
  }
}

/**
 * 清空全部本地存储（谨慎调用）
 * @returns {boolean} 是否清空成功
 */
function clear() {
  try {
    wx.clearStorageSync();
    return true;
  } catch (err) {
    console.error('[storage] clear 失败:', err);
    return false;
  }
}

/**
 * 判断某个键是否存在
 * @param {string} key 存储键
 * @returns {boolean}
 */
function has(key) {
  return get(key, null) !== null;
}

module.exports = {
  set,
  get,
  remove,
  clear,
  has
};
