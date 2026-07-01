import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf" default-mode="text">A</math-field></body></html>`);
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
    const mf = document.getElementById('mf');
    mf.executeCommand(['selectAll']);
    mf.executeCommand(['applyStyle', {fontSeries: 'b'}]);
  });
  
  const val = await page.evaluate(() => document.getElementById('mf').value);
  console.log('VALUE:', val);
  
  await browser.close();
})();
