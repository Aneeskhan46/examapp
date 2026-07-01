import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf">\\mathbf{\\mathit{a}}</math-field></body></html>');
  await new Promise(r => setTimeout(r, 2000));
  
  const val = await page.evaluate(() => document.getElementById('mf').shadowRoot.innerHTML);
  console.log('HTML:', val);
  console.log('HAS BOLD?', val.includes('bold') || val.includes('ML__bold'));
  console.log('HAS ITALIC?', val.includes('italic') || val.includes('ML__mathit'));
  
  await browser.close();
})();
