import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf">\\text{\\textbf{\\textsf{A}}}</math-field></body></html>');
  await new Promise(r => setTimeout(r, 2000));
  
  const val = await page.evaluate(() => {
    const mf = document.getElementById('mf');
    return mf.shadowRoot.innerHTML;
  });
  console.log('HTML:', val);
  
  await browser.close();
})();
