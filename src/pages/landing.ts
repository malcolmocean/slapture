export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slapture</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 2rem; text-align: center; }
    h1 { font-size: 2.5rem; margin-top: 4rem; }
    .tagline { color: #666; margin: 1rem 0 2rem; font-size: 1.1rem; }
    .cta { display: inline-block; padding: 0.75rem 2rem; background: #333; color: white; text-decoration: none; border-radius: 6px; font-size: 1rem; }
    .cta:hover { background: #555; }
  </style>
</head>
<body>
  <div class="container">
    <h1>slapture</h1>
    <p class="tagline">Capture anything. Route it intelligently.</p>
    <a href="/login" class="cta">Sign in</a>
  </div>
</body>
</html>`;
}
