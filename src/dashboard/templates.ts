export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Slapture Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    nav {
      background: #333;
      padding: 1rem 2rem;
      display: flex;
      gap: 2rem;
      align-items: center;
    }
    nav a {
      color: #fff;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
    }
    nav a:hover { background: #444; }
    nav a.active { background: #007aff; }
    .logo { font-weight: bold; font-size: 1.25rem; margin-right: auto; }
    main { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 1.5rem; color: #333; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    .badge-info { background: #cce5ff; color: #004085; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 500; color: #666; }
    .btn {
      display: inline-block;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.875rem;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: #007aff; color: white; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-danger { background: #6c757d; color: white; }
    .btn-danger:hover { background: #dc3545; }
    .btn:hover { opacity: 0.9; }
    .filter-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-bar select, .filter-bar input {
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .text-muted { color: #666; }
    .text-truncate {
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: #666;
    }
  </style>
</head>
<body>
  <nav>
    <a href="/widget" class="logo">Slapture</a>
    <a href="/dashboard">Home</a>
    <a href="/dashboard/captures">Captures</a>
    <a href="/dashboard/routes">Routes</a>
    <a href="/dashboard/reviews">Reviews</a>
    <a href="/dashboard/auth">Auth Status</a>
    <a href="/dashboard/test-suite">Test Suite</a>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, c => map[c]);
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusBadge(status: string): string {
  const classes: Record<string, string> = {
    success: 'badge-success',
    failed: 'badge-danger',
    pending: 'badge-warning',
    rejected: 'badge-secondary',
    blocked_needs_auth: 'badge-warning',
    blocked_auth_expired: 'badge-danger',
  };
  const labels: Record<string, string> = {
    success: 'Success',
    failed: 'Failed',
    pending: 'Pending',
    rejected: 'Rejected',
    blocked_needs_auth: 'Needs Auth',
    blocked_auth_expired: 'Auth Expired',
  };
  return `<span class="badge ${classes[status] || 'badge-secondary'}">${labels[status] || status}</span>`;
}

export function verificationBadge(state: string): string {
  const classes: Record<string, string> = {
    human_verified: 'badge-success',
    ai_certain: 'badge-info',
    ai_uncertain: 'badge-warning',
    failed: 'badge-danger',
    pending: 'badge-secondary',
  };
  const labels: Record<string, string> = {
    human_verified: 'Verified',
    ai_certain: 'AI Certain',
    ai_uncertain: 'AI Uncertain',
    failed: 'Failed',
    pending: 'Pending',
  };
  return `<span class="badge ${classes[state] || 'badge-secondary'}">${labels[state] || state}</span>`;
}
