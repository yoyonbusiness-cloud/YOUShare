const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const devices = [
  { name: 'iPhone_SE', width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'iPhone_14_Pro_Max', width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Pixel_7', width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
  { name: 'Galaxy_Z_Fold_5', width: 344, height: 884, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
  { name: 'iPad_Pro', width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
];

async function runTest() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const outDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (const device of devices) {
    console.log(`Testing ${device.name}...`);
    const page = await browser.newPage();
    await page.setViewport(device);

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500)); 
    await page.screenshot({ path: path.join(outDir, `${device.name}_hero.png`), fullPage: true });

    await page.evaluate(() => document.querySelector('#show-generate-btn').click());
    await new Promise(r => setTimeout(r, 500)); 
    await page.evaluate(() => document.querySelector('#final-join-generated-btn').click());
    await new Promise(r => setTimeout(r, 1000)); 

    await page.screenshot({ path: path.join(outDir, `${device.name}_workspace.png`), fullPage: true });

    await page.evaluate(() => {
        const file = new File(['dummy content'], 'test.txt', { type: 'text/plain' });
        window.handleFiles([file]); 
    });

    await new Promise(r => setTimeout(r, 500)); 
    await page.screenshot({ path: path.join(outDir, `${device.name}_modal.png`), fullPage: true });

    await page.close();
  }

  await browser.close();
  console.log('Done screenshots. Saved in /screenshots/');
}

runTest().catch(console.error);
