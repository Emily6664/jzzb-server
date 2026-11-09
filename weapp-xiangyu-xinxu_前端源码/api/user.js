// api/user.js —— 用户登录相关接口
//
// 【mock 开关】在 utils/api.js（USE_MOCK）。true 时直接返回 mock/mock-user.js 的数据。
//
// 【真实环境的前置条件】
//   1. 小程序需为「已认证」主体（个人主体拿不到手机号）；
//   2. 后台「用户隐私保护指引」需声明手机号用途；
//   3. 后端要拿 phoneCode 调微信 phonenumber.getPhoneNumber 换取真实手机号，
//      前端拿不到明文手机号，只能拿到后端换好的结果。

const { request } = require('../utils/api');
const mockUser = require('../mock/mock-user');

/**
 * 微信手机号一键登录
 * - 接口含义：用 wx.login 的 code 建立会话，用 getPhoneNumber 的 code 换取手机号。
 * - 入参：payload {Object}
 *     loginCode string  wx.login() 成功回调里的 code
 *     phoneCode string  <button open-type="getPhoneNumber"> 回调里的 detail.code
 * - 返回：Promise<Object>
 *     token     string  登录凭证
 *     userId    string  用户 ID
 *     phone     string  手机号
 *     nickname  string  昵称
 *     avatarUrl string  头像地址
 */
function login(payload) {
  return request({
    url: '/user/login',
    method: 'POST',
    data: payload,
    mock: function () {
      return mockUser.loginResult;
    }
  });
}

/**
 * 获取当前登录用户资料
 * - 接口含义：用 token 换用户资料（昵称、手机号、地址数量等）
 * - 入参：无
 * - 返回：Promise<Object>
 *     userId       string  用户 ID
 *     phone        string  手机号
 *     nickname     string  昵称
 *     avatarUrl    string  头像地址
 *     addressCount number  已保存的收货地址数量
 */
function getProfile() {
  return request({
    url: '/user/profile',
    method: 'GET',
    data: {},
    mock: function () {
      return mockUser.profile;
    }
  });
}

module.exports = {
  login,
  getProfile
};
