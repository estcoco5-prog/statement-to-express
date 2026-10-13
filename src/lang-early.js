// Runs before the page is drawn, so a person who chose English never sees the
// Thai flash first. src/lang.js does the rest.
try {
  if (localStorage.getItem('statement-to-express-lang') === 'en') {
    document.documentElement.lang = 'en';
    document.documentElement.dataset.lang = 'en';
  }
} catch { /* storage blocked: Thai */ }
