import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script defer src="https://unpkg.com/mathlive@0.94.0"></script></head><body><math-field id="mf">\\text{\\textbf{A}}</math-field></body></html>');
  await new Promise(r => setTimeout(r, 2000));
  
  const val = await page.evaluate(() => {
    const mf = document.getElementById('mf');
    mf.executeCommand(['selectAll']);
    return mf.queryStyle({fontSeries: 'b'});
  });
  console.log('QUERY STYLE:', val);
  
  await browser.close();
})();
