# Simple HTTPS Setup with Self-Signed Certificate

## What This Does
- Enables HTTPS on your Elastic Beanstalk instance
- Uses a self-signed certificate (free, automatic)
- Redirects all HTTP traffic to HTTPS
- Encrypts data between users and your server

## Setup Instructions

### Deploy the Configuration
Simply deploy your application with the included configuration files:

```bash
# Using EB CLI
eb deploy

# Or zip and upload through AWS Console
```

The configuration will automatically:
1. Generate a self-signed SSL certificate
2. Configure nginx to serve HTTPS on port 443
3. Redirect HTTP (port 80) to HTTPS

### What Users Will See
- **First Visit**: Browser will show a security warning about the self-signed certificate
- **To Proceed**: Users click "Advanced" → "Proceed to site" (varies by browser)
- **After That**: Connection is encrypted with HTTPS

### Access Your Application
- HTTP: `http://rppl-privacy.us-west-2.elasticbeanstalk.com` → Redirects to HTTPS
- HTTPS: `https://rppl-privacy.us-west-2.elasticbeanstalk.com` → Secure connection

## Important Notes

### Security Groups
Make sure your EC2 security group allows:
- Port 80 (HTTP) - for redirect
- Port 443 (HTTPS) - for secure connection

To check/update:
1. Go to EC2 Console → Security Groups
2. Find your Elastic Beanstalk security group
3. Add inbound rules for ports 80 and 443 from source 0.0.0.0/0

### Browser Warnings
Self-signed certificates will always show warnings because they're not from a trusted Certificate Authority. This is normal and expected. The connection is still encrypted.

### For Production
If you later get a custom domain, you can:
- Get a free SSL certificate from Let's Encrypt
- Use AWS Certificate Manager with a custom domain
- Purchase a certificate from a Certificate Authority

## Files Included

1. **`.ebextensions/https-instance.config`**
   - Generates self-signed certificate
   - Configures nginx for HTTPS

2. **`.ebextensions/https-redirect.config`**
   - Redirects HTTP to HTTPS

3. **Security headers in `application.py`**
   - HSTS, XSS protection, etc.

## Troubleshooting

**HTTPS not working after deploy?**
- Check Elastic Beanstalk logs for nginx errors
- Verify security group allows port 443
- Try restarting the environment

**Too many redirects?**
- Clear browser cache
- Check that only one redirect configuration is active

**Certificate expired?**
- Redeploy to generate a new certificate
- Certificate auto-generates with 365-day validity

## That's It!
Your application now has HTTPS enabled with encryption between users and your server. While not suitable for production use with real customers (due to browser warnings), this is perfectly fine for:
- Development and testing
- Internal tools
- Proof of concepts
- Research projects