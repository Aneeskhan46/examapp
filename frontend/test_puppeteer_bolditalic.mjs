import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf"></math-field></body></html>');
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
    const mf = document.getElementById('mf');
    mf.value = 'a';
    mf.select();
    mf.applyStyle({ fontSeries: 'b', variantStyle: 'italic' });
  });
  
  const val = await page.evaluate(() => document.getElementById('mf').value);
  console.log('VALUE:', val);
  
  await browser.close();
})();
