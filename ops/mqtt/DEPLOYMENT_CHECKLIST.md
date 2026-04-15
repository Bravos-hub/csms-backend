# EMQX Phase 1 Deployment Checklist

Complete this checklist before deploying EMQX to production.

## Pre-Deployment Planning

- [ ] Infrastructure capacity plan approved
  - [ ] CPU, memory, storage requirements validated
  - [ ] Network bandwidth capacity confirmed
  - [ ] EBS volumes pre-created with correct IDs
- [ ] Security audit completed
  - [ ] Firewall rules reviewed
  - [ ] TLS certificate strategy finalized
  - [ ] RBAC permissions validated
- [ ] Disaster recovery plan documented
  - [ ] RTO/RPO targets confirmed
  - [ ] Backup retention policy set
  - [ ] Recovery procedures tested
- [ ] Cost estimates approved
  - [ ] Staging: ~$50/month
  - [ ] Production: ~$150-200/month
  - [ ] Budget allocation confirmed

## Pre-Deployment Configuration

### Secrets and Credentials

- [ ] EMQX admin credentials generated
  ```bash
  # Generate strong passwords
  openssl rand -base64 32 > /tmp/emqx_admin_password.txt
  ```
- [ ] Redis credentials obtained (if using Redis persistence)
- [ ] AWS backup credentials provisioned
  - [ ] Access key ID
  - [ ] Secret access key
  - [ ] S3 bucket created: `s3://evzone-mqtt-backups/`
- [ ] EMQX API token generated
- [ ] API authentication secret created

### Infrastructure Preparation

- [ ] EBS volumes created and IDs documented
  - [ ] Staging: 50GB gp3 volume ID: `________`
  - [ ] Production: 200GB io2 volume ID: `________`
- [ ] Storage class verified
  ```bash
  kubectl get storageclass | grep ebs
  ```
- [ ] Monitoring stack operational
  - [ ] Prometheus running
  - [ ] Alertmanager configured
  - [ ] Slack/PagerDuty webhooks tested
- [ ] Logging infrastructure ready
  - [ ] Elasticsearch cluster operational
  - [ ] Fluentd/Fluent-bit deployed
  - [ ] Log retention policies set
- [ ] Network policies validated
  - [ ] Egress rules allow DNS (UDP 53)
  - [ ] Ingress allows app namespace traffic
  - [ ] Monitoring namespace has metrics access

## Deployment Steps

### Environment: Staging

- [ ] Apply namespace and policies
  ```bash
  kubectl apply -f namespace.yaml
  ```
- [ ] Verify namespaces created
  ```bash
  kubectl get ns | grep mqtt
  ```
- [ ] Create secrets
  ```bash
  kubectl -n mqtt-staging create secret generic emqx-admin \
    --from-literal=username=admin \
    --from-literal=password=$(cat /tmp/emqx_admin_password.txt)
  ```
- [ ] Apply persistence configuration
  ```bash
  # Update volume IDs first!
  kubectl apply -f persistence.yaml
  ```
- [ ] Verify PVC status
  ```bash
  kubectl get pvc -n mqtt-staging
  ```
- [ ] Apply configuration maps and secrets
  ```bash
  kubectl apply -f configmap-secrets.yaml
  ```
- [ ] Deploy EMQX StatefulSet
  ```bash
  kubectl apply -f statefulset.yaml
  ```
- [ ] Monitor pod startup
  ```bash
  kubectl get pods -n mqtt-staging -w
  # Wait for emqx-0 and emqx-1 to reach Running state
  ```
- [ ] Check logs for errors
  ```bash
  kubectl logs -n mqtt-staging emqx-0
  ```
- [ ] Verify cluster formation
  ```bash
  kubectl exec -n mqtt-staging emqx-0 -- emqx ctl cluster status
  ```
- [ ] Apply services
  ```bash
  kubectl apply -f service-discovery.yaml
  ```
- [ ] Test MQTT connectivity
  ```bash
  # From within cluster
  kubectl run -it --rm mqtt-client --image=eclipse-mosquitto -- \
    mosquitto_pub -h emqx.mqtt-staging -t test/topic -m "Hello"
  ```

