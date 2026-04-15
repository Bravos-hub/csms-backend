# EMQX Kubernetes Deployment - Phase 1

This directory contains production-grade Kubernetes manifests for deploying EMQX (Enterprise MQTT Broken) in Kubernetes clusters for staging and production environments.

## Overview

EMQX is the primary MQTT message broker for the EV Zone platform, handling real-time communication between charging stations, mobile apps, and backend services. This deployment includes:

- **High Availability**: Multi-node StatefulSet with clustering support
- **Persistence**: Data persistence to Redis and MySQL for fault tolerance
- **Monitoring**: Prometheus metrics and alerting
- **Logging**: Centralized log aggregation with Fluentd
- **Backup/Recovery**: Automated backups to S3 with recovery procedures
- **Security**: RBAC, NetworkPolicies, and TLS encryption
- **Scaling**: Horizontal Pod Autoscaling based on connections and resource usage
- **Graceful Shutdown**: PreStop hooks for connection draining

## Files Structure

```
mqtt/
├── README.md                    # This file
├── namespace.yaml              # Namespaces and NetworkPolicies
├── configmap-secrets.yaml      # Configuration and credentials
├── statefulset.yaml            # EMQX cluster deployment
├── persistence.yaml            # Volume and storage configuration
├── service-discovery.yaml       # Services, Ingress, and monitoring
├── scaling-lifecycle.yaml      # HPA, PDB, and graceful shutdown
├── monitoring-logging.yaml     # Prometheus rules, alerts, and log aggregation
└── backup-recovery.yaml        # Backup jobs and recovery procedures
```

## Prerequisites

### Cluster Requirements

- Kubernetes 1.24+ (1.28+ recommended)
- 3+ worker nodes for production (2+ for staging)
- EBS volume support (AWS EKS)
- Metrics Server installed for HPA
- Prometheus Operator (for monitoring)
- Fluentd/ELK stack (for logging)

### Storage Requirements

- **Staging**: 50 GB EBS volume (gp3)
- **Production**: 200 GB EBS volume (io2 or gp3)

### Network Requirements

- MQTT port 1883 accessible to applications
- Management port 8081 restricted to internal network
- Intra-cluster ports 4370 (RPC) and 5370 (distributed Erlang) for clustering

## Installation

### Step 1: Create Namespaces and Policies

```bash
kubectl apply -f namespace.yaml
```

This creates:
- `mqtt-staging` and `mqtt-production` namespaces
- Network policies to restrict traffic

### Step 2: Create Configuration and Secrets

```bash
kubectl apply -f configmap-secrets.yaml
```

**Important**: Update the following secrets before deploying:

```bash
# Staging
kubectl -n mqtt-staging create secret generic emqx-admin \
  --from-literal=username=admin \
  --from-literal=password="<secure-password>"

kubectl -n mqtt-staging create secret generic redis-credentials \
  --from-literal=host=redis.default \
  --from-literal=password="<redis-password>"

# Production
kubectl -n mqtt-production create secret generic emqx-admin \
  --from-literal=username=admin \
  --from-literal=password="<secure-password>"

kubectl -n mqtt-production create secret generic emqx-api-credentials \
  --from-literal=api-token="<generated-api-token>"
```

### Step 3: Create Storage

```bash
kubectl apply -f persistence.yaml
```

**Note**: Update the EBS volume IDs in `persistence.yaml` to match your AWS environment.

### Step 4: Deploy EMQX StatefulSet

```bash
kubectl apply -f statefulset.yaml
```

Verify the deployment:

```bash
# Check pod status
kubectl get pods -n mqtt-staging
kubectl get pods -n mqtt-production

# Expected output (staging):
# NAME      READY   STATUS    RESTARTS   AGE
# emqx-0    1/1     Running   0          2m
# emqx-1    1/1     Running   0          1m

# Check logs
kubectl logs -n mqtt-staging emqx-0
```

### Step 5: Create Services

```bash
kubectl apply -f service-discovery.yaml
```

Verify service creation:

```bash
kubectl get svc -n mqtt-staging
kubectl get svc -n mqtt-production
```

### Step 6: Configure Scaling and Lifecycle

```bash
kubectl apply -f scaling-lifecycle.yaml
```

Verify HPA:

```bash
kubectl get hpa -n mqtt-staging
kubectl get hpa -n mqtt-production
```

### Step 7: Setup Monitoring and Logging

```bash
kubectl apply -f monitoring-logging.yaml
```

### Step 8: Configure Backups

```bash
# Create AWS credentials secret
kubectl -n mqtt-production create secret generic aws-backup-credentials \
  --from-literal=access-key-id="<your-key>" \
  --from-literal=secret-access-key="<your-secret>"

# Apply backup configuration
kubectl apply -f backup-recovery.yaml
```

## Configuration

