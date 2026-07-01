import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf" letter-shape-style="upright">a</math-field></body></html>`);
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
    const mf = document.getElementById('mf');
    mf.executeCommand(['selectAll']);
    mf.executeCommand(['applyStyle', {fontSeries: 'b'}]);
  });
  
  const val = await page.evaluate(() => document.getElementById('mf').value);
  const html = await page.evaluate(() => document.getElementById('mf').shadowRoot.innerHTML);
  console.log('VALUE:', val);
  console.log('HTML HAS ML__mathit?', html.includes('ML__mathit'));
  console.log('HTML HAS ML__bold?', html.includes('ML__bold') || html.includes('mathbf'));
  
  await browser.close();
})();
