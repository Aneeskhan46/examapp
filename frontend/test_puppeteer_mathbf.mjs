import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf">\\mathbf{\\text{\\textrm{A}}}</math-field></body></html>`);
  await new Promise(r => setTimeout(r, 2000));
  
  const val = await page.evaluate(() => document.getElementById('mf').shadowRoot.innerHTML);
  console.log('HTML HAS ML__bold?', val.includes('ML__bold'));
  
  await browser.close();
})();
