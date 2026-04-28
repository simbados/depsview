/**
 * Tests for src/testFilter.js.
 * Covers isTestDirectory and isTestRequirementsFile for all recognised patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTestDirectory, isTestRequirementsFile } from '../src/testFilter.js';

// ── isTestDirectory ───────────────────────────────────────────────────────────

describe('isTestDirectory', () => {
  it('returns true for "test"', () => {
    assert.equal(isTestDirectory('test'), true);
  });

  it('returns true for "tests"', () => {
    assert.equal(isTestDirectory('tests'), true);
  });

  it('returns true for "testing"', () => {
    assert.equal(isTestDirectory('testing'), true);
  });

  it('returns true for "e2e"', () => {
    assert.equal(isTestDirectory('e2e'), true);
  });

  it('returns true for "integration_tests"', () => {
    assert.equal(isTestDirectory('integration_tests'), true);
  });

  it('is case-insensitive — "Tests" returns true', () => {
    assert.equal(isTestDirectory('Tests'), true);
  });

  it('is case-insensitive — "TEST" returns true', () => {
    assert.equal(isTestDirectory('TEST'), true);
  });

  it('returns false for "src"', () => {
    assert.equal(isTestDirectory('src'), false);
  });

  it('returns false for "custom_components"', () => {
    assert.equal(isTestDirectory('custom_components'), false);
  });

  it('returns false for an empty string', () => {
    assert.equal(isTestDirectory(''), false);
  });

  it('returns false for "myintegration"', () => {
    assert.equal(isTestDirectory('myintegration'), false);
  });
});

// ── isTestRequirementsFile ────────────────────────────────────────────────────

describe('isTestRequirementsFile', () => {
  it('returns true for "requirements-test.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-test.txt'), true);
  });

  it('returns true for "requirements-tests.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-tests.txt'), true);
  });

  it('returns true for "requirements-testing.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-testing.txt'), true);
  });

  it('returns true for "dev-requirements.txt"', () => {
    assert.equal(isTestRequirementsFile('dev-requirements.txt'), true);
  });

  it('returns true for "requirements-dev.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-dev.txt'), true);
  });

  it('returns true for "requirements-lint.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-lint.txt'), true);
  });

  it('returns true for "requirements-docs.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements-docs.txt'), true);
  });

  it('returns true for "ci.txt" (segment "ci" matches)', () => {
    assert.equal(isTestRequirementsFile('ci.txt'), true);
  });

  it('returns true for "requirements_test.txt" (underscore separator)', () => {
    assert.equal(isTestRequirementsFile('requirements_test.txt'), true);
  });

  it('is case-insensitive — "Requirements-Test.txt" returns true', () => {
    assert.equal(isTestRequirementsFile('Requirements-Test.txt'), true);
  });

  it('returns false for "requirements.txt"', () => {
    assert.equal(isTestRequirementsFile('requirements.txt'), false);
  });

  it('returns false for "base-requirements.txt"', () => {
    assert.equal(isTestRequirementsFile('base-requirements.txt'), false);
  });

  it('returns false for "Pipfile"', () => {
    assert.equal(isTestRequirementsFile('Pipfile'), false);
  });

  it('returns false for "pyproject.toml"', () => {
    assert.equal(isTestRequirementsFile('pyproject.toml'), false);
  });
});