### EMQX Configuration

EMQX is configured via the `emqx.conf` ConfigMap in `configmap-secrets.yaml`. Key settings:

```ini
# Node name (automatically set to hostname)
node.name = emqx@$(HOSTNAME).emqx.mqtt-staging

# Cluster discovery
cluster.discovery = k8s
cluster.k8s.apiserver = https://kubernetes.default:443
cluster.k8s.address_type = hostname
cluster.k8s.label_selector = "app=emqx,environment=staging"

# Message persistence
backend.redis.enable = on
backend.redis.server = redis:6379

# Authentication
auth.user.1 = user1:password1
allow_anonymous = false
```

### Resource Limits

**Staging:**
```yaml
requests:
  cpu: 500m
  memory: 512Mi
limits:
  cpu: 2000m
  memory: 2Gi
```

**Production:**
```yaml
requests:
  cpu: 1000m
  memory: 1Gi
limits:
  cpu: 4000m
  memory: 4Gi
```

### Auto-Scaling Settings

**Staging:**
- Min replicas: 2
- Max replicas: 5
- CPU threshold: 75%
- Memory threshold: 80%

**Production:**
- Min replicas: 3
- Max replicas: 10
- CPU threshold: 70%
- Memory threshold: 75%
- Connection threshold: 100k per replica

## Operations

### Monitoring

#### Prometheus Metrics

Access EMQX metrics via Prometheus:

```
http://prometheus:9090
```

Key metrics:
- `mqtt_connections_active`: Current active connections
- `mqtt_messages_received_total`: Total messages received
- `mqtt_subscriptions_active`: Active subscriptions

#### Grafana Dashboard

Import the EMQX dashboard from `monitoring-logging.yaml`:

```bash
kubectl apply -f monitoring-logging.yaml
# Then manually import into Grafana
```

#### Alerts

Configure alert recipients in `monitoring-logging.yaml` or via Prometheus Alertmanager:

```bash
kubectl patch secret/emqx-alert-webhook -p \
  '{spec.stringData.slack-webhook="https://hooks.slack.com/..."}'
```

### Scaling

#### Manual Scaling

```bash
# Scale to 4 replicas
kubectl scale statefulset/emqx --replicas=4 -n mqtt-production
```

#### HPA Status

```bash
kubectl get hpa -n mqtt-production -w
```

### Backup and Recovery

#### Trigger Manual Backup

```bash
kubectl create job --from=cronjob/mqtt-production/emqx-backup manual-backup \
  -n mqtt-production
```

#### View Backups

```bash
aws s3 ls s3://evzone-mqtt-backups/ --region us-east-1 --recursive
```

#### Restore from Backup

```bash
# Create restore job
kubectl create job --from=cronjob/mqtt-production/emqx-restore-from-backup \
  restore-job-manual \
  --env BACKUP_NAME=emqx-backup-20240101_020000 \
  -n mqtt-production

# Monitor progress
kubectl logs -f restore-job-manual-xxxxx -n mqtt-production
```

### Updating EMQX

#### Update Docker Image

```bash
kubectl set image statefulset/emqx \
  emqx=emqx/emqx:5.2.0 \
  -n mqtt-production
```

#### Rolling Update

StatefulSets automatically perform rolling updates:

```bash
kubectl rollout status statefulset/emqx -n mqtt-production -w
```

#### Verify Update

```bash
# Check all replicas 
kubectl get pods -n mqtt-production

# Check EMQX version
kubectl exec -it emqx-0 -n mqtt-production -- emqx ctl version
```

### Troubleshooting

#### Check Pod Status

```bash
kubectl describe pod emqx-0 -n mqtt-production
```

#### View Logs

```bash
# Current pod logs
kubectl logs emqx-0 -n mqtt-production

# Previous pod logs (after crash)
kubectl logs emqx-0 -n mqtt-production --previous

# Real-time logs
kubectl logs -f emqx-0 -n mqtt-production
```

#### Check Cluster Status

```bash
# Via kubectl exec
kubectl exec emqx-0 -n mqtt-production -- emqx ctl cluster status

# Via EMQX API
curl http://emqx:8081/api/v5/nodes \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Diagnose Connection Issues

```bash
# Check if MQTT port is reachable
kubectl run -it --rm debug --image=curlimages/curl -- \
  nc -zv emqx.mqtt-production 1883
```

#### Memory Leaks

Monitor memory usage:

```bash
kubectl top pods -n mqtt-production --sort-by=memory
```

If a pod consistently exceeds limits:

```bash
# Restart single pod
kubectl delete pod emqx-2 -n mqtt-production

