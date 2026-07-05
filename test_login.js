const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  await page.goto('http://localhost:8000');
  await page.waitForTimeout(2000);
  console.log('Typing credentials...');
  await page.type('#auth-email-input', 'test@test.com');
  await page.type('#auth-password-input', 'password123');
  await page.click('#btn-login');
  await page.waitForTimeout(3000);
  await browser.close();
})();
