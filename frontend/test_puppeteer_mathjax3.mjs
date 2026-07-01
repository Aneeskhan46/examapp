import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script><script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script></head><body><div id="test">$$ \\mathbf{\\mathit{a}} $$</div></body></html>');
  await new Promise(r => setTimeout(r, 4000));
  
  const val = await page.evaluate(() => document.getElementById('test').innerHTML);
  console.log('HTML:', val);
  console.log('IS BOLD?', val.includes('font-weight: bold') || val.includes('mjx-b') || val.includes('bold'));
  console.log('IS ITALIC?', val.includes('font-style: italic') || val.includes('mjx-i') || val.includes('italic'));
  
  await browser.close();
})();
