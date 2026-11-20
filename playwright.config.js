const { defineConfig } = require('@playwright/test');

const testURL = process.env.VIEWER_TEST_URL;
const localURL = 'http://127.0.0.1:18784';

module.exports = defineConfig({
  testDir: './tests',
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: testURL || localURL },
  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chromium',
        launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: testURL ? undefined : {
    command: 'python3 -m http.server 18784 --bind 127.0.0.1 --directory public',
    url: localURL,
    reuseExistingServer: !process.env.CI,
  },
});
