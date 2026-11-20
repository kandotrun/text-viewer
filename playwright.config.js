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
    command: 'npm exec --no -- wrangler dev --local --ip 127.0.0.1 --port 18784',
    url: localURL,
    reuseExistingServer: !process.env.CI,
  },
});
