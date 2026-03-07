.PHONY: dev quality quality-full quality-backend \
       deploy deploy-backend deploy-admin deploy-web \
       rollback status

dev:
	@echo "Starting dev servers (Ctrl+C to stop all)..."
	@trap 'kill 0' EXIT; \
	  (cd apps/backend-rs && cargo run) & \
	  (cd apps/admin && npm run dev) & \
	  (cd apps/web && npm run dev) & \
	  wait

quality:
	./scripts/quality-gate.sh fast

quality-full:
	./scripts/quality-gate.sh

quality-backend:
	./scripts/quality-gate.sh backend

deploy:
	@test -n "$(APP)" || { echo "Usage: make deploy APP=<backend|admin|web|all>"; exit 1; }
	gh workflow run aws-ecs-deploy.yml -f app=$(APP)
	@echo "Deploy triggered. Run 'make status' to monitor."

deploy-backend:
	gh workflow run aws-ecs-deploy.yml -f app=backend
	@echo "Backend deploy triggered."

deploy-admin:
	gh workflow run aws-ecs-deploy.yml -f app=admin
	@echo "Admin deploy triggered."

deploy-web:
	gh workflow run aws-ecs-deploy.yml -f app=web
	@echo "Web deploy triggered."

rollback:
	@test -n "$(APP)" || { echo "Usage: make rollback APP=<backend|admin|web>"; exit 1; }
	gh workflow run aws-ecs-rollback.yml -f app=$(APP)
	@echo "Rollback triggered for $(APP)."

status:
	@echo "==> ECS Service Status"
	@aws ecs describe-services --cluster casaora-prod \
		--services casaora-backend casaora-admin casaora-web \
		--query 'services[].{Service:serviceName,Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}' \
		--output table 2>/dev/null || echo "AWS CLI not configured or services not found"
	@echo ""
	@echo "==> Recent Deployments"
	@gh run list --workflow=aws-ecs-deploy.yml --limit=5 2>/dev/null || echo "gh CLI not available"
