# EMQX Troubleshooting Guide

## Common Issues and Solutions

### Connection Issues

#### Problem: MQTT Client Cannot Connect

**Symptoms:**
- Connection timeout when trying to connect to EMQX
- `Connection refused` errors
- `No route to host` errors

**Diagnosis:**

```bash
# 1. Check if pods are running
kubectl get pods -n mqtt-production
# Expected: All pods in "Running" state

# 2. Check service endpoints
kubectl get endpoints -n mqtt-production
# Expected: emqx service has multiple endpoints

# 3. Check if port is exposed
kubectl get svc -n mqtt-production emqx
# Expected: Port 1883 listed

# 4. Test connectivity from within cluster
kubectl run -it --rm debug --image=curlimages/curl -- \
  nc -zv emqx.mqtt-production.svc.cluster.local 1883
```

**Solutions:**

1. **Pod not running** → Check logs and resource allocation
   ```bash
   kubectl logs -f emqx-0 -n mqtt-production
   kubectl describe pod emqx-0 -n mqtt-production
   ```

2. **Network policy blocking traffic** → Verify NetworkPolicy rules
   ```bash
   kubectl get networkpolicy -n mqtt-production
   kubectl describe networkpolicy mqtt-production-policy -n mqtt-production
   ```

3. **Service not accessible** → Check service definition
   ```bash
   kubectl get svc -n mqtt-production -o yaml
   # Verify selectors match pod labels
   ```

4. **Firewall blocking** → Check security groups (AWS)
   ```bash
   # Verify security group allows port 1883 inbound
   aws ec2 describe-security-groups --filters Name=group-name,Values=...
   ```

---

#### Problem: Connection Drops Unexpectedly

**Symptoms:**
- Clients randomly disconnect
- Connection timeout after period of inactivity
- Frequent reconnection attempts

**Diagnosis:**

```bash
# 1. Check connection limits
kubectl exec -n mqtt-production emqx-0 -- \
  emqx ctl sessions list | head -20

# 2. Check for pod restarts
kubectl get pods -n mqtt-production -o jsonpath='{.items[*].status.containerStatuses[0].restartCount}'

# 3. Check logs for disconnection errors
kubectl logs -n mqtt-production emqx-0 | grep -i "disconnect\|kick"

# 4. Monitor active connections
kubectl exec -n mqtt-production emqx-0 -- \
  emqx_ctl status | grep connections
```

**Solutions:**

1. **Pod crashing** → Investigate restart cause
   ```bash
   kubectl logs -n mqtt-production emqx-0 --previous
   ```

2. **Keep-alive timeout** → Check EMQX configuration
   ```bash
   # Default keepalive timeout: 60 seconds
   # Check emqx.conf for: mqtt.max_packet_size
   ```

3. **Memory limit exceeded** → Increase resource limits
   ```bash
   kubectl set resources statefulset/emqx -n mqtt-production \
     --limits=memory=8Gi
   ```

4. **Too many connections** → Scale up or limit connections
   ```bash
   # Check current max connections
   kubectl exec -n mqtt-production emqx-0 -- \
     grep "max_connections" /opt/emqx/etc/emqx.conf
   ```

---

### Performance Issues

#### Problem: High CPU Usage

**Symptoms:**
- CPU usage consistently above 80%
- Slow message processing
- Client connections lag

**Diagnosis:**

```bash
# 1. Check CPU usage
kubectl top pods -n mqtt-production --containers
# Expected: < 70% CPU

# 2. Check message throughput
curl -s http://emqx.mqtt-production:8081/api/v5/stats | jq '.messages.*'

# 3. Identify heavy operations
kubectl exec -n mqtt-production emqx-0 -- \
  emqx_ctl processes | head -10

# 4. Check for message queue backup
curl -s http://emqx.mqtt-production:8081/api/v5/stats | \
  jq '.messages.queued'
```

**Solutions:**

1. **Increase resources**
   ```bash
   kubectl set resources statefulset/emqx -n mqtt-production \
     --requests=cpu=2000m --limits=cpu=4000m
   ```