# Or redeploy entire StatefulSet
kubectl rollout restart statefulset/emqx -n mqtt-production
```

## Security Considerations

### Authentication

1. **Admin Credentials**: Change default credentials in all environments
2. **MQTT Clients**: Use username/password authentication (configure in `emqx.conf`)
3. **API Tokens**: Generate unique tokens for each integration

### Network

1. **Namespace Isolation**: NetworkPolicies restrict cross-namespace traffic
2. **TLS**: MQTTS (port 8883) with certificates managed by cert-manager (future phase)
3. **Rate Limiting**: Configure per-client connection limits in EMQX config

### Data

1. **Message Persistence**: Messages stored in Redis (configure persistence)
2. **Session Persistence**: Session state backed up to MySQL
3. **Encryption**: All credentials in Kubernetes Secrets

### RBAC

Ensure proper RBAC for backup/restore operations:

```bash
kubectl get rolebinding,clusterrolebinding | grep emqx
```

## Disaster Recovery

### RTO/RPO Targets

- **RTO (Recovery Time Objective)**: < 5 minutes
- **RPO (Recovery Point Objective)**: < 1 hour

### Failure Scenarios

1. **Pod Crash**: StatefulSet auto-restarts via ReplicaSet
2. **Node Failure**: Pods reschedule to healthy nodes
3. **Cluster Failure**: Manual restore from S3 backup
4. **Data Loss**: Restore latest backup or point-in-time recovery

## Performance Tuning

### Connection Limits

```yaml
max_connections: 1000000  # Per node
max_subscriptions_per_client: 10000
```

### Memory Management

```yaml
max_inflight: 32
max_awaiting_rel: 100
```

### Message Throughput

```yaml
listener.tcp.acceptors: 16
listener.tcp.max_connections: 250000
```

## Cost Optimization

### Staging

- 2 replicas × 512M RAM = 1GB
- 50GB EBS (gp3): ~$5/month
- **Estimated cost**: ~$50/month

### Production

- 3-5 replicas × 1GB RAM = 3-5GB
- 200GB EBS (io2): ~$50-100/month
- **Estimated cost**: ~$150-200/month

## Support and Maintenance

### Documentation

- [EMQX Docs](https://docs.emqx.com/)
- [EMQX Kubernetes](https://docs.emqx.com/en/emqx/latest/deploy/install.html#deploy-on-k8s)
- [Kubernetes Best Practices](https://kubernetes.io/docs/)

### Regular Tasks

- **Weekly**: Monitor metrics and alerts
- **Monthly**: Review backup completeness
- **Quarterly**: Update EMQX to latest patch version
- **Annually**: Disaster recovery drill

## Roadmap - Phase 2 & 3

### Phase 2 (Q2 2024)

- [ ] Multi-region failover setup
- [ ] Advanced ACL and authentication
- [ ] Message routing and bridging
- [ ] Custom plugins development
- [ ] Performance benchmarking

### Phase 3 (Q3 2024)

- [ ] MQTT5 support
- [ ] Message deduplication
- [ ] Flow control optimization
- [ ] Cost optimization review
- [ ] High availability testing

## Related Documentation

- [Architecture](../architecture.md)
- [Deployment Guide](../deployment-architecture.md)
- [Troubleshooting](../troubleshooting.md)

```bash
kubectl create namespace mqtt-staging
kubectl apply -f ops/mqtt/namespace.yaml

# Deploy with Staging values
helm install emqx emqx/emqx \
  -n mqtt-staging \
  -f ops/mqtt/helm-values/base.yaml \
  -f ops/mqtt/helm-values/staging.yaml

# Apply network policy and monitoring
kubectl apply -f ops/mqtt/networkpolicy.yaml -n mqtt-staging
kubectl apply -f ops/mqtt/servicemonitor.yaml -n mqtt-staging
```

### Deploy to Production

```bash
kubectl create namespace mqtt-production
kubectl apply -f ops/mqtt/namespace.yaml

# Deploy with Production values
helm install emqx emqx/emqx \
  -n mqtt-production \
  -f ops/mqtt/helm-values/base.yaml \
  -f ops/mqtt/helm-values/production.yaml

# Apply network policy and monitoring
kubectl apply -f ops/mqtt/networkpolicy.yaml -n mqtt-production
kubectl apply -f ops/mqtt/servicemonitor.yaml -n mqtt-production
```

### Verify Deployment

```bash
# Check pod status
kubectl get pods -n mqtt-production

# Check service
kubectl get svc -n mqtt-production emqx

# Check logs
kubectl logs -n mqtt-production -l app.kubernetes.io/name=emqx -f

