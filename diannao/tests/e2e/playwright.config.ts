import { defineConfig, devices } from "@playwright/test";

/**
 * 店脑端到端测试配置。
 * baseURL 走 E2E_WEB_BASE_URL，默认指向 C 的 web 本地端口。
 */
const baseURL = process.env.E2E_WEB_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./",
  fullyParallel: false, // 接待链路用例有登录态依赖，串行更稳
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