2. **Scale up replicas**
   ```bash
   kubectl scale statefulset/emqx --replicas=5 -n mqtt-production
   ```

3. **Optimize EMQX settings**
   - Reduce `max_inflight` in configuration
   - Increase `tcp_acceptors`
   - Enable message batching

4. **Check for stuck sessions**
   ```bash
   kubectl exec -n mqtt-production emqx-0 -- \
     emqx_ctl sessions list | grep -i "stuck\|zombie"
   ```

---

#### Problem: High Memory Usage

**Symptoms:**
- Memory usage growing over time
- Pod restarts due to OOMKilled
- Slow performance

**Diagnosis:**

```bash
# 1. Check memory usage
kubectl top pods -n mqtt-production --containers
# Expected: < 75% of limit

# 2. Check memory trend
kubectl logs -n mqtt-production emqx-0 | grep -i "memory\|heap"

# 3. Check RSS memory from EMQX status
curl -s http://emqx.mqtt-production:8081/api/v5/stats | \
  jq '.memory'

# 4. Check for memory leaks
kubectl exec -n mqtt-production emqx-0 -- \
  emqx_ctl memory
```

**Solutions:**

1. **Increase memory limit**
   ```bash
   kubectl set resources statefulset/emqx -n mqtt-production \
     --limits=memory=8Gi
   ```

2. **Enable memory management**
   ```bash
   # In emqx.conf:
   # vm.memory_high_watermark = 0.6
   ```

3. **Restart pod to clear memory**
   ```bash
   kubectl delete pod emqx-2 -n mqtt-production
   # StatefulSet will recreate it
   ```

4. **Reduce connection limits if needed**
   ```bash
   kubectl exec -n mqtt-production emqx-0 -- \
     emqx ctl set_config "listener.tcp.max_connections" "100000"
   ```

---

### Data and Persistence Issues

#### Problem: Messages Not Persisted

**Symptoms:**
- Messages lost after broker restart
- Retained messages not available
- Session data not preserved

**Diagnosis:**

```bash
# 1. Check persistence configuration
kubectl exec -n mqtt-production emqx-0 -- \
  grep -E "message_ttl|enable_stats|persist" /opt/emqx/etc/emqx.conf

# 2. Check if Redis is accessible
kubectl exec -n mqtt-production emqx-0 -- \
  redis-cli -h redis.default ping

# 3. Check persistent volume status
kubectl get pvc -n mqtt-production
# Expected: All in "Bound" status

# 4. Check Redis message store
kubectl exec -n mqtt-production emqx-0 -- \
  redis-cli -h redis.default keys "msg:*" | wc -l
```

**Solutions:**

1. **Enable message persistence in EMQX**
   ```bash
   # Update ConfigMap with:
   # backend.redis.enable = on
   kubectl apply -f configmap-secrets.yaml
   kubectl rollout restart statefulset/emqx -n mqtt-production
   ```

2. **Verify Redis connection**
   ```bash
   curl -X POST http://emqx.mqtt-production:8081/api/v5/nodes/emqx-0@emqx-0.emqx.mqtt-production/redis-test
   ```

3. **Check volume mount**
   ```bash
   kubectl exec -n mqtt-production emqx-0 -- \
     df -h /var/lib/emqx
   ```

4. **Restore from backup if data lost**
   ```bash
   kubectl apply -f backup-recovery.yaml
   # Then trigger restore job
   ```

---

#### Problem: PVC not Mounting

**Symptoms:**
- Pod stuck in `ContainerCreating` state
- Volume mount errors in logs

**Diagnosis:**

```bash
# 1. Check PVC status
kubectl get pvc -n mqtt-production

# 2. Check PV status
kubectl get pv

# 3. Check pod events
kubectl describe pod emqx-0 -n mqtt-production
# Look for "Unable to mount volume"

# 4. Check node disk space
kubectl describe node <node-name> | grep "Allocatable\|Allocated"
```

**Solutions:**

1. **Volume not provisioned correctly**
   ```bash
   # Update persistent.yaml with correct volume IDs
   # Then re-apply
   kubectl apply -f persistence.yaml
   ```