# Access EMQX Dashboard
kubectl port-forward -n mqtt-production svc/emqx 18083:18083
# Visit: http://localhost:18083
# Default: admin/public
```

## Configuration Details

### Base Configuration (All Environments)

- **Version**: EMQX 5.0+ (Enterprise)
- **Replicaset**: Clustered deployment for HA
- **Storage**: PersistentVolumeClaim for data retention
- **Monitoring**: Prometheus metrics exposed on port 8883
- **Dashboard**: Web console on port 18083

### Staging-Specific

- **Replicas**: 1
- **Storage**: 10Gi SSD
- **Resource Limits**: 500m CPU, 512Mi memory
- **Ingress**: Available for testing, basic auth enabled
- **Retention**: 7 days for message history

### Production-Specific

- **Replicas**: 3 (HA cluster)
- **Storage**: 100Gi SSD
- **Resource Limits**: 2 CPU, 4Gi memory
- **Pod Disruption Budget**: Min 2 replicas available
- **Ingress**: TLS required, mTLS client cert validation
- **Retention**: 30 days for message history
- **Backup**: Daily snapshots to S3

## Multi-Tenant Configuration

### Creating Tenant Credentials

Each tenant gets:
1. **Username**: `{tenantId}-mqtt-user`
2. **Auto-generated password** (stored in Kubernetes Secret)
3. **ACL Rule**: Restricted to `v1/{tenantId}/#`

**Manual creation example:**
```bash
# Create secret for tenant org-123
kubectl create secret generic mqtt-credentials-org-123 \
  -n mqtt-production \
  --from-literal=username=org-123-mqtt-user \
  --from-literal=password=$(openssl rand -hex 16) \
  --from-literal=acl='["v1/org-123/#"]'

# Then sync to EMQX via API or dashboard
```

### Service Credentials

Services (api, worker) get separate credentials:

**evzone-api**: Can publish/subscribe to all tenant topics
```
ACL: v1/+/+/+/charger/+/status
     v1/+/+/+/charger/+/transaction
     v1/+/+/+/battery-swap/+/session
     ...all canonical topics
```

**evzone-worker**: Same as API (processes async events)

## Health Checks

### Broker Health

```bash
# Via kubectl
kubectl exec -it pod/emqx-0 -n mqtt-production -- \
  emqx ctl status

# Via API
curl -u admin:public http://localhost:18083/api/v5/status
```

### Topic Check

```bash
# Check subscription count
curl -u admin:public \
  http://localhost:18083/api/v5/subscriptions?limit=100

# Check client connections
curl -u admin:public \
  http://localhost:18083/api/v5/clients?limit=100
```

## Troubleshooting

### Broker Not Starting

1. Check logs: `kubectl logs -n mqtt-production pod/emqx-0`
2. Check storage: `kubectl describe pvc -n mqtt-production`
3. Check resources: `kubectl describe nodes | grep -A 5 "Allocated resources"`

### Clients Can't Connect

1. Verify NetworkPolicy allows service pods
2. Check ACL rules: EMQX Dashboard → Access Control → Users & Permissions
3. Verify credentials: `kubectl get secret mqtt-credentials-org-123 -o yaml`

### High Memory Usage

1. Check concurrent connections: `kubectl exec pod/emqx-0 -- emqx ctl stats`
2. Reduce session expiry time
3. Enable message persistence limits

## Security

### Network Isolation

- Pod-to-Pod: MQTT pods only accept from services in ops namespace
- Ingress: TLS 1.3 required
- Egress: Limited to internal cluster DNS + S3 (for backups)

### Credentials Management

- All credentials stored in Kubernetes Secrets
- Rotated monthly via K8s secret versioning
- Never logged or exposed in pod env vars
- ACL enforced at broker level (not application level)

## Monitoring

### Prometheus Metrics

- Broker health: `emqx_broker_version`, `emqx_connections_count`
- Topic stats: `emqx_messages_in_rate`, `emqx_messages_out_rate`
- Storage: Persisted message counts, queue depths
- Alerts: Connection drops, persistence errors, resource exhaustion

### Grafana Dashboard

Import ID: **15123** (Community EMQX dashboard)

## Backup & Recovery

### Automated Backups

- Daily snapshots of persistent data
- Stored in S3 bucket: `s3://evzone-mqtt-backups/{env}/`
- Retention: 30 days

### Manual Backup

```bash
kubectl exec pod/emqx-0 -n mqtt-production -- \
  tar czf /tmp/emqx-backup.tar.gz /opt/emqx/data/

kubectl cp mqtt-production/emqx-0:/tmp/emqx-backup.tar.gz ./
```

### Recovery

```bash
# Restore from backup
kubectl exec pod/emqx-0 -n mqtt-production -- \
  tar xzf /tmp/emqx-backup.tar.gz -C /opt/emqx/data/

# Restart pod
kubectl rollout restart statefulset/emqx -n mqtt-production
```

## References

- [EMQX Documentation](https://docs.emqx.io/)
- [EMQX Kubernetes Helm](https://github.com/emqx/emqx-operator)
- [EMQX ACL Guide](https://docs.emqx.io/en/emqx/latest/security/acl.html)
