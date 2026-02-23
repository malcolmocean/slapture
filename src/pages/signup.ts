import { renderLoginPage } from './login.js';

// Signup is the same UI as login (Firebase handles both).
// It's just at a different, non-linked URL.
export function renderSignupPage(firebaseConfig: Record<string, string>): string {
  return renderLoginPage(firebaseConfig);
}
