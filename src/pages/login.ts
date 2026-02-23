export function renderLoginPage(firebaseConfig: Record<string, string>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in - Slapture</title>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/ui/7.0.0/firebase-ui-auth.js"></script>
  <link type="text/css" rel="stylesheet" href="https://www.gstatic.com/firebasejs/ui/7.0.0/firebase-ui-auth.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #333; }
    .container { max-width: 400px; margin: 0 auto; padding: 2rem; }
    h1 { text-align: center; margin: 2rem 0; }
    .note { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #856404; }
    .back { display: block; text-align: center; margin-top: 1.5rem; color: #666; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign in to Slapture</h1>
    <div class="note">
      Google sign-in is currently in test mode. If you get an error, your Google account may need to be added to the approved list.
    </div>
    <div id="firebaseui-auth-container"></div>
    <a href="/" class="back">&#8592; Back</a>
  </div>
  <script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    firebase.initializeApp(firebaseConfig);

    const ui = new firebaseui.auth.AuthUI(firebase.auth());
    ui.start('#firebaseui-auth-container', {
      signInSuccessUrl: '/widget',
      signInOptions: [
        firebase.auth.GoogleAuthProvider.PROVIDER_ID,
        firebase.auth.EmailAuthProvider.PROVIDER_ID,
      ],
      tosUrl: '/',
      privacyPolicyUrl: '/',
    });
  </script>
</body>
</html>`;
}
