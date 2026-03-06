# HUMAN.md: Things Malcolm needs to do manually

## DNS Setup for slapture.com → Cloud Run

Once the Cloud Run service is deployed, you need to map slapture.com to it.

### 1. Get the Cloud Run service URL
After deploying, note the auto-assigned URL (something like `slapture-xxxxx-ue.a.run.app`).

### 2. Map custom domain in Cloud Run
```
gcloud run domain-mappings create --service slapture --domain slapture.com --region us-east1
gcloud run domain-mappings create --service slapture --domain www.slapture.com --region us-east1
```
This will output DNS records you need to create.

### 3. Set DNS records at your registrar
Cloud Run will tell you to create:

| Type | Name | Value |
|------|------|-------|
| A | @ | (IP provided by gcloud) |
| AAAA | @ | (IPv6 provided by gcloud) |
| CNAME | www | ghs.googlehosted.com. |

There are usually 4 A records and 4 AAAA records. Add all of them.

### 4. Wait for SSL
Google auto-provisions an SSL cert. Takes 15-30 minutes after DNS propagates. You can check status:
```
gcloud run domain-mappings describe --domain slapture.com --region us-east1
```

### 5. Verify
- https://slapture.com should load
- https://www.slapture.com should load
- http:// should redirect to https:// automatically

## Notes
- DNS propagation can take up to 48h but usually 5-30 min
- The Cloud Run region in the commands above should match where you deployed the service
- If your registrar doesn't support AAAA records, the A records alone are fine

---

## Google Sheets: Add Drive API scope for spreadsheet discovery

The Mastermind needs to list/search your existing Google Sheets so it can route captures to them instead of creating CSV files. This requires the Google Drive API (read-only) in addition to the existing Sheets API scope.

### Steps

- [ ] **Google Cloud Console > APIs & Services > Library**
  - Search for "Google Drive API" and **Enable** it (the Sheets API is already enabled)

- [ ] **Google Cloud Console > APIs & Services > OAuth consent screen > "Data Access" (left sidebar)**
  - Click **"Add or Remove Scopes"**
  - In the filter/search box, paste: `https://www.googleapis.com/auth/drive.readonly`
  - Check it, click "Update", then "Save"
  - (If you don't see "Data Access", try: OAuth consent screen > your app name > "Edit" or "Scopes" tab)
  - NOTE: This step may be skippable while in Testing mode — the scope is already in the OAuth URL, so Google will prompt for it regardless. This registration just matters for the verification review.

- [ ] **Re-consent: Disconnect and reconnect Google Sheets in Slapture**
  - Dashboard > Auth > Disconnect Google Sheets, then reconnect
  - Google will re-prompt for consent with the new Drive scope
  - (Existing tokens won't have the Drive scope, so a re-consent is required)

- [ ] **Confirm test user is listed** (if not already)
  - Google Cloud Console > OAuth consent screen > Test users
  - Ensure the test account (`GOOGLE_TEST_ACCOUNT` from .env) is listed
  - While in Testing mode, only listed test users can authorize

No env var changes needed — same client ID/secret.