### Environment: Production

- [ ] Repeat all staging steps in `mqtt-production` namespace
- [ ] Verify production replicas (should be 3+)
  ```bash
  kubectl get pods -n mqtt-production
  ```
- [ ] Confirm high-availability setup
  - [ ] Multiple nodes in different AZs
  - [ ] StatefulSet replicas replicas ≥ 3
  - [ ] PDB enforces minAvailable = 2

## Scaling and Lifecycle Configuration

- [ ] Apply HPA configuration
  ```bash
  kubectl apply -f scaling-lifecycle.yaml
  ```
- [ ] Verify HPA status
  ```bash
  kubectl get hpa -n mqtt-staging
  kubectl get hpa -n mqtt-production
  ```
- [ ] Test scaling behavior (staging only)
  ```bash
  # Generate load and watch HPA
  kubectl get hpa -n mqtt-staging -w
  ```

## Monitoring and Logging Setup

- [ ] Apply monitoring configuration
  ```bash
  kubectl apply -f monitoring-logging.yaml
  ```
- [ ] Verify Prometheus ServiceMonitor
  ```bash
  kubectl get servicemonitor -n mqtt-production
  ```
- [ ] Verify PrometheusRule alerts
  ```bash
  kubectl get prometheusrule -n mqtt-production
  ```
- [ ] Test Prometheus scraping
  ```bash
  # Access Prometheus UI and query "mqtt_connections_active"
  ```
- [ ] Verify Grafana dashboard
  - [ ] Navigate to Grafana dashboard
  - [ ] Select EMQX dashboard
  - [ ] Verify data is flowing
- [ ] Verify Fluentd log collection
  ```bash
  # Check Elasticsearch for recent logs
  curl -s http://elasticsearch:9200/emqx-logs-*/_search | jq
  ```
- [ ] Configure alert notifications
  ```bash
  kubectl patch secret/emqx-alert-webhook -n mqtt-production -p \
    '{...}'  # Add Slack webhook details
  ```
- [ ] Test alert trigger (staging)
  - [ ] Manually trigger alert condition
  - [ ] Verify notification received

## Backup and Recovery Configuration

### Staging (Basic Backup)

- [ ] Create AWS backup credentials secret
  ```bash
  kubectl -n mqtt-staging create secret generic aws-backup-credentials \
    --from-literal=access-key-id=... \
    --from-literal=secret-access-key=...
  ```
- [ ] Create S3 bucket if needed
  ```bash
  aws s3 mb s3://evzone-mqtt-backups-staging --region us-east-1
  ```
- [ ] Apply basic backup configuration
  ```bash
  # Configure only daily backup cronjob
  ```

### Production (Full Backup + Recovery)

- [ ] Create AWS backup credentials secret (production)
- [ ] Create S3 bucket
  ```bash
  aws s3 mb s3://evzone-mqtt-backups --region us-east-1
  ```
- [ ] Apply full backup configuration
  ```bash
  kubectl apply -f backup-recovery.yaml
  ```
- [ ] Verify backup CronJobs created
  ```bash
  kubectl get cronjob -n mqtt-production
  ```
- [ ] Trigger manual backup test
  ```bash
  kubectl create job --from=cronjob/mqtt-production/emqx-backup \
    test-backup-1 -n mqtt-production
  ```
- [ ] Monitor backup job
  ```bash
  kubectl logs -n mqtt-production -l job-name=test-backup-1 -f
  ```
- [ ] Verify backup in S3
  ```bash
  aws s3 ls s3://evzone-mqtt-backups/ --region us-east-1 --recursive
  ```
- [ ] Document backup naming conventions and retention
- [ ] Test restoration procedure (non-production cluster preferred)
  ```bash
  kubectl create job --from=cronjob/mqtt-production/emqx-restore-from-backup \
    test-restore --env BACKUP_NAME=... -n mqtt-production
  ```

## Post-Deployment Verification

### Functionality Tests

- [ ] MQTT client can connect on port 1883
  ```bash
  mosquitto_pub -h <emqx-lb-ip> -t "test/hello" -m "world"
  ```
