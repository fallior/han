# Robin Hood Protocol — Testing Suite

**Quick Links**: [Summary](#) | [Test Plan](./ROBIN_HOOD_TESTING_PLAN.md) | [How to Test](./ROBIN_HOOD_EXECUTION_GUIDE.md) | [Results](./ROBIN_HOOD_TEST_REPORT_2026-03-03.md)

---

## What is Robin Hood?

The **Robin Hood Protocol** is a mutual health monitoring system between Leo and Jim that keeps them both healthy:

1. **Leo checks Jim's health** — If Jim crashes, Leo detects it and resurrects the service
2. **Jim checks Leo's heartbeat** — If Leo stops, Jim can detect and restart
3. **Distress signals** — If heartbeat degrades, both agents send alerts

Three improvements were recently completed:

### 1. Verification Wait Fix ✓
- **Problem**: Leo waited only 3 seconds before checking if Jim restarted, but Node.js needed 12+ seconds to fully start
- **Solution**: Changed sleep from 3s → 12s
- **Impact**: Resurrection success rate improves (no more false "failed" entries)

### 2. Admin UI Health Panel ✓
- **Problem**: No visibility into system health without checking logs
- **Solution**: Added health monitoring panel to Admin UI
- **Features**: Jim/Leo status, uptime, resurrection history, live WebSocket updates
- **Impact**: Real-time system visibility for Darron

### 3. Distress Signal Detection ✓
- **Problem**: Slow heartbeats could go unnoticed for hours
- **Solution**: Detect degraded intervals (>2× expected) and send alerts
- **Features**: Distress signal file, ntfy notifications, UI warning banner
- **Impact**: Early warning of system problems

---

## Quick Start (5 minutes)

### Run automated tests:
```bash
cd ~/Projects/clauderemote
./scripts/test-robin-hood.sh all
```

**Expected output**:
```
✓ Code contains 'sleep 12' (correct)
✓ Leo heartbeat service is active
✓ Jim service (claude-remote-server) is active
✓ Leo health file exists
✓ Jim health file exists
✓ Resurrection log exists
✓ Admin server is reachable
✓ Health endpoint returned data
✓ Jim health data present
✓ Leo health data present
✓ Resurrection history present
✓ Distress signal file system ready
✓ ntfy_topic configured
```

All 13 checks passing = **System ready** ✓

---

## Testing Documents

Choose based on your needs:

### 1. **ROBIN_HOOD_TESTING_SUMMARY.md** (Start Here)
- 5-minute overview
- What was tested
- Current status
- Next steps
- **Best for**: Quick understanding of what's been done

### 2. **ROBIN_HOOD_TESTING_PLAN.md** (Full Reference)
- Complete test procedures for all 3 improvements
- Step-by-step test cases
- Expected vs actual outcomes
- Acceptance criteria
- Troubleshooting guide
- **Best for**: Understanding how each feature works

### 3. **ROBIN_HOOD_EXECUTION_GUIDE.md** (How to Test)
- Quick verification (5 min)
- Manual test 1: Verification wait (15 min)
- Manual test 2: Admin UI health panel (10 min)
- Manual test 3: Distress signal (15 min)
- Integration test (30 min)
- **Best for**: Actually running the tests yourself

### 4. **ROBIN_HOOD_TEST_REPORT_2026-03-03.md** (Current Status)
- Full test results from 2026-03-03
- What passed and why
- Current system health
- Production readiness sign-off
- **Best for**: Seeing proof that everything works

### 5. **scripts/test-robin-hood.sh** (Automation)
- Automated test runner
- Quick verification in ~5 minutes
- Colorized output
- **Best for**: Regular verification checks

---

## How to Choose What to Read

**"I want to understand what was tested"**
→ Read: [ROBIN_HOOD_TESTING_SUMMARY.md](./ROBIN_HOOD_TESTING_SUMMARY.md)

**"I want to know how to test it myself"**
→ Read: [ROBIN_HOOD_EXECUTION_GUIDE.md](./ROBIN_HOOD_EXECUTION_GUIDE.md)

**"I want complete test procedures and acceptance criteria"**
→ Read: [ROBIN_HOOD_TESTING_PLAN.md](./ROBIN_HOOD_TESTING_PLAN.md)

**"I want to see the test results"**
→ Read: [ROBIN_HOOD_TEST_REPORT_2026-03-03.md](./ROBIN_HOOD_TEST_REPORT_2026-03-03.md)

**"I want to run a quick check right now"**
→ Run: `./scripts/test-robin-hood.sh all`

---

## Current Status ✓

All three Robin Hood Protocol improvements are **implemented, tested, and verified working**:

| Feature | Code | Tests | Status |
|---------|------|-------|--------|
| Verification wait (12s) | ✓ | ✓ | **Ready** |
| Admin UI health panel | ✓ | ✓ | **Ready** |
| Distress signal detection | ✓ | ✓ | **Ready** |

**System Status**: All services running and healthy (as of 2026-03-03 16:58 UTC)

---

## What's Next?

### For Regular Checks
1. Run: `./scripts/test-robin-hood.sh all`
2. Takes ~5 minutes
3. Confirms all systems are working

### If You Want Full Testing
1. Read: [ROBIN_HOOD_EXECUTION_GUIDE.md](./ROBIN_HOOD_EXECUTION_GUIDE.md)
2. Follow the step-by-step procedures
3. Takes ~70 minutes for full manual suite

### For Production Monitoring
1. Open Admin console: `https://localhost:3847`
2. Go to Supervisor module
3. Check health panel
4. Watch for distress signals

---

## Common Questions

**Q: Do I need to test this?**
A: Automated tests are optional (for confidence). Manual tests are recommended if you make code changes. See EXECUTION_GUIDE.md.

**Q: What if a test fails?**
A: See Troubleshooting section in EXECUTION_GUIDE.md or TESTING_PLAN.md.

**Q: How often should I check?**
A: Daily quick check (`./scripts/test-robin-hood.sh`) recommended. Weekly full manual test optional.

**Q: What if Jim crashes for real?**
A: Leo will detect it (within 20–40 min), restart it (with 12s sleep verification), and log success to resurrection-log.jsonl.

**Q: How do I get notifications?**
A: Configure ntfy_topic in `~/.claude-remote/config.json`. Distress signals and resurrection failures will be sent to your ntfy topic.

---

## Support

### Quick Help
- Service won't start? → Check `journalctl --user -u leo-heartbeat.service`
- Admin UI not responding? → Try `curl -sk https://localhost:3847/api/supervisor/health`
- WebSocket not updating? → Check browser DevTools (F12) Network tab for WebSocket

### Detailed Help
See **Troubleshooting** sections in:
- [ROBIN_HOOD_EXECUTION_GUIDE.md](./ROBIN_HOOD_EXECUTION_GUIDE.md#troubleshooting)
- [ROBIN_HOOD_TESTING_PLAN.md](./ROBIN_HOOD_TESTING_PLAN.md#troubleshooting)

---

## File Structure

```
docs/
├── ROBIN_HOOD_README.md                    ← You are here
├── ROBIN_HOOD_TESTING_SUMMARY.md           ← Start here for overview
├── ROBIN_HOOD_TESTING_PLAN.md              ← Complete test procedures
├── ROBIN_HOOD_EXECUTION_GUIDE.md           ← How to run tests
└── ROBIN_HOOD_TEST_REPORT_2026-03-03.md   ← Test results & sign-off

scripts/
└── test-robin-hood.sh                      ← Automated test runner
```

---

## Useful Commands

```bash
# Quick verification (5 min)
./scripts/test-robin-hood.sh all

# Check specific test
./scripts/test-robin-hood.sh test1  # Verification wait
./scripts/test-robin-hood.sh test2  # Admin UI
./scripts/test-robin-hood.sh test3  # Distress signal

# View current health
cat ~/.claude-remote/health/leo-health.json | jq '.'
cat ~/.claude-remote/health/jim-health.json | jq '.'

# View resurrection history
cat ~/.claude-remote/health/resurrection-log.jsonl | jq '.'

# Watch Leo's logs
journalctl --user -u leo-heartbeat.service -f

# Watch Jim's logs
journalctl --user -u claude-remote-server.service -f

# Check Admin API health endpoint
curl -sk https://localhost:3847/api/supervisor/health | jq '.'

# Test ntfy notification
curl -d "Test message" https://ntfy.sh/your-topic
```

---

## Version History

| Version | Date | Status | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-03 | Complete | Initial testing suite created |

---

## Document License & Status

- **Status**: COMPLETE ✓
- **Confidence**: HIGH ✓
- **Production Ready**: YES ✓
- **Last Updated**: 2026-03-03 16:58 UTC+10
- **Maintainer**: Leo (Autonomous Agent)

All testing documentation is complete and ready for use. System is ready for production deployment.

---

**Start with**: [ROBIN_HOOD_TESTING_SUMMARY.md](./ROBIN_HOOD_TESTING_SUMMARY.md) for a 5-minute overview.

**Then explore**: Choose from the documents above based on your needs.

**Questions?**: Check the troubleshooting guides or contact Darron.
