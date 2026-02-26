# Admin Frontend Migration (AWS ECS + OpenNext Decision Path)

## Decision (Pragmatic)

- **Immediate production path**: `Next.js` container on **ECS Fargate** behind the existing ALB
- **OpenNext path**: keep as a future option if you later move the frontend to CloudFront + Lambda

Why:
- `OpenNext` is primarily an AWS serverless adapter (Lambda/CloudFront), not an ECS runtime requirement.
- For your current stack and cutover speed, ECS is the lowest-risk move from Vercel.

## What Exists in Repo

- Admin container image build: `/Users/christopher/Desktop/casaora/apps/admin/Dockerfile`
- Admin ECS task definition template: `/Users/christopher/Desktop/casaora/infra/aws/ecs/taskdef.admin.json`
- Admin ALB routing bootstrap script: `/Users/christopher/Desktop/casaora/scripts/aws/bootstrap-admin-alb-routing.sh`
- Admin ECS deploy script: `/Users/christopher/Desktop/casaora/scripts/aws/deploy-admin-production.sh`
- GitHub Actions ECS deploy workflow: `/Users/christopher/Desktop/casaora/.github/workflows/aws-ecs-deploy.yml`

## Required AWS Secrets Manager Secrets (Admin)

Recommended names (used by deploy script defaults):

- `casaora/admin/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `casaora/admin/CLERK_SECRET_KEY`

## Required GitHub Repository Variables (for CI deploy workflow)

- `ADMIN_NEXT_PUBLIC_API_BASE_URL` (example: `https://api.casaora.co/v1`)
- `ADMIN_NEXT_PUBLIC_SITE_URL` (example: `https://app.casaora.co`)
- `ADMIN_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (publishable key; public value)

## One-Time ALB Routing Bootstrap (Admin Host)

Create host-based routing on the shared ALB for `app.casaora.co`:

```bash
/Users/christopher/Desktop/casaora/scripts/aws/bootstrap-admin-alb-routing.sh \
  ADMIN_HOSTNAMES=app.casaora.co
```

This creates/updates:
- Target group: `casaora-prod-admin-web-tg` (port `3000`)
- HTTPS listener rule on `:443` with host header `app.casaora.co`

## Admin Deploy (Manual)

```bash
/Users/christopher/Desktop/casaora/scripts/aws/deploy-admin-production.sh
```

Optional overrides:
- `SMOKE_BASE_URL=https://app.casaora.co`
- `NEXT_PUBLIC_SITE_URL=https://app.casaora.co`
- `NEXT_PUBLIC_API_BASE_URL=https://api.casaora.co/v1`

## Cloudflare Cutover (Admin)

1. Create `CNAME` `app` -> ALB DNS (`DNS only` first)
2. Smoke test `https://app.casaora.co/login`
3. Enable Cloudflare proxy (optional) after validation
4. Later move `www` / apex routing from Vercel to AWS origin

## OpenNext (Future Branch)

If you later choose CloudFront/Lambda for frontend instead of ECS:
- Add `OpenNext` build/deploy pipeline in a separate workflow
- Keep the same Cloudflare hostname strategy
- Re-evaluate image/file upload and runtime env handling