- [ ] MQTTS works on port 8883 (if TLS configured)
- [ ] WebSocket connection works (port 8083)
- [ ] Multiple subscribers receive messages
- [ ] Message retention works as configured
- [ ] Session persistence works (disconnect and reconnect)
- [ ] QoS 0, 1, 2 all function correctly

### Performance and Stability Tests

- [ ] Load test: 1000 concurrent connections
  ```bash
  # Use MQTT load testing tool (e.g., JMeter, HiveMQ Swarm)
  ```
- [ ] Health check passes for all replicas
  ```bash
  kubectl exec -n mqtt-production emqx-0 -- emqx status
  ```
- [ ] CPU usage stable under load
  ```bash
  kubectl top pods -n mqtt-production
  ```
- [ ] Memory usage stable (no memory leaks)
- [ ] No pod restarts during sustained load
  ```bash
  kubectl get pods -n mqtt-production -o jsonpath='{.items[*].status.containerStatuses[0].restartCount}'
  ```

### Cluster Health Tests

- [ ] All pods in Ready state
  ```bash
  kubectl get pods -n mqtt-production
  ```
- [ ] No pending events
  ```bash
  kubectl get events -n mqtt-production --sort-by='.lastTimestamp'
  ```
- [ ] Cluster status shows all nodes
  ```bash
  kubectl exec -n mqtt-production emqx-0 -- emqx ctl cluster status
  ```
- [ ] PVCs are bound and mounted
  ```bash
  kubectl get pvc -n mqtt-production
  ```

### Monitoring and Alerting Tests

- [ ] Prometheus scraping metrics from EMQX
  ```bash
  # Check targets in Prometheus UI
  ```
- [ ] Grafana dashboard displays data
- [ ] Alert rules are active
  ```bash
  kubectl get prometheusrule -n mqtt-production
  ```
- [ ] Test alert firing (trigger condition)
- [ ] Alert notification received
- [ ] Logs appear in Elasticsearch
  ```bash
  curl http://elasticsearch:9200/emqx-logs-*/_search
  ```

### Security Validation

- [ ] Default credentials changed
  ```bash
  curl -u admin:newpass http://emqx:8081/api/v5/nodes
  ```
- [ ] Anonymous access disabled
- [ ] ACLs enforced for test topics
- [ ] API requires authentication token
- [ ] NetworkPolicy blocks cross-namespace traffic
  ```bash
  # Attempt to reach EMQX from non-allowed namespace (should fail)
  ```
- [ ] Secrets are encrypted at rest (verify with K8s etcd)

## Documentation and Handover

- [ ] Operational runbook completed
  - [ ] Common troubleshooting scenarios documented
  - [ ] Escalation procedures defined
  - [ ] Emergency contacts listed
- [ ] Administrator guide created
  - [ ] How to scale the cluster
  - [ ] How to perform updates
  - [ ] How to trigger manual backups
- [ ] Disaster recovery procedures documented
  - [ ] How to restore from backup
  - [ ] How to handle node failure
  - [ ] How to migrate to different cluster
- [ ] Alert runbooks created for each alert
  - [ ] What the alert means
  - [ ] How to investigate
  - [ ] How to resolve
- [ ] Metrics and dashboards documented
  - [ ] Key metrics explained
  - [ ] Dashboard interpretation guide
- [ ] Knowledge transfer completed
  - [ ] Operations team trained
  - [ ] On-call rotation explained
  - [ ] Escalation path defined

## Sign-Off

- [ ] Infrastructure team sign-off: `_____________` Date: `___________`
- [ ] Security team sign-off: `_____________` Date: `___________`
- [ ] Operations team sign-off: `_____________` Date: `___________`
- [ ] Product team sign-off: `_____________` Date: `___________`

## Post-Deployment Tasks (First Month)

- [ ] Monitor metrics daily for anomalies
- [ ] Review logs for errors or warnings
- [ ] Test backup restoration monthly
- [ ] Update runbooks based on operational experience
- [ ] Schedule performance tuning review
- [ ] Plan for Phase 2 features

## Notes

```
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
```
