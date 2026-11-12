// 拼装日接线 patch（INTEGRATION PATCH）—— 待罗（C）复核
// 改动：/v1 代理到邱的 API（7401）；/wechat 代理到微信网关（7402）。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const API_TARGET = process.env.DIANNAO_API_ORIGIN ?? 'http://localhost:7401'
const GW_TARGET = process.env.DIANNAO_GW_ORIGIN ?? 'http://localhost:7402'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
      // 注意：必须带尾斜杠，否则会把 /wechat-demo.html 也代理走
      '/wechat/': { target: GW_TARGET, changeOrigin: true },
    },
  },
})