2. **Node disk full**
   ```bash
   # Check available disk space on nodes
   # Delete old volumes or scale to different nodes
   kubectl get nodes -o wide
   ```

3. **PVC in wrong state**
   ```bash
   # Delete and recreate PVC
   kubectl delete pvc emqx-pvc -n mqtt-production
   kubectl apply -f persistence.yaml
   ```

---

### Cluster Issues

#### Problem: Cluster Not Forming

**Symptoms:**
- Multiple pods showing as separate clusters
- `emqx ctl cluster status` shows only local node
- Pods not discovering each other

**Diagnosis:**

```bash
# 1. Check cluster status
kubectl exec -n mqtt-production emqx-0 -- \
  emqx ctl cluster status

# 2. Check cluster discovery configuration
kubectl get configmap -n mqtt-production emqx -o yaml | \
  grep -A5 "cluster.discovery"

# 3. Check pod network connectivity
kubectl exec -n mqtt-production emqx-0 -- \
  nslookup emqx-1.emqx.mqtt-production.svc.cluster.local

# 4. Check EMQX logs for cluster errors
kubectl logs -n mqtt-production emqx-0 | grep -i "cluster\|join"
```

**Solutions:**

1. **Kubernetes discovery not configured**
   ```bash
   # Ensure emqx.conf has:
   # cluster.discovery = k8s
   # cluster.k8s.apiserver = https://kubernetes.default:443
   kubectl apply -f configmap-secrets.yaml
   kubectl rollout restart statefulset/emqx -n mqtt-production
   ```

2. **Pods can't resolve headless service**
   ```bash
   # Verify headless service
   kubectl get svc -n mqtt-production emqx
   # Should have ClusterIP: None
   ```

3. **Network policy blocking discovery**
   ```bash
   # Check intra-cluster policy allows ports 4370, 5370
   kubectl describe networkpolicy mqtt-cluster-communication \
     -n mqtt-production
   ```

4. **Service account missing permissions**
   ```bash
   # Ensure RBAC allows reading pods/services
   kubectl get clusterrole,clusterrolebinding | grep emqx
   ```

---

#### Problem: Node Eviction or Drain

**Symptoms:**
- Pods evicted due to resource pressure
- Pods failing to terminate gracefully
- Data loss during node drain

**Diagnosis:**

```bash
# 1. Check PDB status
kubectl get pdb -n mqtt-production

# 2. Check pod disruption budget
kubectl describe pdb emqx-pdb -n mqtt-production

# 3. Check for eviction events
kubectl get events -n mqtt-production --sort-by='.lastTimestamp' | \
  grep -i "evict\|preempt"

# 4. Check node pressure
kubectl describe node <node-name> | grep "Pressure\|MemoryPressure"
```

**Solutions:**

1. **Increase PDB minimum availability**
   ```bash
   kubectl patch pdb emqx-pdb -n mqtt-production \
     --type merge -p '{"spec":{"minAvailable":2}}'
   ```

2. **Graceful drain of node**
   ```bash
   # Increase termination grace period
   kubectl patch statefulset/emqx -n mqtt-production \
     --type merge -p '{"spec":{"template":{"spec":{"terminationGracePeriodSeconds":120}}}}'
   
   # Then drain node
   kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
   ```

3. **Monitor graceful shutdown**
   ```bash
   kubectl logs -f emqx-0 -n mqtt-production
   # Should see "graceful shutdown" messages
   ```

---

### Monitoring and Alerting Issues

#### Problem: Metrics Not Appearing in Prometheus

**Symptoms:**
- ServiceMonitor created but no metrics scraped
- Prometheus shows target as "Down"
- Empty metrics in Grafana

**Diagnosis:**

```bash
# 1. Check ServiceMonitor
kubectl get servicemonitor -n mqtt-production
kubectl describe servicemonitor emqx -n mqtt-production

# 2. Check Prometheus targets
# - Navigate to Prometheus UI
# - Go to Status -> Targets
# - Look for emqx targets

# 3. Check if metrics endpoint is working
curl -s http://emqx.mqtt-production:8081/api/v5/prometheus/stats | head

# 4. Check Prometheus scrape configuration
kubectl get prometheus -n monitoring -o yaml | grep -A10 "serviceMonitor"
```

