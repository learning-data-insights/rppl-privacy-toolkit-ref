# SSL/HTTPS Setup Guide for AWS Elastic Beanstalk

## Prerequisites
- Domain name (e.g., yourdomain.com)
- AWS account with Elastic Beanstalk application deployed

## Step 1: Request SSL Certificate from AWS Certificate Manager (ACM)

1. **Open AWS Certificate Manager**
   - Go to AWS Console → Certificate Manager
   - **IMPORTANT**: Make sure you're in the same region as your Elastic Beanstalk environment

2. **Request a Public Certificate**
   - Click "Request certificate" → "Request a public certificate"
   - Add domain names:
     - `yourdomain.com`
     - `www.yourdomain.com` (optional, but recommended)
     - `*.yourdomain.com` (optional wildcard for subdomains)

3. **Choose Validation Method**
   - **DNS Validation** (Recommended): You'll add a CNAME record to your domain
   - **Email Validation**: AWS sends verification email to admin@yourdomain.com

4. **Complete Validation**
   - For DNS: Add the provided CNAME record to your domain's DNS
   - For Email: Click the link in the verification email

5. **Copy Certificate ARN**
   - Once validated, copy the ARN (looks like: `arn:aws:acm:us-east-1:123456789012:certificate/abc-123-def`)

## Step 2: Enable HTTPS in Your Application

### Update the Configuration File

1. Open `.ebextensions/alb-secure-listener.config`
2. Find the commented HTTPS section
3. Uncomment and replace `YOUR_CERTIFICATE_ARN_HERE` with your actual certificate ARN:

```yaml
  # Configure HTTPS listener on port 443
  aws:elbv2:listener:443:
    ListenerEnabled: true
    Protocol: HTTPS
    SSLCertificateArns: arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id
    SSLPolicy: ELBSecurityPolicy-TLS-1-2-2017-01
```

### Deploy the Changes

```bash
# Using EB CLI
eb deploy

# Or using AWS Console
# Upload and deploy your application version
```

## Step 3: Configure DNS

### Option A: Using Route 53 (Recommended)
1. Go to Route 53 → Hosted Zones
2. Select your domain
3. Create an A record:
   - Type: A - IPv4 address
   - Alias: Yes
   - Target: Your Elastic Beanstalk environment

### Option B: Using External DNS Provider
1. Get your Load Balancer URL:
   - Go to Elastic Beanstalk → Your Environment
   - Copy the environment URL (e.g., `myapp.us-east-1.elasticbeanstalk.com`)
2. Create a CNAME record:
   - Host: @ or www
   - Points to: Your EB environment URL

## Step 4: Test Your SSL Setup

1. **Visit Your Site**
   - Go to `https://yourdomain.com`
   - Verify the padlock icon appears

2. **Check HTTP Redirect**
   - Visit `http://yourdomain.com`
   - Should automatically redirect to HTTPS

3. **Test SSL Quality**
   - Visit: https://www.ssllabs.com/ssltest/
   - Enter your domain
   - Aim for an A rating or better

## Security Features Already Implemented

✅ **Security Headers** (application.py)
- Strict Transport Security (HSTS)
- X-Content-Type-Options
- X-Frame-Options
- Content Security Policy
- Referrer Policy

✅ **HTTP to HTTPS Redirect** (https-redirect.config)
- Automatically redirects all HTTP traffic to HTTPS

✅ **Modern TLS Policy**
- TLS 1.2+ only
- Strong cipher suites

## Maintenance

### Certificate Renewal
- ACM certificates auto-renew if using DNS validation
- No action required on your part

### Monitoring
- Set up CloudWatch alarms for:
  - Target health
  - HTTP 4xx/5xx errors
  - Response time

## Troubleshooting

**Certificate not showing in Load Balancer settings?**
- Ensure certificate is in the same region as your EB environment
- Check certificate is fully validated (status: "Issued")

**HTTPS not working after deployment?**
- Wait 5-10 minutes for changes to propagate
- Check Elastic Beanstalk logs for configuration errors
- Verify the certificate ARN is correct

**Mixed content warnings?**
- Check browser console for HTTP resources
- Update any hardcoded HTTP URLs to HTTPS or use protocol-relative URLs (//example.com)

## Cost Considerations
- **ACM Certificates**: Free
- **Application Load Balancer**: ~$0.025/hour + data processing charges
- **HTTPS**: No additional cost beyond the load balancer

## Next Steps After SSL Setup
1. Update any API integrations to use HTTPS
2. Update sitemap and robots.txt with HTTPS URLs
3. Notify users of the secure connection
4. Consider implementing additional security features like WAF

## Support Resources
- [AWS Certificate Manager Documentation](https://docs.aws.amazon.com/acm/)
- [Elastic Beanstalk HTTPS Configuration](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/configuring-https.html)
- [AWS Support](https://console.aws.amazon.com/support/)