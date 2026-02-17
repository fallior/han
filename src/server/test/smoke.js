#!/usr/bin/env node
/**
 * Claude Remote - Smoke Test Suite
 * Lightweight checks: syntax validation, exports, Node version
 * No external test framework required
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const results = [];

/**
 * Log a test result and track pass/fail
 */
function logResult(testName, passed, error = null) {
    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${testName}`);
    if (error) {
        console.log(`       ${error}`);
    }
    results.push({ testName, passed });
}

/**
 * Test 1: Syntax validation with node --check
 */
function testSyntaxValidation() {
    const filesToCheck = [
        'server.js',
        'orchestrator.js'
    ];

    filesToCheck.forEach(file => {
        try {
            execSync(`node --check ${file}`, {
                stdio: 'pipe',
                timeout: 10000,
                cwd: path.join(__dirname, '..')
            });
            logResult(`Syntax check: ${file}`, true);
        } catch (error) {
            logResult(
                `Syntax check: ${file}`,
                false,
                error.message.split('\n')[0]
            );
        }
    });
}

/**
 * Test 2: Load orchestrator.js and verify exports
 * Mock better-sqlite3 and @anthropic-ai/claude-agent-sdk
 */
function testOrchestratorExports() {
    try {
        // Mock modules before requiring orchestrator
        const mockModules = {
            'better-sqlite3': class MockDB {
                prepare() { return { all: () => [], run: () => ({}) }; }
                close() {}
            },
            '@anthropic-ai/claude-agent-sdk': {
                query: async () => ({ content: [{ text: '{}' }] })
            }
        };

        // Intercept require to use mocks
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function(id) {
            if (mockModules[id]) {
                return mockModules[id];
            }
            return originalRequire.apply(this, arguments);
        };

        // Load orchestrator
        const orchestrator = originalRequire.call(
            module,
            '../orchestrator'
        );

        // Restore original require
        Module.prototype.require = originalRequire;

        // Verify exported functions exist
        const requiredExports = [
            'getStatus',
            'recommendModel',
            'analyseFailure',
            'selectModel'
        ];

        let allExportsPresent = true;
        requiredExports.forEach(exportName => {
            if (typeof orchestrator[exportName] !== 'function') {
                logResult(
                    `Orchestrator export: ${exportName}`,
                    false,
                    `${exportName} is not a function (${typeof orchestrator[exportName]})`
                );
                allExportsPresent = false;
            }
        });

        if (allExportsPresent) {
            logResult('Orchestrator exports', true);
        }
    } catch (error) {
        logResult(
            'Orchestrator exports',
            false,
            error.message
        );
    }
}

/**
 * Test 3: Validate Node.js version against engines constraint
 */
function testNodeVersion() {
    try {
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

        if (!packageJson.engines || !packageJson.engines.node) {
            logResult('Node version constraint', false, 'No engines.node specified');
            return;
        }

        const constraint = packageJson.engines.node;
        const runningVersion = process.version.slice(1); // Remove 'v' prefix

        // Simple check: constraint should be >=X.Y.Z
        const minVersionMatch = constraint.match(/^>=(\d+\.\d+\.\d+)/);
        if (!minVersionMatch) {
            logResult('Node version constraint', false, `Cannot parse constraint: ${constraint}`);
            return;
        }

        const minVersion = minVersionMatch[1];
        const [minMajor, minMinor, minPatch] = minVersion.split('.').map(Number);
        const [runMajor, runMinor, runPatch] = runningVersion.split('.').map(Number);

        const isSatisfied = runMajor > minMajor ||
            (runMajor === minMajor && runMinor > minMinor) ||
            (runMajor === minMajor && runMinor === minMinor && runPatch >= minPatch);

        if (isSatisfied) {
            logResult(
                `Node version (${runningVersion} >= ${minVersion})`,
                true
            );
        } else {
            logResult(
                `Node version (${runningVersion} >= ${minVersion})`,
                false,
                `Running version ${runningVersion} does not satisfy ${constraint}`
            );
        }
    } catch (error) {
        logResult('Node version constraint', false, error.message);
    }
}

/**
 * Main test runner
 */
function runAllTests() {
    console.log('🧪 Claude Remote Smoke Tests\n');

    testSyntaxValidation();
    testOrchestratorExports();
    testNodeVersion();

    // Summary
    console.log('\n─────────────────────────────────────');
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const passedStr = `${passed}/${total}`;

    console.log(`Tests: ${passedStr} passed`);

    if (passed === total) {
        console.log('✓ All checks passed');
        process.exit(0);
    } else {
        console.log('✗ Some checks failed');
        process.exit(1);
    }
}

// Run tests
runAllTests();
