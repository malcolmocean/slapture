export function renderLoginPage(firebaseConfig: Record<string, string>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in - Slapture</title>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-auth-compat.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #333; }
    .container { max-width: 400px; margin: 0 auto; padding: 2rem; }
    h1 { text-align: center; margin: 2rem 0 1.5rem; }
    .note { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #856404; }
    .error { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: #721c24; display: none; }
    .divider { display: flex; align-items: center; margin: 1.5rem 0; color: #999; font-size: 0.85rem; }
    .divider::before, .divider::after { content: ''; flex: 1; border-top: 1px solid #ddd; }
    .divider span { padding: 0 1rem; }
    .google-btn {
      display: flex; align-items: center; justify-content: center; gap: 0.75rem;
      width: 100%; padding: 0.7rem 1rem; border: 1px solid #ddd; border-radius: 6px;
      background: white; cursor: pointer; font-size: 0.95rem; color: #333;
    }
    .google-btn:hover { background: #f5f5f5; }
    .google-btn svg { width: 20px; height: 20px; }
    form { display: flex; flex-direction: column; gap: 0.75rem; }
    label { font-size: 0.85rem; font-weight: 500; }
    input[type="email"], input[type="password"] {
      width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem;
    }
    input:focus { outline: none; border-color: #333; }
    .submit-btn {
      width: 100%; padding: 0.7rem; border: none; border-radius: 6px;
      background: #333; color: white; font-size: 0.95rem; cursor: pointer;
    }
    .submit-btn:hover { background: #555; }
    .submit-btn:disabled { background: #999; cursor: not-allowed; }
    .toggle { text-align: center; margin-top: 1rem; font-size: 0.85rem; color: #666; }
    .toggle a { color: #333; font-weight: 500; cursor: pointer; text-decoration: underline; }
    .back { display: block; text-align: center; margin-top: 1.5rem; color: #666; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign in to Slapture</h1>
    <div class="note">
      Google sign-in is currently in test mode. If you get an error, your Google account may need to be added to the approved list.
    </div>
    <div class="error" id="error-msg"></div>

    <button class="google-btn" id="google-btn">
      <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Continue with Google
    </button>

    <div class="divider"><span>or</span></div>

    <form id="email-form">
      <div>
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com" />
      </div>
      <div>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required placeholder="Password" minlength="6" />
      </div>
      <button type="submit" class="submit-btn" id="submit-btn">Sign in</button>
    </form>

    <div class="toggle" id="toggle-mode" style="display: none;">
      Don't have an account? <a id="toggle-link">Create one</a>
    </div>

    <a href="/" class="back">&#8592; Back</a>
  </div>
  <script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();

    const errorEl = document.getElementById('error-msg');
    const emailForm = document.getElementById('email-form');
    const submitBtn = document.getElementById('submit-btn');
    const toggleLink = document.getElementById('toggle-link');
    let isSignUp = false;

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }
    function clearError() {
      errorEl.style.display = 'none';
    }

    // After any successful sign-in, create session and redirect
    async function onSignedIn(user) {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, signup: isSignUp }),
      });
      if (!res.ok) {
        const data = await res.json();
        // Sign out the Firebase user since they don't have a server account
        await auth.signOut();
        showError(data.error || 'Sign-in failed');
        return;
      }
      window.location.href = '/widget';
    }

    // Google sign-in
    document.getElementById('google-btn').addEventListener('click', async () => {
      clearError();
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        await onSignedIn(result.user);
      } catch (err) {
        showError(err.message || 'Google sign-in failed');
      }
    });

    // Email sign-in / sign-up
    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      submitBtn.disabled = true;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      try {
        let result;
        if (isSignUp) {
          result = await auth.createUserWithEmailAndPassword(email, password);
        } else {
          result = await auth.signInWithEmailAndPassword(email, password);
        }
        await onSignedIn(result.user);
      } catch (err) {
        showError(err.message || 'Authentication failed');
        submitBtn.disabled = false;
      }
    });

    // Toggle sign-in / sign-up mode
    toggleLink.addEventListener('click', () => {
      isSignUp = !isSignUp;
      submitBtn.textContent = isSignUp ? 'Create account' : 'Sign in';
      toggleLink.textContent = isSignUp ? 'Sign in instead' : 'Create one';
      document.querySelector('.toggle').firstChild.textContent = isSignUp ? 'Already have an account? ' : "Don't have an account? ";
      clearError();
    });

    // If arriving at /signup, show toggle and default to sign-up mode
    if (window.location.pathname === '/secret-signup') {
      document.getElementById('toggle-mode').style.display = 'block';
      toggleLink.click();
    }
  </script>
</body>
</html>`;
}