**Solutions:**

1. **ServiceMonitor selector mismatch**
   ```bash
   # Ensure labels match
   kubectl apply -f service-discovery.yaml
   ```

2. **Metrics endpoint not accessible**
   ```bash
   # Check EMQX API port is exposed
   kubectl get svc -n mqtt-production emqx-api
   ```

3. **Prometheus not scraping**
   ```bash
   # Reload Prometheus configuration
   kubectl rollout restart prometheus -n monitoring
   ```

4. **Authentication required for metrics**
   ```bash
   # If API requires auth, update ServiceMonitor with credentials
   ```

---

#### Problem: Alerts Not Firing

**Symptoms:**
- Alert conditions met but no notifications
- Alert shows as "Inactive" in Prometheus
- No slack messages

**Diagnosis:**

```bash
# 1. Check PrometheusRule
kubectl get prometheusrule -n mqtt-production
kubectl describe prometheusrule emqx-alerts -n mqtt-production

# 2. Check Prometheus alert state
# - Go to Prometheus UI
# - Go to Alerts tab
# - Check alert status

# 3. Check Alertmanager configuration
kubectl get secret -n monitoring | grep alertmanager

# 4. Test metric query
curl -s 'http://prometheus:9090/api/v1/query?query=mqtt_connections_active'
```

**Solutions:**

1. **PrometheusRule syntax error**
   ```bash
   # Validate YAML
   kubectl apply -f monitoring-logging.yaml --dry-run=client
   ```

2. **Metric doesn't exist**
   ```bash
   # Verify metric is being scraped
   curl -s http://emqx:8081/api/v5/prometheus/stats | grep metric_name
   ```

3. **Alertmanager webhook not configured**
   ```bash
   # Update secret with correct webhook URL
   kubectl patch secret emqx-alert-webhook -n mqtt-production \
     --type merge -p '{...}'
   ```

4. **Alert threshold too high**
   ```bash
   # Review threshold values in PrometheusRule
   # Temporarily lower for testing
   kubectl patch prometheusrule emqx-alerts -n mqtt-production \
     --type merge -p '{...}'
   ```

---

## Useful Commands

### Quick Health Check

```bash
# Full cluster health
kubectl get pods,pvc,svc -n mqtt-production
kubectl top pods -n mqtt-production
curl -s http://emqx:8081/api/v5/stats | jq '.'

# Quick cluster status
kubectl exec -n mqtt-production emqx-0 -- emqx ctl cluster status

# Check recent logs
kubectl logs -n mqtt-production emqx-0 | tail -50
```

### Get EMQX Info

```bash
# Version
kubectl exec -n mqtt-production emqx-0 -- emqx ctl version

# Running nodes
kubectl exec -n mqtt-production emqx-0 -- emqx_ctl running_nodes

# Statistics
kubectl exec -n mqtt-production emqx-0 -- emqx_ctl stats

# Connections
kubectl exec -n mqtt-production emqx-0 -- emqx ctl info clients
```

### Emergency Actions

```bash
# Restart single pod
kubectl delete pod emqx-2 -n mqtt-production

# Restart all pods
kubectl rollout restart statefulset/emqx -n mqtt-production

# Scale to emergency size
kubectl scale statefulset/emqx --replicas=1 -n mqtt-production

# Force delete stuck pod
kubectl delete pod emqx-0 -n mqtt-production --grace-period=0 --force
```

---

## Escalation Path

1. **Check dashboard and alerts** → Review Grafana/Prometheus
2. **Check logs** → `kubectl logs -f <pod>`
3. **Check events** → `kubectl get events -n mqtt-production`
4. **Run diagnostics** → Refer to diagnosis steps above
5. **Escalate to infrastructure team** → If node/cluster issue
6. **Engage EMQX support** → If configuration/performance issue

---

## Contact Information

- **On-Call Response**: Team Slack channel #mqtt-broker
- **Infrastructure Team**: infrastructure@evzone.dev
- **EMQX Support**: support@emqx.io
- **AWS Support**: AWS account contact
