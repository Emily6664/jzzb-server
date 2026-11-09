// mock/mock-user.js —— 用户与登录模拟数据（仅 Demo 使用）
//
// 【字段约定】与 api/user.js 各接口 resolve 出来的结构严格一致。
//
// loginResult  微信手机号一键登录返回
//   token      string  登录凭证，后续请求放进 Authorization 头
//   userId     string  用户唯一标识
//   phone      string  手机号（真实环境下由微信 getPhoneNumber 换取，这里用假号）
//   nickname   string  昵称
//   avatarUrl  string  头像地址，空字符串表示用默认头像
//
// profile      用户资料
//   userId / phone / nickname / avatarUrl / addressCount

module.exports = {
  loginResult: {
    token: 'mock-token-0001',
    userId: 'user-0001',
    phone: '13800138000',
    nickname: '围山访客',
    avatarUrl: ''
  },

  profile: {
    userId: 'user-0001',
    phone: '13800138000',
    nickname: '围山访客',
    avatarUrl: '',
    addressCount: 0
  }
};
