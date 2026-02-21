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
